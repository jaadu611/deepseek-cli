#!/usr/bin/env node
const { chromium } = require('playwright');
const { execSync }  = require('child_process');
const blessed       = require('blessed');
const { tools, getSystemPrompt } = require('./tools');

// ── colors ────────────────────────────────────────────────────────────────────
const R  = '\x1b[0m';
const fg = (r,g,b) => `\x1b[38;2;${r};${g};${b}m`;
const C  = {
  body:      fg(200, 200, 200),
  dim:       fg(110, 110, 110),
  bold:      fg(255, 255, 255),
  italic:    fg(160, 160, 160),
  code:      fg(234, 234, 234),
  bullet:    fg(110, 110, 110),
  red:       fg(255, 255, 255),
  you:       fg(56, 189, 248),   // sky blue
  deepseek:  fg(52, 211, 153),   // emerald green
};

// ── wrapping utility ─────────────────────────────────────────────────────────
function wrapText(text, limit) {
  if (!text) return [''];
  const words = text.split(' ');
  const lines = [];
  let currentLine = '';
  for (const word of words) {
    if (currentLine.length + word.length > limit) {
      lines.push(currentLine.trimEnd());
      currentLine = word + ' ';
    } else {
      currentLine += word + ' ';
    }
  }
  if (currentLine) lines.push(currentLine.trimEnd());
  return lines;
}

// ── markdown renderer ─────────────────────────────────────────────────────────
function renderMd(raw) {
  const width = chat && chat.width ? chat.width : (scr.width || 80);
  const limit = Math.max(20, width - 7);
  const lines = raw.trim().split('\n');
  const out   = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // code fence open
    const fence = line.match(/^```(\w*)/);
    if (fence) {
      const lang = fence[1] || 'code';
      const codeLines = [];
      i++;
      while (i < lines.length && !lines[i].startsWith('```')) {
        codeLines.push(lines[i]);
        i++;
      }

      // Determine box width
      let maxLen = 40;
      for (const cl of codeLines) {
        if (cl.length > maxLen) maxLen = cl.length;
      }
      const boxLimit = Math.min(limit - 4, 65);
      if (maxLen > boxLimit) maxLen = boxLimit;

      const title = ' ' + lang + ' ';
      const topBar = '┌─' + title + '─'.repeat(maxLen - title.length) + '┐';
      out.push(C.dim + topBar + R);

      for (const cl of codeLines) {
        let content = cl;
        if (content.length > maxLen) {
          content = content.substring(0, maxLen - 3) + '...';
        }
        const padded = content.padEnd(maxLen, ' ');
        out.push(C.dim + '│ ' + R + C.code + padded + R + C.dim + '│' + R);
      }

      const bottomBar = '└─' + '─'.repeat(maxLen) + '┘';
      out.push(C.dim + bottomBar + R);
      continue;
    }

    // heading
    const hm = line.match(/^(#{1,3}) (.*)/);
    if (hm) {
      if (out.length && out[out.length - 1] !== '') out.push('');
      const wrapped = wrapText(hm[2], limit);
      for (const wl of wrapped) {
        out.push(C.bold + '\x1b[1m' + inline(wl) + R);
      }
      continue;
    }

    // horizontal rule
    if (/^(-{3,}|\*{3,})$/.test(line.trim())) {
      out.push(C.dim + '─'.repeat(Math.min(55, limit)) + R);
      continue;
    }

    // unordered list
    const ul = line.match(/^[ \t]*[-*+] (.*)/);
    if (ul) {
      const wrapped = wrapText(ul[1], limit - 4);
      out.push(C.dim + ' · ' + R + C.body + inline(wrapped[0]) + R);
      for (let j = 1; j < wrapped.length; j++) {
        out.push('   ' + C.body + inline(wrapped[j]) + R);
      }
      continue;
    }

    // ordered list
    const ol = line.match(/^[ \t]*\d+[.)]\s+(.*)/);
    if (ol) {
      const wrapped = wrapText(ol[1], limit - 4);
      out.push(C.dim + ' · ' + R + C.body + inline(wrapped[0]) + R);
      for (let j = 1; j < wrapped.length; j++) {
        out.push('   ' + C.body + inline(wrapped[j]) + R);
      }
      continue;
    }

    // blockquote
    const bq = line.match(/^> (.*)/);
    if (bq) {
      const wrapped = wrapText(bq[1], limit - 4);
      for (const wl of wrapped) {
        out.push(C.dim + ' ┃ ' + R + C.italic + '\x1b[3m' + inline(wl) + R);
      }
      continue;
    }

    // blank (compress consecutive blank lines)
    if (line.trim() === '') {
      if (out.length && out[out.length - 1] !== '') {
        out.push('');
      }
      continue;
    }

    // paragraph
    const wrapped = wrapText(line, limit);
    for (const wl of wrapped) {
      out.push(C.body + inline(wl) + R);
    }
  }

  // trim trailing blank lines
  while (out.length && out[out.length - 1] === '') out.pop();
  return out;
}

