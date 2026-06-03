const blessed = require("blessed");

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

const FRAMES = ["⠁", "⠂", "⠄", "⡀", "⢀", "⠠", "⠐", "⠈"];

// ── wrapping ──────────────────────────────────────────────────────────────────
function wrapText(text, limit) {
  if (!text) return [""];
  const words = text.split(" ");
  const lines = [];
  let cur = "";
  for (const w of words) {
    if (cur.length + w.length > limit) {
      lines.push(cur.trimEnd());
      cur = w + " ";
    } else {
      cur += w + " ";
    }
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
      const inner = Math.min(Math.max(...codeLines.map((l) => l.length), 4), limit - 4);
      const langLabel = lang ? ` ${lang} ` : " text ";
      const bar = "─".repeat(Math.max(0, inner - langLabel.length));
      out.push(C.codeBorder + "╭" + langLabel + bar + "╮" + R);
      for (const cl of codeLines) {
        const content = cl.length > inner ? cl.slice(0, inner - 1) + "…" : cl;
        out.push(
          C.codeBorder +
            "│" +
            R +
            " " +
            C.code +
            content.padEnd(inner - 1) +
            R +
            " " +
            C.codeBorder +
            "│" +
            R
        );
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

    for (const wl of wrapText(line, limit)) out.push(C.body + inline(wl) + R);
  }

  while (out.length && out[out.length - 1] === "") out.pop();
  return out;
}

// ── TUI layout ────────────────────────────────────────────────────────────────
const scr = blessed.screen({
  smartCSR: true,
  fullUnicode: true,
  title: "deepseek",
  ignoreLocked: ["C-c"],
});

const topBar = blessed.box({
  top: 0,
  left: 0,
  right: 0,
  height: 1,
  tags: false,
  style: { bg: "default", fg: "#5a5a5a" },
  padding: { left: 2 },
  content: " deepseek ",
});

const chat = blessed.box({
  top: 1,
  left: 0,
  right: 0,
  bottom: 3,
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
  bottom: 3,
  left: 0,
  right: 0,
  orientation: "horizontal",
  style: { fg: "#2a2a2a" },
});

const input = blessed.textbox({
  bottom: 0,
  left: 0,
  right: 0,
  height: 3,
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

input.on("cancel", () => {
  (global.setImmediate || process.nextTick)(() => {
    input.focus();
    scr.render();
  });
});

scr.append(topBar);
scr.append(chat);
scr.append(inputSep);
scr.append(input);

function setTopBarTitle(title) {
  const truncated = title && title.length > 60 ? title.slice(0, 57) + "…" : title || "deepseek";
  topBar.setContent(C.dimmer + "  " + truncated + R);
  scr.render();
}

function scrollDown(n) {
  chat.scroll(n || chat.height);
  scr.render();
}
function scrollUp(n) {
  chat.scroll(-(n || chat.height));
  scr.render();
}

// ── spinner ───────────────────────────────────────────────────────────────────
let spinFrame = 0;
let activeSpinners = 0;
let globalSpinInterval = null;
let logItems = [];
let lineToItem = [];

function startGlobalSpinner() {
  activeSpinners++;
  if (globalSpinInterval) return;
  globalSpinInterval = setInterval(() => {
    spinFrame++;
    renderLog();
  }, 100);
}

function stopGlobalSpinner() {
  activeSpinners = Math.max(0, activeSpinners - 1);
  if (activeSpinners === 0 && globalSpinInterval) {
    clearInterval(globalSpinInterval);
    globalSpinInterval = null;
  }
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
            if (i === 0 && !hasThink) itemLines.push(C.accentB + "  ● " + R + rendered[i]);
            else itemLines.push("    " + rendered[i]);
          }
        }
      }
    } else if (item.type === "tool") {
      if (item.status === "executing") {
        itemLines.push(
          C.dimmer +
            "  " +
            FRAMES[spinFrame % FRAMES.length] +
            " " +
            C.tool +
            item.name +
            R +
            C.dimmer +
            " …" +
            R
        );
      } else if (item.expanded) {
        itemLines.push(C.tool + "  ⊟ " + R + C.muted + item.name + R);
        if (item.result) {
          const rLines = item.result.toString().split("\n");
          const maxShow = Math.min(50, rLines.length);
          for (let i = 0; i < maxShow; i++)
            itemLines.push(C.dimmer + "  │ " + R + C.dim + rLines[i] + R);
          if (rLines.length > maxShow)
            itemLines.push(
              C.dimmer + "  │ " + R + C.dimmer + `… +${rLines.length - maxShow} lines` + R
            );
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
    } else if (item.type === "status") {
      itemLines.push(C.dimmer + "  " + FRAMES[spinFrame % FRAMES.length] + " " + C.muted + item.text + R);
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
  const y = data.y - (chat.atop + chat.itop) + chat.childBase;
  if (y < 0 || y >= lineToItem.length) return;
  const item = lineToItem[y];
  if (item?.type === "tool" && item.status === "completed") {
    item.expanded = !item.expanded;
    renderLog();
  } else if (item?.type === "deepseek" && item.thinking) {
    item.expanded = !item.expanded;
    renderLog();
  }
});

// ── chat history overlay ──────────────────────────────────────────────────────
function showChatHistory(sessions, onSelect) {
  if (!sessions || !sessions.length) {
    return;
  }

  const overlay = blessed.box({
    top: "center",
    left: "center",
    width: "70%",
    height: "70%",
    border: { type: "line" },
    style: { border: { fg: "#3a3a3a" }, bg: "default" },
    label: " sessions  esc to close ",
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
    style: {
      selected: { fg: "#52c4c4", bg: "default", bold: true },
      item: { fg: "#888888" },
    },
    items: sessions.map((s) => {
      const date = new Date(s.updated_at).toLocaleDateString("en-GB", {
        day: "2-digit",
        month: "short",
      });
      return `  ${date}  ${s.title}`;
    }),
  });

  scr.append(overlay);
  list.focus();
  scr.render();

  const close = () => {
    overlay.destroy();
    (global.setImmediate || process.nextTick)(() => {
      input.focus();
      scr.render();
    });
  };
  list.on("select", (_, idx) => {
    close();
    onSelect(sessions[idx]);
  });
  list.key(["escape"], close);
  overlay.key(["escape"], close);
}

module.exports = {
  scr,
  topBar,
  chat,
  inputSep,
  input,
  C,
  R,
  setLogItems(items) {
    logItems = items;
  },
  getLogItems() {
    return logItems;
  },
  setTopBarTitle,
  scrollDown,
  scrollUp,
  startGlobalSpinner,
  stopGlobalSpinner,
  renderLog,
  showChatHistory,
  renderMd,
  wrapText,
  inline,
};
