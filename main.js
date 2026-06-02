#!/usr/bin/env node
const { chromium } = require("playwright");
const { execSync } = require("child_process");
const blessed = require("blessed");
const http = require("http");
const { tools, getSystemPrompt, normalizeToolCall } = require("./tools");
const mcpLoader = require("./.deepseek/mcp/mcp_loader");
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

// ── colors ────────────────────────────────────────────────────────────────────
const R = "\x1b[0m";
const fg = (r, g, b) => `\x1b[38;2;${r};${g};${b}m`;
const C = {
  body: fg(200, 200, 200),
  dim: fg(110, 110, 110),
  bold: fg(255, 255, 255),
  italic: fg(160, 160, 160),
  code: fg(234, 234, 234),
  bullet: fg(110, 110, 110),
  red: fg(255, 100, 100),
  you: fg(56, 189, 248),
  deepseek: fg(52, 211, 153),
};

// ── wrapping utility ─────────────────────────────────────────────────────────
function wrapText(text, limit) {
  if (!text) return [""];
  const words = text.split(" ");
  const lines = [];
  let currentLine = "";
  for (const word of words) {
    if (currentLine.length + word.length > limit) {
      lines.push(currentLine.trimEnd());
      currentLine = word + " ";
    } else {
      currentLine += word + " ";
    }
  }
  if (currentLine) lines.push(currentLine.trimEnd());
  return lines;
}

// ── markdown renderer ─────────────────────────────────────────────────────────
function renderMd(raw) {
  const width = chat && chat.width ? chat.width : scr.width || 80;
  const limit = Math.max(20, width - 7);
  const lines = raw.trim().split("\n");
  const out = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const fence = line.match(/^```(\w*)/);
    if (fence) {
      const lang = fence[1] || "code";
      const codeLines = [];
      i++;
      while (i < lines.length && !lines[i].startsWith("```")) {
        codeLines.push(lines[i]);
        i++;
      }
      let maxLen = 40;
      for (const cl of codeLines) {
        if (cl.length > maxLen) maxLen = cl.length;
      }
      const boxLimit = Math.min(limit - 4, 65);
      if (maxLen > boxLimit) maxLen = boxLimit;
      const title = " " + lang + " ";
      const topBar = "┌─" + title + "─".repeat(maxLen - title.length) + "┐";
      out.push(C.dim + topBar + R);
      for (const cl of codeLines) {
        let content = cl;
        if (content.length > maxLen)
          content = content.substring(0, maxLen - 3) + "...";
        const padded = content.padEnd(maxLen, " ");
        out.push(C.dim + "│ " + R + C.code + padded + R + C.dim + "│" + R);
      }
      out.push(C.dim + "└─" + "─".repeat(maxLen) + "┘" + R);
      continue;
    }
    const hm = line.match(/^(#{1,3}) (.*)/);
    if (hm) {
      if (out.length && out[out.length - 1] !== "") out.push("");
      const wrapped = wrapText(hm[2], limit);
      for (const wl of wrapped) out.push(C.bold + "\x1b[1m" + inline(wl) + R);
      continue;
    }
    if (/^(-{3,}|\*{3,})$/.test(line.trim())) {
      out.push(C.dim + "─".repeat(Math.min(55, limit)) + R);
      continue;
    }
    const ul = line.match(/^[ \t]*[-*+] (.*)/);
    if (ul) {
      const wrapped = wrapText(ul[1], limit - 4);
      out.push(C.dim + " · " + R + C.body + inline(wrapped[0]) + R);
      for (let j = 1; j < wrapped.length; j++)
        out.push("   " + C.body + inline(wrapped[j]) + R);
      continue;
    }
    const ol = line.match(/^[ \t]*\d+[.)]\s+(.*)/);
    if (ol) {
      const wrapped = wrapText(ol[1], limit - 4);
      out.push(C.dim + " · " + R + C.body + inline(wrapped[0]) + R);
      for (let j = 1; j < wrapped.length; j++)
        out.push("   " + C.body + inline(wrapped[j]) + R);
      continue;
    }
    const bq = line.match(/^> (.*)/);
    if (bq) {
      const wrapped = wrapText(bq[1], limit - 4);
      for (const wl of wrapped)
        out.push(C.dim + " ┃ " + R + C.italic + "\x1b[3m" + inline(wl) + R);
      continue;
    }
    if (line.trim() === "") {
      if (out.length && out[out.length - 1] !== "") out.push("");
      continue;
    }
    const wrapped = wrapText(line, limit);
    for (const wl of wrapped) out.push(C.body + inline(wl) + R);
  }
  while (out.length && out[out.length - 1] === "") out.pop();
  return out;
}

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

