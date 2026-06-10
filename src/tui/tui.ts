// @ts-nocheck
const fs = require("fs");
const readline = require("readline");
const EventEmitter = require("events");

let webviewView = null;
let pendingConfirmationCallback = null;

// ── palette ───────────────────────────────────────────────────────────────────
const R = "\x1b[0m";
const fg = (r, g, b) => `\x1b[38;2;${r};${g};${b}m`;
const bg = (r, g, b) => `\x1b[48;2;${r};${g};${b}m`;

const C = {
  body: fg(220, 220, 225),
  dim: fg(130, 130, 130),
  dimmer: fg(85, 85, 85),
  muted: fg(150, 150, 150),
  bold: fg(255, 255, 255),
  italic: fg(170, 170, 170),
  code: fg(190, 235, 190),
  accent: fg(6, 182, 212),
  accentB: fg(8, 145, 178),
  you: fg(6, 182, 212),
  ai: fg(220, 220, 225),
  think: fg(180, 140, 80),
  tool: fg(52, 211, 153),
  err: fg(248, 113, 113),
  sep: fg(48, 48, 48),
  codeBorder: fg(75, 75, 75),
  compact: fg(0, 191, 255),
};

const FRAMES = ["⠁", "⠂", "⠄", "⡀", "⢀", "⠠", "⠐", "⠈"];

// ── wrapping ──────────────────────────────────────────────────────────────────
function wrapText(text, limit) {
  if (!text) return [""];
  const inputLines = text.split("\n");
  const outputLines = [];
  for (const line of inputLines) {
    if (line === "") {
      outputLines.push("");
      continue;
    }
    const words = line.split(" ");
    let cur = "";
    for (const w of words) {
      if (cur.length + w.length > limit) {
        outputLines.push(cur.trimEnd());
        cur = w + " ";
      } else {
        cur += w + " ";
      }
    }
    if (cur) outputLines.push(cur.trimEnd());
  }
  return outputLines.length ? outputLines : [""];
}

// ── tool parameter formatter ─────────────────────────────────────────────────
function formatToolParams(name, params) {
  if (!params || typeof params !== "object") return "";
  const parts = [];

  const rawPath = params.path || params.filePath || params.AbsolutePath || params.TargetFile || params.SearchPath || params.DirectoryPath || "";
  const basename = typeof rawPath === "string" && rawPath ? rawPath.split("/").pop() : "";

  if (name === "read_file" || name === "view_file") {
    if (basename) parts.push(`path: ${basename}`);
    const start = params.start_line || params.StartLine;
    const end = params.end_line || params.EndLine;
    if (start !== undefined && end !== undefined) parts.push(`lines: ${start}-${end}`);
    else if (start !== undefined) parts.push(`line: ${start}`);
    const offset = params.offset;
    if (offset !== undefined) parts.push(`offset: ${offset}`);
  } else if (name === "write_file" || name === "write_to_file") {
    if (basename) parts.push(`path: ${basename}`);
  } else if (name === "patch_file" || name === "multi_patch_file" || name === "replace_file_content" || name === "multi_replace_file_content") {
    if (basename) parts.push(`path: ${basename}`);
  } else if (name === "execute_shell_command" || name === "run_command") {
    const cmd = params.command || params.CommandLine || "";
    if (cmd) {
      const displayCmd = cmd.length > 25 ? cmd.substring(0, 22) + "..." : cmd;
      parts.push(`cmd: "${displayCmd}"`);
    }
  } else if (name === "grep_search") {
    const q = params.query || params.Query || "";
    if (q) parts.push(`query: "${q}"`);
    if (basename) parts.push(`in: ${basename}`);
  } else if (name === "glob_search") {
    const pattern = params.pattern || params.Query || "";
    if (pattern) parts.push(`pattern: "${pattern}"`);
  } else if (name === "list_directory" || name === "list_dir") {
    if (basename) parts.push(`path: ${basename}`);
    else if (rawPath === "/" || rawPath === "." || rawPath === "./") parts.push(`path: ${rawPath}`);
  } else if (name === "scroll_chat" || name === "scroll_chat_to_bottom") {
    const action = params.action;
    if (action) parts.push(`action: ${action}`);
  } else if (name === "manage_task" || name === "manage_plan") {
    const taskId = params.taskId || params.planId;
    if (taskId) parts.push(`id: ${taskId}`);
  }

  if (parts.length === 0) {
    const keys = Object.keys(params).slice(0, 2);
    for (const k of keys) {
      const val = params[k];
      const displayVal = typeof val === "string" && val.length > 20 ? val.substring(0, 17) + "..." : val;
      parts.push(`${k}: ${displayVal}`);
    }
  }
  return parts.length ? `(${parts.join(", ")})` : "";
}

