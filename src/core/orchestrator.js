const { tools, getSystemPrompt, normalizeToolCall } = require("../tools");
const mcpLoader = require("../mcp/mcp_loader");
const tui = require("../tui/tui");
const brainRegistry = require("./brains/registry");
const { loadConfig } = require("../utils/config");
const path = require("path");
const fs = require("fs");
const {
  getCurrentSessionId,
  createSession,
  setCurrentSessionId,
  saveMessage,
  getSessions,
  updateSessionTitle,
} = require("./history");

let busy = false;

// ── JSON extraction ───────────────────────────────────────────────────────────
function isValidToolCall(normalized) {
  if (!normalized || typeof normalized !== "object") return false;
  if (normalized._isMulti && Array.isArray(normalized.calls) && normalized.calls.length > 0) {
    return true;
  }
  if (normalized.tool && typeof normalized.tool === "string") {
    return true;
  }
  return false;
}

// Enhanced JSON extraction with markdown code block support and error recovery
function extractJSON(text) {
  if (!text) return null;

  const parsedObjects = [];
  
  // First, try to extract JSON from markdown code blocks
  const codeBlockRegex = /```(?:json)?\s*([\s\S]*?)```/g;
  let match;
  while ((match = codeBlockRegex.exec(text)) !== null) {
    const blockContent = match[1].trim();
    try {
      const parsed = JSON.parse(blockContent);
      if (parsed && typeof parsed === 'object') {
        parsedObjects.push(parsed);
      }
    } catch (err) {
      // Not valid JSON, continue
    }
  }

  // If no code blocks, do standard extraction
  if (parsedObjects.length === 0) {
    let i = 0;
    while (i < text.length) {
      const startIdx = text.indexOf('{', i);
      if (startIdx === -1) break;

      let depth = 0;
      let endIdx = -1;
      let inString = false;
      let escape = false;

      for (let j = startIdx; j < text.length; j++) {
        const char = text[j];

        if (escape) {
          escape = false;
          continue;
        }

        if (char === '\\') {
          escape = true;
          continue;
        }

        if (char === '"') {
          inString = !inString;
          continue;
        }

        if (!inString) {
          if (char === '{') {
            depth++;
          } else if (char === '}') {
            depth--;
            if (depth === 0) {
              endIdx = j;
              break;
            }
          }
        }
      }

      if (endIdx !== -1) {
        const candidate = text.substring(startIdx, endIdx + 1);
        try {
          const parsed = JSON.parse(candidate);
          if (parsed && typeof parsed === 'object') {
            parsedObjects.push(parsed);
            i = endIdx + 1;
            continue;
          }
        } catch (err) {
          // Try to repair common issues: trailing commas, unquoted keys
          try {
            const repaired = candidate
              .replace(/,\s*}/g, '}')
              .replace(/,\s*]/g, ']')
              .replace(/([{,]\s*)([a-zA-Z0-9_]+)(\s*:)/g, '$1"$2"$3');
            const parsed = JSON.parse(repaired);
            if (parsed && typeof parsed === 'object') {
              parsedObjects.push(parsed);
              i = endIdx + 1;
              continue;
            }
          } catch (e) {}
        }
      }
      i = startIdx + 1;
    }
  }

  const validToolCalls = [];
  let finalResponse = null;

  for (const obj of parsedObjects) {
    const normalized = normalizeToolCall(obj);
    if (isValidToolCall(normalized)) {
      if (normalized._isMulti) {
        validToolCalls.push(...normalized.calls);
      } else {
        validToolCalls.push(normalized);
      }
    } else if (normalized && normalized.response !== undefined) {
      finalResponse = normalized;
    }
  }

  if (validToolCalls.length > 0) {
    if (validToolCalls.length === 1) {
      return validToolCalls[0];
    } else {
      return { _isMulti: true, calls: validToolCalls };
    }
  }

  if (finalResponse) {
    return finalResponse;
  }

  // Last resort: if text contains a valid JSON-like structure but we missed it, try to find first { and last }
  const firstBrace = text.indexOf('{');
  const lastBrace = text.lastIndexOf('}');
  if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
    const candidate = text.substring(firstBrace, lastBrace + 1);
    try {
      const parsed = JSON.parse(candidate);
      if (parsed && typeof parsed === 'object') {
        const normalized = normalizeToolCall(parsed);
        if (isValidToolCall(normalized)) {
          return normalized;
        }
        if (normalized && normalized.response !== undefined) {
          return normalized;
        }
      }
    } catch (err) {}
  }

  return null;
}

