// @ts-nocheck
// error_formatter.ts — formats tool errors for the model with a
// "Recommended next step" section. The orchestrator embeds this output
// into tool results so the model can recover without guessing.

/**
 * Format a tool error as a structured message with a "Recommended next step"
 * section the model is forced to follow.
 *
 * @param tool - the tool name (e.g. "patch_file")
 * @param err - the Error object (or any error-like with .message)
 * @param ctx - { params, attempt, previousErrors, blockedApproach }
 * @returns a multi-line string the model can use to recover
 */
function formatToolError(tool, err, ctx) {
  ctx = ctx || {};
  const params = ctx.params || {};
  const attempt = ctx.attempt || 1;
  const previousErrors = Array.isArray(ctx.previousErrors) ? ctx.previousErrors : [];
  const blockedApproach = !!ctx.blockedApproach;

  const errMsg = (err && (err.message || err.toString())) || '(unknown error)';
  const lines = [];
  lines.push(`[Tool Failed] ${tool}: ${errMsg}`);
  if (attempt > 1) {
    lines.push(`(attempt ${attempt}; previous errors: ${previousErrors.length})`);
  }

  // Detect a few common patterns and add a targeted recommendation.
  const lower = errMsg.toLowerCase();
  let recommended = '';
  if (lower.includes('enoent') || lower.includes('no such file') || lower.includes('not found')) {
    const path = params && (params.path || params.filePath || params.filename) || '';
    recommended = `The path "${path}" does not exist. Use list_directory or glob_search to find the correct path, then retry. If the file SHOULD exist, create it first with write_file (if new) or check your working directory.`;
  } else if (lower.includes('eacces') || lower.includes('permission denied')) {
    recommended = `Permission denied. Check file permissions with file_info. You probably cannot write to this location from this user. Suggest a different path.`;
  } else if (lower.includes('eisdir')) {
    recommended = `You tried to operate on a directory as if it were a file. Use list_directory instead of read_file on directories.`;
  } else if (lower.includes('syntax') || lower.includes('unexpected token') || lower.includes('parse')) {
    recommended = `Your patch or generated code has a syntax error. Read the file again (your mental model may be stale), fix the syntax, and retry. NEVER reset to zero — just patch the broken lines.`;
  } else if (lower.includes('patch') || lower.includes('line')) {
    recommended = `The patch failed (likely wrong start_line / end_line, or stale state). Read the file with read_file to see the CURRENT state, then retry with fresh line numbers. NEVER reset to zero.`;
  } else if (lower.includes('timeout') || lower.includes('timed out')) {
    recommended = `The tool took too long. Try a smaller scope (e.g. read a portion of the file instead of the whole thing), or run a simpler shell command.`;
  } else if (lower.includes('git') && lower.includes('conflict')) {
    recommended = `Git conflict. Run \`git status\` to see what's conflicted, resolve the conflict markers manually, then \`git add\` the resolved files. Do NOT use patch_file to "fix" conflict markers — that is the wrong tool.`;
  } else if (lower.includes('enotempty') || lower.includes('directory not empty')) {
    recommended = `Cannot remove a non-empty directory. Clear the contents first, or use a different path.`;
  } else {
    recommended = `Read the error carefully. Do NOT retry the identical call. Try a different approach: a different tool, different parameters, or fix the root cause first (e.g. create a missing file before patching it).`;
  }

  if (blockedApproach) {
    recommended += ' [circuit breaker: this is attempt #' + attempt + ' of the same approach. STOP and reconsider the design. Try something fundamentally different.]';
  }

  lines.push('');
  lines.push('Recommended next step:');
  lines.push(recommended);
  lines.push('');
  lines.push('(You MUST reply in valid JSON. If you are giving a final answer to the user, include a "Self-test:" line.)');
  return lines.join('\n');
}

/**
 * Summarize the attempts state for a turn. Returns a human-readable
 * multi-line string the model can scan in one go.
 */
function summarizeAttempts(state) {
  if (!state || !state.attempts) return '(no attempts recorded)';
  const lines = [];
  lines.push('Attempt summary this turn:');
  const totalCalls = state.toolCallCount || 0;
  lines.push('  total tool calls: ' + totalCalls);
  const sameStreak = state.sameErrorStreak || 0;
  if (sameStreak > 0) {
    lines.push('  SAME-ERROR STREAK: ' + sameStreak + ' (consider switching strategy)');
  }
  const blocked = Array.from(state.blockedApproaches || []);
  if (blocked.size > 0) {
    lines.push('  blocked approaches: ' + Array.from(blocked).join(', '));
  }
  if (state.attempts && state.attempts.size > 0) {
    const entries = Array.from(state.attempts.entries());
    const repeated = entries.filter(([_, info]) => (info.count || 0) >= 2);
    if (repeated.length > 0) {
      lines.push('  repeated attempts (>1): ' + repeated.length);
    }
  }
  return lines.join('\n');
}

module.exports = {
  formatToolError,
  summarizeAttempts,
};
