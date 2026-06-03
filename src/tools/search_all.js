const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const { isPathAllowed, getPermissionErrorPath } = require('../utils/permissions');
const { recordContext } = require('../utils/context');

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
  description: "Searches for files/folders matching a pattern. Supports pagination with offset/limit.",
  parameters: {
    type: "object",
    properties: {
      pattern: { type: "string", description: "The name, pattern, or substring to search for." },
      directory: { type: "string", description: "Root directory to search within (defaults to current working directory)." },
      offset: { type: "integer", description: "Number of results to skip (pagination, default 0)." },
      limit: { type: "integer", description: "Maximum results to return (default 100, max 500)." }
    },
    required: ["pattern"]
  },
  async execute({ pattern, directory, offset = 0, limit = 100 }) {
    try {
      if (!pattern || typeof pattern !== 'string' || pattern.trim() === '') {
        return 'Error: Required parameter "pattern" is missing or empty. Provide a non-empty search pattern.';
      }

      const resolvedDir = directory ? path.resolve(directory) : process.cwd();
      if (!isPathAllowed(resolvedDir)) {
        return getPermissionErrorPath(resolvedDir);
      }

      if (!fs.existsSync(resolvedDir)) {
        return `Error: Directory not found: ${resolvedDir}`;
      }

      // Record context
      recordContext(`search_all in ${resolvedDir} for "${pattern}"`);

      const maxLimit = Math.min(limit, 500);
      let results = [];

      // Use locate for system-wide search (if directory is root and locate available)
      if (resolvedDir === '/' && process.platform !== 'win32') {
        const locateResult = await runCmd('locate', ['-i', pattern]);
        if (!locateResult.error && locateResult.status === 0) {
          const matched = locateResult.stdout.split('\n')
            .filter(Boolean)
            .filter(p => !p.includes('node_modules/') && !p.includes('.git/'));
          if (matched.length > 0) {
            results = matched.map(p => `[Path] ${p}`);
          }
        }
      }

      // Fallback to 'find' for directory-scoped search
      if (results.length === 0) {
        const findResult = await runCmd('find', [
          resolvedDir,
          '-iname', `*${pattern}*`,
          '!', '-path', '*/node_modules/*',
          '!', '-path', '*/.git/*'
        ], 30000);
        if (!findResult.error && findResult.stdout) {
          const matched = findResult.stdout.split('\n').filter(Boolean);
          results = matched.map(p => `[Path] ${p}`);
        }
      }

      const totalResults = results.length;
      if (totalResults === 0) {
        return `No files or folders matching "${pattern}" found in ${resolvedDir}.`;
      }

      const start = Math.min(offset, totalResults);
      const end = Math.min(start + maxLimit, totalResults);
      const paginated = results.slice(start, end);
      const hasMore = end < totalResults;

      let output = `Found ${totalResults} result(s) for "${pattern}" in ${resolvedDir}:\n${paginated.join('\n')}`;
      if (hasMore) {
        output += `\n\n[Showing ${start+1}-${end} of ${totalResults}. Use offset=${end}&limit=${maxLimit} to see more.]`;
      }
      return output;
    } catch (err) {
      return `Error searching: ${err.message}`;
    }
  }
};