function safeTruncate(text) {
  const config = loadConfig();
  const maxLength = config.max_tool_output_length ?? 4000;
  const s = String(text ?? "");
  if (s.length <= maxLength) return s;
  return s.slice(0, maxLength) + `\n\n[truncated: ${s.length - maxLength} chars omitted]`;
}

function verifyImportsAndExports(filePath) {
  if (!fs.existsSync(filePath)) return null;
  const ext = path.extname(filePath).toLowerCase();
  if (![".js", ".jsx", ".ts", ".tsx", ".mjs", ".cjs"].includes(ext)) return null;

  const content = fs.readFileSync(filePath, "utf8");
  const dirname = path.dirname(filePath);

  function resolveRelativePath(importPath) {
    if (!importPath.startsWith('.') && !importPath.startsWith('/')) return null;
    let fullPath = path.resolve(dirname, importPath);
    const extensions = [".js", ".ts", ".jsx", ".tsx", ".mjs", ".cjs"];
    if (fs.existsSync(fullPath) && fs.statSync(fullPath).isFile()) {
      return fullPath;
    }
    for (const ext of extensions) {
      if (fs.existsSync(fullPath + ext)) return fullPath + ext;
    }
    for (const ext of extensions) {
      const indexPath = path.join(fullPath, "index" + ext);
      if (fs.existsSync(indexPath)) return indexPath;
    }
    return null;
  }

  function getExports(targetPath) {
    if (!fs.existsSync(targetPath)) return new Set();
    const targetContent = fs.readFileSync(targetPath, "utf8");
    const exports = new Set();

    const cjsBlockMatch = targetContent.match(/module\.exports\s*=\s*\{([^}]+)\}/);
    if (cjsBlockMatch) {
      const items = cjsBlockMatch[1].split(",");
      for (let item of items) {
        item = item.trim();
        const parts = item.split(":");
        const name = parts[0].trim();
        if (name && !name.includes("\n")) {
          exports.add(name.replace(/['"]/g, ""));
        }
      }
    }
    const cjsAssignRegex = /(?:module\.)?exports\.([a-zA-Z0-9_]+)\s*=/g;
    let match;
    while ((match = cjsAssignRegex.exec(targetContent)) !== null) {
      exports.add(match[1]);
    }

    const esmRegex = /export\s+(?:const|let|var|function|class|interface|type)\s+([a-zA-Z0-9_]+)/g;
    while ((match = esmRegex.exec(targetContent)) !== null) {
      exports.add(match[1]);
    }
    const esmBlockRegex = /export\s*\{([^}]+)\}/g;
    while ((match = esmBlockRegex.exec(targetContent)) !== null) {
      const items = match[1].split(",");
      for (let item of items) {
        item = item.trim();
        const parts = item.split(/\s+as\s+/);
        const name = (parts[1] || parts[0]).trim();
        if (name) exports.add(name);
      }
    }

    return exports;
  }

  const esmImportRegex = /import\s*\{([^}]+)\}\s*from\s*['"]([^'"]+)['"]/g;
  let match;
  while ((match = esmImportRegex.exec(content)) !== null) {
    const importPath = match[2];
    const resolved = resolveRelativePath(importPath);
    if (resolved) {
      const targetExports = getExports(resolved);
      const importedNames = match[1].split(",").map(n => n.trim().split(/\s+as\s+/)[0].trim());
      for (const name of importedNames) {
        if (name && !targetExports.has(name)) {
          return {
            success: false,
            error: `Linker Check Failed: '${name}' is imported in '${path.basename(filePath)}' from '${importPath}', but '${path.basename(resolved)}' does not export it.`
          };
        }
      }
    }
  }

  const cjsImportRegex = /(?:const|let|var)\s*\{([^}]+)\}\s*=\s*require\s*\(\s*['"]([^'"]+)['"]\s*\)/g;
  while ((match = cjsImportRegex.exec(content)) !== null) {
    const importPath = match[2];
    const resolved = resolveRelativePath(importPath);
    if (resolved) {
      const targetExports = getExports(resolved);
      const importedNames = match[1].split(",").map(n => {
        const parts = n.trim().split(":");
        return (parts[1] || parts[0]).trim();
      });
      for (const name of importedNames) {
        if (name && !name.includes("\n") && !targetExports.has(name)) {
          return {
            success: false,
            error: `Linker Check Failed: '${name}' is required in '${path.basename(filePath)}' from '${importPath}', but '${path.basename(resolved)}' does not export it.`
          };
        }
      }
    }
  }

  return { success: true };
}

