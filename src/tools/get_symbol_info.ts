// @ts-nocheck
const path = require('path');
const codeGraph = require('../utils/code_graph');

module.exports = {
  name: "get_symbol_info",
  description: "Get full details about a symbol: type (function/class/method/type), file location, definition line, all references, and imports. Comprehensive symbol information for understanding code structure.",
  parameters: {
    type: "object",
    properties: {
      symbol: { type: "string", description: "The symbol name to get info about." },
      path: { type: "string", description: "Project root directory (optional, defaults to cwd)." }
    },
    required: ["symbol"]
  },
  async execute(params = {}) {
    try {
      const { symbol, path: cwd = '.' } = params;
      if (!symbol) return "Error: 'symbol' parameter is required.";

      const projectDir = path.resolve(cwd);
      let index = codeGraph.loadIndex();
      if (!index || !index.symbols[symbol]) {
        await codeGraph.initParser();
        const result = await codeGraph.buildIndex(projectDir);
        index = result.index;
        codeGraph.saveIndex(index);
      }

      const defs = (index.symbols[symbol] || []).filter(s => s.kind !== 'import');

      if (defs.length === 0) {
        return `No symbol found for "${symbol}". It may not exist in indexed files.`;
      }

      const out = [`## Symbol Info: "${symbol}"\n`];

      // Definition details
      out.push(`### Definitions (${defs.length})\n`);
      for (const def of defs) {
        out.push(`  ${def.file}:${def.line} — [${def.kind}]${def.exported ? ' (exported)' : ''}`);
        if (def.context) out.push(`    \`${def.context}\``);
      }

      // Find files that import this symbol
      const importers = [];
      for (const [file, imports] of Object.entries(index.imports || {})) {
        for (const imp of imports) {
          if (imp.imported && imp.imported.includes(symbol)) {
            importers.push(file);
          }
        }
      }
      if (importers.length > 0) {
        out.push(`\n### Imported by (${importers.length} files)\n`);
        for (const f of importers) {
          out.push(`  - ${f}`);
        }
      }

      // Find files that define the same symbol name (potential conflicts)
      if (defs.length > 1) {
        out.push(`\n### WARNING: Multiple definitions found\n`);
        out.push(`This symbol is defined in ${defs.length} files. Be careful about which one you modify.`);
      }

      return out.join('\n');
    } catch (err) {
      return `Error in get_symbol_info: ${err.message}`;
    }
  }
};