#!/usr/bin/env node
const fs = require("fs");

// Create mcp-sandbox directory at startup
fs.mkdirSync("/tmp/mcp-sandbox", { recursive: true });
const { chromium } = require("playwright");
const { execSync } = require("child_process");
const blessed = require("blessed");
const http = require("http");
const { tools, getSystemPrompt, normalizeToolCall } = require("./tools");
const mcpLoader = require("./mcp/mcp_loader");
const {
  initHistory,
  createSession,
  getCurrentSessionId,
  setCurrentSessionId,
  updateSessionDeepseekId,
  updateSessionTitle,
  saveMessage,
  loadSessionMessages,
  getSessions,
} = require("./history");

process.on("unhandledRejection", (reason) => {
  if (busy) {
    logItems.push({ type: "error", message: `Unhandled error: ${reason}` });
    busy = false;
    if (globalSpinInterval) clearInterval(globalSpinInterval);
    renderLog();
  }
  console.error("Unhandled rejection:", reason);
});

// ── palette ───────────────────────────────────────────────────────────────────
const R = "\x1b[0m";
const fg = (r, g, b) => `\x1b[38;2;${r};${g};${b}m`;
const bg = (r, g, b) => `\x1b[48;2;${r};${g};${b}m`;

const C = {
  body: fg(210, 210, 210),
  dim: fg(90, 90, 90),
  dimmer: fg(58, 58, 58),
  muted: fg(130, 130, 130),
  bold: fg(255, 255, 255),
  italic: fg(155, 155, 155),
  code: fg(200, 230, 200),
  accent: fg(82, 196, 196),
  accentB: fg(48, 140, 140),
  you: fg(82, 196, 196),
  ai: fg(190, 190, 190),
  think: fg(88, 88, 88),
  tool: fg(110, 120, 100),
  err: fg(200, 80, 80),
  sep: fg(45, 45, 45),
  codeBorder: fg(60, 60, 60),
};

const FORMAT_REMINDER = `[SYSTEM: Single JSON tool call only. No parallel tools.]`;

// ── wrapping ──────────────────────────────────────────────────────────────────
function wrapText(text, limit) {
  if (!text) return [""];
  const words = text.split(" ");
  const lines = [];
  let cur = "";
  for (const w of words) {
    if (cur.length + w.length > limit) { lines.push(cur.trimEnd()); cur = w + " "; }
    else cur += w + " ";
  }
  if (cur) lines.push(cur.trimEnd());
  return lines.length ? lines : [""];
}

// ── inline markdown (single-line) ────────────────────────────────────────────
function inline(s) {
  const b = C.body;
  return s
    .replace(/`([^`]+)`/g, C.code + "$1" + R + b)
    .replace(/\*\*\*([^*]+)\*\*\*/g, "\x1b[1;3m" + C.bold + "$1" + R + b)
    .replace(/\*\*([^*]+)\*\*/g, "\x1b[1m" + C.bold + "$1" + R + b)
    .replace(/\*([^*\n]+)\*/g, "\x1b[3m" + C.italic + "$1" + R + b)
    .replace(/~~([^~]+)~~/g, "\x1b[9m" + C.dim + "$1" + R + b)
    .replace(/__([^_]+)__/g, "\x1b[1m" + C.bold + "$1" + R + b)
    .replace(/(?<!\w)_([^_\n]+?)_(?!\w)/g, "\x1b[3m" + C.italic + "$1" + R + b);
}

// ── block markdown renderer ───────────────────────────────────────────────────
function renderMd(raw) {
  const width = chat && chat.width ? chat.width : scr.width || 80;
  const limit = Math.max(20, width - 7);
  const lines = raw.trim().split("\n");
  const out = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    const fence = line.match(/^```(\w*)/);
    if (fence) {
      const lang = fence[1] || "text";
      const codeLines = [];
      i++;
      while (i < lines.length && !lines[i].startsWith("```")) {
        codeLines.push(lines[i]);
        i++;
      }
      const inner = Math.min(Math.max(...codeLines.map(l => l.length), 4), limit - 4);
      const langLabel = lang ? ` ${lang} ` : " text ";
      const bar = "─".repeat(Math.max(0, inner - langLabel.length));
      out.push(C.codeBorder + "╭" + langLabel + bar + "╮" + R);
      for (const cl of codeLines) {
        const content = cl.length > inner ? cl.slice(0, inner - 1) + "…" : cl;
        out.push(C.codeBorder + "│" + R + " " + C.code + content.padEnd(inner - 1) + R + " " + C.codeBorder + "│" + R);
      }
      out.push(C.codeBorder + "╰" + "─".repeat(inner) + "╯" + R);
      continue;
    }

    const hm = line.match(/^(#{1,3}) (.*)/);
    if (hm) {
      if (out.length && out[out.length - 1] !== "") out.push("");
      const level = hm[1].length;
      const prefix = level === 1 ? "§ " : level === 2 ? "· " : "  ";
      for (const wl of wrapText(hm[2], limit))
        out.push(C.accent + prefix + R + "\x1b[1m" + C.bold + inline(wl) + R);
      out.push("");
      continue;
    }

    if (/^(-{3,}|\*{3,}|_{3,})$/.test(line.trim())) {
      out.push(C.sep + "─".repeat(Math.min(55, limit)) + R);
      continue;
    }

    const ul = line.match(/^[ \t]*[-*+] (.*)/);
    if (ul) {
      const wrapped = wrapText(ul[1], limit - 4);
      out.push(C.accentB + "  ▸ " + R + C.body + inline(wrapped[0]) + R);
      for (let j = 1; j < wrapped.length; j++)
        out.push("    " + C.body + inline(wrapped[j]) + R);
      continue;
    }

    const ol = line.match(/^[ \t]*(\d+)[.)]\s+(.*)/);
    if (ol) {
      const wrapped = wrapText(ol[2], limit - 5);
      out.push(C.muted + "  " + ol[1].padStart(2) + ". " + R + C.body + inline(wrapped[0]) + R);
      for (let j = 1; j < wrapped.length; j++)
        out.push("       " + C.body + inline(wrapped[j]) + R);
      continue;
    }

    const bq = line.match(/^> (.*)/);
    if (bq) {
      for (const wl of wrapText(bq[1], limit - 4))
        out.push(C.accentB + " ▎ " + R + "\x1b[3m" + C.italic + inline(wl) + R);
      continue;
    }

    if (line.trim() === "") {
      if (out.length && out[out.length - 1] !== "") out.push("");
      continue;
    }

    for (const wl of wrapText(line, limit))
      out.push(C.body + inline(wl) + R);
  }

  while (out.length && out[out.length - 1] === "") out.pop();
  return out;
}