async function runAutomaticVerification(modifiedFiles) {
  const { execSync } = require('child_process');
  const cwd = process.cwd();
  const config = loadConfig();

  // 1. Check JS/TS Imports and Exports for mismatches
  for (const file of modifiedFiles) {
    const res = verifyImportsAndExports(file);
    if (res && !res.success) {
      return res;
    }
  }

  // 1. User custom verification commands from config.json
  if (config.verification_commands && Array.isArray(config.verification_commands)) {
    for (const cmd of config.verification_commands) {
      if (!cmd) continue;
      try {
        execSync(cmd, { stdio: "pipe", cwd });
      } catch (err) {
        const output = (err.stdout ? err.stdout.toString() : "") + "\n" + (err.stderr ? err.stderr.toString() : "");
        return {
          success: false,
          error: `Custom verification command '${cmd}' failed:\n${output || err.message}`
        };
      }
    }
  }

  // 2. Syntax check modified files
  for (const file of modifiedFiles) {
    if (!fs.existsSync(file)) continue;
    const ext = path.extname(file).toLowerCase();
    try {
      if (ext === ".js" || ext === ".cjs" || ext === ".mjs") {
        execSync(`node --check "${file}"`, { stdio: "pipe" });
      } else if (ext === ".py") {
        execSync(`python3 -m py_compile "${file}"`, { stdio: "pipe" });
      } else if (ext === ".go") {
        execSync(`go vet "${file}"`, { stdio: "pipe" });
      } else if (ext === ".ts" || ext === ".tsx") {
        let tscPath = "tsc";
        if (fs.existsSync("./node_modules/.bin/tsc")) tscPath = "./node_modules/.bin/tsc";
        execSync(`${tscPath} --noEmit "${file}"`, { stdio: "pipe" });
      }
    } catch (err) {
      const output = err.stderr ? err.stderr.toString() : err.message;
      return {
        success: false,
        error: `Syntax check failed for ${path.basename(file)}:\n${output}`
      };
    }
  }

  // 3. Project-wide TypeScript compile (tsconfig.json detection)
  if (fs.existsSync(path.join(cwd, "tsconfig.json"))) {
    try {
      let tscPath = "tsc";
      if (fs.existsSync(path.join(cwd, "node_modules", ".bin", "tsc"))) {
        tscPath = path.join(cwd, "node_modules", ".bin", "tsc");
      }
      execSync(`${tscPath} --noEmit`, { stdio: "pipe", cwd });
    } catch (err) {
      const output = (err.stdout ? err.stdout.toString() : "") + "\n" + (err.stderr ? err.stderr.toString() : "");
      return {
        success: false,
        error: `Project-wide TypeScript compilation check failed:\n${output}`
      };
    }
  }

  // 4. Auto-detect and run lint, typecheck, build scripts from package.json
  if (fs.existsSync(path.join(cwd, "package.json"))) {
    try {
      const pkg = JSON.parse(fs.readFileSync(path.join(cwd, "package.json"), "utf8"));
      if (pkg.scripts) {
        // Run in this specific order: typecheck, lint, build
        const autoScripts = ["typecheck", "lint", "build"];
        for (const scriptName of autoScripts) {
          if (pkg.scripts[scriptName]) {
            let cmd = `npm run ${scriptName}`;
            if (fs.existsSync(path.join(cwd, "pnpm-lock.yaml"))) cmd = `pnpm run ${scriptName}`;
            else if (fs.existsSync(path.join(cwd, "yarn.lock"))) cmd = `yarn run ${scriptName}`;
            
            try {
              execSync(cmd, { stdio: "pipe", cwd });
            } catch (err) {
              const output = (err.stdout ? err.stdout.toString() : "") + "\n" + (err.stderr ? err.stderr.toString() : "");
              return {
                success: false,
                error: `Auto-detected script 'npm run ${scriptName}' failed:\n${output}`
              };
            }
          }
        }
      }
    } catch (e) {}
  }

  // 5. Run project tests
  // Node.js
  if (fs.existsSync(path.join(cwd, "package.json"))) {
    try {
      const pkg = JSON.parse(fs.readFileSync(path.join(cwd, "package.json"), "utf8"));
      if (pkg.scripts && pkg.scripts.test && !pkg.scripts.test.includes("no test specified")) {
        let cmd = "npm test";
        if (fs.existsSync(path.join(cwd, "pnpm-lock.yaml"))) cmd = "pnpm test";
        else if (fs.existsSync(path.join(cwd, "yarn.lock"))) cmd = "yarn test";
        
        const output = execSync(cmd, { stdio: "pipe", cwd });
        return { success: true, message: `All verification checks and tests passed.` };
      }
    } catch (err) {
      const output = (err.stdout ? err.stdout.toString() : "") + "\n" + (err.stderr ? err.stderr.toString() : "");
      return {
        success: false,
        error: `Test suite execution failed (npm test):\n${output}`
      };
    }
  }

  // Go
  if (fs.existsSync(path.join(cwd, "go.mod"))) {
    try {
      execSync("go test ./...", { stdio: "pipe", cwd });
      return { success: true, message: "All verification checks and tests passed." };
    } catch (err) {
      const output = (err.stdout ? err.stdout.toString() : "") + "\n" + (err.stderr ? err.stderr.toString() : "");
      return {
        success: false,
        error: `Test suite execution failed (go test):\n${output}`
      };
    }
  }

  // Rust
  if (fs.existsSync(path.join(cwd, "Cargo.toml"))) {
    try {
      execSync("cargo test", { stdio: "pipe", cwd });
      return { success: true, message: "All verification checks and tests passed." };
    } catch (err) {
      const output = (err.stdout ? err.stdout.toString() : "") + "\n" + (err.stderr ? err.stderr.toString() : "");
      return {
        success: false,
        error: `Test suite execution failed (cargo test):\n${output}`
      };
    }
  }

  // Python
  if (fs.existsSync(path.join(cwd, "pytest.ini")) || fs.existsSync(path.join(cwd, "conftest.py")) || fs.existsSync(path.join(cwd, "tests"))) {
    let pytestAvailable = false;
    try {
      execSync("pytest --version", { stdio: "ignore" });
      pytestAvailable = true;
    } catch (e) {}

    if (pytestAvailable) {
      try {
        execSync("pytest", { stdio: "pipe", cwd });
        return { success: true, message: "All verification checks and tests passed." };
      } catch (err) {
        const output = (err.stdout ? err.stdout.toString() : "") + "\n" + (err.stderr ? err.stderr.toString() : "");
        return {
          success: false,
          error: `Test suite execution failed (pytest):\n${output}`
        };
      }
    } else {
      try {
        execSync("python3 -m unittest discover", { stdio: "pipe", cwd });
        return { success: true, message: "All verification checks and tests passed." };
      } catch (err) {
        const output = (err.stdout ? err.stdout.toString() : "") + "\n" + (err.stderr ? err.stderr.toString() : "");
        return {
          success: false,
          error: `Test suite execution failed (unittest):\n${output}`
        };
      }
    }
  }

  return { success: true, message: "All verification checks passed." };
}

