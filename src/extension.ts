import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';

// Import CLI dependencies
const tui = require('./tui/tui');
const orchestrator = require('./core/orchestrator');
const brainRegistry = require('./core/brains/registry');
const mcpLoader = require('./mcp/mcp_loader');
const checkpoints = require('./utils/checkpoints');
const askUserTool = require('./tools/ask_user');
const {
  initHistory,
  getSessions,
  setCurrentSessionId,
  loadSessionMessages,
  saveMessage,
  deleteSession
} = require('./core/history');

let pendingAskUserResolve: ((value: string) => void) | null = null;
let promptQueue: string[] = [];

function updateQueueUI(webviewView: vscode.WebviewView) {
  webviewView.webview.postMessage({
    command: 'updateQueue',
    queue: promptQueue
  });
}

async function processNextInQueue(webviewView: vscode.WebviewView) {
  if (orchestrator.isBusy()) return;
  if (promptQueue.length === 0) return;
  const nextPrompt = promptQueue.shift();
  updateQueueUI(webviewView);
  if (nextPrompt) {
    await handlePrompt(nextPrompt, webviewView);
  }
}

async function handlePrompt(text: string, webviewView: vscode.WebviewView) {
  orchestrator.setBusy(true);
  try {
    const cp = checkpoints.createCheckpoint(text);
    await orchestrator.ask(text, cp ? { checkpointId: cp.id } : {});
  } finally {
    orchestrator.setBusy(false);
    await processNextInQueue(webviewView);
  }
}

async function handleBrainstorm(text: string, webviewView: vscode.WebviewView) {
  orchestrator.setBusy(true);
  try {
    const { runBrainstormPipeline } = require('./core/brainstorm/engine');
    
    // Create a new chat session for brainstorm
    const { createSession: createHistorySession, setCurrentSessionId: setHistorySessionId, updateSessionTitle } = require('./core/history');
    const ns = createHistorySession('Brainstorm: ' + text.slice(0, 40));
    setHistorySessionId(ns.id);
    tui.setTopBarTitle('Brainstorm: ' + text.slice(0, 60));
    
    // Save user message
    const logItems = tui.getLogItems();
    logItems.push({ type: 'user', text });
    saveMessage(ns.id, 'user', text);
    tui.renderLog();
    
    tui.setAutoScroll(true);
    
    await runBrainstormPipeline(text);
  } catch (err: any) {
    const logItems = tui.getLogItems();
    logItems.push({ type: 'error', message: `Brainstorm failed: ${err.message}` });
    
    // Save pipeline state on failure for retry
    try {
      const { findLatestPipelineState } = require('./core/brainstorm/engine');
      const state = findLatestPipelineState();
      if (state) {
        logItems.push({ 
          type: 'status', 
          text: `⚠️ Pipeline state saved for retry (Level: ${state.level}, Step: ${state.step})` 
        });
        // Post retry state to webview
        if (webviewView) {
          webviewView.webview.postMessage({
            command: 'brainstormRetryReady',
            state: {
              userPrompt: state.userPrompt,
              evidenceDir: state.evidenceDir,
              level: state.level,
              step: state.step,
            },
            userMessage: text,
          });
        }
      } else {
        // No pipeline state found, just save the user prompt for retry
        if (webviewView) {
          webviewView.webview.postMessage({
            command: 'brainstormRetryReady',
            state: null,
            userMessage: text,
          });
        }
      }
    } catch (stateErr) {
      // Don't let state saving errors crash the UI
      fs.appendFileSync(
        "/tmp/deepseek-cli-debug.log",
        `[extension] Failed to save pipeline state: ${stateErr}\n`
      );
    }
    
    tui.renderLog();
  } finally {
    orchestrator.setBusy(false);
  }
}


