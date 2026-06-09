// @ts-nocheck
// Reminder prompt — injected BEFORE each turn, AFTER the system prompt.
// Compact but rich: gives the model a quick situational snapshot so it
// doesn't have to reconstruct context from scratch.

function buildReminderPrompt(state) {
  state = state || {};
  const mode = state.mode || 'act';
  const modeBadge = mode === 'plan'
    ? '🟦 [PLAN MODE — read-only, write_file only for ./implementation_plan.md]'
    : (mode === 'act' ? '🟩 [ACT MODE — full tool access]'
                      : '⬜ [AUTO MODE — will detect intent per turn]');

  const recentFiles = (state.recentFiles && state.recentFiles.length > 0)
    ? state.recentFiles.slice(0, 5).map(f => '  - ' + f).join('\n')
    : '  (none this session)';

  const lastTools = (state.lastToolCalls && state.lastToolCalls.length > 0)
    ? state.lastToolCalls.slice(-3).map(t => '  - ' + (t.tool || t.name || '?') + ' ' + (t.status || '')).join('\n')
    : '  (none this turn)';

  const toolCount = state.toolCallCount || 0;
  const toolBudget = state.maxToolCallsPerTurn || 30;
  const toolPct = Math.round((toolCount / toolBudget) * 100);

  const recentErrors = (state.recentErrors && state.recentErrors.length > 0)
    ? '\n[RECENT ERRORS] (call get_recent_errors for full pattern):\n  - ' + state.recentErrors.slice(-2).join('\n  - ')
    : '';

  const lastUserMessage = state.lastUserMessage
    ? '\n[USER LAST SAID]: ' + (state.lastUserMessage.length > 200 ? state.lastUserMessage.substring(0, 200) + '...' : state.lastUserMessage)
    : '';

  const modeChange = state.modeJustChanged
    ? '\n[MODE JUST CHANGED] — your tool access and rules are now ' + mode + ' mode. Re-read the system prompt section that applies to ' + mode + ' mode before continuing.'
    : '';

  return `
# REMINDER (inject before each turn)
${modeBadge}
${modeChange}
${lastUserMessage}

[TOOL BUDGET]: ${toolCount}/${toolBudget} tool calls used this turn (${toolPct}%). If you hit the limit, the circuit breaker fires and you must answer.

[RECENT FILES TOUCHED]:
${recentFiles}

[LAST 3 TOOL CALLS]:
${lastTools}

[KEY RULES REMINDER]:
- If you change code, WRITE A TEST and run it (./test_<feature>.ext). Do not claim done without it.
- If a tool fails, read the error's "Recommended next step". NEVER retry the same call 3 times.
- After ANY error, your first action is read_file on the affected file. Not another write.
- DO NOT reset to zero. If a previous attempt partially succeeded, the files on disk have the partial state.
- Final answer MUST include a self-test result line: "PASS  Self-test: ..." or "FAIL  Self-test: ..." — the orchestrator REJECTS answers without it.
${recentErrors}
`;
}

module.exports = { buildReminderPrompt };
