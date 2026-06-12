// @ts-nocheck
const path = require('path');
const lspClient = require('../utils/lsp_client');

module.exports = {
  name: "lsp_find_references",
  description: "Find ALL references to a symbol using the language server (more accurate than grep). Returns every file and line that uses this symbol, including through imports and inheritance. Use before renaming or changing function signatures.",
  parameters: {
    type: "object",
    properties: {
      path: { type: "string", description: "File path containing the symbol." },
      line: { type: "number", description: "Line number of the symbol (1-based)." },
      character: { type: "number", description: "Character position of the symbol start (1-based)." }
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

      const result = await lspClient.findReferences(absPath, line, character);

      if (result.error) return `LSP Error: ${result.error}`;
      if (!result || !Array.isArray(result) || result.length === 0) return "No references found.";

      const out = [`## References (${result.length} found)\n`];
      // Group by file
      const byFile = {};
      for (const ref of result) {
        const f = ref.uri ? path.basename(ref.uri.replace('file://', '')) : 'unknown';
        const relPath = ref.uri ? ref.uri.replace('file://', '') : 'unknown';
        if (!byFile[f]) byFile[f] = { path: relPath, lines: [] };
        byFile[f].lines.push(ref.range ? ref.range.start.line + 1 : '?');
      }
      for (const [file, data] of Object.entries(byFile)) {
        out.push(`  ${file} — lines: ${data.lines.join(', ')}`);
      }
      return out.join('\n');
    } catch (err) {
      return `Error in lsp_find_references: ${err.message}`;
    }
  }
};