// @ts-nocheck
// Auto-context-compaction utility. When the rolling prompt grows too large,
// summarize the oldest turns and replace them with a compact version.
//
// This module exposes a pure function (compactTranscript) and a helper to
// estimate token counts. The orchestrator can call compactTranscript() to
// keep the session going past the model's context window.

const fs = require('fs');
const path = require('path');

// Rough token estimator: ~4 chars per token for English
function estimateTokens(text) {
  if (typeof text !== "string") return 0;
  return Math.ceil(text.length / 4);
}

function estimateTranscriptTokens(transcript) {
  if (!Array.isArray(transcript)) return 0;
  return transcript.reduce((sum, turn) => {
    let s = (turn.content || "").length;
    if (turn.toolOutput) s += turn.toolOutput.length;
    return sum + Math.ceil(s / 4);
  }, 0);
}

/**
 * Compact a transcript by:
 *   1. Keeping the system prompt (first turn if role=system) and the most recent 6 turns intact.
 *   2. Summarizing the middle turns into a single "## Summary" block.
 *
 * @param {Array} transcript - [{ role, content, toolName, toolOutput }]
 * @param {Object} opts
 * @param {number} opts.keepRecent - turns to keep verbatim at the end (default 6)
 * @param {number} opts.maxTokens - if the transcript is below this, no compaction (default 8000)
 * @returns {Array} compacted transcript
 */
function compactTranscript(transcript, opts = {}) {
  if (!Array.isArray(transcript) || transcript.length === 0) return transcript;
  const keepRecent = opts.keepRecent || 6;
  const maxTokens = opts.maxTokens || 8000;

  const currentTokens = estimateTranscriptTokens(transcript);
  if (currentTokens < maxTokens) return transcript; // nothing to do

  // Find system prompt (if any)
  let systemTurn = null;
  let start = 0;
  if (transcript[0] && transcript[0].role === "system") {
    systemTurn = transcript[0];
    start = 1;
  }

  const middleTurns = transcript.slice(start, transcript.length - keepRecent);
  const recentTurns = transcript.slice(transcript.length - keepRecent);

  if (middleTurns.length === 0) return transcript;

  // Synthesize a summary block
  const summaryLines = [`# Compaction summary (${middleTurns.length} earlier turns, ~${estimateTranscriptTokens(middleTurns)} tokens collapsed to ~150)`];
  summaryLines.push("");
  summaryLines.push("## Key actions taken");
  for (const t of middleTurns) {
    if (t.role === "user") {
      summaryLines.push(`- **User asked**: ${(t.content || "").substring(0, 100).replace(/\n/g, " ")}`);
    } else if (t.role === "assistant") {
      summaryLines.push(`- **Assistant**: ${(t.content || "").substring(0, 100).replace(/\n/g, " ")}`);
    } else if (t.role === "tool") {
      summaryLines.push(`- **Tool ${t.toolName || ""}** → ${(t.content || "").substring(0, 80).replace(/\n/g, " ")}`);
    }
  }
  summaryLines.push("");
  summaryLines.push("## Files modified");
  const fileSet = new Set();
  for (const t of middleTurns) {
    if (t.toolName && t.toolParams && t.toolParams.path) fileSet.add(t.toolParams.path);
  }
  if (fileSet.size > 0) {
    for (const f of fileSet) summaryLines.push(`- ${f}`);
  } else {
    summaryLines.push("- (none recorded)");
  }
  summaryLines.push("");
  summaryLines.push("## Decisions / non-obvious facts");
  // Heuristic: look for assistant turns with the word "decided" / "because" / "therefore"
  const decisions = middleTurns.filter(t => t.role === "assistant" && /\b(decided|because|therefore|chose|rationale)\b/i.test(t.content || ""));
  if (decisions.length > 0) {
    for (const d of decisions.slice(0, 5)) {
      summaryLines.push(`- ${(d.content || "").substring(0, 200).replace(/\n/g, " ")}`);
    }
  } else {
    summaryLines.push("- (none captured)");
  }

  const summaryBlock = {
    role: "system",
    content: summaryLines.join("\n"),
  };

  const compacted = [];
  if (systemTurn) compacted.push(systemTurn);
  compacted.push(summaryBlock);
  compacted.push(...recentTurns);

  return compacted;
}

module.exports = {
  estimateTokens,
  estimateTranscriptTokens,
  compactTranscript,
};
