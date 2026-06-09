// @ts-nocheck
const { summarizeAttempts, formatToolError } = require('../utils/error_formatter');
// Module-level slot. The orchestrator writes its current turnState here
// before each tool dispatch, and reads it back. This avoids changing the
// tool's signature while still letting the tool see live state.
let _turnState = null;
function setTurnState(state) {
    _turnState = state;
}
function getTurnState() {
    return _turnState;
}
module.exports = {
    name: "get_recent_errors",
    description: "Returns a structured summary of the most recent tool errors in the current turn, with the recommended next step for each. Use this when you're stuck and want to see the pattern of failures, or before retrying a tool. The orchestrator tracks every tool attempt; this is the way to 'look back' without scrolling the TUI.",
    parameters: {
        type: "object",
        properties: {
            limit: { type: "integer", description: "Max number of recent errors to return (default 5)." }
        }
    },
    async execute({ limit = 5 } = {}) {
        try {
            const state = _turnState;
            if (!state || !state.attempts || state.attempts.size === 0) {
                return [
                    "No recent tool errors in the current turn.",
                    "",
                    "If you are seeing an error in the last tool result, it means the orchestrator",
                    "has already shown it to you and is awaiting your next move. Re-read the last",
                    "few turns of the conversation, particularly any 'Recommended next step:' lines.",
                ].join("\n");
            }
            const summary = summarizeAttempts(state);
            // Also list the last `limit` individual errors in structured form
            const recent = [];
            const entries = Array.from(state.attempts.entries()).slice(-limit);
            let i = 0;
            for (const [key, info] of entries) {
                i++;
                let parsed;
                try {
                    parsed = JSON.parse(key);
                }
                catch {
                    continue;
                }
                const { tool, params } = parsed;
                // Reconstruct a per-error actionable message
                try {
                    const errObj = new Error(info.lastError || "(unknown error)");
                    const msg = formatToolError(tool, errObj, {
                        params: params || {},
                        attempt: info.count || 1,
                        previousErrors: [],
                        blockedApproach: (info.count || 0) >= 2,
                    });
                    recent.push(`[${i}] ${msg.split("\n")[0]}\n  ${info.count || 0} attempt(s); last error: ${(info.lastError || "(none)").slice(0, 200)}`);
                }
                catch {
                    recent.push(`[${i}] ${tool}: ${(info.lastError || "(none)").slice(0, 200)}`);
                }
            }
            const streakWarn = state.sameErrorStreak >= 2
                ? `\n\n[Warning] Same error has appeared ${state.sameErrorStreak} times in a row. STOP and reconsider the approach — use sequential_thinking before retrying.`
                : "";
            return `Recent tool attempts (${state.attempts.size} total this turn, showing last ${entries.length}):\n\n` +
                recent.join("\n\n") + "\n\n" +
                "─".repeat(60) + "\n" +
                summary +
                streakWarn;
        }
        catch (err) {
            return `Error in get_recent_errors: ${err.message}`;
        }
    },
    setTurnState,
    getTurnState,
};