// ── browser ───────────────────────────────────────────────────────────────────
let _page = null;
let _initializing = null;

let _streamDone = false;
let _thinkingChunks = [];
let _responseChunks = [];
let _isThinking = false;
let _streamBuffer = "";

function resetStreamState() {
  _streamDone = false;
  _thinkingChunks = [];
  _responseChunks = [];
  _isThinking = false;
  _streamBuffer = "";
}

function launchBrowser() {
  try { execSync('pgrep -f "remote-debugging-port=9222"', { stdio: "ignore" }); }
  catch {
    execSync(
      'chromium --headless=new --remote-debugging-port=9222 --user-data-dir="$HOME/scraper-profile" &',
      { shell: true, stdio: "ignore" },
    );
  }
}

async function waitForCDP(port = 9222, timeout = 10000) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    try {
      await new Promise((resolve, reject) => {
        const req = http.get(`http://localhost:${port}/json/version`, (res) => {
          if (res.statusCode === 200) resolve();
          else reject(new Error("Status " + res.statusCode));
        });
        req.on("error", reject);
        req.setTimeout(1000, () => { req.destroy(); reject(new Error("Timeout")); });
      });
      return true;
    } catch { await new Promise(r => setTimeout(r, 300)); }
  }
  throw new Error("Chromium CDP port did not open in time");
}

const _exposedPages = new WeakSet();

async function setupInterceptors(page) {
  if (!_exposedPages.has(page)) {
    _exposedPages.add(page);
    await page.exposeFunction("_onNetworkChunk", processNetworkChunk);
    await page.exposeFunction("_onStreamEnd", () => { _streamDone = true; });
  }

  await page.evaluate(() => {
    if (window.__interceptorsInstalled) return;
    window.__interceptorsInstalled = true;

    const origFetch = window.fetch;
    window.fetch = async function (...args) {
      const url = args[0] instanceof Request ? args[0].url : String(args[0]);
      const response = await origFetch.apply(this, args);
      if (url.includes("/api/v0/chat/completion")) {
        const clone = response.clone();
        (async () => {
          const reader = clone.body.getReader();
          const decoder = new TextDecoder();
          while (true) {
            const { done, value } = await reader.read();
            if (done) { window._onStreamEnd(); break; }
            window._onNetworkChunk(decoder.decode(value, { stream: true }));
          }
        })().catch(() => { });
      }
      return response;
    };

    const OrigXHR = window.XMLHttpRequest;
    window.XMLHttpRequest = function () {
      const xhr = new OrigXHR();
      let lastLen = 0;
      xhr.addEventListener("readystatechange", function () {
        if (xhr.readyState > 2 && xhr.responseURL?.includes("/api/v0/chat/completion")) {
          const text = xhr.responseText || "";
          if (text.length > lastLen) {
            window._onNetworkChunk(text.substring(lastLen));
            lastLen = text.length;
          }
          if (xhr.readyState === 4) window._onStreamEnd();
        }
      });
      return xhr;
    };
    Object.assign(window.XMLHttpRequest, OrigXHR);
  });
}