// ── markdown inline render ────────────────────────────────────────────────────
function inline(str) {
  if (!str) return "";
  return str
    .replace(/\*\*([^*]+)\*\*/g, `${C.bold}$1${R}${C.body}`)
    .replace(/\*([^*]+)\*/g, `${C.italic}$1${R}${C.body}`)
    .replace(/`([^`]+)`/g, `${C.code}$1${R}${C.body}`);
}

function renderMd(raw) {
  if (!raw) return [""];
  const lines = [];
  let inCode = false;
  let codeLang = "";
  let codeLines = [];
  const width = process.stdout.columns || 80;
  const limit = width - 8;

  const flushCode = () => {
    if (codeLines.length) {
      const langLabel = codeLang ? ` ${codeLang} ` : " ";
      const bar = "─".repeat(Math.max(0, limit - langLabel.length - 2));
      lines.push(C.codeBorder + "╭" + langLabel + bar + "╮" + R);
      for (const l of codeLines) {
        lines.push(C.codeBorder + "│ " + R + C.code + l + R + C.codeBorder + " │" + R);
      }
      const inner = Math.min(limit, Math.max(...codeLines.map(l => l.length)));
      lines.push(C.codeBorder + "╰" + "─".repeat(inner) + "╯" + R);
      codeLines = [];
      codeLang = "";
    }
  };

  const addLine = (line) => {
    if (inCode) {
      codeLines.push(line);
    } else {
      lines.push(C.body + inline(line) + R);
    }
  };

  const rawLines = raw.split("\n");
  for (let line of rawLines) {
    if (line.startsWith("```")) {
      flushCode();
      inCode = !inCode;
      if (inCode) codeLang = line.slice(3).trim();
      continue;
    }
    if (inCode) {
      codeLines.push(line);
      continue;
    }
    if (line.startsWith("# ")) {
      addLine(C.accent + "▸ " + R + C.bold + line.slice(2) + R);
      lines.push("");
      continue;
    }
    if (line.startsWith("## ")) {
      addLine(C.accent + "  ▸ " + R + C.bold + line.slice(3) + R);
      lines.push("");
      continue;
    }
    if (line.startsWith("- ") || line.startsWith("* ")) {
      const wrapped = wrapText(line.slice(2), limit - 4);
      for (let j = 0; j < wrapped.length; j++) {
        if (j === 0) addLine(C.accentB + "  ● " + R + wrapped[0]);
        else addLine("    " + wrapped[j]);
      }
      continue;
    }
    if (/^\d+\. /.test(line)) {
      const match = line.match(/^(\d+)\. /);
      const num = match[1];
      const wrapped = wrapText(line.slice(num.length + 2), limit - 6);
      for (let j = 0; j < wrapped.length; j++) {
        if (j === 0) addLine(C.muted + "  " + num + ". " + R + wrapped[0]);
        else addLine("       " + wrapped[j]);
      }
      continue;
    }
    if (line.startsWith("> ")) {
      const wrapped = wrapText(line.slice(2), limit - 4);
      for (let j = 0; j < wrapped.length; j++) {
        addLine(C.accentB + " ▎ " + R + C.italic + wrapped[j]);
      }
      continue;
    }
    if (line === "") {
      if (lines.length && lines[lines.length - 1] !== "") lines.push("");
      continue;
    }
    const wrapped = wrapText(line, limit);
    for (const wl of wrapped) addLine(wl);
  }
  flushCode();
  return lines;
}

