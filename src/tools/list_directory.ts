// @ts-nocheck
const fs = require('fs');
const path = require('path');
const { isPathAllowed, getPermissionErrorPath } = require('../utils/permissions');

module.exports = {
  name: "list_directory",
  description: "Retrieves files and folders within a given directory. Supports recursive tree view with depth control and pagination.",
  parameters: {
    type: "object",
    properties: {
      path: { type: "string", description: "The directory path to inspect." },
      recursive: { type: "boolean", description: "Whether to list contents recursively (default false)." },
      max_depth: { type: "integer", description: "Maximum depth for recursive listing (default 3). Ignored if recursive is false." },
      offset: { type: "integer", description: "Number of items to skip (for pagination, default 0)." },
      limit: { type: "integer", description: "Maximum number of items to return (default 200, max 1000)." },
      include_metadata: { type: "boolean", description: "Append pagination metadata to the output (default false)." }
    },
    required: ["path"]
  },
  async execute({ path: dirPath, recursive = false, max_depth = 3, offset = 0, limit = 200, include_metadata = false }) {
    try {
      if (!dirPath || typeof dirPath !== 'string' || dirPath.trim() === '') {
        return 'Error: Required parameter "path" is missing or empty.';
      }
      const resolvedPath = path.resolve(dirPath);
      if (!isPathAllowed(resolvedPath)) {
        return getPermissionErrorPath(resolvedPath);
      }
      if (!fs.existsSync(resolvedPath)) {
        return `Error: Directory not found: ${resolvedPath}`;
      }
      if (!fs.statSync(resolvedPath).isDirectory()) {
        return `Error: Path is not a directory: ${resolvedPath}`;
      }
      const IGNORE = new Set(['node_modules', '.git', 'dist', 'build', '.next', '__pycache__']);
      const maxLimit = Math.min(limit, 1000);
      function formatSize(bytes) {
        if (bytes < 1024) return `${bytes}B`;
        if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
        return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
      }
      function walk(dir, depth, prefix) {
        if (depth > max_depth) return [];
        let items;
        try { items = fs.readdirSync(dir, { withFileTypes: true }); } catch { return [`${prefix}[unreadable]`]; }
        const lines = [];
        for (const item of items) {
          if (IGNORE.has(item.name)) continue;
          const connector = '├── ';
          const childPrefix = '│   ';
          if (item.isDirectory()) {
            lines.push(`${prefix}${connector}${item.name}/`);
            if (recursive) lines.push(...walk(path.join(dir, item.name), depth + 1, prefix + childPrefix));
          } else {
            const size = (() => { try { return formatSize(fs.statSync(path.join(dir, item.name)).size); } catch { return '?'; } })();
            lines.push(`${prefix}${connector}${item.name} (${size})`);
          }
        }
        return lines;
      }
      let allLines = walk(resolvedPath, 1, '');
      if (allLines.length === 0) allLines = ['Directory is empty.'];
      const totalItems = allLines.length;
      const start = Math.min(offset, totalItems);
      const end = Math.min(start + maxLimit, totalItems);
      const paginatedLines = allLines.slice(start, end);
      const hasMore = end < totalItems;
      let output = `${resolvedPath}\n${paginatedLines.join('\n')}`;
      if (include_metadata || hasMore) {
        output += `\n\n[Showing ${start+1}-${end} of ${totalItems} items.`;
        if (hasMore) output += ` Use offset=${end}&limit=${maxLimit} to see more.`;
        output += ']';
      }
      return output;
    } catch (err) {
      return `Error listing directory: ${err.message}`;
    }
  }
};
