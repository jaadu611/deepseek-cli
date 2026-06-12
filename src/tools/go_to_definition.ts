// @ts-nocheck
const path = require('path');
const codeGraph = require('../utils/code_graph');

module.exports = {
  name: "go_to_definition",
  description: "Find where a symbol is defined (function, class, type, variable). Returns the file, line number, and the full definition line. Use to jump to where something is implemented.",
  parameters: {
    type: "object",
    properties: {
      symbol: { type: "string", description: "The symbol name to find the definition of." },
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

      const defs = codeGraph.goToDefinition(index, symbol);

      if (defs.length === 0) {
        return `No definition found for "${symbol}".`;
      }

      const out = [`## Definition of "${symbol}" (${defs.length} location${defs.length > 1 ? 's' : ''})\n`];
      for (const def of defs) {
        out.push(`  ${def.file}:${def.line} [${def.kind}]${def.context ? ' — ' + def.context : ''}`);
      }

      return out.join('\n');
    } catch (err) {
      return `Error in go_to_definition: ${err.message}`;
    }
  }
};