function processNetworkChunk(text) {
  _streamBuffer += text;
  const lines = _streamBuffer.split("\n");
  _streamBuffer = lines.pop();

  for (let line of lines) {
    line = line.trim();
    if (!line) continue;

    // Handle SSE "data: {...}" or just "{...}"
    let jsonStr = line;
    if (line.startsWith("data:")) {
      jsonStr = line.substring(5).trim();
    }
    if (!jsonStr || jsonStr === "[DONE]") {
      if (jsonStr === "[DONE]") _streamDone = true;
      continue;
    }

    let json;
    try {
      json = JSON.parse(jsonStr);
    } catch {
      // Maybe it's a raw JSON line without data: prefix
      try {
        json = JSON.parse(line);
      } catch {
        continue;
      }
    }

    // Detect stream end – many possible shapes
    if (
      json === "[DONE]" ||
      json.p === "response/status" && json.v === "FINISHED" ||
      json.p === "response" && json.v?.quasi_status === "FINISHED" ||
      json.v?.[0]?.quasi_status === "FINISHED" ||
      json.quasi_status === "FINISHED" ||
      json.status === "FINISHED"
    ) {
      _streamDone = true;
      continue;
    }

    // Extract fragments (THINK / RESPONSE)
    const fragments = json.v?.response?.fragments || (Array.isArray(json.v) ? json.v : []);
    for (const frag of fragments) {
      if (frag.type === "THINK") _isThinking = true;
      if (frag.type === "RESPONSE") _isThinking = false;
      if (typeof frag.content === "string" && frag.content) {
        (_isThinking ? _thinkingChunks : _responseChunks).push(frag.content);
      }
    }

    // Fallback: if json.v is a string and not a status
    if (typeof json.v === "string" && json.p !== "response/status") {
      (_isThinking ? _thinkingChunks : _responseChunks).push(json.v);
    }
  }
}

async function getPage() {
  if (_page) {
    try { await _page.evaluate("1"); return _page; }
    catch { _page = null; _initializing = null; }
  }
  if (_initializing) return _initializing;
  _initializing = (async () => {
    await waitForCDP();
    const browser = await chromium.connectOverCDP("http://localhost:9222");
    const ctx = browser.contexts()[0];
    let page = ctx.pages().find(p => p.url().includes("chat.deepseek.com"));
    if (!page) page = await ctx.newPage();
    await page.goto("https://chat.deepseek.com/");
    await setupInterceptors(page);
    _page = page;
    _initializing = null;
    return page;
  })();
  return _initializing;
}

// ── fast submit ───────────────────────────────────────────────────────────────
async function submitPrompt(page, prompt) {
  const textarea = page.locator("textarea").first();
  await textarea.waitFor({ state: "visible", timeout: 10000 });
  await page.waitForFunction(
    (ta) => !ta.disabled && !ta.readOnly,
    textarea.elementHandle(),
    { timeout: 5000 }
  );
  await textarea.fill(prompt);
  await textarea.focus();

  const sendSelectors = [
    'button[aria-label="Send Message"]',
    'button[aria-label="Send"]',
    'button[type="submit"]',
    'div[role="button"][aria-label*="end"]',
  ];
  let sent = false;
  for (const sel of sendSelectors) {
    try {
      const btn = page.locator(sel).last();
      if (await btn.isVisible({ timeout: 100 })) {
        await btn.click();
        sent = true;
        break;
      }
    } catch { }
  }
  if (!sent) {
    await textarea.focus();
    await textarea.press("Enter");
  }
}

