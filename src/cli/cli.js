const fs = require("fs");
const path = require("path");
const os = require("os");
const tui = require("../tui/tui");
const orchestrator = require("../core/orchestrator");
const brainRegistry = require("../core/brains/registry");
const mcpLoader = require("../mcp/mcp_loader");
const {
  initHistory,
  getSessions,
  setCurrentSessionId,
  loadSessionMessages,
} = require("../core/history");

process.on("unhandledRejection", (reason) => {
  if (orchestrator.isBusy()) {
    const logItems = tui.getLogItems();
    logItems.push({ type: "error", message: `Unhandled error: ${reason}` });
    orchestrator.setBusy(false);
    tui.stopGlobalSpinner();
    tui.renderLog();
  }
  fs.appendFileSync(
    "/tmp/deepseek-cli-debug.log",
    `[cli] Unhandled Rejection: ${reason && reason.stack ? reason.stack : reason}\n`
  );
});



// ── key bindings ──────────────────────────────────────────────────────────────
tui.input.key(["pageup"], () => tui.scrollUp());
tui.input.key(["pagedown"], () => tui.scrollDown());
tui.input.key(["S-up"], () => tui.scrollUp(3));
tui.input.key(["S-down"], () => tui.scrollDown(3));
tui.input.key(["C-u"], () => tui.scrollUp());
tui.input.key(["C-d"], () => tui.scrollDown());

