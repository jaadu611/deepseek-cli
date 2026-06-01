const fs = require('fs');
const path = require('path');

module.exports = {
  name: "read_file",
  description: "Reads and returns the text content of a specified file. For large files, you can read a specific line range.",
  parameters: {
    type: "object",
    properties: {
      path: {
        type: "string",
        description: "The absolute or relative path to the file."
      },
      start_line: {
        type: "integer",
        description: "The starting line number to read (optional, 1-indexed)."
      },
      end_line: {
        type: "integer",
        description: "The ending line number to read (optional, 1-indexed)."
      }
    },
    required: ["path"]
  },
  async execute({ path: filePath, start_line, end_line }) {
    try {
      if (!filePath || typeof filePath !== 'string' || filePath.trim() === '') {
        return 'Error: Required parameter "path" is missing or empty. You must provide a non-empty string path to the file.';
      }
      const resolvedPath = path.resolve(filePath);
      if (!fs.existsSync(resolvedPath)) {
        return `Error: File not found: ${resolvedPath}`;
      }
      const stat = fs.statSync(resolvedPath);
      if (stat.isDirectory()) {
        return `Error: Path is a directory, not a file: ${resolvedPath}`;
      }
      const content = fs.readFileSync(resolvedPath, 'utf8');
      
      if (start_line !== undefined || end_line !== undefined) {
        const lines = content.split('\n');
        const start = (start_line !== undefined && start_line > 0) ? Math.max(0, start_line - 1) : 0;
        const end = (end_line !== undefined && end_line > 0) ? Math.min(lines.length, end_line) : lines.length;
        if (start >= lines.length) {
          return `Error: start_line ${start_line} exceeds number of lines (${lines.length})`;
        }
        return lines.slice(start, end).join('\n');
      }

      return content;
    } catch (err) {
      return `Error reading file: ${err.message}`;
    }
  }
};
