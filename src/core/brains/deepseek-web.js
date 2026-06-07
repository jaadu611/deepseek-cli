const BaseBrain = require("./base");
const { chromium } = require("playwright");
const { execSync } = require("child_process");
const http = require("http");

class DeepSeekWebBrain extends BaseBrain {
  constructor() {
    super();
    this.page = null;
    this.initializing = null;
    this.exposedPages = new WeakSet();
    this.initPromise = null;

    this.pageStates = new WeakMap();
  }

  static get id() {
    return "deepseek-web";
  }

  static get name() {
    return "DeepSeek Web Automator (Playwright)";
  }

  getOrCreatePageState(page) {
    if (!this.pageStates.has(page)) {
      this.pageStates.set(page, {
        streamDone: false,
        thinkingChunks: [],
        responseChunks: [],
        isThinking: false,
        streamBuffer: "",
        thinkingStartTime: null,
        thinkingEndTime: null,
      });
    }
    return this.pageStates.get(page);
  }

  async createNewPage() {
    await this.waitForCDP();
    const browser = await chromium.connectOverCDP("http://127.0.0.1:9222");
    const ctx = browser.contexts()[0];
    const page = await ctx.newPage();
    await this.setupInterceptors(page);
    await page.goto("https://chat.deepseek.com/").catch(() => {});
    return page;
  }

  init() {
    if (!this.initPromise) {
      this.initPromise = (async () => {
        this.launchBrowser();
        try {
          await this.getPage();
        } catch (err) {
          require('fs').appendFileSync(
            "/tmp/deepseek-cli-debug.log",
            `[Brain] Failed to initialize page: ${err.stack || err.message}\n`
          );
          this.initPromise = null;
          throw err;
        }
      })();
    }
    return this.initPromise;
  }

  async cleanup() {
    if (this.page) {
      try {
        await this.page.context().browser().close().catch(() => {});
      } catch (err) {}
    }
    try {
      execSync('pkill -f "remote-debugging-port=9222"', { stdio: "ignore" });
    } catch (err) {}
  }

  async onSessionLoad(session) {
    try {
      const page = await this.getPage();
      const currentUrl = page.url();
      require('fs').appendFileSync(
        "/tmp/deepseek-cli-debug.log",
        `[Brain] onSessionLoad called: session=${JSON.stringify(session)}, currentUrl=${currentUrl}\n`
      );
      if (session && session.deepseek_id) {
        if (!currentUrl.includes(session.deepseek_id)) {
          await page.goto(`https://chat.deepseek.com/a/chat/s/${session.deepseek_id}`).catch(() => {});
          await this.setupInterceptors(page);
        }
      } else {
        if (currentUrl.includes("/a/chat/s/")) {
          // Try to click the "New Chat" button on the web UI to avoid full page reload challenges
          const clicked = await page.evaluate(() => {
            const selectors = [
              'button[aria-label*="New Chat"i]',
              'button[title*="New Chat"i]',
              'div[role="button"][aria-label*="New Chat"i]',
              'a[aria-label*="New Chat"i]',
              '.ds-sidebar button', // common sidebar button selector class prefixes
            ];
            for (const sel of selectors) {
              const elements = document.querySelectorAll(sel);
              for (const el of elements) {
                const text = (el.textContent || '').trim().toLowerCase();
                if (text.includes('new chat') || text === 'new' || text === '+ new chat') {
                  el.click();
                  return true;
                }
              }
              const firstEl = document.querySelector(sel);
              if (firstEl && (firstEl.getAttribute('aria-label') || '').toLowerCase().includes('new chat')) {
                firstEl.click();
                return true;
              }
            }
            // General query selector for button/div texts
            const allElements = Array.from(document.querySelectorAll('button, div[role="button"], a, span, p'));
            for (const el of allElements) {
              const text = (el.textContent || '').trim().toLowerCase();
              if (text === 'new chat' || text === '+ new chat' || text === 'new') {
                let clickable = el;
                while (clickable && clickable.tagName !== 'BUTTON' && clickable.tagName !== 'A' && clickable.getAttribute('role') !== 'button') {
                  clickable = clickable.parentElement;
                }
                if (clickable) {
                  clickable.click();
                  return true;
                }
              }
            }
            return false;
          }).catch(() => false);

          if (clicked) {
            // Give it a brief moment to update the DOM/URL
            await page.waitForTimeout(400).catch(() => {});
          }
          
          // If the click failed to navigate away from the session URL, reload to the new chat page
          if (page.url().includes("/a/chat/s/")) {
            await page.goto("https://chat.deepseek.com/").catch(() => {});
            await this.setupInterceptors(page);
          }
        } else if (!currentUrl.includes("chat.deepseek.com")) {
          await page.goto("https://chat.deepseek.com/").catch(() => {});
          await this.setupInterceptors(page);
        }
      }
    } catch (err) {
      require('fs').appendFileSync(
        "/tmp/deepseek-cli-debug.log",
        `[Brain] onSessionLoad error: ${err.stack || err.message}\n`
      );
    }
  }

