// @ts-nocheck
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
  updateSessionDeepseekId,
  getFilteredChatHistory,
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
          } catch (e) { }
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
    } catch (err) { }
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

const COMMON_WORDS = new Set([
  'close', 'init', 'start', 'stop', 'run', 'execute', 'status', 'config', 'name',
  'get', 'set', 'update', 'clear', 'create', 'delete', 'reset', 'load', 'save',
  'index', 'type', 'error', 'result', 'success', 'log', 'open', 'send', 'connect',
  'setup', 'process', 'handle', 'wait', 'show', 'hide', 'render', 'add', 'remove',
  'has', 'find', 'all', 'map', 'filter', 'reduce', 'keys', 'values', 'entries',
  'push', 'pop', 'shift', 'unshift', 'splice', 'slice', 'join', 'split', 'replace',
  'match', 'test', 'exec', 'toString', 'then', 'catch', 'finally'
]);

function verifyNoDeletedReferences(filePath) {
  if (!fs.existsSync(filePath)) return null;
  const ext = path.extname(filePath).toLowerCase();
  if (![".js", ".jsx", ".ts", ".tsx", ".mjs", ".cjs"].includes(ext)) return null;

  const { execSync } = require('child_process');
  const relativePath = path.relative(process.cwd(), filePath);

  let oldContent = "";
  try {
    oldContent = execSync(`git show "HEAD:${relativePath}"`, { stdio: 'pipe' }).toString();
  } catch (err) {
    // If the file is not tracked in git (e.g. new file), skip deleted methods check
    return null;
  }

  const newContent = fs.readFileSync(filePath, "utf8");

  function getDeclaredMethods(content) {
    const methods = new Set();
    // Class methods: async foo() { or foo() {
    const classMethodRegex = /^\s*(?:async\s+)?([a-zA-Z0-9_]+)\s*\([^)]*\)\s*\{/gm;
    let match;
    while ((match = classMethodRegex.exec(content)) !== null) {
      const name = match[1];
      if (!['if', 'for', 'while', 'switch', 'catch', 'constructor'].includes(name)) {
        methods.add(name);
      }
    }
    // Function assignments: const foo = () => or let foo = async () =>
    const funcRegex = /(?:function\s+|const\s+|let\s+|var\s+)([a-zA-Z0-9_]+)\s*=\s*(?:async\s*)?\([^)]*\)\s*=>/g;
    while ((match = funcRegex.exec(content)) !== null) {
      methods.add(match[1]);
    }
    // Function declarations: function foo() {
    const funcDeclRegex = /(?:async\s+)?function\s+([a-zA-Z0-9_]+)\s*\(/g;
    while ((match = funcDeclRegex.exec(content)) !== null) {
      methods.add(match[1]);
    }
    return methods;
  }

  const oldMethods = getDeclaredMethods(oldContent);
  const newMethods = getDeclaredMethods(newContent);

  const deletedMethods = [];
  for (const m of oldMethods) {
    if (!newMethods.has(m)) {
      deletedMethods.push(m);
    }
  }

  if (deletedMethods.length === 0) return null;

  const cleanNewContent = newContent
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\/\/.*/g, "");

  // Scan the project files to see if any of these deleted methods are still referenced
  const { globSync } = require('glob');
  const files = globSync("**/*.{js,ts,jsx,tsx,mjs,cjs}", {
    cwd: process.cwd(),
    absolute: true,
    ignore: ["**/node_modules/**", "**/dist/**", "**/ds_config/**", "**/.git/**"]
  });

  for (const deletedMethod of deletedMethods) {
    const regex = new RegExp(`\\b${deletedMethod}\\b`);

    // Check in the modified file itself first
    const occurrencesInNewFile = (cleanNewContent.match(new RegExp(`\\b${deletedMethod}\\b`, 'g')) || []).length;
    if (occurrencesInNewFile > 0) {
      return {
        success: false,
        error: `Linker Check Failed: Method/Function '${deletedMethod}' was deleted from '${path.basename(filePath)}', but references to it still exist in the same file.`
      };
    }

    if (COMMON_WORDS.has(deletedMethod)) continue;

    for (const f of files) {
      if (path.resolve(f) === path.resolve(filePath)) continue;
      const fileContent = fs.readFileSync(f, "utf8");
      const cleanFileContent = fileContent
        .replace(/\/\*[\s\S]*?\*\//g, "")
        .replace(/\/\/.*/g, "");
      if (regex.test(cleanFileContent)) {
        return {
          success: false,
          error: `Linker Check Failed: Method/Function '${deletedMethod}' was deleted from '${path.basename(filePath)}', but it is still referenced in '${path.relative(process.cwd(), f)}'.`
        };
      }
    }
  }

  return null;
}

