const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

// Async wrapper for shell commands to prevent event loop blocking
function runCmd(cmd, args, timeoutMs = 15000) {
  return new Promise((resolve) => {
    const proc = spawn(cmd, args, { encoding: 'utf8' });
    let out = '', err = '';
    proc.stdout.on('data', d => out += d);
    proc.stderr.on('data', d => err += d);
    
    const timer = setTimeout(() => {
      proc.kill('SIGTERM');
      setTimeout(() => resolve({ stdout: out, stderr: err + '\n[Timed out]', status: -1, error: new Error('Timeout') }), 500);
    }, timeoutMs);
    
    proc.on('close', (code) => {
      clearTimeout(timer);
      resolve({ stdout: out, stderr: err, status: code });
    });
    
    proc.on('error', (e) => {
      clearTimeout(timer);
      resolve({ stdout: out, stderr: err + '\n' + e.message, status: -1, error: e });
    });
  });
}

module.exports = {
  name: "search_all",
  description: "Rapidly searches the entire system or a specified directory for files and folders matching a pattern (like the find command, but optimized using index-based locate).",
  parameters: {
    type: "object",
    properties: {
      pattern: {
        type: "string",
        description: "The name, pattern, or substring of the file/folder to look for."
      },
      directory: {
        type: "string",
        description: "The root directory to search within (optional, defaults to searching the entire system '/')."
      }
    },
    required: ["pattern"]
  },
  async execute({ pattern, directory }) {
    try {
      if (!pattern || typeof pattern !== 'string' || pattern.trim() === '') {
        return 'Error: Required parameter "pattern" is missing or empty. You must provide a non-empty search pattern.';
      }
      const resolvedDir = directory ? path.resolve(directory) : process.cwd();
      let results = [];

      // 1. If explicitly searching entire system, use 'locate' for indexed results
      if (resolvedDir === '/') {
        const locateResult = await runCmd('locate', ['-i', pattern]);
        if (!locateResult.error && locateResult.status === 0) {
          const matched = locateResult.stdout.split('\n')
            .filter(Boolean)
            .filter(p => !p.includes('node_modules/') && !p.includes('.git/'));
          if (matched.length > 0) {
            results = matched.slice(0, 100).map(p => `[Path] ${p}`);
          }
        }
      }

      // 2. Use 'find' for directory-scoped searches, or as fallback
      if (results.length === 0) {
        const findResult = await runCmd('find', [
          resolvedDir,
          '-iname', `*${pattern}*`,
          '!', '-path', '*/node_modules/*',
          '!', '-path', '*/.git/*'
        ]);

        if (!findResult.error && findResult.stdout) {
          const matched = findResult.stdout.split('\n').filter(Boolean);
          results = matched.slice(0, 100).map(p => `[Path] ${p}`);
        }
      }

      if (results.length === 0) {
        return `No files or folders matching "${pattern}" found in ${resolvedDir}.`;
      }

      const summary = `Found ${results.length} result(s) for "${pattern}" in ${resolvedDir}:\n`;
      return summary + results.join('\n');
    } catch (err) {
      return `Error searching: ${err.message}`;
    }
  }
};