// @ts-nocheck
const path = require('path');
const lspClient = require('../utils/lsp_client');

module.exports = {
  name: "lsp_hover",
  description: "Get type information and documentation for a symbol at a specific position. Returns the type signature, JSDoc/docstring, and overload info. Use to understand what a function returns or what type a variable is.",
  parameters: {
    type: "object",
    properties: {
      path: { type: "string", description: "File path." },
      line: { type: "number", description: "Line number (1-based)." },
      character: { type: "number", description: "Character position on the line (1-based)." }
    },
    required: ["path", "line", "character"]
  },
  async execute(params = {}) {
    try {
      const { path: filePath, line, character } = params;
      if (!filePath || !line || !character) return "Error: 'path', 'line', and 'character' are required.";

      const absPath = path.resolve(filePath);
      const detection = lspClient.detectServer(absPath);
      if (!detection) return `No language server for ${path.extname(filePath)}`;

      const result = await lspClient.getHover(absPath, line, character);

      if (result.error) return `LSP Error: ${result.error}`;
      if (!result) return `No hover info at ${path.basename(filePath)}:${line}:${character}`;

      const contents = result.contents;
      let text = '';
      if (typeof contents === 'string') {
        text = contents;
      } else if (contents && contents.value) {
        text = contents.value;
      } else if (contents && Array.isArray(contents)) {
        text = contents.map(c => typeof c === 'string' ? c : c.value || '').join('\n');
      }

      return `## Hover: ${path.basename(filePath)}:${line}:${character}\n\n${text || 'No info available'}`;
    } catch (err) {
      return `Error in lsp_hover: ${err.message}`;
    }
  }
};