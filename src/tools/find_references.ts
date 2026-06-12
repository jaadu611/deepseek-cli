// @ts-nocheck
const path = require('path');
const codeGraph = require('../utils/code_graph');

module.exports = {
  name: "find_references",
  description: "Find all references to a symbol (function, class, method, variable) across the codebase using tree-sitter AST parsing. Returns definitions and usages. Use before renaming or changing function signatures.",
  parameters: {
    type: "object",
    properties: {
      symbol: { type: "string", description: "The symbol name to search for (e.g. 'authenticate', 'UserModel')." },
      path: { type: "string", description: "Project root directory (optional, defaults to cwd)." }
    },
    required: ["symbol"]
  },
  async execute(params = {}) {
    try {
      const { symbol, path: cwd = '.' } = params;
      if (!symbol) return "Error: 'symbol' parameter is required.";

      const projectDir = path.resolve(cwd);

      // Try loading cached index, or build fresh
      let index = codeGraph.loadIndex();
      if (!index || !index.symbols[symbol]) {
        await codeGraph.initParser();
        const result = await codeGraph.buildIndex(projectDir);
        index = result.index;
        codeGraph.saveIndex(index);
      }

      const refs = codeGraph.findReferences(index, symbol);

      if (refs.length === 0) {
        return `No references found for "${symbol}". The symbol may not exist in indexed files, or WASM grammars may not be available.`;
      }

      const out = [`## References to "${symbol}" (${refs.length} found)\n`];
      for (const ref of refs) {
        const tag = ref.type === 'definition' ? `[definition]` : `[imported]`;
        out.push(`  ${ref.file}:${ref.line} ${tag}${ref.context ? ' — ' + ref.context : ''}`);
      }

      return out.join('\n');
    } catch (err) {
      return `Error in find_references: ${err.message}`;
    }
  }
};