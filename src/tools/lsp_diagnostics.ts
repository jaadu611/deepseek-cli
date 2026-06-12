// @ts-nocheck
const path = require('path');
const lspClient = require('../utils/lsp_client');

module.exports = {
  name: "lsp_diagnostics",
  description: "Get real-time type errors and warnings from the language server for a file. Shows actual compiler/type errors, not just syntax. Use after editing to check for errors before running tests.",
  parameters: {
    type: "object",
    properties: {
      path: { type: "string", description: "File path to check for errors." },
      line: { type: "number", description: "Optional: line number to get detailed info about." },
      character: { type: "number", description: "Optional: character position on the line." }
    },
    required: ["path"]
  },
  async execute(params = {}) {
    try {
      const { path: filePath, line, character } = params;
      if (!filePath) return "Error: 'path' parameter is required.";

      const absPath = path.resolve(filePath);
      const detection = lspClient.detectServer(absPath);

      if (!detection) {
        return `No language server available for this file type (${path.extname(filePath)}). Supported: .ts, .tsx, .js, .jsx, .py, .go, .rs`;
      }

      // Check if server is available
      const available = lspClient.checkAvailableServers();
      const serverInfo = available[detection.type];
      if (serverInfo && !serverInfo.installed) {
        return `Language server '${serverInfo.command}' is not installed. Install it:\n- TypeScript/JS: npm i -g typescript-language-server typescript\n- Python: npm i -g pyright\n- Go: go install golang.org/x/tools/gopls@latest\n- Rust: rustup component add rust-analyzer`;
      }

      const result = await lspClient.getDiagnostics(absPath);

      if (result.error) {
        return `LSP Error: ${result.error}`;
      }

      const diagnostics = result.diagnostics || [];

      if (diagnostics.length === 0) {
        return `✅ No errors or warnings in ${path.basename(filePath)}`;
      }

      const out = [`## Diagnostics for ${path.basename(filePath)} (${diagnostics.length} issues)\n`];

      for (const diag of diagnostics) {
        const severity = diag.severity === 1 ? '❌ ERROR' : diag.severity === 2 ? '⚠️ WARNING' : 'ℹ️ INFO';
        const line = diag.range.start.line + 1;
        const col = diag.range.start.character + 1;
        out.push(`${severity} at line ${line}, col ${col}`);
        out.push(`  ${diag.message}`);
        if (diag.source) out.push(`  (source: ${diag.source})`);
        out.push('');
      }

      return out.join('\n');
    } catch (err) {
      return `Error in lsp_diagnostics: ${err.message}`;
    }
  }
};