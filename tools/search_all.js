const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

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
      const resolvedDir = directory ? path.resolve(directory) : '/';
      let results = [];

      // 1. If searching entire system, use 'locate' for instantaneous indexed results
      if (resolvedDir === '/') {
        const locateResult = spawnSync('locate', [
          '-i',
          pattern
        ], { encoding: 'utf8' });

        if (!locateResult.error && locateResult.status === 0) {
          const matched = locateResult.stdout.split('\n')
            .filter(Boolean)
            .filter(p => !p.includes('node_modules/') && !p.includes('.git/'));
          if (matched.length > 0) {
            results = matched.slice(0, 100).map(p => `[Path] ${p}`);
          }
        }
      }

      // 2. Fallback to native 'find' if locate returned nothing, had an error, or a specific directory was targeted
      if (results.length === 0) {
        const findResult = spawnSync('find', [
          resolvedDir,
          '-iname',
          `*${pattern}*`
        ], { encoding: 'utf8' });

        if (!findResult.error && findResult.stdout) {
          const matched = findResult.stdout.split('\n')
            .filter(Boolean)
            .filter(p => !p.includes('node_modules/') && !p.includes('.git/'));
          results = matched.slice(0, 100).map(p => `[Path] ${p}`);
        }
      }

      if (results.length === 0) {
        return 'No matching files or folders found.';
      }

      return results.join('\n');
    } catch (err) {
      return `Error searching: ${err.message}`;
    }
  }
};
