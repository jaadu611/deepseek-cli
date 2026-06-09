// @ts-nocheck
// Centralized "guard" logic for the orchestrator. Extracted so we can
// unit-test the rules and so the orchestrator stays readable.

const fs = require('fs');
const path = require('path');

const DEFAULT_ALLOWLIST = null;
const DEFAULT_RATELIMITS = {
  max_per_turn: 30,
  max_consecutive_same: 3,
  max_per_tool_per_turn: 5,
};

// Match a "stack frame" line. Very permissive: any line starting with optional
// whitespace then "at " followed by SOMETHING and an optional parenthesized
// location. This matches JS, Python, Java, Rust, Go, etc.
const STACK_FRAME_REGEX = /^\s*at\s+\S/gm;
const GIT_CONFLICT_REGEX = /^[<>=]{7}(?:\s|$)/m;

function isStackTrace(text) {
  if (typeof text !== "string" || text.length < 30) return false;
  // Check 1: a "Traceback (most recent call last):" header (Python) + at least one frame
  const hasTraceback = /Traceback \(most recent call last\):/.test(text);
  if (hasTraceback) {
    // Python traceback is reliable with just the header + any frame
    const lines = text.split("\n");
    return lines.some(l => /^\s+File ".*", line \d+/.test(l));
  }
  // Check 2: 2+ "at <thing>" lines (JS/Java/Rust/Go)
  const matches = text.match(STACK_FRAME_REGEX);
  if (matches && matches.length >= 2) return true;
  // Check 3: explicit "stack trace" / "stacktrace" keyword + at least one frame
  if (/stack\s*trace/i.test(text) && matches && matches.length >= 1) return true;
  return false;
}

function hasGitConflict(text) {
  if (typeof text !== "string") return false;
  return GIT_CONFLICT_REGEX.test(text);
}

function isEnvFilePath(filePath) {
  if (!filePath || typeof filePath !== "string") return false;
  const base = path.basename(filePath);
  // Block real secrets: .env, .env.local, .env.production, etc.
  // ALLOW .env.example, .env.sample, .env.template (these are public templates)
  if (base === ".env") return true;
  if (base.startsWith(".env.")) {
    const allowedSuffixes = [".example", ".sample", ".template", ".dist", ".default"];
    if (allowedSuffixes.some(s => base.endsWith(s))) return false;
    return true;
  }
  return false;
}

function checkToolAllowlist(toolName, allowlist) {
  if (!allowlist || !Array.isArray(allowlist) || allowlist.length === 0) return null;
  if (allowlist.includes(toolName)) return null;
  return `[BLOCKED] Tool '${toolName}' is not in the current tool allowlist. Allowed: ${allowlist.join(", ")}. Update your config.json or remove the allowlist to use all tools.`;
}

function checkRateLimit(state, toolName, limits) {
  limits = limits || DEFAULT_RATELIMITS;
  if (state.toolCallCount >= (limits.max_per_turn || DEFAULT_RATELIMITS.max_per_turn)) {
    return `[CIRCUIT BREAKER] You have already used ${state.toolCallCount} tool calls this turn (max ${limits.max_per_turn}). Stop calling tools and produce a final answer NOW. If you need more, the user can extend the budget.`;
  }
  const toolCount = state.toolCounts[toolName] || 0;
  if (toolCount >= (limits.max_per_tool_per_turn || DEFAULT_RATELIMITS.max_per_tool_per_turn)) {
    return `[CIRCUIT BREAKER] You have called ${toolName} ${toolCount} times this turn (max ${limits.max_per_tool_per_turn}). Use a DIFFERENT tool, or produce a final answer.`;
  }
  if (state.consecutiveSame >= (limits.max_consecutive_same || DEFAULT_RATELIMITS.max_consecutive_same)) {
    return `[CIRCUIT BREAKER] You have called ${toolName} ${state.consecutiveSame} times in a row. STOP. Use a different approach — e.g. read the file, use sequential_thinking, or ask the user.`;
  }
  return null;
}

function recordToolCall(state, toolName) {
  state.toolCallCount = (state.toolCallCount || 0) + 1;
  state.toolCounts = state.toolCounts || {};
  state.toolCounts[toolName] = (state.toolCounts[toolName] || 0) + 1;
  if (state.lastToolName === toolName) {
    state.consecutiveSame = (state.consecutiveSame || 0) + 1;
  } else {
    state.consecutiveSame = 1;
    state.lastToolName = toolName;
  }
}

function annotateOutput(toolName, output) {
  if (typeof output !== "string") return output;
  if (isStackTrace(output)) {
    return output + `\n\n[Orchestrator note] This output contains a stack trace. The tool crashed. Before retrying: (1) re-read the file/code involved, (2) try a different tool, (3) call get_recent_errors to see the full pattern, (4) consider restore_file to roll back.`;
  }
  if (hasGitConflict(output)) {
    return output + `\n\n[Orchestrator note] Git conflict markers detected in the output. Resolve the conflicts before continuing (<<<<<<<, =======, >>>>>>>).`;
  }
  return output;
}

function parsePlanModeResponse(text) {
  if (!text || typeof text !== "string") return null;
  // The enter_plan_mode tool output starts with "[ORCHESTRATOR: ASK USER]" then has
  // either a free-form question or a numbered options list.
  const m = text.match(/\[ORCHESTRATOR: ASK USER\]([\s\S]*)/);
  if (!m) return null;
  const block = m[1];
  // The first non-blank line is the question
  const lines = block.split("\n");
  let question = null;
  for (const l of lines) {
    const trimmed = l.trim();
    if (trimmed) { question = trimmed; break; }
  }
  // "Context: ..." line
  const ctxMatch = block.match(/Context:\s*([^\n]+)/);
  // "Options:\n  1. ...\n  2. ..." block
  const optionsMatch = block.match(/Options:\n([\s\S]*?)(?:\n\nDefault|\n*$)/);
  let options = null;
  if (optionsMatch) {
    options = optionsMatch[1]
      .split("\n")
      .map(l => l.replace(/^\s*\d+\.\s*/, "").trim())
      .filter(l => l.length > 0);
    if (options.length === 0) options = null;
  }
  return {
    question,
    context: ctxMatch ? ctxMatch[1].trim() : null,
    options,
  };
}

module.exports = {
  DEFAULT_ALLOWLIST,
  DEFAULT_RATELIMITS,
  isStackTrace,
  hasGitConflict,
  isEnvFilePath,
  checkToolAllowlist,
  checkRateLimit,
  recordToolCall,
  annotateOutput,
  parsePlanModeResponse,
};