function verifyThirdPartyDependencies(filePath) {
  if (!fs.existsSync(filePath)) return null;
  const ext = path.extname(filePath).toLowerCase();
  if (![".js", ".jsx", ".ts", ".tsx", ".mjs", ".cjs"].includes(ext)) return null;

  const content = fs.readFileSync(filePath, "utf8");

  // Read package.json dependencies
  let declaredDependencies = new Set();
  const pkgPath = path.join(process.cwd(), "package.json");
  if (fs.existsSync(pkgPath)) {
    try {
      const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8"));
      if (pkg.dependencies) {
        for (const dep of Object.keys(pkg.dependencies)) {
          declaredDependencies.add(dep);
        }
      }
      if (pkg.devDependencies) {
        for (const dep of Object.keys(pkg.devDependencies)) {
          declaredDependencies.add(dep);
        }
      }
    } catch (e) { }
  }

  const builtins = new Set([
    "assert", "async_hooks", "buffer", "child_process", "cluster", "console",
    "constants", "crypto", "dgram", "dns", "domain", "events", "fs", "fs/promises",
    "http", "http2", "https", "inspector", "module", "net", "os", "path", "perf_hooks",
    "process", "punycode", "querystring", "readline", "repl", "stream", "string_decoder",
    "sys", "timers", "tls", "trace_events", "tty", "url", "util", "v8", "vm", "wasi",
    "worker_threads", "zlib"
  ]);

  // Extract non-relative imports/requires
  const cjsRegex = /require\s*\(\s*['"]([^'"]+)['"]\s*\)/g;
  let match;
  while ((match = cjsRegex.exec(content)) !== null) {
    const importPath = match[1];
    if (importPath.startsWith('.') || importPath.startsWith('/')) continue;
    const pkgName = importPath.split('/')[0];
    if (pkgName && !builtins.has(pkgName) && !declaredDependencies.has(pkgName)) {
      return {
        success: false,
        error: `Linker Check Failed: Undeclared package dependency '${pkgName}' is required in '${path.basename(filePath)}'. Please add it to package.json dependencies first.`
      };
    }
  }

  // ES modules imports and calls
  const esmRegex = /import\s+(?:[^'"]+\s+from\s+)?['"]([^'"]+)['"]/g;
  while ((match = esmRegex.exec(content)) !== null) {
    const importPath = match[1];
    if (importPath.startsWith('.') || importPath.startsWith('/')) continue;
    const pkgName = importPath.split('/')[0];
    if (pkgName && !builtins.has(pkgName) && !declaredDependencies.has(pkgName)) {
      return {
        success: false,
        error: `Linker Check Failed: Undeclared package dependency '${pkgName}' is imported in '${path.basename(filePath)}'. Please add it to package.json dependencies first.`
      };
    }
  }

  const importCallRegex = /import\s*\(\s*['"]([^'"]+)['"]\s*\)/g;
  while ((match = importCallRegex.exec(content)) !== null) {
    const importPath = match[1];
    if (importPath.startsWith('.') || importPath.startsWith('/')) continue;
    const pkgName = importPath.split('/')[0];
    if (pkgName && !builtins.has(pkgName) && !declaredDependencies.has(pkgName)) {
      return {
        success: false,
        error: `Linker Check Failed: Undeclared package dependency '${pkgName}' is imported dynamically in '${path.basename(filePath)}'. Please add it to package.json dependencies first.`
      };
    }
  }

  return null;
}

function verifyNoConflictMarkers(filePath) {
  if (!fs.existsSync(filePath)) return null;
  const content = fs.readFileSync(filePath, "utf8");
  if (/^[<>=]{7}(?:\s|$)/m.test(content)) {
    return {
      success: false,
      error: `Linker Check Failed: Git conflict markers (e.g. <<<<<<<, =======, >>>>>>>) were detected in '${path.basename(filePath)}'. Please resolve them.`
    };
  }
  return null;
}

function verifyJsonSyntax(filePath) {
  if (!fs.existsSync(filePath)) return null;
  if (path.extname(filePath).toLowerCase() === ".json") {
    try {
      JSON.parse(fs.readFileSync(filePath, "utf8"));
    } catch (err) {
      return {
        success: false,
        error: `Syntax Check Failed: '${path.basename(filePath)}' is not valid JSON:\n${err.message}`
      };
    }
  }
  return null;
}

function verifyFileShrinkage(filePath, latestResponseText) {
  if (!fs.existsSync(filePath)) return null;
  const ext = path.extname(filePath).toLowerCase();
  if (![".js", ".jsx", ".ts", ".tsx", ".mjs", ".cjs", ".py", ".go"].includes(ext)) return null;

  // If the agent explains the deletion, bypass the check
  if (latestResponseText && typeof latestResponseText === 'string') {
    const bypassRegex = /\b(delete|remove|cleanup|refactor|bypass|intentional|deprecated|simplify|prune)\b/i;
    if (bypassRegex.test(latestResponseText)) {
      return null;
    }
  }

  const { execSync } = require('child_process');
  const relativePath = path.relative(process.cwd(), filePath);

  let oldContent = "";
  try {
    oldContent = execSync(`git show "HEAD:${relativePath}"`, { stdio: 'pipe' }).toString();
  } catch (err) {
    return null; // Skip if file is new
  }

  const newContent = fs.readFileSync(filePath, "utf8");
  const oldLines = oldContent.split('\n').length;
  const newLines = newContent.split('\n').length;

  if (oldLines > 100 && newLines < oldLines * 0.7 && (oldLines - newLines) > 40) {
    const shrinkPercent = Math.round(((oldLines - newLines) / oldLines) * 100);
    return {
      success: false,
      error: `Linker Check Failed: Heuristic check failed. The line count of '${path.basename(filePath)}' decreased by ${shrinkPercent}% (from ${oldLines} to ${newLines} lines). Large code deletion or file truncation detected. Overwriting or truncating code is forbidden. If this deletion is intentional, please perform it in smaller, verified steps.`
    };
  }
  return null;
}

/**
 * Validates a sub-agent prompt is specific enough to dispatch safely.
 * Returns an error string if the prompt is too vague, null if it passes.
 */
function validateSubAgentPrompt(prompt) {
  if (!prompt || typeof prompt !== 'string') {
    return `[SYSTEM INTERCEPT - INVALID SUB-AGENT PROMPT]\nThe 'prompt' field is empty or missing. Sub-agent calls MUST include a detailed prompt.`;
  }

  const trimmed = prompt.trim();

  // Minimum length: prompts shorter than 120 chars are almost certainly too vague
  if (trimmed.length < 120) {
    return `[SYSTEM INTERCEPT - SUB-AGENT PROMPT TOO VAGUE]\nYour run_sub_agent prompt is only ${trimmed.length} characters long. Sub-agent prompts MUST be at minimum 120 characters and include:\n  1. The exact file path(s) to edit.\n  2. The precise function/class/section to modify.\n  3. The exact new code or logic to implement (no placeholders).\n  4. Any interface contracts (function signatures, return types, exports).\n  5. What NOT to touch.\n\nRewrite the prompt with these details before dispatching the sub-agent.`;
  }

  // Must reference at least one file path (contains a slash and a recognizable extension)
  const hasFilePath = /[\w./\\-]+\.(?:js|ts|jsx|tsx|mjs|cjs|py|go|rs|json|md|css|sh)/.test(trimmed);
  if (!hasFilePath) {
    return `[SYSTEM INTERCEPT - SUB-AGENT PROMPT MISSING FILE TARGET]\nYour run_sub_agent prompt does not reference any target file. Sub-agent prompts MUST specify the exact file path(s) to read or modify (e.g. 'src/core/orchestrator.js').\n\nRewrite the prompt to include specific file targets.`;
  }

  // Must not be all vague action words with no specifics
  const vagueOnlyRegex = /^\s*(implement|add|create|update|fix|make|change|do|handle|write)\s+(it|this|that|the feature|the fix|the change|the code)\s*\.?\s*$/i;
  if (vagueOnlyRegex.test(trimmed)) {
    return `[SYSTEM INTERCEPT - SUB-AGENT PROMPT IS VAGUE COMMAND]\nYour run_sub_agent prompt is a vague command with no specifics. Rephrase with exact implementation details.`;
  }

  // Must not contain lazy placeholder markers
  const placeholderRegex = /(\.{3}\s*rest of|TODO:|FIXME:|placeholder|\[your code here\]|\/\/ fill in)/i;
  if (placeholderRegex.test(trimmed)) {
    return `[SYSTEM INTERCEPT - SUB-AGENT PROMPT CONTAINS PLACEHOLDERS]\nYour run_sub_agent prompt contains placeholder text (e.g. '... rest of', 'TODO', 'fill in'). Sub-agent prompts MUST contain the complete, concrete specification — no lazy shortcuts.`;
  }

  return null; // Passes all checks
}

async function runAutomaticVerification(modifiedFiles, latestResponseText) {
  const { execSync } = require('child_process');
  const cwd = process.cwd();
  const config = loadConfig();

  // 1. Check JS/TS Imports and Exports for mismatches, deleted references, undeclared dependencies, conflict markers, JSON syntax, and file shrinkage
  for (const file of modifiedFiles) {
    let res = verifyNoConflictMarkers(file);
    if (res && !res.success) return res;

    res = verifyJsonSyntax(file);
    if (res && !res.success) return res;

    res = verifyImportsAndExports(file);
    if (res && !res.success) return res;

    res = verifyNoDeletedReferences(file);
    if (res && !res.success) return res;

    res = verifyThirdPartyDependencies(file);
    if (res && !res.success) return res;

    res = verifyFileShrinkage(file, latestResponseText);
    if (res && !res.success) return res;
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
    } catch (e) { }
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
    } catch (e) { }

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

function showConfirmation(message) {
  return new Promise((resolve) => {
    const blessed = require("blessed");
    const screen = tui.scr;

    const overlay = blessed.box({
      parent: screen,
      top: "center",
      left: "center",
      width: "50%",
      height: 7,
      border: { type: "line" },
      style: { border: { fg: "#ffa500" }, bg: "default" },
      keys: true,
      vi: true,
    });

    blessed.text({
      parent: overlay,
      top: 1,
      left: 2,
      right: 2,
      content: message,
      style: { fg: "#ffffff" },
    });

    const yesBtn = blessed.button({
      parent: overlay,
      bottom: 1,
      left: "center",
      width: 10,
      height: 1,
      content: " Yes ",
      style: { bg: "#2a2a2a", fg: "#00ff00", focus: { bg: "#00ff00", fg: "#000000" } },
      mouse: true,
      keys: true,
      shrink: true,
    });

    const noBtn = blessed.button({
      parent: overlay,
      bottom: 1,
      left: "center+12",
      width: 10,
      height: 1,
      content: " No ",
      style: { bg: "#2a2a2a", fg: "#ff0000", focus: { bg: "#ff0000", fg: "#000000" } },
      mouse: true,
      keys: true,
      shrink: true,
    });

    yesBtn.focus();

    const cleanup = (result) => {
      overlay.destroy();
      screen.render();
      resolve(result); // result should be true or false
    };

    yesBtn.on("press", () => cleanup(true));
    noBtn.on("press", () => cleanup(false));      // Explicit false
    yesBtn.key(["enter"], () => cleanup(true));
    noBtn.key(["enter"], () => cleanup(false));   // Explicit false
    overlay.key(["escape"], () => cleanup(false));// Escape = false

    screen.render();
  });
}

async function handleGitDirtyWorkspace() {
  const { execSync } = require('child_process');
  try {
    const status = execSync('git status --porcelain', { stdio: 'pipe' }).toString().trim();
    if (status) {
      const confirmed = await showConfirmation('Uncommitted changes detected. Continue?');
      if (!confirmed) {
        const logItems = tui.getLogItems();
        logItems.push({
          type: "error",
          text: "Operation aborted. Uncommitted changes remain."
        });
        tui.renderLog();
        const abortError = new Error('ABORTED_BY_USER');
        abortError.code = 'ABORTED';
        throw abortError;
      }
      // User confirmed, continue without any git operations and without extra message
    }
  } catch (err) {
    if (err.message === 'ABORTED_BY_USER') {
      throw err;
    }
    // Ignore other errors (non-git repo, git command failure, etc.)
  }
}
async function ask(prompt) {
  busy = true;
  let lastToolCalls = [];
  function checkToolLoop(tool, params) {
    const key = JSON.stringify({ tool, params });
    if (lastToolCalls.length > 0 && lastToolCalls[lastToolCalls.length - 1] === key) {
      let count = 1;
      for (let i = lastToolCalls.length - 2; i >= 0; i--) {
        if (lastToolCalls[i] === key) count++;
        else break;
      }
      if (count >= 2) return true;
    }
    lastToolCalls.push(key);
    if (lastToolCalls.length > 10) lastToolCalls.shift();
    return false;
  }
  const modifiedFiles = new Set();
  let hasEditedFiles = false;
  let hasVerified = false;

  let sid = getCurrentSessionId();
  if (!sid) {
    try {
      await handleGitDirtyWorkspace();
    } catch (err) {
      if (err.message === 'ABORTED_BY_USER') {
        busy = false;
        tui.stopGlobalSpinner();
        return; // Stop execution, do not proceed further
      }
      throw err; // Re‑throw unexpected errors
    }
    const ns = createSession(prompt.slice(0, 40));
    sid = ns.id;
    setCurrentSessionId(sid);
    tui.setTopBarTitle(prompt.slice(0, 60));
  }
  tui.setAutoScroll(true);
  const brain = brainRegistry.getActiveBrain();

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
    const checkpoints = require("../utils/checkpoints");
    const revertInfo = checkpoints.getLastRevertedCheckpointInfo();
    let promptTextForBrain = prompt;
    if (revertInfo) {
      promptTextForBrain = `[SYSTEM: The user reverted the workspace to checkpoint ${revertInfo.id} (created at ${new Date(revertInfo.timestamp).toLocaleTimeString()}). The current codebase has been restored to that state. Please review the codebase and continue accordingly.]\n\nUser prompt:\n${prompt}`;
    }

    const list = checkpoints.listCheckpoints();
    const cp = list.length > 0 ? list[list.length - 1] : null;

    let currentPrompt = `[System Instructions]\n${getSystemPrompt(promptTextForBrain)}\n\n[User Request]\n${promptTextForBrain}`;



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
          const verificationResult = await runAutomaticVerification(modifiedFiles, responseText || thinkingText);
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

          // ── Dead Code & Unused Import Guard (post-verification, non-blocking) ──
          // After verification passes, ask the main brain to self-analyse the modified files
          // for dead code and unused imports. Results are shown in TUI only — no rollback.
          if (hasVerified && modifiedFiles.size > 0) {
            try {
              const fileList = Array.from(modifiedFiles)
                .filter(f => fs.existsSync(f))
                .map(f => path.relative(process.cwd(), f))
                .join(', ');
              if (fileList) {
                const deadCodePrompt =
                  `[SYSTEM: Dead Code & Unused Import Scan]\n` +
                  `The following files were just modified: ${fileList}\n` +
                  `Read each file and identify:\n` +
                  `  1. Any imported symbols (require/import) that are never used in the file body.\n` +
                  `  2. Any declared functions, classes, or variables that are defined but never called or referenced within the project.\n` +
                  `  3. Any exports that are defined but not imported anywhere in the project.\n` +
                  `Respond ONLY with a concise markdown bullet list of findings (file:line — description).\n` +
                  `If there are no findings, respond with exactly: "No dead code or unused imports detected."\n` +
                  `Do NOT call any tools. Do NOT rewrite any code. This is analysis only.`;

                const deadCodeResult = await brain.getCompletionStream(deadCodePrompt, {
                  onStartCalled: () => { },
                  onProgress: () => { }
                });
                const dcText = (deadCodeResult.responseText || "").trim();
                if (dcText && !dcText.toLowerCase().startsWith("no dead code")) {
                  const dcItem = {
                    type: "status",
                    text: `[Dead Code Scan]\n${dcText}`
                  };
                  logItems.push(dcItem);
                  tui.renderLog();
                }
              }
            } catch (_dcErr) {
              // Non-critical: dead code scan failure must never block the session
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
          // ── Sub-agent prompt strictness guard (parallel batch) ──
          if (c.tool === "run_sub_agent") {
            const promptError = validateSubAgentPrompt(c.prompt);
            if (promptError) {
              // Swap this call to an error result immediately
              c._intercepted = promptError;
            }
          }
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
                    `[Tool Timeout] ${c.tool} did not complete within ${TOOL_TIMEOUT_MS / 1000
                    }s`
                  ),
                TOOL_TIMEOUT_MS
              )
            );
            const executePromise = (async () => {
              // Sub-agent prompt strictness: intercept before executing
              if (c._intercepted) {
                return c._intercepted;
              }
              if (checkToolLoop(c.tool, c)) {
                return `❌ Loop detected: Identical tool call was repeated 3 times consecutively. Aborting execution to prevent infinite looping.`;
              }
              const t = tools[c.tool];
              if (t) {
                try {
                  const res = await t.execute(c);
                  return c.tool === "run_sub_agent" ? String(res ?? "") : safeTruncate(String(res ?? ""));
                } catch (e) {
                  return c.tool === "run_sub_agent" ? `Error: ${e.message}` : safeTruncate(`Error: ${e.message}`);
                }
              }
              const isMcp = mcpLoader.getRegistry().some((x) => x.name === c.tool);
              if (isMcp) {
                try {
                  const res = await mcpLoader.callTool(c.tool, c);
                  return c.tool === "run_sub_agent" ? String(res ?? "") : safeTruncate(String(res ?? ""));
                } catch (e) {
                  return c.tool === "run_sub_agent" ? `MCP error: ${e.message}` : safeTruncate(`MCP error: ${e.message}`);
                }
              }
              return `Error: tool '${c.tool}' not found.`;
            })();
            if (c.tool === "run_sub_agent") {
              return executePromise;
            }
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
            ? `\n\nNote: ${calls.length - MAX_PAR
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

        // ── Sub-agent prompt strictness guard (single call) ──
        if (toolName === "run_sub_agent") {
          const promptError = validateSubAgentPrompt(toolParams.prompt);
          if (promptError) {
            const toolItem2 = {
              type: "tool",
              name: toolName,
              params: toolParams,
              status: "completed",
              result: promptError,
              expanded: false,
            };
            logItems.push(toolItem2);
            saveMessage(sid, "tool_result", promptError, { tool: toolName });
            const FORMAT_REMINDER2 = `\n\n[Reminder: You MUST respond in English only. Fix the sub-agent prompt and retry.]`;
            currentPrompt = `[Tool Output for ${toolName}]\n${promptError}${FORMAT_REMINDER2}`;
            isInitial = false;
            dsItem = { type: "deepseek", text: "", spinning: true };
            logItems.push(dsItem);
            tui.renderLog();
            continue;
          }
        }

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
        if (checkToolLoop(toolName, toolParams)) {
          toolResult = `❌ Loop detected: Identical tool call was repeated 3 times consecutively. Aborting execution to prevent infinite looping.`;
        } else {
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
        }

        toolResult = toolName === "run_sub_agent" ? String(toolResult) : safeTruncate(String(toolResult));
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
    brain.onSessionSync(sess, prompt).catch(() => { });
  }

  if (sess.title === "New Chat") {
    const title = prompt.slice(0, 40);
    updateSessionTitle(sid, title);
    tui.setTopBarTitle(title);
  }
}

async function compactCurrentSession() {
  const sid = getCurrentSessionId();
  if (!sid) throw new Error("No active session to compact");

  const compactPrompt = `Please summarize the entire conversation up to this point, excluding any tool calls, internal commands, or system messages. Focus on the key points, decisions, context, and important details. Output only the summary, no extra commentary. This summary will be used to start a fresh chat session to continue from where we left off.`;

  const brain = brainRegistry.getActiveBrain();
  if (!brain || typeof brain.getCompletionStream !== "function") {
    throw new Error("No active brain capable of generating summary");
  }

  const logItems = tui.getLogItems();
  const compactItem = { type: "compact", message: "Requesting summary from AI..." };
  logItems.push(compactItem);
  tui.renderLog();

  let summaryText = "";
  try {
    const result = await brain.getCompletionStream(compactPrompt, {
      onStartCalled: () => { },
      onProgress: (progress) => {
        if (progress.text && progress.text.length > summaryText.length) {
          summaryText = progress.text;
        }
      }
    });
    summaryText = result.responseText || result.thinkingText || "";
    if (!summaryText.trim()) throw new Error("Generated summary is empty");
  } catch (err) {
    compactItem.message = `✗ Compression failed: ${err.message}`;
    tui.renderLog();
    throw new Error(`Failed to generate summary: ${err.message}`);
  }

  await brain.createNewChat();
  await brain.sendPromptInNewChat(summaryText);

  let newDeepseekId = null;
  for (let i = 0; i < 10; i++) {
    newDeepseekId = await brain.getCurrentDeepseekId();
    if (newDeepseekId) break;
    await new Promise(r => setTimeout(r, 500));
  }
  if (!newDeepseekId) {
    compactItem.message = "✗ Compression failed: Could not obtain deepseek_id after sending summary";
    tui.renderLog();
    throw new Error("Could not obtain deepseek_id after sending summary");
  }

  updateSessionDeepseekId(sid, newDeepseekId);

  const sessions = getSessions();
  const session = sessions.find(s => s.id === sid);
  if (session && session.title && !session.title.startsWith("Compacted:")) {
    updateSessionTitle(sid, `Compacted: ${session.title}`);
  }

  compactItem.message = `✓ Compression complete. New chat created with ID: ${newDeepseekId}`;
  tui.renderLog();

  return { success: true, newDeepseekId };
}

module.exports = {
  ask,
  isBusy,
  setBusy,
  runAutomaticVerification,
  compactCurrentSession,
};