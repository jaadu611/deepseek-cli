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



    const options = {
      timeout,
      shell: process.env.SHELL || '/bin/sh',
      maxBuffer: 10 * 1024 * 1024, // 10MB
      ...(cwd && { cwd })
    };

    const executeWithRetry = async (attempt) => {
      return new Promise((resolve) => {
        try {
          exec(command, options, (error, stdout, stderr) => {
            let output = '';

            // Handle maxBuffer exceeded gracefully
            if (error && error.code === 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER') {
              output += '[Warning: Output exceeded 10MB buffer and was truncated]\n\n';
              if (stdout) output += `--- STDOUT (partial) ---\n${stdout.slice(0, 5000)}\n\n`;
              if (stderr) output += `--- STDERR (partial) ---\n${stderr.slice(0, 2000)}\n\n`;
              output += `--- STATUS ---\nExit Code: 1\nError: maxBuffer exceeded\n`;
              resolve(output);
              return;
            }

            if (stdout) output += `--- STDOUT ---\n${stdout}\n`;
            if (stderr) output += `--- STDERR ---\n${stderr}\n`;

            const exitCode = error?.code ?? 0;
            const timedOut = error?.killed ?? false;

            output += `--- STATUS ---\nExit Code: ${exitCode}\n`;
            if (timedOut) output += `Timed Out: Yes\n`;
            if (error && !error.killed && error.code !== 0) output += `Error: ${error.message}\n`;

            // Determine if error is transient (network, timeout) for retry
            const isTransient = error && (error.code === 'ETIMEDOUT' || error.signal === 'SIGTERM' || (error.code && error.code >= 500));
            if (isTransient && attempt < retryCount) {
              const delay = retryDelayMs * Math.pow(2, attempt);
              setTimeout(() => {
                executeWithRetry(attempt + 1).then(resolve);
              }, delay);
              return;
            }

            const prefix = (exitCode === 0 && !timedOut) ? '[Command Success]\n' : '[Command Failed]\n';
            const result = prefix + (output.trim() || 'Command executed successfully with no output.');
            resolve(result);
          });
        } catch (syncErr) {
          resolve(`Error: Failed to execute command: ${syncErr.message}`);
        }
      });
    };

    return executeWithRetry(0);
  }
};