export function activate(context: vscode.ExtensionContext) {
  // Set working directory to VSCode workspace folder if available
  if (vscode.workspace.workspaceFolders && vscode.workspace.workspaceFolders.length > 0) {
    const workspaceFolder = vscode.workspace.workspaceFolders[0].uri.fsPath;
    try {
      process.chdir(workspaceFolder);
    } catch (err) {
      console.error(`Failed to change directory to workspace: ${err}`);
    }
  }

  // Initialize sessions history
  initHistory();

  const provider = new DeepSeekChatProvider(context);

  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(
      DeepSeekChatProvider.viewType,
      provider,
      {
        webviewOptions: {
          retainContextWhenHidden: true
        }
      }
    )
  );
}

export function deactivate() {
  const brain = brainRegistry.getActiveBrain();
  if (brain) {
    brain.cleanup().catch(() => {});
  }
  mcpLoader.cleanup().catch(() => {});
}

class DeepSeekChatProvider implements vscode.WebviewViewProvider {
  public static readonly viewType = 'deepseek-cli-sidebar';
  private _view?: vscode.WebviewView;

  constructor(private readonly _context: vscode.ExtensionContext) {}

  public resolveWebviewView(
    webviewView: vscode.WebviewView,
    context: vscode.WebviewViewResolveContext,
    _token: vscode.CancellationToken
  ) {
    this._view = webviewView;

    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [this._context.extensionUri]
    };

    webviewView.webview.html = this._getHtmlForWebview(webviewView.webview);

    // Register webview with TUI redirector
    tui.setWebview(webviewView);

    // Register ask_user handler
    askUserTool.registerExtensionHandler((params: any) => {
      webviewView.webview.postMessage({
        command: 'showAskUser',
        params: params
      });
      return new Promise<string>((resolve) => {
        pendingAskUserResolve = resolve;
      });
    });

