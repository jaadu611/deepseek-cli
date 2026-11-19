// @ts-nocheck
// lsp_client.ts — Lightweight LSP client for deepseek_cli
// Spawns language servers and communicates via JSON-RPC over stdin/stdout.
// Supports: TypeScript/JavaScript (tsserver via typescript-language-server),
//           Python (pyright), Go (gopls), Rust (rust-analyzer).

const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

// Server configurations: how to find and start each language server
const SERVER_CONFIGS = {
  typescript: {
    command: 'typescript-language-server',
    args: ['--stdio'],
    languages: ['typescript', 'typescriptreact', 'javascript', 'javascriptreact'],
    extensions: ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs'],
    // Fallback: try npx if not globally installed
    fallbackCommand: 'npx',
    fallbackArgs: ['typescript-language-server', '--stdio'],
  },
  python: {
    command: 'pyright-langserver',
    args: ['--stdio'],
    languages: ['python'],
    extensions: ['.py'],
    fallbackCommand: 'npx',
    fallbackArgs: ['pyright-langserver', '--stdio'],
  },
  go: {
    command: 'gopls',
    args: [],
    languages: ['go'],
    extensions: ['.go'],
  },
  rust: {
    command: 'rust-analyzer',
    args: [],
    languages: ['rust'],
    extensions: ['.rs'],
  },
};

// Active server instances (keyed by server type)
const activeServers = {};

// Request ID counter
let nextRequestId = 1;

// Pending request callbacks
const pendingRequests = {};

// Server stdout buffer (for partial reads)
const stdoutBuffers = {};

/**
 * Detect which language server to use for a file
 */
function detectServer(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  for (const [type, config] of Object.entries(SERVER_CONFIGS)) {
    if (config.extensions.includes(ext)) {
      return { type, config };
    }
  }
  return null;
}

/**
 * Start a language server
 */
async function startServer(serverType) {
  if (activeServers[serverType]) {
    return activeServers[serverType];
  }

  const config = SERVER_CONFIGS[serverType];
  if (!config) return null;

  return new Promise((resolve, reject) => {
    let command = config.command;
    let args = config.args;

    // Try fallback if primary command not found
    try {
      const { execSync } = require('child_process');
      execSync(`which ${config.command}`, { stdio: 'ignore' });
    } catch {
      if (config.fallbackCommand) {
        command = config.fallbackCommand;
        args = config.fallbackArgs;
      } else {
        reject(new Error(`Language server '${config.command}' not found. Install it first.`));
        return;
      }
    }

    const server = spawn(command, args, {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env, NODE_NO_WARNINGS: '1' },
    });

    let serverStderr = '';
    server.stderr.on('data', (data) => {
      const chunk = data.toString();
      serverStderr += chunk;
      checkAndHandlePrompt(serverType, server, command + ' ' + args.join(' '), serverStderr);
    });

    stdoutBuffers[serverType] = '';

    server.stdout.on('data', (data) => {
      const chunk = data.toString();
      stdoutBuffers[serverType] += chunk;
      checkAndHandlePrompt(serverType, server, command + ' ' + args.join(' '), chunk);
      processMessages(serverType);
    });

    server.on('error', (err) => {
      console.error(`LSP server ${serverType} error: ${err.message}`);
      delete activeServers[serverType];
    });

    server.on('exit', () => {
      delete activeServers[serverType];
    });

    activeServers[serverType] = { process: server, initialized: false };

    // Send initialize request
    const initParams = {
      processId: process.pid,
      rootUri: `file://${process.cwd()}`,
      capabilities: {
        textDocument: {
          publishDiagnostics: { relatedInformation: true },
          hover: { contentFormat: ['markdown', 'plaintext'] },
          references: {},
          definition: { linkSupport: true },
          rename: { prepareSupport: true },
          completion: { completionItem: { snippetSupport: true } },
          synchronization: { didSave: true, willSave: false },
        },
      },
    };

    sendRequest(serverType, 'initialize', initParams)
      .then((result) => {
        // Send initialized notification
        sendNotification(serverType, 'initialized', {});
        activeServers[serverType].initialized = true;
        resolve(activeServers[serverType]);
      })
      .catch((err) => {
        if (server.process) {
          try { server.process.kill(); } catch {}
        }
        delete activeServers[serverType];
        reject(err);
      });
  });
}

