// @ts-nocheck
const BaseBrain = require("./base");
const { chromium } = require("playwright");
const { execSync } = require("child_process");
const http = require("http");

async function gotoWithWait(page, url) {
  try {
    await page.goto(url, { waitUntil: "domcontentloaded" });
  } catch (err) {}
  try {
    await page.waitForSelector('textarea, div[contenteditable="true"]', { timeout: 5000 });
  } catch (err) {}
}

class GLMWebBrain extends BaseBrain {
  constructor() {
    super();
    this.page = null;
    this.initializing = null;
    this.exposedPages = new WeakSet();
    this.initPromise = null;
    this.browser = null;
    this.context = null;
    this.connectingPromise = null;
    this.launchingBrowser = false;

    this.pageStates = new WeakMap();
  }

  static get id() {
    return "glm-web";
  }

  static get name() {
    return "GLM 5.2 Web Automator (Z.ai)";
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

  async getBrowserConnection() {
    if (this.browser) {
      try {
        await this.browser.contexts()[0].pages();
        return this.browser;
      } catch (err) {
        this.browser = null;
        this.context = null;
      }
    }
    if (this.connectingPromise) return this.connectingPromise;
    this.connectingPromise = (async () => {
      await this.waitForCDP();
      const browser = await chromium.connectOverCDP("http://127.0.0.1:9222");
      this.browser = browser;
      this.context = browser.contexts()[0];

      this.browser.on("disconnected", () => {
        this.browser = null;
        this.context = null;
        this.connectingPromise = null;
      });

      this.connectingPromise = null;
      return browser;
    })();
    return this.connectingPromise;
  }

  async createNewPage() {
    await this.getBrowserConnection();
    const page = await this.context.newPage();
    await this.setupInterceptors(page);
    await gotoWithWait(page, "https://chat.z.ai/");
    return page;
  }

  init() {
    if (!this.initPromise) {
      this.initPromise = (async () => {
        this.launchBrowser();
        try {
          await this.getPage();
        } catch (err) {
          require("fs").appendFileSync(
            "/tmp/deepseek-cli-debug.log",
            `[GLM Brain] Failed to initialize page: ${err.stack || err.message}\n`
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
        await this.page.context().browser().close().catch(() => { });
      } catch (err) { }
    }
    try {
      execSync('pkill -f "remote-debugging-port=9222"', { stdio: "ignore" });
    } catch (err) { }
  }

  async onSessionLoad(session) {
    try {
      const page = await this.getPage();
      const currentUrl = page.url();
      require("fs").appendFileSync(
        "/tmp/deepseek-cli-debug.log",
        `[GLM Brain] onSessionLoad called: session=${JSON.stringify(session)}, currentUrl=${currentUrl}\n`
      );
      if (session && session.deepseek_id) {
        if (!currentUrl.includes(session.deepseek_id)) {
          await gotoWithWait(page, `https://chat.z.ai/c/${session.deepseek_id}`);
          await this.setupInterceptors(page);
        }
      } else {
        if (!currentUrl.includes("chat.z.ai") || currentUrl.includes("/c/")) {
          await gotoWithWait(page, "https://chat.z.ai/");
          await this.setupInterceptors(page);
        }
      }
    } catch (err) {
      require("fs").appendFileSync(
        "/tmp/deepseek-cli-debug.log",
        `[GLM Brain] onSessionLoad error: ${err.stack || err.message}\n`
      );
    }
  }

  async onSessionSync(session, prompt) {
    if (!session) return;
    try {
      const page = await this.getPage();
      if (!session.deepseek_id) {
        const m = page.url().match(/\/c\/([a-zA-Z0-9_-]+)/);
        if (m) {
          // Store the chat ID back to the session if we have an updater
          try {
            const { updateSessionDeepseekId } = require("../../core/history");
            updateSessionDeepseekId(session.id, m[1]);
          } catch (e) { }
        }
      }
    } catch (err) { }
  }

  launchBrowser() {
    if (this.launchingBrowser) return;
    this.launchingBrowser = true;

    try {
      const { execSync } = require("child_process");
      if (process.platform === "win32") {
        execSync('taskkill /F /IM chrome.exe /FI "WINDOWTITLE eq remote-debugging-port=9222*"', { stdio: "ignore" });
      } else {
        execSync('pkill -f "remote-debugging-port=9222"', { stdio: "ignore" });
      }
    } catch (err) { }

    const { spawn } = require("child_process");
    const path = require("path");
    const os = require("os");

    let userAgent = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/148.0.0.0 Safari/537.36";
    if (os.platform() === "darwin") {
      userAgent = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/148.0.0.0 Safari/537.36";
    } else if (os.platform() === "win32") {
      userAgent = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/148.0.0.0 Safari/537.36";
    }

    const profilePath = path.join(os.homedir(), ".ds_config", "scraper-profile");

    const config = require("../../utils/config").loadConfig();
    const spawnArgs = [
      "--remote-debugging-port=9222",
      `--user-data-dir=${profilePath}`,
      `--user-agent=${userAgent}`,
    ];

    if (config.headless) {
      spawnArgs.push("--headless=new");
    }

    const child = spawn("chromium", spawnArgs, {
      detached: true,
      stdio: "ignore",
    });
    child.unref();

    setTimeout(() => {
      this.launchingBrowser = false;
    }, 3000);
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
      await this.getBrowserConnection();
      let page = this.context.pages().find((p) => p.url().includes("chat.z.ai"));
      if (!page) {
        page = await this.context.newPage();
        await this.setupInterceptors(page);
        await gotoWithWait(page, "https://chat.z.ai/");
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
      await page.exposeFunction("_glmOnNetworkChunk", (text) => this.processNetworkChunk(page, text));
      await page.exposeFunction("_glmOnStreamEnd", () => {
        const state = this.getOrCreatePageState(page);
        state.streamDone = true;
      });

      const installFn = () => {
        if (window.__glmInterceptorsInstalled) return;
        window.__glmInterceptorsInstalled = true;

        const origFetch = window.fetch;
        window.fetch = async function (...args) {
          const url = args[0] instanceof Request ? args[0].url : String(args[0]);
          const response = await origFetch.apply(this, args);
          if (url.includes("/api/v2/chat/completions")) {
            const clone = response.clone();
            (async () => {
              const reader = clone.body.getReader();
              const decoder = new TextDecoder();
              while (true) {
                const { done, value } = await reader.read();
                if (done) {
                  window._glmOnStreamEnd();
                  break;
                }
                window._glmOnNetworkChunk(decoder.decode(value, { stream: true }));
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
            if (xhr.readyState > 2 && xhr.responseURL?.includes("/api/v2/chat/completions")) {
              const text = xhr.responseText || "";
              if (text.length > lastLen) {
                window._glmOnNetworkChunk(text.substring(lastLen));
                lastLen = text.length;
              }
              if (xhr.readyState === 4) window._glmOnStreamEnd();
            }
          });
          return xhr;
        };
        Object.assign(window.XMLHttpRequest, OrigXHR);
      };

      await page.addInitScript(installFn);
      try {
        await page.evaluate(installFn);
      } catch (err) { }
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

      // Z.ai format: {"type":"chat:completion","data":{"delta_content":"...","phase":"thinking|answer|other|done"}}
      const data = json.type === "chat:completion" ? json.data : json;
      if (!data) continue;

      // Check for done signal
      if (data.done === true && !data.delta_content) {
        // Check for CAPTCHA error
        if (data.error && data.error.code === "FRONTEND_CAPTCHA_REQUIRED") {
          require("fs").appendFileSync(
            "/tmp/deepseek-cli-debug.log",
            `[GLM Brain] CAPTCHA error: ${JSON.stringify(data.error)}\n`
          );
        }
        state.streamDone = true;
        continue;
      }

      if (data.phase === "thinking" && data.delta_content) {
        if (!state.isThinking) {
          state.isThinking = true;
          state.thinkingStartTime = state.thinkingStartTime || Date.now();
        }
        state.thinkingChunks.push(data.delta_content);
      }

      if (data.phase === "answer" && data.delta_content) {
        if (state.isThinking) {
          state.isThinking = false;
          state.thinkingEndTime = Date.now();
        }
        state.responseChunks.push(data.delta_content);
      }

      if (data.phase === "done") {
        state.streamDone = true;
      }
    }
  }

  async submitPrompt(page, prompt, options = {}) {
    // Bring tab to front
    try { await page.bringToFront(); } catch (e) { }
    await new Promise((r) => setTimeout(r, 200));

    // Z.ai uses a contenteditable div or textarea — try both
    const inputSelectors = [
      'textarea',
      'div[contenteditable="true"]',
      '[data-testid="chat-input"]',
      '#chat-input',
    ];

    let inputEl = null;
    const maxRetries = 3;
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      for (const sel of inputSelectors) {
        try {
          const el = page.locator(sel).first();
          if (await el.isVisible({ timeout: 2000 })) {
            inputEl = el;
            break;
          }
        } catch { }
      }
      if (inputEl) break;
      if (attempt < maxRetries) {
        // Wait 1.5 seconds and bring to front before retrying
        await new Promise((r) => setTimeout(r, 1500));
        try { await page.bringToFront(); } catch (e) { }
      }
    }

    if (!inputEl) {
      throw new Error("Could not find chat input on Z.ai");
    }

    await inputEl.click();
    await new Promise((r) => setTimeout(r, 100));

    // Clear existing content and type the prompt
    const tagName = await inputEl.evaluate((el) => el.tagName.toLowerCase());
    if (tagName === "textarea") {
      await inputEl.fill(prompt);
    } else {
      // contenteditable div
      await inputEl.evaluate((el) => { el.textContent = ""; });
      await inputEl.type(prompt, { delay: 5 });
    }

    await new Promise((r) => setTimeout(r, 200));

    // Click send button
    const sendSelectors = [
      'button[data-testid="send-button"]',
      'button[aria-label="Send"]',
      'button[aria-label="Send Message"]',
      'button[type="submit"]',
      'button:has(svg)',
    ];

    let sent = false;
    for (const sel of sendSelectors) {
      try {
        const btns = page.locator(sel);
        const count = await btns.count();
        // Try the last matching button (usually the send button at bottom)
        for (let i = count - 1; i >= 0; i--) {
          const btn = btns.nth(i);
          if (await btn.isVisible({ timeout: 500 })) {
            // Check if button is not disabled
            const isDisabled = await btn.evaluate((el) =>
              el.disabled || el.getAttribute("aria-disabled") === "true"
            ).catch(() => false);

            // Exclude toggle/setting/attachment buttons that might match button:has(svg)
            const isToggleOrSetting = await btn.evaluate((el) => {
              const label = (el.getAttribute("aria-label") || "").toLowerCase();
              const title = (el.getAttribute("title") || "").toLowerCase();
              const text = (el.textContent || "").toLowerCase();
              const role = (el.getAttribute("role") || "").toLowerCase();
              
              // Check roles and state attributes commonly used for toggles
              const isSwitch = role === "switch" || role === "checkbox" || role === "radio";
              const hasCheckedAttr = el.hasAttribute("aria-checked") || el.hasAttribute("aria-pressed") || el.hasAttribute("aria-selected");
              
              // Keywords in English and Chinese
              const keywords = [
                "search", "thinking", "reasoning", "reason", "model", "attach", "image", "file", 
                "upload", "clear", "setting", "history", "sidebar", "clean", "delete", "close",
                "思考", "思维", "搜索", "联网", "上传", "文件", "图片", "附件", "添加", "清除", 
                "清空", "设置", "历史", "侧边栏", "删除", "关闭", "清理"
              ];
              const hasKeyword = keywords.some(k => label.includes(k) || title.includes(k) || text.includes(k));
              
              // Class name checks
              const className = el.className && typeof el.className === "string" ? el.className.toLowerCase() : "";
              const hasToggleClass = className.includes("toggle") || className.includes("switch") || className.includes("checkbox");
              
              return isSwitch || hasCheckedAttr || hasKeyword || hasToggleClass;
            }).catch(() => false);

            if (!isDisabled && !isToggleOrSetting) {
              await btn.click();
              sent = true;
              break;
            }
          }
        }
        if (sent) break;
      } catch { }
    }

    if (!sent) {
      // Fallback: press Enter
      await inputEl.focus();
      await inputEl.press("Enter");
    }
  }

  async getCompletionStream(prompt, options = {}) {
    const activePage = options.page || (await this.getPage());
    const { onStartCalled, onProgress } = options;
    let attempt = 0;
    const maxAttempts = 5;

    // Bring to front
    try { await activePage.bringToFront(); } catch (e) { }
    await new Promise((r) => setTimeout(r, 300));

    // Verify page is alive
    try { await activePage.evaluate("1"); } catch (e) {
      require("fs").appendFileSync(
        "/tmp/deepseek-cli-debug.log",
        `[GLM Brain] getCompletionStream: page appears dead, reloading...\n`
      );
      await activePage.reload().catch(() => { });
      await new Promise((r) => setTimeout(r, 2000));
    }

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

      // Bring to front again before submit
      try { await activePage.bringToFront(); } catch (e) { }
      await new Promise((r) => setTimeout(r, 150));

      try {
        await this.submitPrompt(activePage, prompt, options);
      } catch (err: any) {
        require("fs").appendFileSync(
          "/tmp/deepseek-cli-debug.log",
          `[GLM Brain] Attempt ${attempt} failed during submitPrompt: ${err.message}. Reloading and retrying...\n`
        );
        await activePage.reload().catch(() => { });
        await new Promise((r) => setTimeout(r, 2000));
        continue;
      }

      // Wait for first chunk (no timeout, wait indefinitely)
      let firstChunkSeen = false;

      while (!state.thinkingChunks.length && !state.responseChunks.length && !state.streamDone) {
        await new Promise((r) => setTimeout(r, 50));
      }

      const IDLE_TIMEOUT_MS = 12000000; // 3.3 hours (same as DeepSeek)
      let lastDataTime = Date.now();
      let lastLen = 0;

      const checkDone = () => {
        if (state.streamDone) return true;
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

      // Flush remaining buffer
      if (state.streamBuffer.trim()) this.processNetworkChunk(activePage, "\n");
      const thinkSoFar = state.thinkingChunks.join("");
      const respSoFar = state.responseChunks.join("");
      if (thinkSoFar && state.thinkingStartTime) state.thinkingEndTime = Date.now();

      if (!thinkSoFar.trim() && !respSoFar.trim()) {
        require("fs").appendFileSync(
          "/tmp/deepseek-cli-debug.log",
          `[GLM Brain] Attempt ${attempt} returned completely empty response. Reloading and retrying...\n`
        );
        await activePage.reload().catch(() => { });
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

    throw new Error("GLM (Z.ai) failed to complete generation after multiple attempts.");
  }

  async createNewChat() {
    const page = await this.getPage();
    require("fs").appendFileSync(
      "/tmp/deepseek-cli-debug.log",
      `[GLM Brain] createNewChat called, current URL: ${page.url()}\n`
    );
    await gotoWithWait(page, "https://chat.z.ai/");
    await this.setupInterceptors(page);
    await new Promise((r) => setTimeout(r, 500));
    return true;
  }
}

module.exports = GLMWebBrain;
