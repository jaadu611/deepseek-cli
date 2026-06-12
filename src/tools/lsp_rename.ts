// @ts-nocheck
const path = require('path');
const fs = require('fs');
const lspClient = require('../utils/lsp_client');

module.exports = {
  name: "lsp_rename",
  description: "Rename a symbol across ALL files in the project using the language server. Returns the exact edits needed for every file. More reliable than grep because it understands imports, inheritance, and type references.",
  parameters: {
    type: "object",
    properties: {
      path: { type: "string", description: "File containing the symbol." },
      line: { type: "number", description: "Line number of the symbol (1-based)." },
      character: { type: "number", description: "Character position of the symbol start (1-based)." },
      new_name: { type: "string", description: "The new name for the symbol." },
      dry_run: { type: "boolean", description: "If true, just show what would change without applying. Default: true." }
    },
    required: ["path", "line", "character", "new_name"]
  },
  async execute(params = {}) {
    try {
      const { path: filePath, line, character, new_name, dry_run = true } = params;
      if (!filePath || !line || !character || !new_name) {
        return "Error: 'path', 'line', 'character', and 'new_name' are required.";
      }

      const absPath = path.resolve(filePath);
      const detection = lspClient.detectServer(absPath);
      if (!detection) return `No language server for ${path.extname(filePath)}`;

      const result = await lspClient.renameSymbol(absPath, line, character, new_name);

      if (result.error) return `LSP Error: ${result.error}`;
      if (!result || !result.changes) return "No changes needed or symbol not found.";

      const changes = result.changes;
      const files = Object.keys(changes);
      let totalEdits = 0;
      for (const file of Object.values(changes)) {
        totalEdits += file.length;
      }

      const out = [`## Rename: "${params.path}:${line}:${character}" → "${new_name}"`];
      out.push(`Would change ${files.length} file(s), ${totalEdits} edit(s)\n`);

      for (const [fileUri, edits] of Object.entries(changes)) {
        const relPath = fileUri.replace('file://', '');
        const baseName = path.basename(relPath);
        out.push(`  ${baseName}:`);
        for (const edit of edits) {
          const startLine = edit.range.start.line + 1;
          const startChar = edit.range.start.character + 1;
          const endLine = edit.range.end.line + 1;
          out.push(`    L${startLine}:${startChar} → ${edit.newText}`);
        }
      }

      if (!dry_run && files.length > 0) {
        out.push('\n### Applying changes...');
        let applied = 0;
        for (const [fileUri, edits] of Object.entries(changes)) {
          const absFile = fileUri.replace('file://', '');
          try {
            let content = fs.readFileSync(absFile, 'utf8');
            const lines = content.split('\n');
            // Apply edits in reverse order to preserve line numbers
            const sorted = edits.sort((a, b) => {
              if (b.range.start.line !== a.range.start.line) return b.range.start.line - a.range.start.line;
              return b.range.start.character - a.range.start.character;
            });
            for (const edit of sorted) {
              const startLine = edit.range.start.line;
              const startChar = edit.range.start.character;
              const endLine = edit.range.end.line;
              const endChar = edit.range.end.character;
              const before = lines[startLine].substring(0, startChar);
              const after = lines[endLine].substring(endChar);
              if (startLine === endLine) {
                lines[startLine] = before + edit.newText + after;
              } else {
                lines.splice(startLine, endLine - startLine + 1, before + edit.newText + after);
              }
            }
            fs.writeFileSync(absFile, lines.join('\n'));
            applied++;
          } catch (err) {
            out.push(`  ⚠️ Failed to apply to ${baseName}: ${err.message}`);
          }
        }
        out.push(`\nApplied to ${applied}/${files.length} files.`);
      } else if (dry_run) {
        out.push('\n⚠️ DRY RUN — no changes applied. Set dry_run=false to apply.');
      }

      return out.join('\n');
    } catch (err) {
      return `Error in lsp_rename: ${err.message}`;
    }
  }
};