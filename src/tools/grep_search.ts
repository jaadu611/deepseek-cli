// @ts-nocheck
const fs = require('fs');
const path = require('path');
const { glob } = require('glob');

module.exports = {
  name: "grep_search",
  description: "Search file contents for a regular expression pattern. Returns filename:line_number: line content.",
  parameters: {
    type: "object",
    properties: {
      pattern: { type: "string", description: "Regular expression pattern to search for (JavaScript RegExp syntax)." },
      directory: { type: "string", description: "Root directory to search in (defaults to current working directory)." },
      include: { type: "string", description: "Glob pattern to filter files (e.g., '*.js')." },
      exclude: { type: "string", description: "Glob pattern to exclude files (e.g., 'node_modules/**')." },
      offset: { type: "integer", description: "Number of results to skip (pagination, default 0)." },
      limit: { type: "integer", description: "Maximum results to return (default 100, max 500)." }
    },
    required: ["pattern"]
  },
  async execute({ pattern, directory, include, exclude, offset = 0, limit = 100 }) {
    try {
      if (!pattern || typeof pattern !== 'string' || pattern.trim() === '') {
        return 'Error: Required parameter "pattern" is missing or empty.';
      }
      let regex;
      try {
        regex = new RegExp(pattern, 'i');
      } catch (e) {
        return `Error: Invalid regular expression: ${e.message}`;
      }
      const searchDir = directory ? path.resolve(directory) : process.cwd();
      if (!fs.existsSync(searchDir)) {
        return `Error: Directory not found: ${searchDir}`;
      }
      const maxLimit = Math.min(limit, 500);
      let filePattern = include || '**/*';
      const { getGlobIgnorePatterns } = require('../utils/ignore');
      const globOptions = {
        cwd: searchDir,
        absolute: true,
        nodir: true,
        ignore: getGlobIgnorePatterns()
      };
      if (exclude) {
        globOptions.ignore.push(exclude);
      }
      const files = await glob(filePattern, globOptions);
      const results = [];
      for (const file of files.slice(0, 1000)) { // limit total files scanned
        try {
          const content = fs.readFileSync(file, 'utf8');
          const lines = content.split('\n');
          for (let i = 0; i < lines.length; i++) {
            if (regex.test(lines[i])) {
              results.push(`${file}:${i+1}: ${lines[i].trim()}`);
              if (results.length >= 5000) break; // safety
            }
          }
        } catch (err) {
          // skip unreadable files
        }
        if (results.length >= 5000) break;
      }
      const total = results.length;
      const start = Math.min(offset, total);
      const end = Math.min(start + maxLimit, total);
      const paginated = results.slice(start, end);
      const hasMore = end < total;
      let output = `[Search Complete] Found ${total} result(s) for pattern /${pattern}/ in ${searchDir}:\n${paginated.join('\n')}`;
      if (hasMore) {
        output += `\n\n[Showing ${start+1}-${end} of ${total}. Use offset=${end}&limit=${maxLimit} to see more.]`;
      }
      return output;
    } catch (err) {
      return `Error in grep search: ${err.message}`;
    }
  }
};