// ── browser ───────────────────────────────────────────────────────────────────
let _page = null;
let _initializing = null;

function launchBrowser() {
  try {
    execSync('pgrep -f "remote-debugging-port=9222"', { stdio: "ignore" });
  } catch {
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
        req.setTimeout(1000, () => {
          req.destroy();
          reject(new Error("Timeout"));
        });
      });
      return true;
    } catch {
      await new Promise((r) => setTimeout(r, 300));
    }
  }
  throw new Error("Chromium CDP port did not open in time");
}

async function getPage() {
  if (_page) {
    try {
      await _page.evaluate("1");
      return _page;
    } catch {
      _page = null;
      _initializing = null;
    }
  }
  if (_initializing) return _initializing;
  _initializing = (async () => {
    await waitForCDP();
    const browser = await chromium.connectOverCDP("http://localhost:9222");
    const ctx = browser.contexts()[0];
    let page = ctx.pages().find((p) => p.url().includes("chat.deepseek.com"));
    if (!page) page = await ctx.newPage();
    await page.goto("https://chat.deepseek.com/");
    _page = page;
    _initializing = null;
    return page;
  })();
  return _initializing;
}

async function submitPrompt(page, prompt) {
  const textarea = page.locator("textarea").first();
  await textarea.waitFor({ state: "visible", timeout: 10000 });
  await page.waitForTimeout(300);
  await page.evaluate((text) => {
    const ta = document.querySelector("textarea");
    if (!ta) return;
    const nativeSetter = Object.getOwnPropertyDescriptor(
      window.HTMLTextAreaElement.prototype,
      "value",
    ).set;
    nativeSetter.call(ta, text);
    ta.dispatchEvent(new Event("input", { bubbles: true }));
    ta.dispatchEvent(new Event("change", { bubbles: true }));
  }, prompt);
  await page.waitForTimeout(300);
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
      if (await btn.isVisible({ timeout: 500 })) {
        await btn.click();
        sent = true;
        break;
      }
    } catch { }
  }
  if (!sent) await page.keyboard.press("Enter");
  await page.waitForTimeout(200);
}

// ── TUI ───────────────────────────────────────────────────────────────────────
const scr = blessed.screen({
  smartCSR: true,
  fullUnicode: true,
  title: "deepseek",
  ignoreLocked: ["C-c"],
});
const chat = blessed.box({
  top: 0,
  left: 0,
  right: 0,
  bottom: 3,
  scrollable: true,
  alwaysScroll: true,
  mouse: true,
  keys: false,
  tags: false,
  wrap: false,
  scrollbar: { ch: " ", style: { bg: "#3e4452" }, track: { bg: "default" } },
  padding: { left: 2, right: 2, top: 0 },
  style: { bg: "default", fg: "#c8c8c8" },
});
const input = blessed.textbox({
  bottom: 0,
  left: 0,
  right: 0,
  height: 3,
  inputOnFocus: true,
  padding: { left: 3, right: 2 },
  style: {
    bg: "default",
    fg: "#c8c8c8",
    border: { fg: "#3e4452" },
    focus: { border: { fg: "#ffffff" } },
  },
  border: { type: "line" },
});
scr.append(chat);
scr.append(input);

function scrollDown(n) {
  chat.scroll(n || chat.height);
  scr.render();
}
function scrollUp(n) {
  chat.scroll(-(n || chat.height));
  scr.render();
}