function isBusy() {
  return busy;
}

function setBusy(val) {
  busy = val;
}

async function ask(prompt) {
  busy = true;
  tui.setAutoScroll(true);
  const brain = brainRegistry.getActiveBrain();
  
  const modifiedFiles = new Set();
  let hasEditedFiles = false;
  let hasVerified = false;

  let sid = getCurrentSessionId();
  if (!sid) {
    const ns = createSession(prompt.slice(0, 40));
    sid = ns.id;
    setCurrentSessionId(sid);
    tui.setTopBarTitle(prompt.slice(0, 60));
  }

  const logItems = tui.getLogItems();

  // Clean up any initial boot status item before adding user message
  const bootIdx = logItems.findIndex((item) => item.type === "status");
  if (bootIdx !== -1) {
    logItems.splice(bootIdx, 1);
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
  tui.startGlobalSpinner();
  tui.renderLog();

  // Await background initializations if they are still running
  const mcpPromise = mcpLoader.init();
  const brainPromise = brain ? brain.init() : Promise.resolve();

  let isMcpDone = false;
  let isBrainDone = false;

  const checkMcp = mcpPromise.then(() => { isMcpDone = true; });
  const checkBrain = brainPromise.then(() => { isBrainDone = true; });

  await Promise.race([
    Promise.all([checkMcp, checkBrain]),
    new Promise((r) => setTimeout(r, 100))
  ]);

  if (!isMcpDone || !isBrainDone) {
    let text = "waiting for background initialization...";
    if (!isMcpDone && isBrainDone) text = "connecting to MCP servers...";
    else if (!isBrainDone && isMcpDone) text = "connecting to browser...";

    let askBootItem = { type: "status", text };
    
    // Prevent double spinners
    dsItem.spinning = false;
    
    const dsIdx = logItems.indexOf(dsItem);
    if (dsIdx !== -1) {
      logItems.splice(dsIdx, 0, askBootItem);
    } else {
      logItems.push(askBootItem);
    }
    tui.renderLog();

    await Promise.all([
      mcpPromise.catch((err) => {
        logItems.push({ type: "error", message: `MCP Init Error: ${err.message}` });
      }),
      brainPromise.catch((err) => {
        logItems.push({ type: "error", message: `Brain Init Error: ${err.message}` });
      })
    ]);

    const askBootIdx = logItems.indexOf(askBootItem);
    if (askBootIdx !== -1) {
      logItems.splice(askBootIdx, 1);
    }
    
    // Restore main spinner
    dsItem.spinning = true;
    tui.renderLog();
  }

  try {
    let currentPrompt = `[System Instructions]\n${getSystemPrompt(prompt)}\n\n[User Request]\n${prompt}`;



    let isInitial = true;

    while (busy) {
      if (!isInitial) {
        dsItem.spinning = true;
        tui.startGlobalSpinner();
        tui.renderLog();
      }

      const streamPromise = brain.getCompletionStream(currentPrompt, {
        onStartCalled: () => {
          dsItem.spinning = false;
          dsItem.expanded = true;
          tui.stopGlobalSpinner();
        },
        onProgress: ({ thinking, text, thinkingStartTime, thinkingEndTime }) => {
          dsItem.thinking = thinking;
          dsItem.text = text;
          dsItem._thinkingStartTime = thinkingStartTime;
          dsItem._thinkingEndTime = thinkingEndTime;
          tui.renderLog();
        },
      });

      const { thinkingText, responseText } = await streamPromise;
      dsItem.thinking = thinkingText;
      dsItem.text = responseText;
      dsItem.spinning = false;
      if (thinkingText) {
        dsItem._thinkingEndTime = Date.now();
        dsItem.expanded = false;
      }
      tui.stopGlobalSpinner();
      tui.renderLog();

      let parsed = null;
      if (responseText.includes("{")) {
        parsed = extractJSON(responseText);
      }
      if (!parsed && thinkingText && thinkingText.includes("{")) {
        parsed = extractJSON(thinkingText);
      }

      // FINAL ANSWER
      if (!parsed || parsed.response !== undefined) {
        if (hasEditedFiles && !hasVerified) {
          const verificationResult = await runAutomaticVerification(modifiedFiles);
          if (!verificationResult.success) {
            const interceptMsg = `[SYSTEM INTERCEPT - VERIFICATION FAILED]\n${verificationResult.error}\n\nYou modified code but verification failed. You MUST fix these errors before returning a final response.`;
            currentPrompt = interceptMsg;
            isInitial = false;
            dsItem = { type: "deepseek", text: "", spinning: true };
            logItems.push(dsItem);
            tui.renderLog();
            continue;
          } else {
            hasVerified = true;
            if (verificationResult.message) {
              const statusItem = { type: "status", text: verificationResult.message };
              logItems.push(statusItem);
              tui.renderLog();
              setTimeout(() => {
                const idx = logItems.indexOf(statusItem);
                if (idx !== -1) logItems.splice(idx, 1);
                tui.renderLog();
              }, 3000);
            }
          }
        }

        let finalText;
        if (parsed?.response !== undefined) {
          finalText = parsed.response;
          if (typeof finalText === "object" && finalText !== null)
            finalText = finalText.message || JSON.stringify(finalText, null, 2);
          finalText = String(finalText);
        } else {
          finalText = responseText;
        }

        // Prevent saving completely empty assistant messages (no content, no thinking)
        if ((!finalText || finalText.trim() === "") && (!thinkingText || thinkingText.trim() === "")) {
          const debugPath = "/tmp/deepseek-cli-debug.log";
          require("fs").appendFileSync(debugPath, `[Orchestrator] Empty assistant message detected - skipping save. responseText length: ${responseText.length}, thinkingText length: ${thinkingText.length}\n`);
          // Set placeholder to avoid breaking UI, but mark as error
          finalText = "[Empty response - possible parsing issue]";
        }

        dsItem.text = finalText;
        dsItem.thinking = thinkingText;
        dsItem.spinning = false;
        if (dsItem.thinking) dsItem.expanded = false;
        tui.renderLog();
        saveMessage(sid, "assistant", finalText, { thinking: thinkingText });
        syncSession(sid, prompt);
        break;
      }

      // TOOL CALL
      let textBeforeJson = responseText;
      const jsonStart = responseText.indexOf("{");
      if (jsonStart !== -1) {
        textBeforeJson = responseText.substring(0, jsonStart).trim();
      }
      // Remove trailing markdown code fences
      textBeforeJson = textBeforeJson
        .replace(/```json\s*$/i, "")
        .replace(/```\s*$/, "")
        .trim();
      dsItem.text = textBeforeJson;
      dsItem.thinking = thinkingText;
      dsItem.spinning = false;
      if (dsItem.thinking) {
        dsItem._thinkingEndTime = Date.now();
        dsItem.expanded = false;
      }
      tui.renderLog();
      syncSession(sid, prompt);

      if (parsed._isMulti) {
        const calls = parsed.calls;
        const MAX_PAR = 8;
        const batch = calls.slice(0, MAX_PAR);
        const toolItems = batch.map((c) => {
          const { tool: _, ...toolParams } = c;
          return {
            type: "tool",
            name: c.tool,
            params: toolParams,
            status: "executing",
            result: "",
            expanded: false,
          };
        });
        for (const t of toolItems) logItems.push(t);
        for (const c of batch) {
          saveMessage(sid, "tool_call", c.tool, { params: c });
          if (["write_file", "patch_multiple_files", "patch_file"].includes(c.tool)) {
            hasEditedFiles = true;
            hasVerified = false;
            if (c.tool === "write_file" || c.tool === "patch_file") {
              if (c.path) modifiedFiles.add(path.resolve(c.path));
            } else if (c.tool === "patch_multiple_files") {
              if (c.patches && Array.isArray(c.patches)) {
                for (const p of c.patches) {
                  if (p && p.path) modifiedFiles.add(path.resolve(p.path));
                }
              }
            }
          } else if (c.tool === "execute_shell_command") {
            hasVerified = true;
          }
        }
        tui.startGlobalSpinner();
        tui.renderLog();

        // Run each tool with a per-tool timeout (30 seconds)
        const TOOL_TIMEOUT_MS = 30000;
        const results = await Promise.all(
          batch.map(async (c) => {
            const timeoutPromise = new Promise((resolve) =>
              setTimeout(
                () =>
                  resolve(
                    `[Tool Timeout] ${c.tool} did not complete within ${
                      TOOL_TIMEOUT_MS / 1000
                    }s`
                  ),
                TOOL_TIMEOUT_MS
              )
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
              const isMcp = mcpLoader.getRegistry().some((x) => x.name === c.tool);
              if (isMcp) {
                try {
                  const res = await mcpLoader.callTool(c.tool, c);
                  return safeTruncate(String(res ?? ""));
                } catch (e) {
                  return safeTruncate(`MCP error: ${e.message}`);
                }
              }
              return `Error: tool '${c.tool}' not found.`;
            })();
            return Promise.race([executePromise, timeoutPromise]);
          })
        );

        results.forEach((res, i) => {
          toolItems[i].status = "completed";
          toolItems[i].result = res;
          saveMessage(sid, "tool_result", res, { tool: batch[i].tool });
        });
        tui.stopGlobalSpinner();
        tui.renderLog();

        const combined = results
          .map((r, i) => `[Tool Output for ${batch[i].tool}]\n${r}`)
          .join("\n\n");
        const overflow =
          calls.length > MAX_PAR
            ? `\n\nNote: ${
                calls.length - MAX_PAR
              } call(s) truncated — issue them next turn if needed.`
            : "";
        const FORMAT_REMINDER = `\n\n[Reminder: You MUST respond in English only. You can either invoke another tool using JSON, or output plain text to respond to the user if you are done.\n` +
          `JSON Format (Single):\n{"tool": "tool_name", "param1": "val"}\n` +
          `JSON Format (Parallel):\n{"tools": [{"name": "t1", "p1": "v1"}, {"name": "t2"}]}\n` +
          `CRITICAL: (1) NEVER use placeholder comments (e.g. "// ... rest of code"). Complete code only. (2) Review unified line diffs returned in tool outputs. (3) Verification checks (syntax/imports/tests) run automatically before completion. Ensure no errors are introduced.\n` +
          `LANGUAGE: English only. Never respond in Chinese or any other non-English language.]`;
        currentPrompt = `${combined}${overflow}${FORMAT_REMINDER}`;
        isInitial = false;
        dsItem = { type: "deepseek", text: "", spinning: true };
        logItems.push(dsItem);
        tui.renderLog();
      } else if (parsed.tool) {
        const toolName = parsed.tool;
        const { tool: _, ...toolParams } = parsed;
        const toolItem = {
          type: "tool",
          name: toolName,
          params: toolParams,
          status: "executing",
          result: "",
          expanded: false,
        };
        logItems.push(toolItem);
        saveMessage(sid, "tool_call", toolName, { params: toolParams });
        
        if (["write_file", "patch_multiple_files", "patch_file"].includes(toolName)) {
          hasEditedFiles = true;
          hasVerified = false;
          if (toolName === "write_file" || toolName === "patch_file") {
            if (toolParams && toolParams.path) {
              modifiedFiles.add(path.resolve(toolParams.path));
            }
          } else if (toolName === "patch_multiple_files") {
            if (toolParams && toolParams.patches && Array.isArray(toolParams.patches)) {
              for (const p of toolParams.patches) {
                if (p && p.path) {
                  modifiedFiles.add(path.resolve(p.path));
                }
              }
            }
          }
        } else if (toolName === "execute_shell_command") {
          hasVerified = true;
        }
        
        tui.startGlobalSpinner();
        tui.renderLog();

        let toolResult = "";
        const localTool = tools[toolName];
        if (localTool) {
          try {
            toolResult = await localTool.execute(toolParams);
          } catch (e) {
            toolResult = `[Tool Failed]\n${toolName}: ${e.message}\n\n(You MUST reply in valid JSON.)`;
          }
        } else {
          const isMcp = mcpLoader.getRegistry().some((x) => x.name === toolName);
          if (isMcp) {
            try {
              toolResult = await mcpLoader.callTool(toolName, toolParams);
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
        tui.stopGlobalSpinner();
        tui.renderLog();

        await new Promise((r) => setTimeout(r, 100));

        const FORMAT_REMINDER = `\n\n[Reminder: You MUST respond in English only. You can either invoke another tool using JSON, or output plain text to respond to the user if you are done.\n` +
          `JSON Format (Single):\n{"tool": "tool_name", "param1": "val"}\n` +
          `JSON Format (Parallel):\n{"tools": [{"name": "t1", "p1": "v1"}, {"name": "t2"}]}\n` +
          `CRITICAL: (1) NEVER use placeholder comments (e.g. "// ... rest of code"). Complete code only. (2) Review unified line diffs returned in tool outputs. (3) Verification checks (syntax/imports/tests) run automatically before completion. Ensure no errors are introduced.\n` +
          `LANGUAGE: English only. Never respond in Chinese or any other non-English language.]`;
        currentPrompt = `[Tool Output for ${toolName}]\n${toolResult}${FORMAT_REMINDER}`;
        isInitial = false;

        dsItem = { type: "deepseek", text: "", spinning: true };
        logItems.push(dsItem);
        tui.renderLog();
      } else {
        dsItem.text = responseText;
        tui.renderLog();
        saveMessage(sid, "assistant", responseText, { thinking: thinkingText });
        break;
      }
    }

  } catch (e) {
    if (dsItem?.spinning) {
      dsItem.spinning = false;
      tui.stopGlobalSpinner();
    }
    logItems.push({ type: "separator" });
    logItems.push({ type: "error", message: e.message });
    tui.renderLog();
  }

  busy = false;
  tui.refocusInput();
}

function syncSession(sid, prompt) {
  const sess = getSessions().find((s) => s.id === sid);
  if (!sess) return;
  
  const brain = brainRegistry.getActiveBrain();
  if (brain && typeof brain.onSessionSync === "function") {
    brain.onSessionSync(sess, prompt).catch(() => {});
  }

  if (sess.title === "New Chat") {
    const title = prompt.slice(0, 40);
    updateSessionTitle(sid, title);
    tui.setTopBarTitle(title);
  }
}

module.exports = {
  ask,
  isBusy,
  setBusy,
  runAutomaticVerification,
};