// ── mocked blessed components ────────────────────────────────────────────────
const scr = {
  render: () => {},
  key: (keys, cb) => {},
};

const topBar = {
  setContent: (content) => {},
};

const chat = {
  on: (evt, cb) => {},
  setContent: (content) => {},
  setScrollPerc: (perc) => {},
  getScrollHeight: () => 0,
  getScroll: () => 0,
  width: 80,
  height: 24,
  itop: 0,
  ibot: 0,
};

const inputSep = {};

const inputEmitter = new EventEmitter();
const input = {
  key: (keys, cb) => {},
  on: (evt, cb) => {
    inputEmitter.on(evt, cb);
  },
  clearValue: () => {},
  focus: () => {
    refocusInput();
  },
  screen: scr,
  _reading: false,
  readInput: (cb) => {},
};

let autoScrollEnabled = true;
function scrollChatToBottom() {}
function setAutoScroll(enabled) {
  autoScrollEnabled = !!enabled;
}

let currentMode = "act";
function setModeBadge(mode) {
  currentMode = mode;
  if (rl) {
    let promptText = "ds";
    if (currentMode) {
      promptText += ` (${currentMode})`;
    }
    rl.setPrompt(`\x1b[36m${promptText}\x1b[0m › `);
  }
  if (webviewView) {
    webviewView.webview.postMessage({
      command: "setMode",
      mode: mode
    });
  }
}
function getModeBadge() {
  return currentMode;
}

function scrollDown() {}
function scrollUp() {}

// ── spinner ───────────────────────────────────────────────────────────────────
let spinFrame = 0;
let activeSpinners = 0;
let globalSpinInterval = null;
let logItems = [];

function startGlobalSpinner() {
  activeSpinners++;
  if (webviewView) {
    webviewView.webview.postMessage({
      command: "spinner",
      active: true
    });
  }
  if (globalSpinInterval) return;
  globalSpinInterval = setInterval(() => {
    spinFrame++;
    renderLog();
  }, 100);
}

function stopGlobalSpinner() {
  activeSpinners = Math.max(0, activeSpinners - 1);
  if (activeSpinners === 0) {
    if (webviewView) {
      webviewView.webview.postMessage({
        command: "spinner",
        active: false
      });
    }
    if (globalSpinInterval) {
      clearInterval(globalSpinInterval);
      globalSpinInterval = null;
    }
  }
}

// ── readline interface ────────────────────────────────────────────────────────
let rl = null;
let isInterfaceInitialized = false;

function initReadline() {
  if (isInterfaceInitialized) return;
  rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    terminal: true,
  });

  rl.on("line", (line) => {
    clearActiveLines();
    inputEmitter.emit("submit", line);
  });

  isInterfaceInitialized = true;
}

function refocusInput() {
  if (webviewView) return; // Webview handles its own focus.
  initReadline();
  clearActiveLines();
  
  let promptText = "ds";
  if (currentMode) {
    promptText += ` (${currentMode})`;
  }
  
  rl.setPrompt(`\x1b[36m${promptText}\x1b[0m › `);
  rl.prompt();
}

// ── render ────────────────────────────────────────────────────────────────────
let finalizedIndex = 0;
let activeLinesCount = 0;

function clearActiveLines() {
  if (activeLinesCount > 0) {
    for (let i = 0; i < activeLinesCount; i++) {
      process.stdout.write("\x1b[A\x1b[2K");
    }
    activeLinesCount = 0;
  }
}

