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

    // Stream state
    this._streamDone = false;
    this._thinkingChunks = [];
    this._responseChunks = [];
    this._isThinking = false;
    this._streamBuffer = "";
    this._thinkingStartTime = null;
    this._thinkingEndTime = null;
  }

  static get id() {
    return "deepseek-web";
  }

  static get name() {
    return "DeepSeek Web Automator (Playwright)";
  }

  init() {
    if (!this.initPromise) {
      this.initPromise = (async () => {
        this.launchBrowser();
        try {
          await this.getPage();
        } catch (err) {
          console.error("[Brain] Failed to initialize page:", err.message);
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
    if (session.deepseek_id) {
      try {
        const page = await this.getPage();
        if (!page.url().includes(session.deepseek_id)) {
          page.goto(`https://chat.deepseek.com/a/chat/s/${session.deepseek_id}`).catch(() => {});
          await this.setupInterceptors(page);
        }
      } catch (err) {}
    }
  }

  async onSessionSync(session, prompt) {
    if (!session) return;
    try {
      const page = await this.getPage();
      if (!session.deepseek_id) {
        const m = page.url().match(/\/a\/chat\/s\/([a-zA-Z0-9_-]+)/);
        if (m) {
          const { updateSessionDeepseekId } = require("../history");
          updateSessionDeepseekId(session.id, m[1]);
        }
      }
    } catch (err) {}
  }

  launchBrowser() {
    try {
      execSync('pgrep -f "remote-debugging-port=9222"', { stdio: "ignore" });
    } catch {
      execSync(
        'chromium --headless=true --remote-debugging-port=9222 --user-data-dir="$HOME/scraper-profile" &',
        { shell: true, stdio: "ignore" }
      );
    }
  }

  async waitForCDP(port = 9222, timeout = 10000) {
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
      const browser = await chromium.connectOverCDP("http://localhost:9222");
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
      await page.exposeFunction("_onNetworkChunk", (text) => this.processNetworkChunk(text));
      await page.exposeFunction("_onStreamEnd", () => {
        this._streamDone = true;
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

  processNetworkChunk(text) {
    this._streamBuffer += text;
    const lines = this._streamBuffer.split("\n");
    this._streamBuffer = lines.pop();

    for (let line of lines) {
      line = line.trim();
      if (!line) continue;

      let jsonStr = line;
      if (line.startsWith("data:")) {
        jsonStr = line.substring(5).trim();
      }
      if (!jsonStr || jsonStr === "[DONE]") {
        if (jsonStr === "[DONE]") this._streamDone = true;
        continue;
      }

      let json;
      try {
        json = JSON.parse(jsonStr);
      } catch {
        try {
          json = JSON.parse(line);
        } catch {
          continue;
        }
      }

      if (
        json === "[DONE]" ||
        (json.p === "response/status" && json.v === "FINISHED") ||
        (json.p === "response" && json.v?.quasi_status === "FINISHED") ||
        json.v?.[0]?.quasi_status === "FINISHED" ||
        json.quasi_status === "FINISHED" ||
        json.status === "FINISHED"
      ) {
        this._streamDone = true;
        continue;
      }

      const fragments = json.v?.response?.fragments || (Array.isArray(json.v) ? json.v : []);
      for (const frag of fragments) {
        if (frag.type === "THINK") this._isThinking = true;
        if (frag.type === "RESPONSE") this._isThinking = false;
        if (typeof frag.content === "string" && frag.content) {
          (this._isThinking ? this._thinkingChunks : this._responseChunks).push(frag.content);
        }
      }

      if (typeof json.v === "string" && json.p !== "response/status") {
        (this._isThinking ? this._thinkingChunks : this._responseChunks).push(json.v);
      }
    }
  }

  async submitPrompt(page, prompt) {
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
      } catch {}
    }
    if (!sent) {
      await textarea.focus();
      await textarea.press("Enter");
    }
  }

  async getCompletionStream(prompt, { onStartCalled, onProgress }) {
    const page = await this.getPage();

    // Reset state
    this._streamDone = false;
    this._thinkingChunks = [];
    this._responseChunks = [];
    this._isThinking = false;
    this._streamBuffer = "";
    this._thinkingStartTime = null;
    this._thinkingEndTime = null;

    await this.setupInterceptors(page);
    await this.submitPrompt(page, prompt);

    const CHUNK_TIMEOUT = 86400000;
    const chunkStart = Date.now();
    while (!this._thinkingChunks.length && !this._responseChunks.length && !this._streamDone) {
      if (Date.now() - chunkStart > CHUNK_TIMEOUT) {
        try {
          page.reload().catch(() => {});
          this._streamDone = false;
          this._thinkingChunks = [];
          this._responseChunks = [];
          this._isThinking = false;
          this._streamBuffer = "";
          await this.submitPrompt(page, prompt);
          await new Promise((r) => setTimeout(r, 2000));
          if (!this._thinkingChunks.length && !this._responseChunks.length && !this._streamDone)
            throw new Error("DeepSeek failed to stream after retry — may be rate-limited.");
        } catch (e) {
          throw new Error(`No stream data and recovery failed: ${e.message}`);
        }
        break;
      }
      await new Promise((r) => setTimeout(r, 50));
    }

    const IDLE_TIMEOUT_MS = 12000000;
    let lastDataTime = Date.now();
    let firstChunkSeen = false;

    const checkDone = () => {
      if (this._streamDone) return true;
      if (
        (this._thinkingChunks.length || this._responseChunks.length) &&
        Date.now() - lastDataTime > IDLE_TIMEOUT_MS
      ) {
        this._streamDone = true;
        return true;
      }
      return false;
    };

    while (!this._streamDone && !checkDone()) {
      await new Promise((r) => setTimeout(r, 100));
      const thinkSoFar = this._thinkingChunks.join("");
      const respSoFar = this._responseChunks.join("");

      if (!firstChunkSeen && (thinkSoFar || respSoFar)) {
        firstChunkSeen = true;
        if (onStartCalled) onStartCalled();
      }

      if (firstChunkSeen) {
        if (!this._thinkingStartTime && thinkSoFar) {
          this._thinkingStartTime = Date.now();
        }
        if (onProgress) {
          onProgress({
            thinking: thinkSoFar,
            text: respSoFar,
            thinkingStartTime: this._thinkingStartTime,
            thinkingEndTime: this._thinkingEndTime,
          });
        }
        lastDataTime = Date.now();
      }
    }

    if (this._streamBuffer.trim()) this.processNetworkChunk("\n");
    const thinkSoFar = this._thinkingChunks.join("");
    const respSoFar = this._responseChunks.join("");
    if (thinkSoFar && this._thinkingStartTime) this._thinkingEndTime = Date.now();

    if (onProgress) {
      onProgress({
        thinking: thinkSoFar,
        text: respSoFar,
        thinkingStartTime: this._thinkingStartTime,
        thinkingEndTime: this._thinkingEndTime,
      });
    }

    return { thinkingText: thinkSoFar, responseText: respSoFar };
  }
}

module.exports = DeepSeekWebBrain;