function inline(s) {
  const b = C.body;
  // order matters: bold before italic
  return s
    .replace(/`([^`]+)`/g,        C.code   + '$1' + R + b)
    .replace(/\*\*\*([^*]+)\*\*\*/g, '\x1b[1;3m' + C.bold + '$1' + R + b)
    .replace(/\*\*([^*]+)\*\*/g,  '\x1b[1m'  + C.bold   + '$1' + R + b)
    .replace(/\*([^*\n]+)\*/g,    '\x1b[3m'  + C.italic  + '$1' + R + b)
    .replace(/~~([^~]+)~~/g,      '\x1b[9m'  + C.dim     + '$1' + R + b)
    .replace(/__([^_]+)__/g,      '\x1b[1m'  + C.bold    + '$1' + R + b)
    .replace(/_([^_\n]+)_/g,      '\x1b[3m'  + C.italic  + '$1' + R + b);
}

// ── browser ───────────────────────────────────────────────────────────────────
let _page = null;
let _initializing = null;

function launchBrowser() {
  try { execSync('pgrep -f "remote-debugging-port=9222"', { stdio: 'ignore' }); }
  catch {
    execSync(
      'chromium --headless=new --remote-debugging-port=9222 --user-data-dir="$HOME/scraper-profile" &',
      { shell: true, stdio: 'ignore' }
    );
    execSync('sleep 2');
  }
}

async function getPage() {
  if (_page) return _page;
  if (_initializing) return _initializing;

  _initializing = (async () => {
    const browser = await chromium.connectOverCDP('http://localhost:9222');
    const ctx     = browser.contexts()[0];
    let page = ctx.pages().find(p => p.url().includes('chat.deepseek.com'));
    if (!page) {
      page = await ctx.newPage();
    }
    await page.goto('https://chat.deepseek.com/');
    _page = page;
    _initializing = null;
    return page;
  })();

  return _initializing;
}

async function submitPrompt(page, prompt) {
  // Robust submission: use React-compatible input events
  const textarea = page.locator('textarea').first();
  await textarea.waitFor({ state: 'visible', timeout: 10000 });
  await textarea.click();

  // Select all and delete any existing content
  await page.keyboard.press('Control+a');
  await page.keyboard.press('Backspace');
  await page.waitForTimeout(80);

  // Focus the textarea and insert text instantly to avoid UI race conditions and input fragmentation
  await textarea.focus();
  await page.keyboard.insertText(prompt);
  await page.waitForTimeout(120);

  // Try send button first, then Enter
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
      if (await btn.isVisible({ timeout: 300 })) {
        await btn.click();
        sent = true;
        break;
      }
    } catch {}
  }
  if (!sent) await page.keyboard.press('Enter');
}

// ── TUI ───────────────────────────────────────────────────────────────────────
const scr = blessed.screen({
  smartCSR:    true,
  fullUnicode: true,
  title:       'deepseek',
  // Don't let grabKeys block our scroll bindings
  ignoreLocked: ['C-c'],
});

// Chat history — scrollable box
const chat = blessed.box({
  top: 0, left: 0, right: 0, bottom: 3,
  scrollable:   true,
  alwaysScroll: true,
  mouse:        true,
  keys:         false,
  tags:         false,   // raw ANSI passthrough
  wrap:         false,
  scrollbar: {
    ch:    ' ',
    style: { bg: '#3e4452' },
    track: { bg: 'default' },
  },
  padding: { left: 2, right: 2, top: 0 },
  style:   { bg: 'default', fg: '#c8c8c8' },
});

// Input bar
const input = blessed.textbox({
  bottom: 0, left: 0, right: 0, height: 3,
  inputOnFocus: true,
  padding: { left: 3, right: 2 },
  style: {
    bg:     'default',
    fg:     '#c8c8c8',
    border: { fg: '#3e4452' },
    focus:  { border: { fg: '#ffffff' } },
  },
  border: { type: 'line' },
});

scr.append(chat);
scr.append(input);

// ── helpers ───────────────────────────────────────────────────────────────────
function scrollDown(n) {
  chat.scroll(n || chat.height);
  scr.render();
}

function scrollUp(n) {
  chat.scroll(-(n || chat.height));
  scr.render();
}

// ── spinner ───────────────────────────────────────────────────────────────────
const FRAMES = ['⠋','⠙','⠹','⠸','⠼','⠴','⠦','⠧','⠇','⠏'];
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
    } catch {}
    const brace = candidate.match(/\{[\s\S]*\}/);
    if (brace) {
      try {
        const parsed = JSON.parse(brace[0]);
        if (parsed) return normalizeToolCall(parsed);
      } catch {}
    }
  }

  const braceMatch = text.match(/\{[\s\S]*\}/);
  if (braceMatch) {
    try {
      const parsed = JSON.parse(braceMatch[0]);
      if (parsed) return normalizeToolCall(parsed);
    } catch {}
  }
  return null;
}

// Convert { "tool_name": { ...params } } into { tool: "tool_name", ...params }
// while also preserving the { tool: "...", parameters: {...} } and { tool: "...", param: val } formats
function normalizeToolCall(obj) {
  if (!obj || typeof obj !== 'object') return obj;
  // Already has a "tool" key — return as-is
  if (obj.tool) return obj;
  // Has a "response" key — return as-is
  if (obj.response !== undefined) return obj;
  // Check if any top-level key matches a known tool name
  for (const key of Object.keys(obj)) {
    if (tools[key] && typeof obj[key] === 'object' && obj[key] !== null) {
      // Format: { "read_file": { "path": "..." } }
      const params = obj[key];
      params.tool = key;
      return params;
    }
  }
  return obj;
}

function renderLog() {
  const lines = [];
  lineToItem = [];

  for (let idx = 0; idx < logItems.length; idx++) {
    const item = logItems[idx];
    const itemLines = [];

    if (item.type === 'user') {
      const limit = (scr.width || 80) - 7;
      const wrapped = wrapText(item.text, limit);
      itemLines.push(C.you + '○  ' + R + C.dim + wrapped[0] + R);
      for (let i = 1; i < wrapped.length; i++) {
        itemLines.push(' '.repeat(3) + C.dim + wrapped[i] + R);
      }
    } 
    else if (item.type === 'deepseek') {
      // Display response block
      if (item.text === '' && item.spinning) {
        itemLines.push(C.deepseek + '●  ' + R + C.dim + FRAMES[spinFrame % FRAMES.length] + R);
      } else if (item.text) {
        const rendered = renderMd(item.text);
        if (rendered.length > 0) {
          itemLines.push(C.deepseek + '●  ' + R + rendered[0]);
          for (let i = 1; i < rendered.length; i++) {
            itemLines.push(' '.repeat(3) + rendered[i]);
          }
        }
      } else if (!item.text && !item.spinning) {
        // Empty response, nothing to show
      }
    } 
    else if (item.type === 'tool') {
      const prefix = item.status === 'executing' 
        ? C.dim + FRAMES[spinFrame % FRAMES.length] + ` executing ${item.name}...` + R
        : C.dim + `✔ ${item.name} ` + (item.expanded ? '(click to collapse)' : '(click to show output)') + R;
      itemLines.push(' '.repeat(3) + prefix);

      if (item.expanded && item.result) {
        const resultLines = item.result.toString().split('\n');
        const maxLines = Math.min(50, resultLines.length);
        for (let i = 0; i < maxLines; i++) {
          itemLines.push(C.dim + '    ' + resultLines[i] + R);
        }
        if (resultLines.length > maxLines) {
          itemLines.push(C.dim + `    ... and ${resultLines.length - maxLines} more lines.` + R);
        }
      }
    }
    else if (item.type === 'separator') {
      itemLines.push('');
    }
    else if (item.type === 'divider') {
      const width = chat.width ? (chat.width - 4) : ((scr.width || 80) - 4);
      itemLines.push(C.dim + '─'.repeat(Math.max(10, width)) + R);
    }
    else if (item.type === 'error') {
      itemLines.push(C.red + 'error  ' + R + C.dim + item.message + R);
    }

    for (const l of itemLines) {
      lines.push(l);
      lineToItem.push(item);
    }
  }

  chat.setContent(lines.join('\n'));
  chat.setScrollPerc(100);
  scr.render();
}

// ── interactive clicks ────────────────────────────────────────────────────────
chat.on('click', (data) => {
  const clickY = data.y - (chat.atop + chat.itop) + chat.childBase;
  if (clickY >= 0 && clickY < lineToItem.length) {
    const item = lineToItem[clickY];
    if (item && item.type === 'tool' && item.status === 'completed') {
      item.expanded = !item.expanded;
      renderLog();
    }
  }
});

// ── ask ───────────────────────────────────────────────────────────────────────
let busy = false;

async function ask(prompt) {
  busy = true;

  // Plan and task files are now preserved across prompts for continuity.
  // To reset for a new unrelated task, the agent can explicitly delete them or the user can do so manually.
  // No automatic deletion is performed.

  if (logItems.length > 0) {
    logItems.push({ type: 'separator' });
    logItems.push({ type: 'divider' });
    logItems.push({ type: 'separator' });
  }

  logItems.push({ type: 'user', text: prompt });

  let dsItem = { type: 'deepseek', text: '', spinning: true };
  logItems.push(dsItem);

  startGlobalSpinner();

  try {
    const page   = await getPage();
    const count  = async () => page.locator('.ds-markdown').count();

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
        if (await count() > before) { appeared = true; break; }
      }

      if (!appeared) throw new Error('no response from deepseek (timeout)');

      const bubble = page.locator('.ds-markdown').last();
      let printed  = 0;
      let started  = false;
      let fullText = '';

      while (true) {
        await page.waitForTimeout(80);
        try {
          fullText = await bubble.evaluate((el) => {
            const key = Object.keys(el).find(k => k.startsWith('__reactFiber') || k.startsWith('__reactInternal'));
            if (!key) return el.textContent;

            function findRawContent(node, depth = 0) {
              if (!node || depth > 20) return null;
              const props = node.memoizedProps;
              if (props) {
                if (typeof props.content === 'string') return props.content;
                if (typeof props.text === 'string') return props.text;
                if (typeof props.value === 'string') return props.value;
              }
              return findRawContent(node.return, depth + 1);
            }

            return findRawContent(el[key]) || el.textContent;
          });
        } catch {
          // Transient error, keep polling
        }

        if (fullText.length > printed) {
          if (!started) {
            dsItem.spinning = false;
            stopGlobalSpinner();
            started = true;
          }
          printed = fullText.length;

          let displayOutput = '';
          const toolMatch = fullText.match(/"tool"\s*:\s*"([^"]*)/);
          const responseMatch = fullText.match(/"response"\s*:\s*"([^"\\]*(?:\\.[^"\\]*)*)/);

          if (responseMatch) {
            displayOutput = responseMatch[1].replace(/\\n/g, '\n').replace(/\\"/g, '"');
          }

          if (!displayOutput && fullText && !toolMatch && !fullText.trim().startsWith('{')) {
            displayOutput = fullText;
          }

          dsItem.text = displayOutput;
          renderLog();
        }

        // If full text is a complete parseable JSON with action fields, stop polling immediately
        if (fullText.trim().startsWith('{')) {
          const parsed = extractJSON(fullText);
          if (parsed && (parsed.response !== undefined || parsed.tool)) {
            break;
          }
        }
      }

      if (!started) {
        dsItem.spinning = false;
        stopGlobalSpinner();
      }

            // Extract JSON response and display only the response field
      const parsed = extractJSON(fullText);
      if (parsed && parsed.response) {
        dsItem.text = parsed.response;
        renderLog();
      } else if (!parsed && fullText.trim()) {
        // Fallback: display raw text if it's not JSON
        let cleaned = fullText.trim();
        if (cleaned && dsItem.text !== cleaned) {
          dsItem.text = cleaned;
          renderLog();
        }
      }

      // Now handle tool calls if present
      if (parsed && parsed.tool) {
        const toolName = parsed.tool;
        // Support all parameter passing formats:
        //   {tool, parameters: {param1, param2}}  — nested
        //   {tool, param1, param2}                — flat
        //   and also handle the normalizeToolCall which already merged params
        const excludedKeys = ['tool', 'response'];
        let toolParams = parsed.parameters || {};
        if (Object.keys(toolParams).length > 0) {
          // Nested format already handled
        } else {
          // Flat format or normalized: take everything except meta fields
          toolParams = {};
          for (const key of Object.keys(parsed)) {
            if (!excludedKeys.includes(key)) {
              toolParams[key] = parsed[key];
            }
          }
        }

        const toolItem = { type: 'tool', name: toolName, status: 'executing', result: '', expanded: false };
        logItems.push(toolItem);
        startGlobalSpinner();

        const tool = tools[toolName];
        let toolResult = '';
        if (tool) {
          try {
            toolResult = await tool.execute(toolParams);
          } catch (err) {
            toolResult = `Error executing tool: ${err.message}`;
          }
        } else {
          toolResult = `Error: Tool '${toolName}' not found.`;
        }

        toolItem.status = 'completed';
        toolItem.result = toolResult;
        stopGlobalSpinner();

        currentPrompt = `[Tool Output for ${toolName}]\n${toolResult}\n\nRemember to return your next response in JSON format.`;
        isInitial = false;

        dsItem = { type: 'deepseek', text: '', spinning: true };
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
    logItems.push({ type: 'separator' });
    logItems.push({ type: 'error', message: e.message });
    renderLog();
  }

  busy = false;
  input.focus();
  scr.render();
}

// ── key bindings ──────────────────────────────────────────────────────────────
// Bind scroll keys on the input widget itself — they fire even during readInput
// because we intercept before grabKeys swallows them
input.key(['pageup'],       () => scrollUp());
input.key(['pagedown'],     () => scrollDown());
input.key(['S-up'],         () => scrollUp(3));
input.key(['S-down'],       () => scrollDown(3));
input.key(['C-u'],          () => scrollUp());
input.key(['C-d'],          () => scrollDown());

input.key('enter', () => {
  if (busy) return;
  const val = input.getValue().trim();
  if (!val) return;
  input.clearValue();
  scr.render();
  ask(val).catch(() => {});
});

scr.key(['C-c'], () => process.exit(0));

// ── boot ──────────────────────────────────────────────────────────────────────
if (require.main === module) {
  launchBrowser();
  getPage().catch(() => {});
  input.focus();
  scr.render();
} else {
  module.exports = { renderMd, wrapText, inline, C, R };
}