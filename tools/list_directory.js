const fs = require('fs');
const path = require('path');

module.exports = {
  name: "list_directory",
  description: "Retrieves files and folders within a given directory. Supports recursive tree view with depth control. Use this to understand project structure.",
  parameters: {
    type: "object",
    properties: {
      path: {
        type: "string",
        description: "The directory path to inspect."
      },
      recursive: {
        type: "boolean",
        description: "Whether to list contents recursively (optional, defaults to false)."
      },
      max_depth: {
        type: "integer",
        description: "Maximum depth for recursive listing (optional, defaults to 3). Ignored if recursive is false."
      }
    },
    required: ["path"]
  },
  async execute({ path: dirPath, recursive = false, max_depth = 3 }) {
    try {
      if (!dirPath || typeof dirPath !== 'string' || dirPath.trim() === '') {
        return 'Error: Required parameter "path" is missing or empty. You must provide a non-empty string path to the directory.';
      }
      const resolvedPath = path.resolve(dirPath);

      if (!fs.existsSync(resolvedPath)) {
        return `Error: Directory not found: ${resolvedPath}`;
      }
      if (!fs.statSync(resolvedPath).isDirectory()) {
        return `Error: Path is not a directory: ${resolvedPath}`;
      }

      const IGNORE = new Set(['node_modules', '.git', 'dist', 'build', '.next', '__pycache__']);

      function formatSize(bytes) {
        if (bytes < 1024) return `${bytes}B`;
        if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
        return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
      }

      function walk(dir, depth, prefix) {
        if (depth > max_depth) return [];
        let items;
        try {
          items = fs.readdirSync(dir, { withFileTypes: true });
        } catch {
          return [`${prefix}[unreadable]`];
        }
        const lines = [];
        items.forEach((item, i) => {
          if (IGNORE.has(item.name)) return;
          const isLast = i === items.length - 1;
          const connector = isLast ? '└── ' : '├── ';
          const childPrefix = isLast ? '    ' : '│   ';
          if (item.isDirectory()) {
            lines.push(`${prefix}${connector}${item.name}/`);
            if (recursive) {
              lines.push(...walk(path.join(dir, item.name), depth + 1, prefix + childPrefix));
            }
          } else {
            const size = (() => { try { return formatSize(fs.statSync(path.join(dir, item.name)).size); } catch { return '?'; } })();
            lines.push(`${prefix}${connector}${item.name} (${size})`);
          }
        });
        return lines;
      }

      const lines = walk(resolvedPath, 1, '');
      if (lines.length === 0) return 'Directory is empty.';
      return `${resolvedPath}\n${lines.join('\n')}`;
    } catch (err) {
      return `Error listing directory: ${err.message}`;
    }
  }
};