// ── stream collector (drives live UI) ────────────────────────────────────────
async function collectStream(dsItem, onUpdate) {
  const IDLE_TIMEOUT_MS = 15000; // 15 seconds without new data = assume end
  let lastDataTime = Date.now();
  let firstChunkSeen = false;

  // Helper to check if we're done
  const checkDone = () => {
    if (_streamDone) return true;
    // If we have any response content and no new data for 15 sec, treat as done
    if ((_thinkingChunks.length || _responseChunks.length) && (Date.now() - lastDataTime > IDLE_TIMEOUT_MS)) {
      _streamDone = true;
      return true;
    }
    return false;
  };

  // If already done, just collect final
  if (_streamDone) {
    if (_streamBuffer.trim()) processNetworkChunk("\n");
    const thinkSoFar = _thinkingChunks.join("");
    const respSoFar = _responseChunks.join("");
    dsItem.thinking = thinkSoFar;
    dsItem.text = respSoFar;
    dsItem.spinning = false;
    if (thinkSoFar) dsItem.expanded = false;
    onUpdate();
    stopGlobalSpinner();
    return { thinkingText: thinkSoFar, responseText: respSoFar };
  }

  while (!_streamDone && !checkDone()) {
    await new Promise(r => setTimeout(r, 100)); // check every 100ms
    const thinkSoFar = _thinkingChunks.join("");
    const respSoFar = _responseChunks.join("");

    if (!firstChunkSeen && (thinkSoFar || respSoFar)) {
      firstChunkSeen = true;
      dsItem.spinning = false;
      dsItem.expanded = true;
      stopGlobalSpinner();
    }

    if (firstChunkSeen) {
      dsItem.thinking = thinkSoFar;
      dsItem.text = respSoFar;
      if (!dsItem._thinkingStartTime && thinkSoFar)
        dsItem._thinkingStartTime = Date.now();
      onUpdate();
      lastDataTime = Date.now(); // reset idle timer whenever we have content
    }
  }

  // Final flush
  if (_streamBuffer.trim()) processNetworkChunk("\n");
  const thinkSoFar = _thinkingChunks.join("");
  const respSoFar = _responseChunks.join("");
  dsItem.thinking = thinkSoFar;
  dsItem.text = respSoFar;
  dsItem.spinning = false;
  if (thinkSoFar) dsItem.expanded = false;
  onUpdate();
  stopGlobalSpinner();

  return { thinkingText: thinkSoFar, responseText: respSoFar };
}

// ── TUI layout ────────────────────────────────────────────────────────────────
const scr = blessed.screen({
  smartCSR: true,
  fullUnicode: true,
  title: "deepseek",
  ignoreLocked: ["C-c"],
});

const topBar = blessed.box({
  top: 0, left: 0, right: 0, height: 1,
  tags: false,
  style: { bg: "default", fg: "#5a5a5a" },
  padding: { left: 2 },
  content: " deepseek ",
});

const chat = blessed.box({
  top: 1,
  left: 0, right: 0, bottom: 3,
  scrollable: true,
  alwaysScroll: true,
  mouse: true,
  keys: false,
  tags: false,
  wrap: false,
  scrollbar: {
    ch: "│",
    style: { fg: "#2a2a2a" },
    track: { bg: "default" },
  },
  padding: { left: 3, right: 3, top: 1 },
  style: { bg: "default", fg: "#d2d2d2" },
});

const inputSep = blessed.line({
  bottom: 3, left: 0, right: 0,
  orientation: "horizontal",
  style: { fg: "#2a2a2a" },
});

const input = blessed.textbox({
  bottom: 0, left: 0, right: 0, height: 3,
  inputOnFocus: true,
  padding: { left: 4, right: 3 },
  style: {
    bg: "default",
    fg: "#c8c8c8",
    border: { fg: "#1e1e1e" },
    focus: { border: { fg: "#3a3a3a" } },
  },
  border: { type: "line" },
});

scr.append(topBar);
scr.append(chat);
scr.append(inputSep);
scr.append(input);

function setTopBarTitle(title) {
  const truncated = title && title.length > 60 ? title.slice(0, 57) + "…" : (title || "deepseek");
  topBar.setContent(C.dimmer + "  " + truncated + R);
  scr.render();
}

function scrollDown(n) { chat.scroll(n || chat.height); scr.render(); }
function scrollUp(n) { chat.scroll(-(n || chat.height)); scr.render(); }

// ── spinner ───────────────────────────────────────────────────────────────────
const FRAMES = ["⠁", "⠂", "⠄", "⡀", "⢀", "⠠", "⠐", "⠈"];
let spinFrame = 0;
let activeSpinners = 0;
let globalSpinInterval = null;
const logItems = [];
let lineToItem = [];

function startGlobalSpinner() {
  activeSpinners++;
  if (globalSpinInterval) return;
  globalSpinInterval = setInterval(() => { spinFrame++; renderLog(); }, 100);
}
function stopGlobalSpinner() {
  activeSpinners = Math.max(0, activeSpinners - 1);
  if (activeSpinners === 0 && globalSpinInterval) {
    clearInterval(globalSpinInterval);
    globalSpinInterval = null;
  }
}

