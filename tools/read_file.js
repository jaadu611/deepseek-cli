const fs = require('fs');
const path = require('path');
const { isPathAllowed, getPermissionErrorPath } = require('../utils/permissions');
const { recordContext } = require('../utils/context');

module.exports = {
  name: "read_file",
  description: "Reads and returns the text content of a specified file. For large files, you can read a specific line range or use offset/limit for pagination.",
  parameters: {
    type: "object",
    properties: {
      path: { type: "string", description: "The absolute or relative path to the file." },
      start_line: { type: "integer", description: "Starting line number (1-indexed, optional)." },
      end_line: { type: "integer", description: "Ending line number (1-indexed, optional)." },
      offset: { type: "integer", description: "Number of lines to skip (0-indexed, alternative to start_line)." },
      limit: { type: "integer", description: "Maximum number of lines to return (default: 500, max: 2000)." }
    },
    required: ["path"]
  },
  async execute({ path: filePath, start_line, end_line, offset, limit = 500 }) {
    try {
      if (!filePath || typeof filePath !== 'string' || filePath.trim() === '') {
        return 'Error: Required parameter "path" is missing or empty. Provide a non-empty string path.';
      }

      const resolvedPath = path.resolve(filePath);
      if (!isPathAllowed(resolvedPath)) {
        return getPermissionErrorPath(resolvedPath);
      }

      if (!fs.existsSync(resolvedPath)) {
        return `Error: File not found: ${resolvedPath}`;
      }

      const stat = fs.statSync(resolvedPath);
      if (stat.isDirectory()) {
        return `Error: Path is a directory, not a file: ${resolvedPath}`;
      }

      // 50MB limit to prevent memory issues
      if (stat.size > 50 * 1024 * 1024) {
        return `Error: File size ${(stat.size / 1024 / 1024).toFixed(1)}MB exceeds 50MB limit. Use offset/limit to read chunks.`;
      }

      const content = fs.readFileSync(resolvedPath, 'utf8');
      const lines = content.split('\n');
      const totalLines = lines.length;

      let start = 0;
      let end = totalLines;

      // Pagination via offset/limit
      if (offset !== undefined && offset >= 0) {
        start = Math.min(offset, totalLines);
        const maxLimit = Math.min(limit, 2000);
        end = Math.min(start + maxLimit, totalLines);
      }
      // Legacy start_line/end_line
      else if (start_line !== undefined || end_line !== undefined) {
        if (start_line !== undefined && start_line < 1) {
          return `Error: start_line must be >= 1, got ${start_line}`;
        }
        if (end_line !== undefined && end_line < 1) {
          return `Error: end_line must be >= 1, got ${end_line}`;
        }
        start = (start_line !== undefined && start_line > 0) ? Math.max(0, start_line - 1) : 0;
        end = (end_line !== undefined && end_line > 0) ? Math.min(totalLines, end_line) : totalLines;
        if (start >= totalLines) {
          return `Error: start_line ${start_line} exceeds total lines (${totalLines})`;
        }
        if (end < start) {
          return `Error: end_line (${end_line}) is less than start_line (${start_line})`;
        }
      } else if (limit !== 500) {
        // If limit provided but no offset, start from 0
        const maxLimit = Math.min(limit, 2000);
        end = Math.min(maxLimit, totalLines);
      }

      const selectedLines = lines.slice(start, end);
      let result = selectedLines.join('\n');

      // Append metadata as comment if needed
      const hasMore = end < totalLines;
      if (hasMore || offset !== undefined || limit !== 500) {
        result += `\n\n[Showing lines ${start+1}-${end} of ${totalLines}. Use offset=${end}&limit=${Math.min(limit,2000)} to see more.]`;
      }

      // Truncate if output is extremely long (safety)
      if (result.length > 100000) {
        result = result.slice(0, 100000) + `\n\n[Truncated: ${result.length - 100000} more characters. Use pagination to read in smaller chunks.]`;
      }

      // Record context
      recordContext(resolvedPath);

      return result;
    } catch (err) {
      return `Error reading file: ${err.message}`;
    }
  }
};
