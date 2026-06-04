const { getRegistry } = require("../mcp/mcp_loader");

const PAGE_SIZE = 10;

module.exports = {
  name: "search_tool_registry",
  description: "Searches the database of available external tools (MCP servers). Use this when you need a capability not provided by the core tools (e.g., database queries, web browsing, slack integration). Returns the schema of matching tools so you can call them. Results are paginated (10 per page). If the output says results are truncated, call this tool again with the same query and the indicated start_index to see more.",
  parameters: {
    type: "object",
    properties: {
      query: {
        type: "string",
        description: "Keywords describing the capability you are looking for (e.g., 'postgres sql query', 'send slack message', 'puppeteer screenshot')."
      },
      start_index: {
        type: "number",
        description: "0-based index to start returning results from. Use this to paginate through large result sets. Defaults to 0."
      }
    },
    required: ["query"]
  },
  execute: async function({ query, start_index }) {
    const registry = getRegistry();
    if (registry.length === 0) return "No external MCP tools are currently configured. Check mcp.json.";

    const q = query.toLowerCase().trim();
    const startIdx = Math.max(0, Math.floor(start_index ?? 0));
    const uniqueServers = Array.from(new Set(registry.map(tool => (tool.server || '').toLowerCase())));

    if (uniqueServers.includes(q)) {
      const serverTools = registry.filter(tool => (tool.server || '').toLowerCase() === q);
      const total = serverTools.length;
      const page = serverTools.slice(startIdx, startIdx + PAGE_SIZE);

      if (page.length === 0) {
        return `No more tools for MCP server "${q}". Total: ${total}, start_index ${startIdx} is past the end.`;
      }

      const output = page.map((tool, i) => {
        return `[${startIdx + i + 1}/${total}] Tool Name: ${tool.name}\nDescription: ${tool.description}\nInput Schema: ${JSON.stringify(tool.inputSchema, null, 2)}`;
      }).join('\n\n---\n\n');

      const shown = startIdx + page.length;
      const remaining = total - shown;
      let footer = '';
      if (remaining > 0) {
        footer = `\n\n⚠️ TRUNCATED: Showing tools ${startIdx + 1}-${shown} of ${total}. ${remaining} more tool(s) remain. To see the next page, call search_tool_registry again with query: "${query}" and start_index: ${shown}`;
      }

      return `Found ${total} tool(s) for MCP server "${q}" (showing ${startIdx + 1}-${shown}):\n\n${output}${footer}`;
    }

    const scored = registry.map(tool => {
      let score = 0;
      const name = tool.name.toLowerCase();
      const desc = (tool.description || '').toLowerCase();
      const server = (tool.server || '').toLowerCase();

      if (server.includes(q)) score += 12;
      if (name.includes(q)) score += 10;
      if (desc.includes(q)) score += 5;

      const words = q.split(/\s+/);
      for (const w of words) {
        if (server.includes(w)) score += 3;
        if (name.includes(w)) score += 2;
        if (desc.includes(w)) score += 1;
      }

      return { tool, score };
    }).filter(x => x.score > 0)
      .sort((a, b) => b.score - a.score);

    const total = scored.length;
    if (total === 0) return `No tools found matching "${query}".`;

    const page = scored.slice(startIdx, startIdx + PAGE_SIZE);

    if (page.length === 0) {
      return `No more tools matching "${query}". Total: ${total}, start_index ${startIdx} is past the end.`;
    }

    const output = page.map(({ tool }, i) => {
      return `[${startIdx + i + 1}/${total}] Tool Name: ${tool.name}\nDescription: ${tool.description}\nInput Schema: ${JSON.stringify(tool.inputSchema, null, 2)}`;
    }).join('\n\n---\n\n');

    const shown = startIdx + page.length;
    const remaining = total - shown;
    let footer = '';
    if (remaining > 0) {
      footer = `\n\n⚠️ TRUNCATED: Showing tools ${startIdx + 1}-${shown} of ${total}. ${remaining} more tool(s) remain. To see the next page, call search_tool_registry again with query: "${query}" and start_index: ${shown}`;
    }

    return `Found ${total} potential tool(s) matching "${query}" (showing ${startIdx + 1}-${shown}). To use one, call it by its "Tool Name" in your next JSON response:\n\n${output}${footer}`;
  }
};