// @ts-nocheck
const fs = require('fs');
const path = require('path');
const { glob } = require('glob');

module.exports = {
  name: "glob_search",
  description: "Find files and directories using glob patterns (e.g., '**/*.js', 'src/**/*.ts'). Supports pagination.",
  parameters: {
    type: "object",
    properties: {
      pattern: { type: "string", description: "Glob pattern to match files/directories." },
      directory: { type: "string", description: "Root directory to search in (defaults to current working directory)." },
      offset: { type: "integer", description: "Number of results to skip (pagination, default 0)." },
      limit: { type: "integer", description: "Maximum results to return (default 100, max 500)." }
    },
    required: ["pattern"]
  },
  async execute({ pattern, directory, offset = 0, limit = 100 }) {
    try {
      if (!pattern || typeof pattern !== 'string' || pattern.trim() === '') {
        return 'Error: Required parameter "pattern" is missing or empty.';
      }
      const searchDir = directory ? path.resolve(directory) : process.cwd();
      if (!fs.existsSync(searchDir)) {
        return `Error: Directory not found: ${searchDir}`;
      }
      const maxLimit = Math.min(limit, 500);
      const { getGlobIgnorePatterns } = require('../utils/ignore');
      const options = {
        cwd: searchDir,
        absolute: true,
        nodir: false,
        ignore: getGlobIgnorePatterns()
      };
      let matches = await glob(pattern, options);
      matches = matches.sort();
      const total = matches.length;
      const start = Math.min(offset, total);
      const end = Math.min(start + maxLimit, total);
      const paginated = matches.slice(start, end);
      const hasMore = end < total;
      let output = `[Search Complete] Found ${total} result(s) for pattern "${pattern}" in ${searchDir}:\n${paginated.join('\n')}`;
      if (hasMore) {
        output += `\n\n[Showing ${start+1}-${end} of ${total}. Use offset=${end}&limit=${maxLimit} to see more.]`;
      }
      return output;
    } catch (err) {
      return `Error in glob search: ${err.message}`;
    }
  }
};