// ── JSON extraction ───────────────────────────────────────────────────────────
function extractJSON(text) {
  if (!text) return null;
  const cbRe = /```(?:json)?\s*([\s\S]*?)\s*```/g;
  let m;
  while ((m = cbRe.exec(text)) !== null) {
    try { const p = JSON.parse(m[1].trim()); if (p) return normalizeToolCall(p); } catch { }
    const br = m[1].match(/\{[\s\S]*\}/);
    if (br) { try { const p = JSON.parse(br[0]); if (p) return normalizeToolCall(p); } catch { } }
  }
  let si = text.length - 1;
  while (si >= 0) {
    const bi = text.lastIndexOf("{", si);
    if (bi < 0) break;
    try { const p = JSON.parse(text.substring(bi)); if (p) return normalizeToolCall(p); } catch { }
    si = bi - 1;
  }
  return null;
}

const MAX_TOOL_OUTPUT = 4000;
function safeTruncate(text) {
  const s = String(text ?? "");
  if (s.length <= MAX_TOOL_OUTPUT) return s;
  return s.slice(0, MAX_TOOL_OUTPUT) + `\n\n[truncated: ${s.length - MAX_TOOL_OUTPUT} chars omitted]`;
}

// ── render ────────────────────────────────────────────────────────────────────
function renderLog() {
  const lines = [];
  lineToItem = [];

  for (let idx = 0; idx < logItems.length; idx++) {
    const item = logItems[idx];
    const itemLines = [];

    if (item.type === "user") {
      const limit = Math.max(20, (chat.width || scr.width || 80) - 9);
      const wrapped = wrapText(item.text, limit);
      itemLines.push(C.you + "  ›  " + R + C.body + wrapped[0] + R);
      for (let i = 1; i < wrapped.length; i++)
        itemLines.push("     " + C.body + wrapped[i] + R);

    } else if (item.type === "deepseek") {
      if (!item.text && !item.thinking && item.spinning) {
        itemLines.push(C.dimmer + "  " + FRAMES[spinFrame % FRAMES.length] + R);
      } else {
        const limit = Math.max(20, (chat.width || scr.width || 80) - 7);

        if (item.thinking) {
          if (item.expanded) {
            const thLines = wrapText(item.thinking, limit - 4);
            for (let i = 0; i < thLines.length; i++) {
              if (i === 0)
                itemLines.push(C.think + "  ┆ " + R + C.think + thLines[i] + R);
              else
                itemLines.push(C.think + "  ┆ " + R + C.think + thLines[i] + R);
            }
          } else {
            const endT = item._thinkingEndTime || Date.now();
            const elapsed = item._thinkingStartTime
              ? Math.round((endT - item._thinkingStartTime) / 1000) : 0;
            const label = elapsed > 0 ? `thought ${elapsed}s` : "thought";
            itemLines.push(C.dimmer + "  ┆ " + C.think + "\x1b[3m" + label + " ▸" + R);
          }
        }

        if (item.text) {
          const rendered = renderMd(item.text);
          const hasThink = !!item.thinking;
          for (let i = 0; i < rendered.length; i++) {
            if (i === 0 && !hasThink)
              itemLines.push(C.accentB + "  ● " + R + rendered[i]);
            else if (i === 0 && hasThink)
              itemLines.push("    " + rendered[i]);
            else
              itemLines.push("    " + rendered[i]);
          }
        } else if (item.thinking && !item.text && !item.spinning) {
          // finished thinking, no response yet (tool call) — nothing extra needed
        }
      }

    } else if (item.type === "tool") {
      if (item.status === "executing") {
        itemLines.push(
          C.dimmer + "  " + FRAMES[spinFrame % FRAMES.length] + " " +
          C.tool + item.name + R + C.dimmer + " …" + R
        );
      } else if (item.expanded) {
        itemLines.push(C.tool + "  ⊟ " + R + C.muted + item.name + R);
        if (item.result) {
          const rLines = item.result.toString().split("\n");
          const maxShow = Math.min(50, rLines.length);
          for (let i = 0; i < maxShow; i++)
            itemLines.push(C.dimmer + "  │ " + R + C.dim + rLines[i] + R);
          if (rLines.length > maxShow)
            itemLines.push(C.dimmer + "  │ " + R + C.dimmer + `… +${rLines.length - maxShow} lines` + R);
        }
      } else {
        itemLines.push(C.tool + "  ⊞ " + R + C.dim + item.name + R + C.dimmer + " ▸" + R);
      }

    } else if (item.type === "separator") {
      itemLines.push("");
    } else if (item.type === "divider") {
      const w = Math.max(10, (chat.width || scr.width || 80) - 8);
      itemLines.push("   " + C.sep + "─".repeat(w) + R);
    } else if (item.type === "error") {
      itemLines.push(C.err + "  ✕ " + R + C.muted + item.message + R);
    }

    for (const l of itemLines) { lines.push(l); lineToItem.push(item); }
  }

  chat.setContent(lines.join("\n"));
  chat.setScrollPerc(100);
  scr.render();
}