  async onSessionSync(session, prompt) {
    if (!session) return;
    try {
      const page = await this.getPage();
      if (!session.deepseek_id) {
        const m = page.url().match(/\/a\/chat\/s\/([a-zA-Z0-9_-]+)/);
        if (m) {
          const { updateSessionDeepseekId } = require("../../core/history");
          updateSessionDeepseekId(session.id, m[1]);
        }
      }
    } catch (err) {}
  }

  launchBrowser() {
    const http = require("http");
    const req = http.get("http://127.0.0.1:9222/json/version", (res) => {
      // Connected successfully, browser is already running
    });
    req.on("error", () => {
      // Not running, launch it in background
      const { spawn } = require("child_process");
      const path = require("path");
      const os = require("os");
      let userAgent = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";
      if (os.platform() === "darwin") {
        userAgent = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";
      } else if (os.platform() === "win32") {
        userAgent = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";
      }

      const child = spawn(
        "chromium",
        [
          // "--headless=new",
          "--remote-debugging-port=9222",
          "--user-data-dir=" + path.join(os.homedir(), "scraper-profile"),
          `--user-agent=${userAgent}`,
        ],
        {
          detached: true,
          stdio: "ignore",
        }
      );
      child.unref();
    });
    req.setTimeout(500, () => {
      req.destroy();
    });
  }