tui.input.on("submit", async (val) => {
  if (orchestrator.isBusy()) return;
  val = (val || "").trim();
  if (!val) {
    tui.refocusInput();
    return;
  }
  tui.input.clearValue();
  tui.scr.render();

  if (val === "/chat") {
    try {
      const sessions = getSessions();
      if (sessions.length) {
        tui.showChatHistory(sessions, loadSessionIntoTUI);
      } else {
        const logItems = tui.getLogItems();
        if (logItems.length && logItems[logItems.length - 1].type !== "separator") {
          logItems.push({ type: "separator" });
        }
        logItems.push({ type: "error", message: "No saved sessions found. Start a new conversation by typing a prompt." });
        tui.renderLog();
        tui.refocusInput();
      }
    } catch (err) {
      fs.appendFileSync(
        "/tmp/deepseek-cli-debug.log",
        `[cli] ERROR: ${err.stack}\n`
      );
      tui.refocusInput();
    }
    return;
  }

  if (val === "/new") {
    tui.setLogItems([]);
    setCurrentSessionId(null);
    tui.setTopBarTitle("new session");
    tui.renderLog();
    tui.refocusInput();

    const brain = brainRegistry.getActiveBrain();
    if (brain && brain.id === "deepseek-web") {
      brain.getPage().then(async (page) => {
        try {
          await page.goto("https://chat.deepseek.com/", { waitUntil: "commit" });
          await brain.setupInterceptors(page);
        } catch (e) {}
      });
    }
    return;
  }

  // ── /install-workflow <url> ───────────────────────────────────────────────
  if (val.startsWith("/install-workflow ")) {
    const url = val.replace("/install-workflow ", "").trim();
    if (!url) {
      const logItems = tui.getLogItems();
      logItems.push({ type: "error", message: "Usage: /install-workflow <raw-github-url>" });
      tui.renderLog();
      tui.refocusInput();
      return;
    }
    const logItems = tui.getLogItems();
    logItems.push({ type: "status", text: `downloading workflow from ${url}...` });
    tui.renderLog();

    const { execSync } = require("child_process");
    try {
      const workflowsDir = path.join(os.homedir(), ".deepseek_cli", "workflows");
      fs.mkdirSync(workflowsDir, { recursive: true });
      const filename = path.basename(url).replace(/[?#].*$/, "") || "workflow.md";
      const dest = path.join(workflowsDir, filename);
      execSync(`curl -fsSL "${url}" -o "${dest}"`, { timeout: 15000 });
      logItems.push({ type: "status", text: `Installed: ${filename} -> ${dest}` });
      logItems.push({ type: "status", text: `Add 'trigger: <keyword>' as the first line to make it project-aware.` });
    } catch (err) {
      logItems.push({ type: "error", message: `Failed to download: ${err.message}` });
    }
    tui.renderLog();
    tui.refocusInput();
    return;
  }

  // ── /install-mcp <name> <npx-package> [args...] ──────────────────────────
  if (val.startsWith("/install-mcp ")) {
    const parts = val.replace("/install-mcp ", "").trim().split(/\s+/);
    if (parts.length < 2) {
      const logItems = tui.getLogItems();
      logItems.push({ type: "error", message: "Usage: /install-mcp <server-name> <npx-package> [extra-args...]" });
      tui.renderLog();
      tui.refocusInput();
      return;
    }
    const [serverName, pkg, ...extraArgs] = parts;
    const logItems = tui.getLogItems();

    try {
      const mcpConfigPath = path.join(__dirname, "mcp", "mcp.json");
      const config = JSON.parse(fs.readFileSync(mcpConfigPath, "utf8"));
      if (config.mcpServers[serverName]) {
        logItems.push({ type: "error", message: `MCP server '${serverName}' already exists. Remove it from mcp.json first.` });
        tui.renderLog();
        tui.refocusInput();
        return;
      }
      
      const serverEnv = {};
      if (pkg.includes("server-puppeteer") || pkg.includes("puppeteer")) {
        serverEnv.PUPPETEER_SKIP_DOWNLOAD = "true";
        serverEnv.PUPPETEER_EXECUTABLE_PATH = "/usr/bin/chromium";
      }

      config.mcpServers[serverName] = {
        command: "npx",
        args: ["-y", pkg, ...extraArgs],
        ...(Object.keys(serverEnv).length > 0 && { env: serverEnv })
      };
      fs.writeFileSync(mcpConfigPath, JSON.stringify(config, null, 2));
      logItems.push({ type: "status", text: `Installed MCP server '${serverName}' (${pkg}). Restart ds to activate.` });
    } catch (err) {
      logItems.push({ type: "error", message: `Failed: ${err.message}` });
    }
    tui.renderLog();
    tui.refocusInput();
    return;
  }

  // ── /list-workflows ──────────────────────────────────────────────────────────
  if (val === "/list-workflows") {
    const logItems = tui.getLogItems();
    const globalDir = path.join(os.homedir(), ".deepseek_cli", "workflows");
    const localDir = path.join(process.cwd(), "ds_config", "workflows");

    let output = "## Installed Workflows\n\n";
    const listDir = (dir, label) => {
      if (!fs.existsSync(dir)) return;
      const files = fs.readdirSync(dir).filter((f) => f.endsWith(".md"));
      if (files.length === 0) return;
      output += `**${label}** (${dir}):\n`;
      for (const f of files) {
        const content = fs.readFileSync(path.join(dir, f), "utf8");
        const firstLine = content.split("\n")[0].trim();
        const trigger = firstLine.startsWith("trigger:") ? firstLine.replace("trigger:", "").trim() : "always";
        output += `  - ${f}  [trigger: ${trigger}]\n`;
      }
      output += "\n";
    };
    listDir(globalDir, "Global");
    listDir(localDir, "Local (project)");

    if (output === "## Installed Workflows\n\n") {
      output += "No workflows installed.\n";
    }
    logItems.push({ type: "deepseek", text: output, spinning: false });
    tui.renderLog();
    tui.refocusInput();
    return;
  }

  // ── /list-mcp ────────────────────────────────────────────────────────────
  if (val === "/list-mcp") {
    const logItems = tui.getLogItems();
    try {
      const mcpConfigPath = path.join(__dirname, "mcp", "mcp.json");
      const config = JSON.parse(fs.readFileSync(mcpConfigPath, "utf8"));
      const servers = Object.entries(config.mcpServers || {});
      let output = "## Installed MCP Servers\n\n";
      if (servers.length === 0) {
        output += "No MCP servers configured.\n";
      } else {
        for (const [name, cfg] of servers) {
          const pkg = cfg.args ? cfg.args.find((a) => a.startsWith("@") || !a.startsWith("-")) || "" : "";
          output += `- **${name}**: ${cfg.command} ${(cfg.args || []).join(" ")}\n`;
        }
      }
      logItems.push({ type: "deepseek", text: output, spinning: false });
    } catch (err) {
      const logItems = tui.getLogItems();
      logItems.push({ type: "error", message: `Failed: ${err.message}` });
    }
    tui.renderLog();
    tui.refocusInput();
    return;
  }

  // ── /help ─────────────────────────────────────────────────────────────────
  if (val === "/help") {
    const logItems = tui.getLogItems();
    logItems.push({
      type: "deepseek",
      text: `## Available Commands

- **/new** — Start a new chat session
- **/chat** — Browse chat history
- **/install-workflow <url>** — Download a workflow .md from a raw GitHub URL
- **/install-mcp <name> <package>** — Add an MCP server to mcp.json
- **/list-workflows** — List all installed workflows and their triggers
- **/list-mcp** — List all configured MCP servers
- **/help** — Show this help message`,
      spinning: false,
    });
    tui.renderLog();
    tui.refocusInput();
    return;
  }

  orchestrator.ask(val).catch(() => {});
});

tui.scr.key(["C-c"], () => cleanupAndExit());

process.on("SIGINT", () => cleanupAndExit());

async function cleanupAndExit() {
  const brain = brainRegistry.getActiveBrain();
  if (brain) {
    try {
      await brain.cleanup();
    } catch (e) {}
  }
  try {
    await mcpLoader.cleanup();
  } catch (e) {}
  process.exit(0);
}

async function loadSessionIntoTUI(session) {
  setCurrentSessionId(session.id);
  const logItems = [];
  tui.setLogItems(logItems);
  tui.setTopBarTitle(session.title);

  for (const msg of loadSessionMessages(session.id)) {
    if (msg.role === "user") {
      if (logItems.length) {
        logItems.push({ type: "separator" });
        logItems.push({ type: "divider" });
        logItems.push({ type: "separator" });
      }
      logItems.push({ type: "user", text: msg.content });
    } else if (msg.role === "assistant") {
      logItems.push({
        type: "deepseek",
        text: msg.content,
        thinking: msg.thinking || "",
        expanded: false,
        spinning: false,
      });
    } else if (msg.role === "tool_call") {
      logItems.push({
        type: "tool",
        name: msg.content,
        status: "completed",
        result: "",
        expanded: false,
      });
    } else if (msg.role === "tool_result") {
      const t = logItems
        .slice()
        .reverse()
        .find((i) => i.type === "tool" && i.name === msg.tool);
      if (t) t.result = msg.content;
    }
  }
  tui.renderLog();

  const brain = brainRegistry.getActiveBrain();
  if (brain && typeof brain.onSessionLoad === "function") {
    brain.onSessionLoad(session).catch(() => {});
  }
}


function main() {
  initHistory();

  const bootItem = { type: "status", text: "booting agent brain (launching headless browser)..." };
  const logItems = [bootItem];

  tui.setLogItems(logItems);
  tui.input.focus();
  tui.setTopBarTitle("deepseek");
  tui.startGlobalSpinner();
  tui.renderLog();

  const mcpPromise = mcpLoader.init((msg) => {
    bootItem.text = msg;
    tui.renderLog();
  });
  const brain = brainRegistry.getActiveBrain();
  const brainPromise = brain ? brain.init() : Promise.resolve();

  (async () => {
    try {
      await brainPromise;
      bootItem.text = "connecting to MCP servers...";
      tui.renderLog();
      await mcpPromise;
    } catch (err) {
      // Suppress errors during background boot to not crash the TUI
    } finally {
      const idx = logItems.indexOf(bootItem);
      if (idx !== -1) {
        logItems.splice(idx, 1);
      }
      tui.stopGlobalSpinner();
      tui.renderLog();
    }
  })();
}

module.exports = {
  main,
};