chat.on("click", (data) => {
  const y = data.y - (chat.atop + chat.itop) + chat.childBase;
  if (y < 0 || y >= lineToItem.length) return;
  const item = lineToItem[y];
  if (item?.type === "tool" && item.status === "completed") {
    item.expanded = !item.expanded; renderLog();
  } else if (item?.type === "deepseek" && item.thinking) {
    item.expanded = !item.expanded; renderLog();
  }
});

// ── chat history overlay ──────────────────────────────────────────────────────
function showChatHistory() {
  const fs = require('fs');
  try {
    const sessions = getSessions();
    if (!sessions.length) {
      fs.appendFileSync('/tmp/deepseek-cli-debug.log', `[showChatHistory] No sessions found at ${new Date().toISOString()}\n`);
      return;
    }
    fs.appendFileSync('/tmp/deepseek-cli-debug.log', `[showChatHistory] Found ${sessions.length} sessions\n`);

    const overlay = blessed.box({
      top: "center", left: "center",
      width: "70%", height: "70%",
      border: { type: "line" },
      style: { border: { fg: "#3a3a3a" }, bg: "default" },
      label: " sessions  esc to close ",
      keys: true, vi: true,
      alwaysScroll: true, scrollable: true,
    });

    const list = blessed.list({
    parent: overlay,
    top: 1, left: 1, right: 1, bottom: 1,
    keys: true, vi: true, mouse: true,
    style: {
      selected: { fg: "#52c4c4", bg: "default", bold: true },
      item: { fg: "#888888" },
    },
    items: sessions.map(s => {
      const date = new Date(s.updated_at).toLocaleDateString("en-GB", { day: "2-digit", month: "short" });
      return `  ${date}  ${s.title}`;
    }),
  });

    scr.append(overlay);
    list.focus();
    scr.render();

    const close = () => { overlay.destroy(); input.focus(); scr.render(); };
    list.on("select", (_, idx) => { close(); loadSessionIntoTUI(sessions[idx]); });
    list.key(["escape"], close);
  } catch (err) {
    const fs = require('fs');
    fs.appendFileSync('/tmp/deepseek-cli-debug.log', `[showChatHistory] ERROR: ${err.stack}\n`);
  }
}

async function loadSessionIntoTUI(session) {
  setCurrentSessionId(session.id);
  logItems.length = 0;
  setTopBarTitle(session.title);

  for (const msg of loadSessionMessages(session.id)) {
    if (msg.role === "user") {
      if (logItems.length) {
        logItems.push({ type: "separator" });
        logItems.push({ type: "divider" });
        logItems.push({ type: "separator" });
      }
      logItems.push({ type: "user", text: msg.content });
    } else if (msg.role === "assistant") {
      logItems.push({ type: "deepseek", text: msg.content, thinking: msg.thinking || "", expanded: false, spinning: false });
    } else if (msg.role === "tool_call") {
      logItems.push({ type: "tool", name: msg.content, status: "completed", result: "", expanded: false });
    } else if (msg.role === "tool_result") {
      const t = logItems.slice().reverse().find(i => i.type === "tool" && i.name === msg.tool);
      if (t) t.result = msg.content;
    }
  }
  renderLog();

  if (session.deepseek_id) {
    try {
      const page = await getPage();
      if (!page.url().includes(session.deepseek_id)) {
        await page.goto(`https://chat.deepseek.com/a/chat/s/${session.deepseek_id}`);
        await setupInterceptors(page);
      }
    } catch { }
  }
}

// ── ask ───────────────────────────────────────────────────────────────────────
let busy = false;