// ── spinner ───────────────────────────────────────────────────────────────────
const FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
let spinFrame = 0;
let activeSpinners = 0;
let globalSpinInterval = null;
const logItems = [];
let lineToItem = [];

function startGlobalSpinner() {
  activeSpinners++;
  renderLog();
  if (globalSpinInterval) return;
  globalSpinInterval = setInterval(() => {
    spinFrame++;
    renderLog();
  }, 80);
}
function stopGlobalSpinner() {
  activeSpinners = Math.max(0, activeSpinners - 1);
  if (activeSpinners === 0 && globalSpinInterval) {
    clearInterval(globalSpinInterval);
    globalSpinInterval = null;
  }
  renderLog();
}

function extractJSON(text) {
  if (!text) return null;
  const codeBlockRegex = /```(?:json)?\s*([\s\S]*?)\s*```/g;
  let match;
  while ((match = codeBlockRegex.exec(text)) !== null) {
    const candidate = match[1].trim();
    try {
      const parsed = JSON.parse(candidate);
      if (parsed) return normalizeToolCall(parsed);
    } catch { }
    const brace = candidate.match(/\{[\s\S]*\}/);
    if (brace) {
      try {
        const parsed = JSON.parse(brace[0]);
        if (parsed) return normalizeToolCall(parsed);
      } catch { }
    }
  }
  let searchIdx = text.length - 1;
  while (searchIdx >= 0) {
    const braceIdx = text.lastIndexOf("{", searchIdx);
    if (braceIdx < 0) break;
    const candidate = text.substring(braceIdx);
    try {
      const parsed = JSON.parse(candidate);
      if (parsed) return normalizeToolCall(parsed);
    } catch { }
    searchIdx = braceIdx - 1;
  }
  return null;
}

const MAX_TOOL_OUTPUT = 4000;
function safeTruncate(text) {
  if (!text) return "";
  const str = String(text);
  if (str.length <= MAX_TOOL_OUTPUT) return str;
  return (
    str.slice(0, MAX_TOOL_OUTPUT) +
    `\n\n[Output truncated: ${str.length - MAX_TOOL_OUTPUT} chars omitted]`
  );
}

