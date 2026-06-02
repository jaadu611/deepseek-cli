const { getRegistry } = require("../mcp/mcp_loader");

module.exports = {
  name: "search_tool_registry",
  description: "Searches the database of available external tools (MCP servers). Use this when you need a capability not provided by the core tools (e.g., database queries, web browsing, slack integration). Returns the schema of matching tools so you can call them.",
  parameters: {
    type: "object",
    properties: {
      query: {
        type: "string",
        description: "Keywords describing the capability you are looking for (e.g., 'postgres sql query', 'send slack message', 'puppeteer screenshot')."
      }
    },
    required: ["query"]
  },
  execute: async function({ query }) {
    const registry = getRegistry();
    if (registry.length === 0) return "No external MCP tools are currently configured. Check mcp.json.";

    const q = query.toLowerCase();
    
    // Simple scoring algorithm for relevance
    const scored = registry.map(tool => {
      let score = 0;
      const name = tool.name.toLowerCase();
      const desc = (tool.description || '').toLowerCase();
      
      if (name.includes(q)) score += 10;
      if (desc.includes(q)) score += 5;
      
      const words = q.split(/\s+/);
      for (const w of words) {
        if (name.includes(w)) score += 2;
        if (desc.includes(w)) score += 1;
      }
      
      return { tool, score };
    }).filter(x => x.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, 3); // Return top 3 matches to save context

    if (scored.length === 0) return `No tools found matching "${query}".`;

    // Format the output so the LLM can read the schema and use it in the next turn
    const output = scored.map(({ tool }) => {
      return `Tool Name: ${tool.name}\nDescription: ${tool.description}\nInput Schema: ${JSON.stringify(tool.inputSchema, null, 2)}`;
    }).join('\n\n---\n\n');

    return `Found ${scored.length} potential tool(s). To use one, call it by its "Tool Name" in your next JSON response:\n\n${output}`;
  }
};