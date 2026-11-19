// @ts-nocheck
const { exec } = require('child_process');
const { isCommandAllowed, getPermissionErrorCommand } = require('../utils/permissions');


module.exports = {
  name: "execute_shell_command",
  description: "Executes a terminal command asynchronously. Supports retries, timeout, and working directory.",
  parameters: {
    type: "object",
    properties: {
      command: { type: "string", description: "The exact shell command to execute." },
      cwd: { type: "string", description: "Working directory (optional)." },
      timeout: { type: "integer", description: "Timeout in milliseconds (default 30000)." },
      retry_count: { type: "integer", description: "Number of automatic retries on transient failures (default 0)." },
      retry_delay_ms: { type: "integer", description: "Base delay between retries in ms (default 1000, exponential backoff)." }
    },
    required: ["command"]
  },
  async execute(params) {
    let command, timeout, cwd, retryCount, retryDelayMs;
    if (typeof params === 'string') {
      command = params;
      timeout = 30000;
      cwd = undefined;
      retryCount = 0;
      retryDelayMs = 1000;
    } else if (params && typeof params === 'object') {
      command = params.command;
      timeout = params.timeout ?? 30000;
      cwd = params.cwd || undefined;
      retryCount = params.retry_count ?? 0;
      retryDelayMs = params.retry_delay_ms ?? 1000;
    } else {
      return 'Error: execute_shell_command called with invalid parameters.';
    }

    if (!command || typeof command !== 'string' || command.trim() === '') {
      return 'Error: The "command" argument must be a non-empty string.';
    }

    // Check permissions
    if (!isCommandAllowed(command)) {
      return getPermissionErrorCommand(command);
    }

    // Validate working directory
    if (cwd) {
      const fs = require('fs');
      if (!fs.existsSync(cwd)) {
        return `Error: Working directory does not exist: ${cwd}`;
      }
    }



    const { spawn } = require('child_process');
    const tui = require('../tui/tui');

    const options = {
      cwd,
      env: { ...process.env, NODE_NO_WARNINGS: '1' },
      shell: process.env.SHELL || '/bin/sh',
    };

    const PROMPT_PATTERNS = [
      /\b(ok to proceed|ok\?|continue\?|proceed\?|want to continue\?)\s*\(?\[?y\/n\]?\)?/i,
      /\[y\/n\]/i,
      /\(y\/n\)/i,
      /ok to proceed\? \([yn]\)/i,
      /\bselect\s+(an?\s+)?option\s*:/i,
      /\bselect\s+a\s+number\s*:/i,
      /\benter\s+(selection|option|choice)\s*:/i,
      /\b(press|hit)\s+\[?enter\]?\s+to\s+continue/i,
    ];

    const respondedPrompts = new Set();
    let promptCount = 0;
    const maxPrompts = 3;

    async function getResponseFromAI(cmdStr, promptText) {
      try {
        const brainRegistry = require('../core/brains/registry');
        const brain = brainRegistry.getActiveBrain();
        if (!brain || typeof brain.getCompletionStream !== 'function') {
          return 'y';
        }

        const tempPage = await brain.createNewPage();
        if (!tempPage) return 'y';

        const aiPrompt = `A terminal command is currently executing and is waiting for user input.\n\n` +
          `Command being run: \`${cmdStr}\`\n` +
          `Terminal output prompting for input:\n` +
          `"""\n${promptText.trim()}\n"""\n\n` +
          `How should we respond to this prompt to proceed successfully? Choose the best answer (typically 'y' or '1' or 'yes').\n` +
          `Respond with ONLY the exact characters to write to the terminal stdin, and absolutely nothing else. No quotes, no markdown, no newlines.`;

        const result = await brain.getCompletionStream(aiPrompt, { page: tempPage, webSearch: false });
        const answer = (result.responseText || 'y').trim().replace(/['"`]/g, '');
        await tempPage.close().catch(() => {});
        return answer;
      } catch (err) {
        return 'y';
      }
    }

    const executeWithRetry = async (attempt) => {
      return new Promise((resolve, reject) => {
        try {
          const child = spawn(options.shell, ['-c', command], {
            cwd: options.cwd,
            env: options.env,
            stdio: ['pipe', 'pipe', 'pipe']
          });

          let stdoutData = '';
          let stderrData = '';
          let accumulatedData = '';

          let hasTimedOut = false;
          const timer = setTimeout(() => {
            hasTimedOut = true;
            try { child.kill('SIGTERM'); } catch {}
          }, timeout);

          const checkForPrompt = async (dataChunk) => {
            accumulatedData += dataChunk;
            const lines = accumulatedData.trim().split('\n');
            const lastLine = lines[lines.length - 1] || '';

            let isPrompt = false;
            for (const pattern of PROMPT_PATTERNS) {
              if (pattern.test(lastLine)) {
                isPrompt = true;
                break;
              }
            }

            if (!isPrompt && lastLine.includes('?') && (lastLine.toLowerCase().includes('y/n') || lastLine.toLowerCase().includes('(y/') || lastLine.toLowerCase().includes('[y/'))) {
              isPrompt = true;
            }

            if (isPrompt && promptCount < maxPrompts) {
              const promptKey = lastLine.trim();
              if (respondedPrompts.has(promptKey)) return;
              respondedPrompts.add(promptKey);
              promptCount++;

              const logItems = tui.getLogItems();
              logItems.push({ type: 'status', text: `[Terminal Prompt] Z.ai is choosing how to proceed...` });
              tui.renderLog();

              const answer = await getResponseFromAI(command, accumulatedData);
              try {
                child.stdin.write(answer + '\n');
              } catch (e) {}
            }
          };

          child.stdout.on('data', (data) => {
            const str = data.toString();
            stdoutData += str;
            checkForPrompt(str);
          });

          child.stderr.on('data', (data) => {
            const str = data.toString();
            stderrData += str;
            checkForPrompt(str);
          });

          child.on('error', (err) => {
            clearTimeout(timer);
            reject(new Error(`Failed to spawn process: ${err.message}`));
          });

          child.on('close', (code) => {
            clearTimeout(timer);

            let output = '';
            // Enforce 10MB limit check
            const maxLimit = 10 * 1024 * 1024;
            if (stdoutData.length > maxLimit || stderrData.length > maxLimit) {
              output += '[Warning: Output exceeded 10MB buffer and was truncated]\n\n';
              if (stdoutData) output += `--- STDOUT (partial) ---\n${stdoutData.slice(0, 5000)}\n\n`;
              if (stderrData) output += `--- STDERR (partial) ---\n${stderrData.slice(0, 2000)}\n\n`;
            } else {
              if (stdoutData) output += `--- STDOUT ---\n${stdoutData}\n`;
              if (stderrData) output += `--- STDERR ---\n${stderrData}\n`;
            }

            const exitCode = code ?? 0;
            output += `--- STATUS ---\nExit Code: ${exitCode}\n`;
            if (hasTimedOut) output += `Timed Out: Yes\n`;

            const isTransient = hasTimedOut || (code !== 0 && code >= 500);
            if (isTransient && attempt < retryCount) {
              const delay = retryDelayMs * Math.pow(2, attempt);
              setTimeout(() => {
                executeWithRetry(attempt + 1).then(resolve, reject);
              }, delay);
              return;
            }

            if (exitCode !== 0 || hasTimedOut) {
              const prefix = hasTimedOut ? '[Command Timed Out]\n' : '[Command Failed]\n';
              const result = prefix + (output.trim() || 'Command executed with no output.');
              reject(new Error(result));
            } else {
              const result = '[Command Success]\n' + (output.trim() || 'Command executed successfully with no output.');
              resolve(result);
            }
          });

        } catch (syncErr) {
          reject(new Error(`Failed to execute command: ${syncErr.message}`));
        }
      });
    };

    return executeWithRetry(0);
  }
};