function renderLog() {
  const lines = [];
  lineToItem = [];
  for (let idx = 0; idx < logItems.length; idx++) {
    const item = logItems[idx];
    const itemLines = [];
    if (item.type === "user") {
      const limit = (scr.width || 80) - 7;
      const wrapped = wrapText(item.text, limit);
      itemLines.push(C.you + "○  " + R + C.body + wrapped[0] + R);
      for (let i = 1; i < wrapped.length; i++)
        itemLines.push(" ".repeat(3) + C.body + wrapped[i] + R);
    } else if (item.type === "deepseek") {
      if (item.text === "" && !item.thinking && item.spinning) {
        itemLines.push(
          C.deepseek +
          "●  " +
          R +
          C.dim +
          FRAMES[spinFrame % FRAMES.length] +
          R,
        );
      } else if (item.thinking || item.text) {
        const limit = Math.max(20, (chat.width || scr.width || 80) - 7);
        if (item.thinking) {
          if (item.expanded) {
            const thinkLines = wrapText(item.thinking, limit);
            const prevDeepseek = logItems
              .slice(0, idx)
              .reverse()
              .find((prev) => prev.type === "deepseek");
            const isFirstInChain = !prevDeepseek?.thinking;
            for (let i = 0; i < thinkLines.length; i++) {
              if (i === 0 && isFirstInChain)
                itemLines.push(
                  C.deepseek + "●  " + R + C.dim + thinkLines[i] + R,
                );
              else
                itemLines.push(C.dim + "│  " + R + C.dim + thinkLines[i] + R);
            }
          } else {
            const endTime = item._thinkingEndTime || Date.now();
            const elapsed = item._thinkingStartTime
              ? Math.round((endTime - item._thinkingStartTime) / 1000)
              : 0;
            const timeStr = elapsed > 0 ? ` for ${elapsed}s` : "";
            const prevDeepseek2 = logItems
              .slice(0, idx)
              .reverse()
              .find((prev) => prev.type === "deepseek");
            const isFirstInChain = !prevDeepseek2?.thinking;
            if (isFirstInChain)
              itemLines.push(
                C.deepseek + "●  " + R + C.dim + "thought" + timeStr + " ▸" + R,
              );
            else itemLines.push(C.dim + "thought" + timeStr + " ▸" + R);
          }
        }
        if (item.text) {
          const rendered = renderMd(item.text);
          for (let i = 0; i < rendered.length; i++) {
            if (!item.thinking) {
              if (i === 0) itemLines.push(C.deepseek + "●  " + R + rendered[i]);
              else itemLines.push(" ".repeat(3) + rendered[i]);
            } else {
              itemLines.push(C.dim + "│  " + R + rendered[i]);
            }
          }
        }
      }
    } else if (item.type === "tool") {
      if (item.status === "executing")
        itemLines.push(
          C.dim +
          "│ " +
          FRAMES[spinFrame % FRAMES.length] +
          ` executing ${item.name}...` +
          R,
        );
      else if (item.expanded) {
        itemLines.push(C.dim + "│ " + R + C.dim + item.name + " ▾" + R);
        if (item.result) {
          const resultLines = item.result.toString().split("\n");
          const maxLines = Math.min(50, resultLines.length);
          for (let i = 0; i < maxLines; i++)
            itemLines.push(C.dim + "│ " + R + C.dim + resultLines[i] + R);
          if (resultLines.length > maxLines)
            itemLines.push(
              C.dim +
              "│ " +
              R +
              C.dim +
              `... and ${resultLines.length - maxLines} more lines.` +
              R,
            );
        }
      } else {
        itemLines.push(C.dim + item.name + " ▸" + R);
      }
    } else if (item.type === "separator") {
      itemLines.push("");
    } else if (item.type === "divider") {
      const width = chat.width ? chat.width - 4 : (scr.width || 80) - 4;
      itemLines.push(C.dim + "─".repeat(Math.max(10, width)) + R);
    } else if (item.type === "error") {
      itemLines.push(C.red + "error  " + R + C.dim + item.message + R);
    }
    for (const l of itemLines) {
      lines.push(l);
      lineToItem.push(item);
    }
  }
  chat.setContent(lines.join("\n"));
  chat.setScrollPerc(100);
  scr.render();
}

chat.on("click", (data) => {
  const clickY = data.y - (chat.atop + chat.itop) + chat.childBase;
  if (clickY >= 0 && clickY < lineToItem.length) {
    const item = lineToItem[clickY];
    if (item && item.type === "tool" && item.status === "completed") {
      item.expanded = !item.expanded;
      renderLog();
    } else if (item && item.type === "deepseek" && item.thinking) {
      item.expanded = !item.expanded;
      renderLog();
    }
  }
});

// ── chat history overlay ──────────────────────────────────────────────────────
function showChatHistory() {
  const sessions = getSessions();
  if (sessions.length === 0) return;

  const overlay = blessed.box({
    top: "center",
    left: "center",
    width: "80%",
    height: "80%",
    border: { type: "line" },
    style: { border: { fg: "white" }, bg: "black" },
    label: " Chat History (Enter to select, Esc to cancel) ",
    keys: true,
    vi: true,
    alwaysScroll: true,
    scrollable: true,
  });

  const list = blessed.list({
    parent: overlay,
    top: 1,
    left: 1,
    right: 1,
    bottom: 1,
    keys: true,
    vi: true,
    mouse: true,
    style: { selected: { bg: "blue", fg: "white" }, item: { fg: "white" } },
    items: sessions.map((s) => {
      const date = new Date(s.updated_at).toLocaleDateString();
      return `${s.title} (${date})`;
    }),
  });

  scr.append(overlay);
  list.focus();
  scr.render();

  function closeOverlay() {
    overlay.destroy();
    input.focus();
    scr.render();
  }

  list.on("select", function (item, index) {
    const selectedSession = sessions[index];
    closeOverlay();
    loadSessionIntoTUI(selectedSession);
  });

  list.key(["escape"], closeOverlay);
}

