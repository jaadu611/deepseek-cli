const fs = require('fs');
const path = require('path');

const CONFIG_PATH = path.join(__dirname, 'mcp.json');
let clients = {}; // serverName -> Client instance
let toolRegistry = []; // Flat list of { server, name, description, inputSchema }

async function init() {
  if (!fs.existsSync(CONFIG_PATH)) {
    return;
  }

  try {
    const config = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
    
    // Dynamic import for the ESM SDK
    const { Client } = await import('@modelcontextprotocol/sdk/client/index.js');
    const { StdioClientTransport } = await import('@modelcontextprotocol/sdk/client/stdio.js');

    for (const [serverName, serverConfig] of Object.entries(config.mcpServers || {})) {
      try {
        const transport = new StdioClientTransport({
          command: serverConfig.command,
          args: serverConfig.args,
          env: serverConfig.env ? { ...process.env, ...serverConfig.env } : process.env,
          stderr: 'ignore'
        });

        const client = new Client({ name: 'deepseek-cli', version: '1.0.0' }, { capabilities: {} });
        
        // Connect to the server
        await client.connect(transport);
        clients[serverName] = client;

        // Fetch available tools from this server
        const toolsResult = await client.listTools();
        for (const tool of toolsResult.tools) {
          toolRegistry.push({
            server: serverName,
            name: tool.name,
            description: tool.description,
            inputSchema: tool.inputSchema
          });
        }
      } catch (err) {
        console.error(`[MCP] Failed to connect to ${serverName}:`, err.message);
      }
    }
  } catch (err) {
    console.error('[MCP] Error parsing mcp.json:', err.message);
  }
}

function getRegistry() {
  return toolRegistry;
}

async function callTool(toolName, args) {
  const toolEntry = toolRegistry.find(t => t.name === toolName);
  if (!toolEntry) throw new Error(`Tool ${toolName} not found in registry`);
  
  const client = clients[toolEntry.server];
  if (!client) throw new Error(`Server ${toolEntry.server} not connected`);

  // Execute the tool via the MCP protocol
  const result = await client.callTool({ name: toolName, arguments: args });
  
  // MCP returns content as an array of objects (text, image, etc). We join text content.
  if (result.content && Array.isArray(result.content)) {
    return result.content.map(c => c.text || JSON.stringify(c)).join('\n');
  }
  return JSON.stringify(result);
}

async function cleanup() {
  for (const [name, client] of Object.entries(clients)) {
    try { await client.close(); } catch {}
  }
}

module.exports = { init, getRegistry, callTool, cleanup };