/**
 * Send a JSON-RPC request and return a promise
 */
function sendRequest(serverType, method, params) {
  return new Promise((resolve, reject) => {
    const server = activeServers[serverType];
    if (!server || !server.process) {
      reject(new Error(`No active ${serverType} server`));
      return;
    }

    const id = nextRequestId++;
    const message = JSON.stringify({
      jsonrpc: '2.0',
      id,
      method,
      params,
    });

    // LSP uses Content-Length header
    const header = `Content-Length: ${Buffer.byteLength(message)}\r\n\r\n`;

    pendingRequests[id] = { resolve, reject, method };

    // Set timeout
    setTimeout(() => {
      if (pendingRequests[id]) {
        delete pendingRequests[id];
        reject(new Error(`LSP request '${method}' timed out after 30s`));
      }
    }, 30000);

    try {
      server.process.stdin.write(header + message);
    } catch (err) {
      delete pendingRequests[id];
      reject(err);
    }
  });
}

/**
 * Send a JSON-RPC notification (no response expected)
 */
function sendNotification(serverType, method, params) {
  const server = activeServers[serverType];
  if (!server || !server.process) return;

  const message = JSON.stringify({
    jsonrpc: '2.0',
    method,
    params,
  });

  const header = `Content-Length: ${Buffer.byteLength(message)}\r\n\r\n`;

  try {
    server.process.stdin.write(header + message);
  } catch (err) {
    // Ignore
  }
}

/**
 * Process buffered messages from stdout
 */
function processMessages(serverType) {
  while (true) {
    const buffer = stdoutBuffers[serverType];
    if (!buffer) break;

    // Look for Content-Length header
    const headerEnd = buffer.indexOf('\r\n\r\n');
    if (headerEnd === -1) break;

    const header = buffer.substring(0, headerEnd);
    const match = header.match(/Content-Length:\s*(\d+)/);
    if (!match) {
      // Discard this non-header block to prevent buffer hang
      stdoutBuffers[serverType] = buffer.substring(headerEnd + 4);
      continue;
    }

    const contentLength = parseInt(match[1], 10);
    const messageStart = headerEnd + 4;

    if (buffer.length < messageStart + contentLength) break;

    // Extract the message
    const messageStr = buffer.substring(messageStart, messageStart + contentLength);
    stdoutBuffers[serverType] = buffer.substring(messageStart + contentLength);

    try {
      const message = JSON.parse(messageStr);

      if (message.id !== undefined && pendingRequests[message.id]) {
        const { resolve, reject, method } = pendingRequests[message.id];
        delete pendingRequests[message.id];

        if (message.error) {
          reject(new Error(`LSP error in '${method}': ${message.error.message}`));
        } else {
          resolve(message.result);
        }
      }
    } catch (err) {
      // Ignore parse errors
    }
  }
}

/**
 * Open a file in the language server
 */
async function openFile(filePath) {
  const detection = detectServer(filePath);
  if (!detection) return null;

  const { type } = detection;
  const server = await startServer(type);
  if (!server) return null;

  const content = fs.readFileSync(filePath, 'utf8');
  const uri = `file://${path.resolve(filePath)}`;

  sendNotification(type, 'textDocument/didOpen', {
    textDocument: {
      uri,
      languageId: detectLanguageId(filePath),
      version: 1,
      text: content,
    },
  });

  return { serverType: type, uri };
}

/**
 * Get diagnostics for a file
 */