async function ask(prompt) {
  busy = true;
  let sid = getCurrentSessionId();
  if (!sid) {
    const ns = createSession(prompt.slice(0, 40));
    sid = ns.id;
    setCurrentSessionId(sid);
    setTopBarTitle(prompt.slice(0, 60));
  }

  if (logItems.length) {
    logItems.push({ type: "separator" });
    logItems.push({ type: "divider" });
    logItems.push({ type: "separator" });
  }
  logItems.push({ type: "user", text: prompt });
  saveMessage(sid, "user", prompt);

  let dsItem = { type: "deepseek", text: "", spinning: true };
  logItems.push(dsItem);
  startGlobalSpinner();
  renderLog();

  try {
    const page = await getPage();
    let currentPrompt = `[System Instructions]\n${getSystemPrompt()}\n\n[User Request]\n${prompt}`;
    let isInitial = true;

    while (busy) {
      if (!isInitial) {
        dsItem.spinning = true;
        startGlobalSpinner();
        renderLog();
      }

      resetStreamState();
      await setupInterceptors(page);
      await submitPrompt(page, currentPrompt);

      const CHUNK_TIMEOUT = 86400000; // 24 hours - no practical limit
      const chunkStart = Date.now();
      while (!_thinkingChunks.length && !_responseChunks.length && !_streamDone) {
        if (Date.now() - chunkStart > CHUNK_TIMEOUT) {
          try {
            await page.reload({ waitUntil: "domcontentloaded" });
            await setupInterceptors(page);
            resetStreamState();
            await submitPrompt(page, currentPrompt);
            await new Promise(r => setTimeout(r, 2000));
            if (!_thinkingChunks.length && !_responseChunks.length && !_streamDone)
              throw new Error("DeepSeek failed to stream after retry — may be rate-limited.");
          } catch (e) {
            throw new Error(`No stream data and recovery failed: ${e.message}`);
          }
          break;
        }
        await new Promise(r => setTimeout(r, 50));
      }

      const { thinkingText, responseText } = await collectStream(dsItem, renderLog);
      if (thinkingText) dsItem._thinkingEndTime = Date.now();

      let parsed = null;
      const trimmed = responseText.trim();
      if (trimmed.startsWith("{") || trimmed.startsWith("```"))
        parsed = extractJSON(responseText);

      // FINAL ANSWER
      if (!parsed || parsed.response !== undefined) {
        let finalText;
        if (parsed?.response !== undefined) {
          finalText = parsed.response;
          if (typeof finalText === "object" && finalText !== null)
            finalText = finalText.message || JSON.stringify(finalText, null, 2);
          finalText = String(finalText);
        } else {
          finalText = responseText;
        }

        dsItem.text = finalText;
        dsItem.thinking = thinkingText;
        dsItem.spinning = false;
        if (dsItem.thinking) dsItem.expanded = false;
        renderLog();
        saveMessage(sid, "assistant", finalText, { thinking: thinkingText });
        syncSession(page, sid, prompt);
        break;
      }

      // TOOL CALL
      dsItem.text = "";
      dsItem.thinking = thinkingText;
      dsItem.spinning = false;
      if (dsItem.thinking) { dsItem._thinkingEndTime = Date.now(); dsItem.expanded = false; }
      renderLog();
      syncSession(page, sid, prompt);

      if (parsed._isMulti) {
        const calls = parsed.calls;
        const MAX_PAR = 8;
        const batch = calls.slice(0, MAX_PAR);
        const toolItems = batch.map(c => ({
          type: "tool", name: c.tool, status: "executing", result: "", expanded: false,
        }));
        for (const t of toolItems) logItems.push(t);
        for (const c of batch) saveMessage(sid, "tool_call", c.tool, { params: c });
        startGlobalSpinner();
        renderLog();

        // Run each tool with a per-tool timeout (30 seconds)
        const TOOL_TIMEOUT_MS = 30000;
        const results = await Promise.all(batch.map(async (c) => {
          const timeoutPromise = new Promise((resolve) =>
            setTimeout(() => resolve(`[Tool Timeout] ${c.tool} did not complete within ${TOOL_TIMEOUT_MS / 1000}s`), TOOL_TIMEOUT_MS)
          );
          const executePromise = (async () => {
            const t = tools[c.tool];
            if (t) {
              try {
                const res = await t.execute(c);
                return safeTruncate(String(res ?? ""));
              } catch (e) {
                return safeTruncate(`Error: ${e.message}`);
              }
            }
            const mcp = require("./mcp/mcp_loader");
            const isMcp = mcp.getRegistry().some(x => x.name === c.tool);
            if (isMcp) {
              try {
                const res = await mcp.callTool(c.tool, c);
                return safeTruncate(String(res ?? ""));
              } catch (e) {
                return safeTruncate(`MCP error: ${e.message}`);
              }
            }
            return `Error: tool '${c.tool}' not found.`;
          })();
          return Promise.race([executePromise, timeoutPromise]);
        }));

        results.forEach((res, i) => {
          toolItems[i].status = "completed";
          toolItems[i].result = res;
          saveMessage(sid, "tool_result", res, { tool: batch[i].tool });
        });
        stopGlobalSpinner();
        renderLog();

        const combined = results.map((r, i) => `[Tool Output for ${batch[i].tool}]\n${r}`).join("\n\n");
        const overflow = calls.length > MAX_PAR
          ? `\n\nNote: ${calls.length - MAX_PAR} call(s) truncated — issue them next turn if needed.` : "";
        currentPrompt = `${combined}${overflow}${FORMAT_REMINDER}`;
        isInitial = false;
        dsItem = { type: "deepseek", text: "", spinning: true };
        logItems.push(dsItem);
        renderLog();
      } else if (parsed.tool) {
        const toolName = parsed.tool;
        const { tool: _, ...toolParams } = parsed;
        const toolItem = {
          type: "tool",
          name: toolName,
          status: "executing",
          result: "",
          expanded: false,
        };
        logItems.push(toolItem);
        saveMessage(sid, "tool_call", toolName, { params: toolParams });
        startGlobalSpinner();
        renderLog();

        let toolResult = "";
        const localTool = tools[toolName];
        if (localTool) {
          try {
            toolResult = await localTool.execute(toolParams);
          } catch (e) {
            toolResult = `[Tool Failed]\n${toolName}: ${e.message}\n\n(You MUST reply in valid JSON.)`;
          }
        } else {
          const mcp = require("./mcp/mcp_loader");
          const isMcp = mcp.getRegistry().some((x) => x.name === toolName);
          if (isMcp) {
            try {
              toolResult = await mcp.callTool(toolName, toolParams);
            } catch (e) {
              toolResult = `[MCP Failed]\n${toolName}: ${e.message}\n\n(You MUST reply in valid JSON.)`;
            }
          } else {
            toolResult = `Error: tool '${toolName}' not found locally or in MCP.`;
          }
        }

        toolResult = safeTruncate(String(toolResult));
        toolItem.status = "completed";
        toolItem.result = toolResult;
        saveMessage(sid, "tool_result", toolResult, { tool: toolName });
        stopGlobalSpinner();
        renderLog();

        // Wait a moment for the UI to become responsive again
        await new Promise(r => setTimeout(r, 100));

        // Prepare the next prompt
        currentPrompt = `[Tool Output for ${toolName}]\n${toolResult}${FORMAT_REMINDER}`;
        isInitial = false;

        // Create new dsItem (spinner will be started by loop)
        dsItem = { type: "deepseek", text: "", spinning: true };
        logItems.push(dsItem);
        renderLog();

      } else {
        // parsed something weird — treat as plain text
        dsItem.text = responseText;
        renderLog();
        saveMessage(sid, "assistant", responseText, { thinking: thinkingText });
        break;
      }
    }
  } catch (e) {
    if (dsItem?.spinning) { dsItem.spinning = false; stopGlobalSpinner(); }
    logItems.push({ type: "separator" });
    logItems.push({ type: "error", message: e.message });
    renderLog();
  }

  busy = false;
  input.focus();
  scr.render();
}