  async waitForCDP(port = 9222, timeout = 10000) {
    const http = require("http");
    const start = Date.now();
    while (Date.now() - start < timeout) {
      try {
        await new Promise((resolve, reject) => {
          const req = http.get(`http://127.0.0.1:${port}/json/version`, (res) => {
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

  async getPage() {
    if (this.page) {
      try {
        await this.page.evaluate("1");
        return this.page;
      } catch {
        this.page = null;
        this.initializing = null;
      }
    }
    if (this.initializing) return this.initializing;
    this.initializing = (async () => {
      await this.waitForCDP();
      const browser = await chromium.connectOverCDP("http://127.0.0.1:9222");
      const ctx = browser.contexts()[0];
      let page = ctx.pages().find((p) => p.url().includes("chat.deepseek.com"));
      if (!page) {
        page = await ctx.newPage();
        await this.setupInterceptors(page);
        page.goto("https://chat.deepseek.com/").catch(() => {});
      } else {
        await this.setupInterceptors(page);
      }
      this.page = page;
      this.initializing = null;
      return page;
    })();
    return this.initializing;
  }

  async setupInterceptors(page) {
    if (!this.exposedPages.has(page)) {
      this.exposedPages.add(page);
      await page.exposeFunction("_onNetworkChunk", (text) => this.processNetworkChunk(page, text));
      await page.exposeFunction("_onStreamEnd", () => {
        const state = this.getOrCreatePageState(page);
        state.streamDone = true;
      });

      const installFn = () => {
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
                if (done) {
                  window._onStreamEnd();
                  break;
                }
                window._onNetworkChunk(decoder.decode(value, { stream: true }));
              }
            })().catch(() => {});
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
      };

      await page.addInitScript(installFn);
      try {
        await page.evaluate(installFn);
      } catch (err) {}
    }
  }

  processNetworkChunk(page, text) {
    const state = this.getOrCreatePageState(page);
    state.streamBuffer += text;
    const lines = state.streamBuffer.split("\n");
    state.streamBuffer = lines.pop();

    for (let line of lines) {
      line = line.trim();
      if (!line.startsWith("data:")) continue;
      const jsonStr = line.slice(5).trim();
      if (jsonStr === "[DONE]") {
        state.streamDone = true;
        continue;
      }
      let json;
      try {
        json = JSON.parse(jsonStr);
      } catch {
        continue;
      }

      if (
        (json.p === "response/status" && json.v === "FINISHED") ||
        (json.p === "response" && json.v?.quasi_status === "FINISHED") ||
        json.p === "stream_end"
      ) {
        state.streamDone = true;
        continue;
      }

      const fragments = json.v?.response?.fragments || (Array.isArray(json.v) ? json.v : []);
      for (const frag of fragments) {
        if (frag.type === "THINK") state.isThinking = true;
        if (frag.type === "RESPONSE") state.isThinking = false;
        if (typeof frag.content === "string" && frag.content) {
          (state.isThinking ? state.thinkingChunks : state.responseChunks).push(frag.content);
        }
      }

      if (typeof json.v === "string" && json.p !== "response/status") {
        (state.isThinking ? state.thinkingChunks : state.responseChunks).push(json.v);
      }
    }
  }

  async submitPrompt(page, prompt, options = {}) {
    const textarea = page.locator("textarea").first();
    await textarea.waitFor({ state: "visible", timeout: 10000 });
    await page.waitForFunction(
      (ta) => !ta.disabled && !ta.readOnly,
      textarea.elementHandle(),
      { timeout: 5000 }
    );
    await textarea.fill(prompt);
    await textarea.focus();

    // Toggle search based on options (default to true)
    const enableSearch = options.webSearch !== false;
    try {
      await page.evaluate((enable) => {
        const selectors = [
          'button[aria-label*="Search"i]',
          'button[title*="Search"i]',
          'div[role="button"][aria-label*="Search"i]',
          'div[role="switch"][aria-label*="Search"i]',
          'div[role="checkbox"][aria-label*="Search"i]'
        ];
        for (const sel of selectors) {
          const el = document.querySelector(sel);
          if (el) {
            const isActive = el.getAttribute('aria-checked') === 'true' ||
                             el.classList.contains('checked') ||
                             el.classList.contains('active') ||
                             el.className.includes('primary') ||
                             (el.querySelector('.checked') !== null);
            if (isActive !== enable) {
              el.click();
            }
            return;
          }
        }
        const elements = Array.from(document.querySelectorAll('button, div[role="button"], div[role="switch"], div[role="checkbox"], span, p'));
        for (const el of elements) {
          const text = el.textContent || '';
          if (/^(web\s+)?search$/i.test(text.trim())) {
            let clickable = el;
            while (clickable && clickable.tagName !== 'BUTTON' && clickable.getAttribute('role') !== 'button' && clickable.getAttribute('role') !== 'switch') {
              clickable = clickable.parentElement;
            }
            if (clickable) {
              const isActive = clickable.getAttribute('aria-checked') === 'true' ||
                               clickable.classList.contains('checked') ||
                               clickable.classList.contains('active') ||
                               clickable.className.includes('primary');
              if (isActive !== enable) {
                clickable.click();
              }
              return;
            }
          }
        }
      }, enableSearch);
    } catch (e) {}

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
      } catch {}
    }
    if (!sent) {
      await textarea.focus();
      await textarea.press("Enter");
    }
  }

  async isGenerationStopped(page) {
    try {
      const statusText = await page.evaluate(() => {
        const assistantMessages = Array.from(document.querySelectorAll('[data-message-role="assistant"]'));
        if (assistantMessages.length === 0) return null;
        const lastAssistant = assistantMessages[assistantMessages.length - 1];
        const statusSpan = lastAssistant.querySelector('span._5255ff8._4d41763');
        if (!statusSpan) return null;
        return statusSpan.textContent.trim();
      });
      return statusText === "Stopped";
    } catch (err) {
      return false;
    }
  }

  async getCompletionStream(prompt, options = {}) {
    const activePage = options.page || await this.getPage();
    const { onStartCalled, onProgress } = options;
    let attempt = 0;
    const maxAttempts = 5;

    while (attempt < maxAttempts) {
      attempt++;
      // Reset state
      const state = this.getOrCreatePageState(activePage);
      state.streamDone = false;
      state.thinkingChunks = [];
      state.responseChunks = [];
      state.isThinking = false;
      state.streamBuffer = "";
      state.thinkingStartTime = null;
      state.thinkingEndTime = null;

      await this.setupInterceptors(activePage);
      await this.submitPrompt(activePage, prompt, options);

      // Wait for first chunk
      const CHUNK_TIMEOUT = 15000;
      const chunkStart = Date.now();
      let firstChunkSeen = false;
      let failedToStart = false;

      while (!state.thinkingChunks.length && !state.responseChunks.length && !state.streamDone) {
        if (Date.now() - chunkStart > CHUNK_TIMEOUT) {
          failedToStart = true;
          break;
        }
        await new Promise((r) => setTimeout(r, 50));
      }

      if (failedToStart) {
        require("fs").appendFileSync(
          "/tmp/deepseek-cli-debug.log",
          `[Brain] Attempt ${attempt} failed to start streaming within ${CHUNK_TIMEOUT}ms. Reloading and retrying...\n`
        );
        await activePage.reload().catch(() => {});
        await new Promise((r) => setTimeout(r, 2000));
        continue;
      }

      const IDLE_TIMEOUT_MS = 12000000;
      let lastDataTime = Date.now();
      let lastLen = 0;
      let stoppedPrematurely = false;

      const checkDone = () => {
        if (state.streamDone) return true;

        if (firstChunkSeen && Date.now() - lastDataTime > 3000) {
          const thinkSoFar = state.thinkingChunks.join("");
          const respSoFar = state.responseChunks.join("");

          const hasJson = respSoFar.includes("{") || thinkSoFar.includes("{");
          if (hasJson) {
            if (hasCompleteJSON(respSoFar) || hasCompleteJSON(thinkSoFar)) {
              state.streamDone = true;
              return true;
            }
          }

          stoppedPrematurely = true;
          return true;
        }

        if (
          (state.thinkingChunks.length || state.responseChunks.length) &&
          Date.now() - lastDataTime > IDLE_TIMEOUT_MS
        ) {
          state.streamDone = true;
          return true;
        }
        return false;
      };

      while (!state.streamDone && !checkDone()) {
        await new Promise((r) => setTimeout(r, 100));
        const thinkSoFar = state.thinkingChunks.join("");
        const respSoFar = state.responseChunks.join("");

        if (!firstChunkSeen && (thinkSoFar || respSoFar)) {
          firstChunkSeen = true;
          if (onStartCalled) onStartCalled();
        }

        if (firstChunkSeen) {
          if (!state.thinkingStartTime && thinkSoFar) {
            state.thinkingStartTime = Date.now();
          }

          const currentLen = thinkSoFar.length + respSoFar.length;
          if (currentLen > lastLen) {
            lastDataTime = Date.now();
            lastLen = currentLen;
          }

          if (onProgress) {
            onProgress({
              thinking: thinkSoFar,
              text: respSoFar,
              thinkingStartTime: state.thinkingStartTime,
              thinkingEndTime: state.thinkingEndTime,
            });
          }
        }
      }

      // Check DOM for explicit "Stopped" status
      const explicitlyStopped = await this.isGenerationStopped(activePage);
      if (explicitlyStopped) {
        stoppedPrematurely = true;
      }

      if (stoppedPrematurely) {
        require("fs").appendFileSync(
          "/tmp/deepseek-cli-debug.log",
          `[Brain] Attempt ${attempt} stopped prematurely (no data for 3s and incomplete final blocks). Reloading and retrying same prompt...\n`
        );
        await activePage.reload().catch(() => {});
        await new Promise((r) => setTimeout(r, 3000));
        continue;
      }

      if (state.streamBuffer.trim()) this.processNetworkChunk(activePage, "\n");
      const thinkSoFar = state.thinkingChunks.join("");
      const respSoFar = state.responseChunks.join("");
      if (thinkSoFar && state.thinkingStartTime) state.thinkingEndTime = Date.now();

      if (!thinkSoFar.trim() && !respSoFar.trim()) {
        require("fs").appendFileSync(
          "/tmp/deepseek-cli-debug.log",
          `[Brain] Attempt ${attempt} returned completely empty response. Reloading and retrying...\n`
        );
        await activePage.reload().catch(() => {});
        await new Promise((r) => setTimeout(r, 3000));
        continue;
      }

      if (onProgress) {
        onProgress({
          thinking: thinkSoFar,
          text: respSoFar,
          thinkingStartTime: state.thinkingStartTime,
          thinkingEndTime: state.thinkingEndTime,
        });
      }

      return { thinkingText: thinkSoFar, responseText: respSoFar };
    }

    throw new Error("DeepSeek failed to complete generation after multiple attempts.");
  }



  async _clickNewChatButton() {
    const page = await this.getPage();
    const currentUrl = page.url();
    require('fs').appendFileSync(
      "/tmp/deepseek-cli-debug.log",
      `[Brain] _clickNewChatButton called, current URL: ${currentUrl}\n`
    );
    
    const clicked = await page.evaluate(() => {
      const selectors = [
        'button[aria-label*="New Chat"i]',
        'button[title*="New Chat"i]',
        'div[role="button"][aria-label*="New Chat"i]',
        'a[aria-label*="New Chat"i]',
        '.ds-sidebar button',
      ];
      for (const sel of selectors) {
        const elements = document.querySelectorAll(sel);
        for (const el of elements) {
          const text = (el.textContent || '').trim().toLowerCase();
          if (text.includes('new chat') || text === 'new' || text === '+ new chat') {
            el.click();
            return true;
          }
        }
        const firstEl = document.querySelector(sel);
        if (firstEl && (firstEl.getAttribute('aria-label') || '').toLowerCase().includes('new chat')) {
          firstEl.click();
          return true;
        }
      }
      const allElements = Array.from(document.querySelectorAll('button, div[role="button"], a, span, p'));
      for (const el of allElements) {
        const text = (el.textContent || '').trim().toLowerCase();
        if (text === 'new chat' || text === '+ new chat' || text === 'new') {
          let clickable = el;
          while (clickable && clickable.tagName !== 'BUTTON' && clickable.tagName !== 'A' && clickable.getAttribute('role') !== 'button') {
            clickable = clickable.parentElement;
          }
          if (clickable) {
            clickable.click();
            return true;
          }
        }
      }
      return false;
    }).catch(() => false);
    
    if (clicked) {
      await page.waitForTimeout(400).catch(() => {});
    }
    return clicked;
  }

  async createNewChat() {
    const page = await this.getPage();
    require('fs').appendFileSync(
      "/tmp/deepseek-cli-debug.log",
      `[Brain] createNewChat called, current URL: ${page.url()}\n`
    );
    
    // Click the New Chat button
    const clicked = await this._clickNewChatButton();
    if (!clicked) {
      // Fallback: navigate directly to chat home
      await page.goto("https://chat.deepseek.com/").catch(() => {});
      await this.setupInterceptors(page);
    }
    
    // Give the page a moment to settle
    await new Promise(r => setTimeout(r, 500));
    return true;
  }

  async getCurrentDeepseekId() {
    const page = await this.getPage();
    const url = page.url();
    const match = url.match(/\/s\/([a-zA-Z0-9]+)/);
    require('fs').appendFileSync(
      "/tmp/deepseek-cli-debug.log",
      `[Brain] getCurrentDeepseekId: URL=${url}, found=${match ? match[1] : 'null'}\n`
    );
    return match ? match[1] : null;
  }

  async sendPromptInNewChat(promptText) {
    const page = await this.getPage();
    require('fs').appendFileSync(
      "/tmp/deepseek-cli-debug.log",
      `[Brain] sendPromptInNewChat called with prompt length: ${promptText.length}\n`
    );
    
    // Wait for textarea to be available
    const textareaSelector = 'textarea.ds-input-textarea, textarea[placeholder*="Message"], textarea[placeholder*="Ask anything"]';
    await page.waitForSelector(textareaSelector, { timeout: 10000 }).catch(() => {
      throw new Error("Textarea not found for sending prompt");
    });
    
    // Fill the textarea
    await page.fill(textareaSelector, promptText);
    
    // Click send button
    const sendButtonSelectors = [
      'button[type="submit"]',
      'button[aria-label="Send"]',
      'button:has-text("Send")',
      'svg[data-icon="paper-plane"]',
    ];
    let clicked = false;
    for (const sel of sendButtonSelectors) {
      try {
        const button = await page.$(sel);
        if (button) {
          await button.click();
          clicked = true;
          break;
        }
      } catch (err) {}
    }
    if (!clicked) {
      // Try pressing Enter as fallback
      await page.keyboard.press('Enter');
    }
    
    // Wait for AI response to appear
    await page.waitForSelector('.ds-message.ai-message, .ds-message:has-text("I")', { timeout: 15000 }).catch(() => {});
    
    require('fs').appendFileSync(
      "/tmp/deepseek-cli-debug.log",
      `[Brain] sendPromptInNewChat completed\n`
    );
    return true;
  }
}

function hasCompleteJSON(text) {
  if (!text || !text.includes("{")) return false;
  const lastBrace = text.lastIndexOf("}");
  if (lastBrace === -1) return false;
  const firstBrace = text.indexOf("{");
  const candidate = text.substring(firstBrace, lastBrace + 1);
  try {
    JSON.parse(candidate);
    return true;
  } catch {
    let depth = 0;
    let inString = false;
    let escape = false;
    for (let i = firstBrace; i <= lastBrace; i++) {
      const ch = candidate[i - firstBrace];
      if (escape) {
        escape = false;
        continue;
      }
      if (ch === '\\') {
        escape = true;
        continue;
      }
      if (ch === '"') {
        inString = !inString;
        continue;
      }
      if (!inString) {
        if (ch === '{') depth++;
        else if (ch === '}') depth--;
      }
    }
    return depth === 0;
  }
}

module.exports = DeepSeekWebBrain;