function isItemFinalized(item, idx, arr) {
  if (!item) return false;
  if (
    item.type === "user" ||
    item.type === "separator" ||
    item.type === "divider" ||
    item.type === "error" ||
    item.type === "compact"
  ) {
    return true;
  }
  if (item.type === "tool" && item.status === "completed") {
    return true;
  }
  if (item.type === "deepseek" && !item.spinning) {
    return true;
  }
  if (item.type === "status") {
    for (let j = idx + 1; j < arr.length; j++) {
      if (isItemFinalized(arr[j], j, arr)) return true;
    }
  }
  return false;
}

function renderItemLines(item, idx) {
  const itemLines = [];
  const width = process.stdout.columns || 80;

  if (item.type === "user") {
    const limit = Math.max(20, width - 9);
    const wrapped = wrapText(item.text, limit);
    itemLines.push(C.you + "  ›  " + R + C.body + wrapped[0] + R);
    for (let i = 1; i < wrapped.length; i++) {
      itemLines.push("     " + C.body + wrapped[i] + R);
    }
  } else if (item.type === "deepseek") {
    if (!item.text && !item.thinking && item.spinning) {
      itemLines.push(C.dimmer + "  " + FRAMES[spinFrame % FRAMES.length] + R);
    } else {
      const limit = Math.max(20, width - 7);

      if (item.thinking) {
        const isExpanded = item.expanded !== false;
        if (isExpanded) {
          const thLines = wrapText(item.thinking, limit - 4);
          for (let i = 0; i < thLines.length; i++) {
            itemLines.push(C.think + "  ┆ " + R + C.think + thLines[i] + R);
          }
        } else {
          const endT = item._thinkingEndTime || Date.now();
          const elapsed = item._thinkingStartTime
            ? Math.round((endT - item._thinkingStartTime) / 1000)
            : 0;
          const label = elapsed > 0 ? `thought ${elapsed}s` : "thought";
          itemLines.push(C.dimmer + "  ┆ " + C.think + "\x1b[3m" + label + " ▸" + R);
        }
      }

      if (item.text) {
        const rendered = renderMd(item.text);
        const hasThink = !!item.thinking;
        for (let i = 0; i < rendered.length; i++) {
          if (i === 0 && !hasThink) {
            itemLines.push(C.accentB + "  ● " + R + rendered[i]);
          } else if (hasThink) {
            itemLines.push(C.think + "  ┆ " + R + rendered[i]);
          } else {
            itemLines.push("    " + rendered[i]);
          }
        }
      }
    }
  } else if (item.type === "tool") {
    const displayParams = item.params ? " " + C.dim + formatToolParams(item.name, item.params) + R : "";

    if (item.status === "executing") {
      itemLines.push(
        C.dimmer +
          "  " +
          FRAMES[spinFrame % FRAMES.length] +
          " " +
          C.tool +
          item.name +
          R +
          displayParams +
          C.dimmer +
          " …" +
          R
      );
    } else {
      itemLines.push(C.tool + "  ✓ " + R + C.dim + item.name + R + displayParams);
      if (item.result) {
        const resStr = item.result.toString();
        if (
          resStr.startsWith("Error") ||
          resStr.startsWith("❌") ||
          resStr.startsWith("[Tool Failed]") ||
          resStr.startsWith("[MCP Failed]")
        ) {
          const rLines = resStr.split("\n");
          for (let i = 0; i < Math.min(10, rLines.length); i++) {
            itemLines.push(C.err + "  │ " + R + C.dim + rLines[i] + R);
          }
        }
      }
    }
  } else if (item.type === "separator") {
    itemLines.push("");
  } else if (item.type === "divider") {
    const w = Math.max(10, width - 8);
    itemLines.push("   " + C.sep + "─".repeat(w) + R);
  } else if (item.type === "error") {
    itemLines.push(C.err + "  ✕ " + R + C.muted + item.message + R);
  } else if (item.type === "status") {
    itemLines.push(C.dimmer + "  " + FRAMES[spinFrame % FRAMES.length] + " " + C.muted + item.text + R);
  } else if (item.type === "compact") {
    itemLines.push(C.compact + "  ⚙ " + R + C.muted + item.message + R);
  }

  return itemLines;
}