async function loadSessionIntoTUI(session) {
  setCurrentSessionId(session.id);
  logItems.length = 0;

  const messages = loadSessionMessages(session.id);
  for (const msg of messages) {
    if (msg.role === "user") {
      if (logItems.length > 0) {
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
      const lastTool = logItems
        .slice()
        .reverse()
        .find((i) => i.type === "tool" && i.name === msg.tool);
      if (lastTool) lastTool.result = msg.content;
    }
  }
  renderLog();

  if (session.deepseek_id) {
    try {
      const page = await getPage();
      if (!page.url().includes(session.deepseek_id)) {
        await page.goto(
          `https://chat.deepseek.com/a/chat/s/${session.deepseek_id}`,
        );
        await page.waitForTimeout(1000);
      }
    } catch (e) { }
  }
}

// ── ask ───────────────────────────────────────────────────────────────────────
let busy = false;
async function ask(prompt) {
  busy = true;
  const sid = getCurrentSessionId();

  if (logItems.length > 0) {
    logItems.push({ type: "separator" });
    logItems.push({ type: "divider" });
    logItems.push({ type: "separator" });
  }
  logItems.push({ type: "user", text: prompt });
  saveMessage(sid, "user", prompt);

  let dsItem = { type: "deepseek", text: "", spinning: true };
  logItems.push(dsItem);
  startGlobalSpinner();

  try {
    const page = await getPage();
    const count = async () => page.locator(".ds-markdown").count();
    let currentPrompt = `[System Instructions]\n${getSystemPrompt()}\n\n[User Request]\n${prompt}`;
    let isInitial = true;

    while (busy) {
      if (!isInitial) {
        dsItem.spinning = true;
        startGlobalSpinner();
      }
      await submitPrompt(page, currentPrompt);
      const before = await count();
      let appeared = false;
      for (let i = 0; i < 150; i++) {
        await page.waitForTimeout(100);
        if ((await count()) > before) {
          appeared = true;
          break;
        }
      }
      if (!appeared) {
        try {
          await page.reload({ waitUntil: 'domcontentloaded' });
          await page.waitForTimeout(2000);
          await submitPrompt(page, currentPrompt);
          let retryAppeared = false;
          for (let i = 0; i < 150; i++) {
            await page.waitForTimeout(100);
            if (await count() > before) { retryAppeared = true; break; }
          }
          if (!retryAppeared) throw new Error('DeepSeek failed to respond after retry. Session may be rate-limited.');
        } catch (retryErr) {
          throw new Error(`Generation dropped and recovery failed: ${retryErr.message}`);
        }
      }

      const bubble = page.locator(".ds-markdown").last();
      let fullText = "";
      let started = false;
      let lastRenderedText = "";
      let thinkingText = "";

      while (true) {
        await page.waitForTimeout(80);
        try {
          fullText = await bubble.evaluate((el) => {
            const key = Object.keys(el).find(
              (k) =>
                k.startsWith("__reactFiber") || k.startsWith("__reactInternal"),
            );
            if (!key) return el.textContent;
            function findRawContent(node, depth = 0) {
              if (!node || depth > 20) return null;
              const props = node.memoizedProps;
              if (props) {
                if (typeof props.content === "string") return props.content;
                if (typeof props.text === "string") return props.text;
                if (typeof props.value === "string") return props.value;
              }
              return findRawContent(node.return, depth + 1);
            }
            return findRawContent(el[key]) || el.textContent;
          });
        } catch { }

        if (fullText && fullText.length > 5) {
          const parsed = extractJSON(fullText);
          if (
            parsed &&
            (parsed.response !== undefined || parsed.tool || parsed._isMulti)
          )
            break;
        }

        if (fullText && fullText !== lastRenderedText) {
          lastRenderedText = fullText;
          if (!started) {
            started = true;
            dsItem.spinning = false;
            dsItem.expanded = true;
            stopGlobalSpinner();
          }
          const streamParsed = extractJSON(fullText);
          if (streamParsed && streamParsed.response) {
            const jsonStartIdx = fullText.indexOf("{");
            if (jsonStartIdx > 0)
              thinkingText = fullText.substring(0, jsonStartIdx).trim();
            dsItem.thinking = thinkingText || "";
            dsItem.text = streamParsed.response;
          } else if (
            streamParsed &&
            (streamParsed.tool || streamParsed._isMulti)
          ) {
            const jsonStartIdx = fullText.indexOf("{");
            if (jsonStartIdx > 0)
              thinkingText = fullText.substring(0, jsonStartIdx).trim();
            dsItem.thinking = thinkingText || "";
          } else {
            if (!fullText.trim().startsWith("{")) {
              thinkingText = fullText;
              dsItem.thinking = fullText;
              if (!dsItem._thinkingStartTime)
                dsItem._thinkingStartTime = Date.now();
            }
          }
          renderLog();
        }
      }

      if (!started) {
        started = true;
        dsItem.spinning = false;
        stopGlobalSpinner();
      }
      if (dsItem._autoCollapseTimer) {
        clearTimeout(dsItem._autoCollapseTimer);
        dsItem._autoCollapseTimer = null;
      }

      const parsed = extractJSON(fullText);
      if (parsed && parsed.response) {
        dsItem.text = parsed.response;
        if (thinkingText) dsItem.thinking = thinkingText;
        if (dsItem.thinking) dsItem._thinkingEndTime = Date.now();
        saveMessage(sid, "assistant", parsed.response, {
          thinking: thinkingText,
        });
      } else if (parsed && (parsed.tool || parsed._isMulti)) {
        if (thinkingText) dsItem.thinking = thinkingText;
        if (dsItem.thinking) dsItem._thinkingEndTime = Date.now();
        dsItem.text = "";
      } else if (fullText && fullText.trim()) {
        dsItem.thinking = fullText;
        dsItem.text = "";
      } else {
        dsItem.text = "";
      }

      renderLog();
      if (dsItem.thinking) {
        dsItem.expanded = false;
        renderLog();
      }

      // Sync Deepseek Chat ID & Title
      const sess = getSessions().find((s) => s.id === sid);
      if (sess) {
        if (!sess.deepseek_id) {
          const url = page.url();
          const match = url.match(/\/a\/chat\/s\/([a-zA-Z0-9_-]+)/);
          if (match) updateSessionDeepseekId(sid, match[1]);
        }
        if (sess.title === "New Chat")
          updateSessionTitle(sid, prompt.slice(0, 40));
      }

      if (parsed && parsed._isMulti) {
        const calls = parsed.calls;
        const MAX_PARALLEL = 8;
        const batchedCalls = calls.slice(0, MAX_PARALLEL);
        const toolItems = batchedCalls.map((c) => ({
          type: "tool",
          name: c.tool,
          status: "executing",
          result: "",
          expanded: false,
        }));
        for (const t of toolItems) logItems.push(t);
        for (const c of batchedCalls)
          saveMessage(sid, "tool_call", c.tool, { params: c });

        startGlobalSpinner();
        renderLog();
        const results = await Promise.all(batchedCalls.map(async (c) => {
          const tool = tools[c.tool];
          if (tool) {
            try { const out = await tool.execute(c); return safeTruncate(out === undefined || out === null ? '' : String(out)); }
            catch (err) { return safeTruncate(`Error executing tool: ${err.message}`); }
          } else {
            const mcp = require('./.deepseek/mcp/mcp_loader');
            const isMcp = mcp.getRegistry().some(t => t.name === c.tool);
            if (isMcp) {
              try { const out = await mcp.callTool(c.tool, c); return safeTruncate(String(out)); }
              catch (err) { return safeTruncate(`Error executing MCP tool: ${err.message}`); }
            }
            return safeTruncate(`Error: Tool '${c.tool}' not found.`);
          }
        }));

        results.forEach((res, i) => {
          toolItems[i].status = "completed";
          toolItems[i].result = res;
          saveMessage(sid, "tool_result", res, { tool: batchedCalls[i].tool });
        });
        stopGlobalSpinner();
        renderLog();

        const combined = results
          .map((res, i) => `[Tool Output for ${batchedCalls[i].tool}]\n${res}`)
          .join("\n\n");
        const overflowNote =
          calls.length > MAX_PARALLEL
            ? `\n\nNote: ${calls.length - MAX_PARALLEL} additional call(s) were truncated. Issue them in the next turn if still needed.`
            : "";
        currentPrompt = `${combined}${overflowNote}\n\nRemember to return your next response in valid JSON. You may issue a single tool call, a parallel "tools" array of independent calls, or a final "response" object.`;
        isInitial = false;
        dsItem = { type: "deepseek", text: "", spinning: true };
        logItems.push(dsItem);
      } else if (parsed && parsed.tool) {
        const toolName = parsed.tool;
        const excludedKeys = ["tool", "response"];
        let toolParams = parsed.parameters || {};
        if (
          typeof toolParams !== "object" ||
          toolParams === null ||
          Array.isArray(toolParams)
        )
          toolParams = {};
        if (Object.keys(toolParams).length > 0) {
        } else {
          toolParams = {};
          for (const key of Object.keys(parsed)) {
            if (!excludedKeys.includes(key)) toolParams[key] = parsed[key];
          }
        }

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
        const tool = tools[toolName];
        let toolResult = '';
        if (tool) {
          try { 
            toolResult = await tool.execute(toolParams); 
          } catch (err) {
            toolResult = `[Tool Execution Failed]\nTool: ${toolName}\nError: ${err.message}\n\n(Analyze this error and decide your next step. You MUST reply in valid JSON format.)`;
          }
        } else {
          const mcp = require('./.deepseek/mcp/mcp_loader');
          const isMcp = mcp.getRegistry().some(t => t.name === toolName);
          if (isMcp) {
            try { 
              toolResult = await mcp.callTool(toolName, toolParams); 
            } catch (err) {
              toolResult = `[MCP Tool Execution Failed]\nTool: ${toolName}\nError: ${err.message}\n\n(Analyze this error and decide your next step. You MUST reply in valid JSON format.)`;
            }
          } else {
            toolResult = `Error: Tool '${toolName}' not found locally or in MCP registry.`;
          }
        }
        toolResult = safeTruncate(toolResult);
        toolItem.status = "completed";
        toolItem.result = toolResult;
        saveMessage(sid, "tool_result", toolResult, { tool: toolName });

        stopGlobalSpinner();
        currentPrompt = `[Tool Output for ${toolName}]\n${toolResult}\n\nRemember to return your next response in JSON format.`;
        isInitial = false;
        dsItem = { type: "deepseek", text: "", spinning: true };
        logItems.push(dsItem);
      } else {
        break;
      }
    }
  } catch (e) {
    if (dsItem && dsItem.spinning) {
      dsItem.spinning = false;
      stopGlobalSpinner();
    }
    logItems.push({ type: "separator" });
    logItems.push({ type: "error", message: e.message });
    renderLog();
  }
  busy = false;
  input.focus();
  scr.render();
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

  if (val === "/chat") {
    showChatHistory();
    return;
  }

  if (val === "/new") {
    logItems.length = 0;
    createSession();
    renderLog();

    // Force focus back to the input box after the heavy screen wipe
    input.focus();
    scr.render();

    getPage().then(async (page) => {
      try {
        await page.goto("https://chat.deepseek.com/");
        await page.waitForTimeout(500);
      } catch { }
    });
    return;
  }

  ask(val).catch(() => { });
});

scr.key(["C-c"], () => process.exit(0));

process.on("SIGINT", async () => {
  if (_page) {
    try {
      await _page
        .context()
        .browser()
        .close()
        .catch(() => { });
    } catch { }
  }
  try {
    execSync('pkill -f "remote-debugging-port=9222"', { stdio: "ignore" });
  } catch { }
  process.exit(0);
});

if (require.main === module) {
  initHistory();
  mcpLoader.init().catch(console.error);
  createSession();
  launchBrowser();
  getPage().catch(() => { });
  input.focus();
  scr.render();
} else {
  module.exports = { renderMd, wrapText, inline, C, R };
}
