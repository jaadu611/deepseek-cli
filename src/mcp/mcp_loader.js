const fs = require('fs');
const path = require('path');

const CONFIG_PATH = path.join(__dirname, 'mcp.json');
let clients = {}; // serverName -> Client instance
let transports = {}; // serverName -> Transport instance
let toolRegistry = []; // Flat list of { server, name, description, inputSchema }

let initPromise = null;

function init(onStatusUpdate) {
  if (!initPromise) {
    initPromise = (async () => {
      if (!fs.existsSync(CONFIG_PATH)) {
        return;
      }

      try {
        const config = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
        // Skip if no MCP servers configured
        if (!config.mcpServers || Object.keys(config.mcpServers).length === 0) {
          return;
        }
        
        const { Client } = await import('@modelcontextprotocol/sdk/client/index.js');
        const { StdioClientTransport } = await import('@modelcontextprotocol/sdk/client/stdio.js');
        const { execSync } = require('child_process');

        const installedServersDir = path.join(__dirname, 'installed_servers');
        const serverEntries = Object.entries(config.mcpServers || {});
        
        await Promise.all(serverEntries.map(async ([serverName, serverConfig]) => {
          try {
            if (serverConfig.command === 'npx' && serverConfig.args && serverConfig.args[0] === '-y') {
              const fullPkg = serverConfig.args[1];
              const pkgNameMatch = fullPkg.match(/^(?:@[^/]+\/)?([^@]+)/);
              const pkgName = pkgNameMatch ? pkgNameMatch[0] : fullPkg;
              
              const pkgDir = path.join(installedServersDir, 'node_modules', pkgName);
              
              if (!fs.existsSync(pkgDir)) {
                if (typeof onStatusUpdate === 'function') {
                  onStatusUpdate(`downloading MCP server: ${fullPkg}...`);
                }
                 execSync(`npm install --prefix "${installedServersDir}" ${fullPkg}`, {
                   stdio: 'ignore',
                   env: { ...process.env, PUPPETEER_SKIP_DOWNLOAD: 'true' }
                 });
              }
              
              const pkgJson = JSON.parse(fs.readFileSync(path.join(pkgDir, 'package.json'), 'utf8'));
              let binPath;
              if (typeof pkgJson.bin === 'string') {
                binPath = pkgJson.bin;
              } else if (typeof pkgJson.bin === 'object' && Object.keys(pkgJson.bin).length > 0) {
                binPath = Object.values(pkgJson.bin)[0];
              } else {
                binPath = pkgJson.main || 'dist/index.js';
              }
              
              const absoluteBinPath = path.join(pkgDir, binPath);
              
              serverConfig.command = process.execPath;
              serverConfig.args = [absoluteBinPath, ...serverConfig.args.slice(2)];
            }

            const transport = new StdioClientTransport({
              command: serverConfig.command,
              args: serverConfig.args,
              env: serverConfig.env ? { ...process.env, ...serverConfig.env } : process.env,
              stderr: 'ignore'
            });

            const client = new Client({ name: 'deepseek-cli', version: '1.0.0' }, { capabilities: {} });
            
            // Connect to the server with a timeout
            await Promise.race([
              client.connect(transport),
              new Promise((_, reject) => setTimeout(() => reject(new Error("Timeout connecting to " + serverName)), 5000))
            ]);
            clients[serverName] = client;
            transports[serverName] = transport;

            // Fetch available tools from this server with a timeout
            const toolsResult = await Promise.race([
              client.listTools(),
              new Promise((_, reject) => setTimeout(() => reject(new Error("Timeout listing tools for " + serverName)), 2500))
            ]);
            for (const tool of toolsResult.tools) {
              toolRegistry.push({
                server: serverName,
                name: tool.name,
                description: tool.description,
                inputSchema: tool.inputSchema
              });
            }
          } catch (err) {
            fs.appendFileSync(
              "/tmp/deepseek-cli-debug.log",
              `[MCP] Failed to connect to ${serverName}: ${err.stack || err.message}\n`
            );
          }
        }));
      } catch (err) {
        fs.appendFileSync(
          "/tmp/deepseek-cli-debug.log",
          `[MCP] Error parsing mcp.json: ${err.stack || err.message}\n`
        );
      }
    })().catch((err) => {
      initPromise = null;
      throw err;
    });
  }
  return initPromise;
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
  for (const [name, transport] of Object.entries(transports)) {
    try { await transport.close(); } catch {}
  }
}

module.exports = { init, getRegistry, callTool, cleanup };