async function getDiagnostics(filePath) {
  const detection = detectServer(filePath);
  if (!detection) return { error: 'No language server available for this file type' };

  const { type } = detection;
  try {
    await startServer(type);
  } catch (err) {
    return { error: err.message };
  }

  const uri = `file://${path.resolve(filePath)}`;

  // Open the file first to trigger diagnostics
  const content = fs.readFileSync(filePath, 'utf8');
  sendNotification(type, 'textDocument/didOpen', {
    textDocument: { uri, languageId: detectLanguageId(filePath), version: 1, text: content },
  });

  // Wait a moment for diagnostics to arrive
  await new Promise((r) => setTimeout(r, 2000));

  // Request diagnostics explicitly if the server supports it
  try {
    const result = await sendRequest(type, 'textDocument/publishDiagnostics', { uri });
    return result;
  } catch {
    // Diagnostics are usually pushed, not pulled. Return what we have.
    return { diagnostics: [], note: 'Diagnostics are published asynchronously by the language server' };
  }
}

/**
 * Find references to a symbol at a position
 */
async function findReferences(filePath, line, character) {
  const detection = detectServer(filePath);
  if (!detection) return { error: 'No language server available for this file type' };

  const { type } = detection;
  try {
    await startServer(type);
  } catch (err) {
    return { error: err.message };
  }

  const uri = `file://${path.resolve(filePath)}`;

  // Ensure file is open
  const content = fs.readFileSync(filePath, 'utf8');
  sendNotification(type, 'textDocument/didOpen', {
    textDocument: { uri, languageId: detectLanguageId(filePath), version: 1, text: content },
  });

  try {
    const result = await sendRequest(type, 'textDocument/references', {
      textDocument: { uri },
      position: { line: line - 1, character: character - 1 }, // LSP is 0-indexed
      context: { includeDeclaration: true },
    });
    return result;
  } catch (err) {
    return { error: err.message };
  }
}

/**
 * Get hover information at a position
 */
async function getHover(filePath, line, character) {
  const detection = detectServer(filePath);
  if (!detection) return { error: 'No language server available for this file type' };

  const { type } = detection;
  try {
    await startServer(type);
  } catch (err) {
    return { error: err.message };
  }

  const uri = `file://${path.resolve(filePath)}`;
  const content = fs.readFileSync(filePath, 'utf8');
  sendNotification(type, 'textDocument/didOpen', {
    textDocument: { uri, languageId: detectLanguageId(filePath), version: 1, text: content },
  });

  try {
    const result = await sendRequest(type, 'textDocument/hover', {
      textDocument: { uri },
      position: { line: line - 1, character: character - 1 },
    });
    return result;
  } catch (err) {
    return { error: err.message };
  }
}

/**
 * Prepare rename at a position
 */
async function prepareRename(filePath, line, character) {
  const detection = detectServer(filePath);
  if (!detection) return { error: 'No language server available for this file type' };

  const { type } = detection;
  try {
    await startServer(type);
  } catch (err) {
    return { error: err.message };
  }

  const uri = `file://${path.resolve(filePath)}`;
  const content = fs.readFileSync(filePath, 'utf8');
  sendNotification(type, 'textDocument/didOpen', {
    textDocument: { uri, languageId: detectLanguageId(filePath), version: 1, text: content },
  });

  try {
    const result = await sendRequest(type, 'textDocument/rename', {
      textDocument: { uri },
      position: { line: line - 1, character: character - 1 },
      newName: '__PLACEHOLDER__',
    });
    // The result contains workspace edits with all files that need to change
    return result;
  } catch (err) {
    return { error: err.message };
  }
}

/**
 * Rename a symbol (returns workspace edit with all changes)
 */
