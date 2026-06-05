const fs = require('fs');
const path = require('path');

module.exports = {
  name: "read_file",
  description: "Reads a file and returns its content WITH LINE NUMBERS prefixed on each line. ALWAYS use this before patching to get exact line references. Supports optional start/end line range for large files.",
  parameters: {
    type: "object",
    properties: {
      path: { type: "string", description: "Relative or absolute file path." },
      start_line: { type: "integer", description: "Optional. Start reading from this 1-based line number." },
      end_line: { type: "integer", description: "Optional. Stop reading at this 1-based line number (inclusive)." }
    },
    required: ["path"]
  },
  async execute({ path: filePath, start_line, end_line }) {
    const { resolveSubAgentPath } = require('../utils/config');
    filePath = resolveSubAgentPath(filePath);
    try {
      const resolved = path.resolve(filePath);
      if (!fs.existsSync(resolved)) return `Error: File not found: ${resolved}`;
      
      const content = fs.readFileSync(resolved, 'utf8');
      const allLines = content.split('\n');
      
      let lines = allLines;
      let offset = 0;
      
      if (start_line || end_line) {
        const s = Math.max(1, start_line || 1);
        const e = Math.min(allLines.length, end_line || allLines.length);
        lines = allLines.slice(s - 1, e);
        offset = s - 1;
      }
      
      // Prefix every line with its 1-based line number, padded for alignment
      const maxNum = String(offset + lines.length).length;
      const numbered = lines.map((line, i) => {
        const num = String(offset + i + 1).padStart(maxNum, ' ');
        return `${num} │ ${line}`;
      }).join('\n');
      
      const header = `[File: ${resolved}] [Lines: ${offset + 1}-${offset + lines.length} of ${allLines.length}]\n`;
      return header + numbered;
    } catch (err) {
      return `Error reading file: ${err.message}`;
    }
  }
};