function renderLog() {
  if (webviewView) {
    webviewView.webview.postMessage({
      command: "updateLog",
      logItems: logItems,
      currentMode: currentMode
    });
    return;
  }
  try {
    clearActiveLines();

    while (
      finalizedIndex < logItems.length &&
      isItemFinalized(logItems[finalizedIndex], finalizedIndex, logItems)
    ) {
      const lines = renderItemLines(logItems[finalizedIndex], finalizedIndex);
      for (const line of lines) {
        process.stdout.write(line + "\n");
      }
      finalizedIndex++;
    }

    const activeLines = [];
    for (let idx = finalizedIndex; idx < logItems.length; idx++) {
      const lines = renderItemLines(logItems[idx], idx);
      activeLines.push(...lines);
    }

    if (activeLines.length > 0) {
      for (const line of activeLines) {
        process.stdout.write(line + "\n");
      }
      activeLinesCount = activeLines.length;
    }
  } catch (err) {
    const fs = require("fs");
    fs.appendFileSync(
      "/tmp/deepseek-cli-crash.log",
      `renderLog CLI error: ${err.stack}\n`
    );
  }
}

function setTopBarTitle(title) {
  // Stored for CLI compatibility
}

// ── chat history overlay ──────────────────────────────────────────────────────
function showChatHistory(sessions, onSelect) {
  initReadline();
  clearActiveLines();
  process.stdout.write("\n\x1b[36m--- Saved Sessions ---\x1b[0m\n");
  sessions.forEach((s, idx) => {
    const date = new Date(s.updated_at).toLocaleDateString("en-GB", {
      day: "2-digit",
      month: "short",
    });
    process.stdout.write(`  ${idx + 1}) \x1b[90m${date}\x1b[0m  ${s.title}\n`);
  });
  process.stdout.write("\n");

  rl.question("Select a session number (or press Enter to cancel): ", (answer) => {
    const val = answer.trim();
    if (val) {
      const idx = parseInt(val, 10) - 1;
      if (idx >= 0 && idx < sessions.length) {
        onSelect(sessions[idx]);
        return;
      }
      process.stdout.write("\x1b[31mInvalid session number.\x1b[0m\n");
    }
    refocusInput();
  });
}

function askConfirmation(message, callback) {
  if (webviewView) {
    webviewView.webview.postMessage({
      command: "askConfirmation",
      message: message
    });
    pendingConfirmationCallback = callback;
    return;
  }
  initReadline();
  clearActiveLines();
  rl.question(`⚠️  \x1b[33m${message}\x1b[0m (y/N): `, (answer) => {
    const val = answer.trim().toLowerCase();
    const confirmed = val === "y" || val === "yes";
    callback(confirmed);
  });
}

module.exports = {
  scr,
  topBar,
  chat,
  input,
  inputSep,
  setTopBarTitle,
  setModeBadge,
  getModeBadge,
  scrollDown,
  scrollUp,
  scrollChatToBottom,
  setAutoScroll,
  startGlobalSpinner,
  stopGlobalSpinner,
  renderLog,
  showChatHistory,
  askConfirmation,
  renderMd,
  wrapText,
  inline,
  refocusInput,
  C,
  R,
  setLogItems(items) {
    logItems = items;
    finalizedIndex = 0;
    activeLinesCount = 0;
    if (webviewView) {
      webviewView.webview.postMessage({
        command: "updateLog",
        logItems: logItems,
        currentMode: currentMode
      });
    }
  },
  getLogItems() {
    return logItems;
  },
  setWebview(view) {
    webviewView = view;
  },
  handleConfirmationResponse(confirmed) {
    if (pendingConfirmationCallback) {
      pendingConfirmationCallback(confirmed);
      pendingConfirmationCallback = null;
    }
  },
  inputEmitter,
};