    // Handle messages from the webview
    webviewView.webview.onDidReceiveMessage(async (data) => {
      switch (data.command) {
        case 'sendMessage': {
          const text = data.text.trim();
          if (!text) return;

          // Slash commands execute immediately (no queue)
          if (text === '/clear' || text === '/compact' || 
              text.startsWith('/install-workflow') || text.startsWith('/install-mcp') || 
              text === '/list-workflows') {
            // Original handling continues below after this block
          } else {
            // Check if brainstorm mode is active
            const currentMode = tui.getModeBadge();
            if (currentMode === 'brainstorm') {
              // Route to brainstorm engine (no queue, no parallelism)
              if (orchestrator.isBusy()) return;
              await handleBrainstorm(text, webviewView);
              break;
            }
            // Regular prompt: queue if busy, else process immediately
            if (orchestrator.isBusy()) {
              promptQueue.push(text);
              updateQueueUI(webviewView);
              return;
            }
            await handlePrompt(text, webviewView);
            break;
          }

          // Original slash command handling (unchanged)
          if (orchestrator.isBusy()) return;
          if (!text) return;

          if (text === '/clear') {
            tui.setLogItems([]);
            setCurrentSessionId(null);
            tui.renderLog();
            return;
          }

          if (text === '/compact') {
            orchestrator.setBusy(true);
            tui.renderLog();
            try {
              await orchestrator.compactCurrentSession();
            } catch (err) {}
            orchestrator.setBusy(false);
            tui.renderLog();
            return;
          }

          if (text.startsWith('/install-workflow')) {
            const url = text.replace("/install-workflow ", "").trim();
            if (!url) {
              const logItems = tui.getLogItems();
              logItems.push({ type: "error", message: "Usage: /install-workflow <raw-github-url>" });
              tui.renderLog();
              return;
            }
            const logItems = tui.getLogItems();
            logItems.push({ type: "status", text: `downloading workflow from ${url}...` });
            tui.renderLog();

            const { execSync } = require("child_process");
            const os = require("os");
            try {
              const workflowsDir = path.join(os.homedir(), ".ds_config", "workflows");
              fs.mkdirSync(workflowsDir, { recursive: true });
              const filename = path.basename(url).replace(/[?#].*$/, "") || "workflow.md";
              const dest = path.join(workflowsDir, filename);
              execSync(`curl -fsSL "${url}" -o "${dest}"`, { timeout: 15000 });
              logItems.push({ type: "status", text: `Installed: ${filename} -> ${dest}` });
              logItems.push({ type: "status", text: `Add 'trigger: <keyword>' as the first line to make it project-aware.` });
            } catch (err: any) {
              logItems.push({ type: "error", message: `Failed to download: ${err.message}` });
            }
            tui.renderLog();
            return;
          }

          if (text.startsWith('/install-mcp')) {
            const parts = text.replace("/install-mcp ", "").trim().split(/\s+/);
            if (parts.length < 2) {
              const logItems = tui.getLogItems();
              logItems.push({ type: "error", message: "Usage: /install-mcp <server-name> <npx-package> [extra-args...]" });
              tui.renderLog();
              return;
            }
            const [serverName, pkg, ...extraArgs] = parts;
            const logItems = tui.getLogItems();

            try {
              const mcpConfigPath = mcpLoader.CONFIG_PATH;
              const config = JSON.parse(fs.readFileSync(mcpConfigPath, "utf8"));
              if (config.mcpServers && config.mcpServers[serverName]) {
                logItems.push({ type: "error", message: `MCP server '${serverName}' already exists. Remove it from mcp.json first.` });
                tui.renderLog();
                return;
              }
              
              const serverEnv: any = {};
              if (pkg.includes("server-puppeteer") || pkg.includes("puppeteer")) {
                serverEnv.PUPPETEER_SKIP_DOWNLOAD = "true";
                serverEnv.PUPPETEER_EXECUTABLE_PATH = "/usr/bin/chromium";
              }

              if (!config.mcpServers) config.mcpServers = {};
              config.mcpServers[serverName] = {
                command: "npx",
                args: ["-y", pkg, ...extraArgs],
                ...(Object.keys(serverEnv).length > 0 && { env: serverEnv })
              };
              fs.writeFileSync(mcpConfigPath, JSON.stringify(config, null, 2));
              logItems.push({ type: "status", text: `Installed MCP server '${serverName}' (${pkg}). Restart ds to activate.` });
            } catch (err: any) {
              logItems.push({ type: "error", message: `Failed: ${err.message}` });
            }
            tui.renderLog();
            return;
          }

          if (text === '/list-workflows') {
            const logItems = tui.getLogItems();
            const os = require("os");
            const globalDir = path.join(os.homedir(), ".ds_config", "workflows");

            let output = "## Installed Workflows\n\n";
            const listDir = (dir: string, label: string) => {
              if (!fs.existsSync(dir)) return;
              const files = fs.readdirSync(dir).filter((f: string) => f.endsWith(".md"));
              if (files.length === 0) return;
              output += `**${label}** (${dir}):\n`;
              for (const f of files) {
                const content = fs.readFileSync(path.join(dir, f), "utf8");
                const firstLine = content.split("\n")[0].trim();
                let trigger = "None";
                if (firstLine.startsWith("trigger:")) trigger = firstLine.replace("trigger:", "").trim();
                output += `- \`${f}\` (Trigger: \`${trigger}\`)\n`;
              }
              output += "\n";
            };
            listDir(globalDir, "Global");
            
            if (output === "## Installed Workflows\n\n") {
              output += "No workflows found in global or local directories.";
            }
            logItems.push({ type: "deepseek", text: output });
            tui.renderLog();
            return;
          }

          // Auto-checkpoint
          const cp = checkpoints.createCheckpoint(text);

          // Trigger ask loop
          orchestrator.ask(text, cp ? { checkpointId: cp.id } : {}).catch(() => {});
          break;
        }

        case 'changeMode': {
          const tools = require('./tools');
          tools.setMode(data.mode);
          tui.setModeBadge(data.mode);
          tui.renderLog();
          
          // When switching to brainstorm mode, automatically create a new chat
          if (data.mode === 'brainstorm' && !orchestrator.isBusy()) {
            tui.setLogItems([]);
            setCurrentSessionId(null);
            const brain = brainRegistry.getActiveBrain();
            if (brain && typeof brain.onSessionLoad === 'function') {
              orchestrator.setBusy(true);
              const switchItem = { type: 'status', text: 'opening new chat for brainstorm session...' };
              tui.getLogItems().push(switchItem);
              tui.startGlobalSpinner();
              tui.renderLog();
              try {
                await brain.onSessionLoad(null);
              } catch (e) {}
              const idx = tui.getLogItems().indexOf(switchItem);
              if (idx !== -1) tui.getLogItems().splice(idx, 1);
              tui.stopGlobalSpinner();
              tui.renderLog();
              orchestrator.setBusy(false);
            }
          }
          break;
        }

        case 'newChat': {
          if (orchestrator.isBusy()) return;
          tui.setLogItems([]);
          setCurrentSessionId(null);
          tui.setModeBadge(tui.getModeBadge() || 'act');

          const brain = brainRegistry.getActiveBrain();
          if (brain && typeof brain.onSessionLoad === 'function') {
            orchestrator.setBusy(true);
            const switchItem = { type: 'status', text: 'opening new chat session in browser...' };
            tui.getLogItems().push(switchItem);
            tui.startGlobalSpinner();
            tui.renderLog();

            try {
              await brain.onSessionLoad(null);
            } catch (e) {}

            const idx = tui.getLogItems().indexOf(switchItem);
            if (idx !== -1) tui.getLogItems().splice(idx, 1);
            tui.stopGlobalSpinner();
            tui.renderLog();
            orchestrator.setBusy(false);
          }
          break;
        }

        case 'revertCheckpoint': {
          if (orchestrator.isBusy()) return;
          try {
            const meta = checkpoints.revertToCheckpoint(data.cpId);
            const logItems = tui.getLogItems();
            logItems.push({
              type: 'status',
              text: `✓ Reverted workspace to Checkpoint ${meta.id}`
            });
            tui.renderLog();
          } catch (err: any) {
            const logItems = tui.getLogItems();
            logItems.push({ type: 'error', message: err.message });
            tui.renderLog();
          }
          break;
        }

        case 'getHistory': {
          const sessions = getSessions();
          webviewView.webview.postMessage({
            command: 'historyList',
            sessions: sessions
          });
          break;
        }

        case 'deleteSession': {
          if (orchestrator.isBusy()) return;
          deleteSession(data.sessionId);
          
          const sessions = getSessions();
          webviewView.webview.postMessage({
            command: 'historyList',
            sessions: sessions
          });
          break;
        }

        case 'selectSession': {
          if (orchestrator.isBusy()) return;
          const sessionId = data.sessionId;
          const sessions = getSessions();
          const session = sessions.find((s: any) => s.id === sessionId);
          if (!session) return;

          setCurrentSessionId(sessionId);
          const logItems: any[] = [];
          tui.setLogItems(logItems);

          for (const msg of loadSessionMessages(sessionId)) {
            if (msg.role === 'user') {
              if (logItems.length) {
                logItems.push({ type: 'separator' });
                logItems.push({ type: 'divider' });
                logItems.push({ type: 'separator' });
              }
              logItems.push({ type: 'user', text: msg.content, checkpointId: msg.metadata?.checkpointId });
            } else if (msg.role === 'assistant') {
              logItems.push({
                type: 'deepseek',
                text: msg.content,
                thinking: msg.metadata?.thinking || '',
                expanded: false,
                spinning: false,
              });
            } else if (msg.role === 'tool_call') {
              logItems.push({
                type: 'tool',
                name: msg.content,
                params: msg.metadata?.params,
                status: 'completed',
                result: '',
                expanded: false,
              });
            } else if (msg.role === 'tool_result') {
              const t = logItems
                .slice()
                .reverse()
                .find((i) => i.type === 'tool' && i.name === msg.metadata?.tool);
              if (t) t.result = msg.content;
            }
          }
          tui.renderLog();

          const brain = brainRegistry.getActiveBrain();
          if (brain && typeof brain.onSessionLoad === 'function') {
            orchestrator.setBusy(true);
            const switchItem = { type: 'status', text: 'switching browser to selected chat...' };
            tui.getLogItems().push(switchItem);
            tui.startGlobalSpinner();
            tui.renderLog();

            try {
              await brain.onSessionLoad(session);
            } catch (e) {}

            const idx = tui.getLogItems().indexOf(switchItem);
            if (idx !== -1) tui.getLogItems().splice(idx, 1);
            tui.stopGlobalSpinner();
            tui.renderLog();
            orchestrator.setBusy(false);
          }
          break;
        }

        case 'answerAskUser': {
          if (pendingAskUserResolve) {
            pendingAskUserResolve(data.text);
            pendingAskUserResolve = null;
          }
          break;
        }

        case 'askConfirmationResponse': {
          tui.handleConfirmationResponse(data.confirmed);
          break;
        }

        case 'retryBrainstorm': {
          if (orchestrator.isBusy()) return;
          const retryText = data.text || '';
          if (!retryText) return;
          await handleBrainstorm(retryText, webviewView);
          break;
        }

        case 'getConfig': {
          try {
            const configUtils = require('./utils/config');
            const config = configUtils.loadConfig();
            webviewView.webview.postMessage({
              command: 'updateConfigState',
              headless: !!config.headless
            });
          } catch (err) {}
          break;
        }

        case 'toggleHeadless': {
          try {
            const configUtils = require('./utils/config');
            const config = configUtils.loadConfig();
            config.headless = !config.headless;
            configUtils.saveConfig(config);
            
            webviewView.webview.postMessage({
              command: 'updateConfigState',
              headless: !!config.headless
            });
            
            const logItems = tui.getLogItems();
            logItems.push({
              type: "status",
              text: `Headless mode toggled to: ${config.headless ? "ON" : "OFF"}. Please restart browser to apply.`
            });
            tui.renderLog();
          } catch (err) {}
          break;
        }

        case 'restartBrowser': {
          const logItems = tui.getLogItems();
          logItems.push({ type: "status", text: "Restarting browser..." });
          tui.renderLog();
          tui.startGlobalSpinner();
          
          try {
            const brain = brainRegistry.getActiveBrain();
            if (brain && (brain.id === 'deepseek-web' || (brain.constructor && brain.constructor.id === 'deepseek-web'))) {
              await brain.cleanup();
              brain.initPromise = null;
              await brain.init();
              logItems.push({ type: "status", text: "✓ Browser restarted successfully." });
            } else {
              logItems.push({ type: "error", message: "Active brain is not deepseek-web." });
            }
          } catch (err: any) {
            logItems.push({ type: "error", message: `Failed to restart browser: ${err.message}` });
          } finally {
            tui.stopGlobalSpinner();
            tui.renderLog();
          }
          break;
        }
      }
    });

    // Boot agent in the background when the view resolves
    this._bootAgent();
  }

  private async _bootAgent() {
    const bootItem = { type: 'status', text: 'booting agent brain (launching headless browser)...' };
    const logItems = [bootItem];
    tui.setLogItems(logItems);
    tui.startGlobalSpinner();
    tui.renderLog();

    const mcpPromise = mcpLoader.init((msg: string) => {
      bootItem.text = msg;
      tui.renderLog();
    });
    const brain = brainRegistry.getActiveBrain();
    const brainPromise = brain ? brain.init() : Promise.resolve();

    try {
      await brainPromise;
      bootItem.text = 'connecting to MCP servers...';
      tui.renderLog();
      await mcpPromise;
    } catch (err) {
      // Suppress errors during background boot to keep UI robust
    } finally {
      const idx = logItems.indexOf(bootItem);
      if (idx !== -1) {
        logItems.splice(idx, 1);
      }
      tui.stopGlobalSpinner();
      tui.renderLog();
    }
  }

  private _getHtmlForWebview(webview: vscode.Webview): string {
    const htmlPath = path.join(this._context.extensionPath, 'dist', 'src', 'webview', 'sidebar.html');
    let html = fs.readFileSync(htmlPath, 'utf8');
    
    // Inject logo URI
    const logoUri = webview.asWebviewUri(vscode.Uri.joinPath(this._context.extensionUri, 'public', 'deepseek-color.svg'));
    html = html.replace(/{{logoUri}}/g, logoUri.toString());
    
    return html;
  }
}