async function renameSymbol(filePath, line, character, newName) {
  const detection = detectServer(filePath);
  if (!detection) return { error: 'No language server available for this file type' };

  const { type } = detection;
  try {
    await startServer(type);
  } catch (err) {
    return { error: err.message };
  }

  const uri = `file://${path.resolve(filePath)}`;
  const content = fs.readFileSync(filePath, 'utf8');
  sendNotification(type, 'textDocument/didOpen', {
    textDocument: { uri, languageId: detectLanguageId(filePath), version: 1, text: content },
  });

  try {
    const result = await sendRequest(type, 'textDocument/rename', {
      textDocument: { uri },
      position: { line: line - 1, character: character - 1 },
      newName,
    });
    return result;
  } catch (err) {
    return { error: err.message };
  }
}

/**
 * Get document symbols (outline of a file)
 */
async function getDocumentSymbols(filePath) {
  const detection = detectServer(filePath);
  if (!detection) return { error: 'No language server available for this file type' };

  const { type } = detection;
  try {
    await startServer(type);
  } catch (err) {
    return { error: err.message };
  }

  const uri = `file://${path.resolve(filePath)}`;
  const content = fs.readFileSync(filePath, 'utf8');
  sendNotification(type, 'textDocument/didOpen', {
    textDocument: { uri, languageId: detectLanguageId(filePath), version: 1, text: content },
  });

  try {
    const result = await sendRequest(type, 'textDocument/documentSymbol', {
      textDocument: { uri },
    });
    return result;
  } catch (err) {
    return { error: err.message };
  }
}

/**
 * Get code actions (quick fixes) for a range
 */
async function getCodeActions(filePath, startLine, startChar, endLine, endChar) {
  const detection = detectServer(filePath);
  if (!detection) return { error: 'No language server available for this file type' };

  const { type } = detection;
  try {
    await startServer(type);
  } catch (err) {
    return { error: err.message };
  }

  const uri = `file://${path.resolve(filePath)}`;
  const content = fs.readFileSync(filePath, 'utf8');
  sendNotification(type, 'textDocument/didOpen', {
    textDocument: { uri, languageId: detectLanguageId(filePath), version: 1, text: content },
  });

  try {
    const result = await sendRequest(type, 'textDocument/codeAction', {
      textDocument: { uri },
      range: {
        start: { line: startLine - 1, character: startChar - 1 },
        end: { line: endLine - 1, character: endChar - 1 },
      },
      context: { diagnostics: [] },
    });
    return result;
  } catch (err) {
    return { error: err.message };
  }
}

/**
 * Stop a language server
 */
function stopServer(serverType) {
  const server = activeServers[serverType];
  if (server && server.process) {
    try {
      sendRequest(serverType, 'shutdown', {}).then(() => {
        sendNotification(serverType, 'exit', {});
        server.process.kill();
      }).catch(() => {
        server.process.kill();
      });
    } catch {
      try { server.process.kill(); } catch {}
    }
    delete activeServers[serverType];
  }
}

/**
 * Stop all language servers
 */
function stopAllServers() {
  for (const type of Object.keys(activeServers)) {
    stopServer(type);
  }
}

/**
 * Detect language ID from file extension
 */
function detectLanguageId(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  const map = {
    '.ts': 'typescript',
    '.tsx': 'typescriptreact',
    '.js': 'javascript',
    '.jsx': 'javascriptreact',
    '.mjs': 'javascript',
    '.cjs': 'javascript',
    '.py': 'python',
    '.go': 'go',
    '.rs': 'rust',
  };
  return map[ext] || 'plaintext';
}

/**
 * Check which language servers are available on the system
 */
function checkAvailableServers() {
  const { execSync } = require('child_process');
  const available = {};

  for (const [type, config] of Object.entries(SERVER_CONFIGS)) {
    try {
      execSync(`which ${config.command}`, { stdio: 'ignore' });
      available[type] = { installed: true, command: config.command };
    } catch {
      if (config.fallbackCommand) {
        try {
          execSync(`which ${config.fallbackCommand}`, { stdio: 'ignore' });
          available[type] = { installed: true, command: config.fallbackCommand };
        } catch {
          available[type] = { installed: false, command: config.command, fallback: config.fallbackCommand };
        }
      } else {
        available[type] = { installed: false, command: config.command };
      }
    }
  }

  return available;
}