function syncSession(page, sid, prompt) {
  const sess = getSessions().find(s => s.id === sid);
  if (!sess) return;
  if (!sess.deepseek_id) {
    const m = page.url().match(/\/a\/chat\/s\/([a-zA-Z0-9_-]+)/);
    if (m) updateSessionDeepseekId(sid, m[1]);
  }
  if (sess.title === "New Chat") {
    const title = prompt.slice(0, 40);
    updateSessionTitle(sid, title);
    setTopBarTitle(title);
  }
}

// ── key bindings ──────────────────────────────────────────────────────────────
input.key(["pageup"], () => scrollUp());
input.key(["pagedown"], () => scrollDown());
input.key(["S-up"], () => scrollUp(3));
input.key(["S-down"], () => scrollDown(3));
input.key(["C-u"], () => scrollUp());
input.key(["C-d"], () => scrollDown());

input.key("enter", () => {
  if (busy) return;
  const val = input.getValue().trim();
  if (!val) return;
  input.clearValue();
  scr.render();

  if (val === "/chat") { showChatHistory(); return; }

  if (val === "/new") {
    logItems.length = 0;
    setCurrentSessionId(null);
    setTopBarTitle("new session");
    renderLog();
    input.focus();
    scr.render();
    getPage().then(async page => {
      try {
        await page.goto("https://chat.deepseek.com/");
        await setupInterceptors(page);
      } catch { }
    });
    return;
  }

  ask(val).catch(() => { });
});

scr.key(["C-c"], () => process.exit(0));

process.on("SIGINT", async () => {
  if (_page) {
    try { await _page.context().browser().close().catch(() => { }); } catch { }
  }
  try { execSync('pkill -f "remote-debugging-port=9222"', { stdio: "ignore" }); } catch { }
  process.exit(0);
});

if (require.main === module) {
  initHistory();
  mcpLoader.init().catch(console.error);
  launchBrowser();
  getPage().catch(() => { });
  input.focus();
  setTopBarTitle("deepseek");
  scr.render();
} else {
  module.exports = { renderMd, wrapText, inline, C, R };
}