module.exports = {
  detectServer,
  startServer,
  openFile,
  getDiagnostics,
  findReferences,
  getHover,
  prepareRename,
  renameSymbol,
  getDocumentSymbols,
  getCodeActions,
  stopServer,
  stopAllServers,
  checkAvailableServers,
  SERVER_CONFIGS,
};

// Cleanup on process exit
const PROMPT_PATTERNS = [
  /\b(ok to proceed|ok\?|continue\?|proceed\?|want to continue\?)\s*\(?\[?y\/n\]?\)?/i,
  /\[y\/n\]/i,
  /\(y\/n\)/i,
  /ok to proceed\? \([yn]\)/i,
  /\bselect\s+(an?\s+)?option\s*:/i,
  /\bselect\s+a\s+number\s*:/i,
  /\benter\s+(selection|option|choice)\s*:/i,
  /\b(press|hit)\s+\[?enter\]?\s+to\s+continue/i,
];

const respondedPrompts = new Set();

function checkAndHandlePrompt(serverType, server, fullCommand, text) {
  if (activeServers[serverType] && activeServers[serverType].initialized) return;

  const lines = text.trim().split('\n');
  const lastLine = lines[lines.length - 1] || '';

  let isPrompt = false;
  for (const pattern of PROMPT_PATTERNS) {
    if (pattern.test(lastLine)) {
      isPrompt = true;
      break;
    }
  }

  if (!isPrompt && lastLine.includes('?') && (lastLine.toLowerCase().includes('y/n') || lastLine.toLowerCase().includes('(y/') || lastLine.toLowerCase().includes('[y/'))) {
    isPrompt = true;
  }

  if (isPrompt) {
    const promptKey = `${serverType}:${lastLine.trim()}`;
    if (respondedPrompts.has(promptKey)) return;
    respondedPrompts.add(promptKey);

    const tui = require('../tui/tui');
    const logItems = tui.getLogItems();
    logItems.push({ type: 'status', text: `[LSP Server Prompt] Z.ai is choosing how to proceed...` });
    tui.renderLog();

    getResponseFromAI(fullCommand, text).then((answer) => {
      try {
        server.stdin.write(answer + '\n');
      } catch (e) {}
    });
  }
}

async function getResponseFromAI(command, promptText) {
  try {
    const brainRegistry = require('../core/brains/registry');
    const brain = brainRegistry.getActiveBrain();
    if (!brain || typeof brain.getCompletionStream !== 'function') {
      return 'y';
    }

    const tempPage = await brain.createNewPage();
    if (!tempPage) return 'y';

    const aiPrompt = `A terminal command is currently executing and is waiting for user input.\n\n` +
      `Command being run: \`${command}\`\n` +
      `Terminal output prompting for input:\n` +
      `"""\n${promptText.trim()}\n"""\n\n` +
      `How should we respond to this prompt to proceed successfully? Choose the best answer (typically 'y' or '1' or 'yes').\n` +
      `Respond with ONLY the exact characters to write to the terminal stdin, and absolutely nothing else. No quotes, no markdown, no newlines.`;

    const result = await brain.getCompletionStream(aiPrompt, { page: tempPage, webSearch: false });
    const answer = (result.responseText || 'y').trim().replace(/['"`]/g, '');
    await tempPage.close().catch(() => {});
    return answer;
  } catch (err) {
    return 'y';
  }
}

process.on('exit', () => {
  stopAllServers();
});

process.on('SIGINT', () => {
  stopAllServers();
  process.exit(0);
});

process.on('SIGTERM', () => {
  stopAllServers();
  process.exit(0);
});