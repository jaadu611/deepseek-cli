// @ts-nocheck
// reminder_prompt.ts — per-turn situational injection.
//
// Injected by the orchestrator BEFORE each brain call, AFTER the system
// prompt. Contains runtime state the model needs to re-ground:
//   - current mode badge
//   - tool-call budget so far this turn
//   - last few tool calls (so it doesn't repeat itself)
//   - scratch file inventory (so it remembers task.md, thinking.md)
//   - recent errors (so it doesn't re-trigger the same circuit breaker)
//   - "you haven't written a test yet" nag when relevant
//   - "you've been looping" warning when relevant
//   - "your plan is ready" / "your task is partially done" hints

const fs = require('fs');
const path = require('path');

function safeStat(p) {
  try { return fs.statSync(p); } catch { return null; }
}
function readText(p, max = 4000) {
  try {
    const s = fs.readFileSync(p, 'utf8');
    if (s.length <= max) return s;
    return s.slice(0, max) + `\n... [+${s.length - max} chars truncated]`;
  } catch { return null; }
}
function listDirLite(dir, max = 30) {
  try {
    if (!fs.existsSync(dir)) return null;
    const items = fs.readdirSync(dir, { withFileTypes: true });
    const out = [];
    let n = 0;
    for (const it of items) {
      if (it.name.startsWith('.')) continue;
      if (n >= max) { out.push(`  ... and ${items.length - max} more`); break; }
      const full = path.join(dir, it.name);
      const st = safeStat(full);
      if (!st) continue;
      const size = st.size < 1024 ? `${st.size}B`
        : st.size < 1024 * 1024 ? `${(st.size / 1024).toFixed(1)}KB`
        : `${(st.size / 1048576).toFixed(1)}MB`;
      const mtime = new Date(st.mtimeMs).toISOString().replace('T', ' ').slice(0, 19);
      if (it.isDirectory()) {
        out.push(`  📁 ${it.name}/  (modified ${mtime})`);
      } else {
        out.push(`  📄 ${it.name}  (${size}, modified ${mtime})`);
      }
      n++;
    }
    return out.length ? out.join('\n') : '  (empty)';
  } catch (err) { return `  (error: ${err.message})`; }
}

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



  const recentErrors = (state.recentErrors && state.recentErrors.length > 0)
    ? '\n[RECENT ERRORS] (call get_recent_errors for full pattern):\n  - ' + state.recentErrors.slice(-2).join('\n  - ')
    : '';

  const lastUserMessage = state.lastUserMessage
    ? '\n[USER LAST SAID]: ' + (state.lastUserMessage.length > 200 ? state.lastUserMessage.substring(0, 200) + '...' : state.lastUserMessage)
    : '';

  const modeChange = state.modeJustChanged
    ? '\n[MODE JUST CHANGED] — your tool access and rules are now ' + mode + ' mode. Re-read the system prompt section that applies to ' + mode + ' mode before continuing.'
    : '';

  // ── scratch inventory ─────────────────────────────────────────────────
  const scratchDir = state.scratchDir || null;
  let scratchBlock = '';
  if (scratchDir) {
    const listing = listDirLite(scratchDir, 25);
    if (listing) {
      scratchBlock = `\n[SCRATCH FILES at ${scratchDir}]:\n${listing}\n` +
        `\n  → If you see task.md, call update_task(action="get") FIRST this turn to re-read your running plan.\n` +
        `  → If you see thinking.md, skim the last 3-5 entries with read_scratch_file("thinking.md").\n` +
        `  → For single-shot tasks (1-3 tool calls), you can skip this re-grounding.\n`;
    }
  }

  // ── pending plan / handoff ────────────────────────────────────────────
  let handoffBlock = '';
  if (state.pendingPlan) {
    handoffBlock = `\n[PENDING PLAN] Your last plan in plan mode is marked READY at ${state.pendingPlan.path}:\n  ${state.pendingPlan.summary}\n  When the user types /act (or "go ahead"), follow this plan.\n`;
  }

  // ── in-progress multi-step task ───────────────────────────────────────
  let taskProgressBlock = '';
  if (state.taskPath) {
    const content = readText(state.taskPath, 2500);
    if (content) {
      const pending = (content.match(/^\s*-\s*\[\s*\]/gm) || []).length;
      const done = (content.match(/^\s*-\s*\[x\]/gim) || []).length;
      taskProgressBlock = `\n[IN-PROGRESS TASK] ${done}/${done + pending} steps done. task.md:\n\`\`\`\n${content}\n\`\`\`\n`;
      if (pending > 0) {
        taskProgressBlock += `  → ${pending} step(s) still [ ]. Don't lose track. Call update_task(action="mark_done", step=N) as you complete each.\n`;
      }
    }
  }

  // ── loop / circuit-breaker warnings ───────────────────────────────────
  const loopWarning = state.consecutiveSame >= 2
    ? `\n⚠️  LOOP WARNING: You have called "${state.consecutiveSameTool || 'the same tool'}" ${state.consecutiveSame} times in a row. STOP. Read the error's "Recommended next step", use get_recent_errors, or call ask_user.\n`
    : '';
  const sameErrorStreakWarn = state.sameErrorStreak >= 2
    ? `\n⚠️  SAME-ERROR STREAK: The same error has appeared ${state.sameErrorStreak} times. STOP and reconsider. think(tag="dead-end") what you've tried, then ask_user.\n`
    : '';

  // ── test nag ──────────────────────────────────────────────────────────
  const testNag = state.hasEditedFiles && !state.hasVerified
    ? `\n🧪 TEST NAG: You have edited code (write/patch) but have NOT run a test yet. Write a temp test, run it, only then finalize.\n`
    : '';

  // ── sub-agent info ────────────────────────────────────────────────────
  const subAgentBudget = (state.subAgentNumber != null)
    ? `\n[SUB-AGENT #${state.subAgentNumber}] Budget: ${state.subAgentToolCount || 0}/${state.subAgentBudget || 25} tool calls. Stay in scope; your scratch/ is cleaned up when you finish. Return final text in your response, not just in scratch.\n`
    : '';

  return `
# REMINDER (injected before each turn — NOT part of your system prompt)
${modeBadge}${modeChange}${lastUserMessage}

${loopWarning}${sameErrorStreakWarn}${testNag}${subAgentBudget}
[RECENT FILES TOUCHED]:
${recentFiles}
${taskProgressBlock}${scratchBlock}${handoffBlock}
[KEY RULES REMINDER]:
- JSON tool calls only (no code fences, no prose mixed in). Format: {"tool": "name", "param": "value"} or {"tools": [...]}.
- If you change code, WRITE A TEST and run it (./test_<feature>.<ext>). Do not claim done without it.
- After ANY tool error, your first action is read_file on the affected file. Not another write.
- DO NOT reset to zero. If a previous attempt partially succeeded, the files on disk have the partial state.
- DO NOT start a turn with a stalling preamble ("Let me think...", "I will now..."). Either call a tool or write the final answer.
- If you are about to assume something, call ask_user instead. NEVER silently pick.
- Final answer MUST include a self-test result line: "PASS  Self-test: ..." or "FAIL  Self-test: ...".
${recentErrors}
`;
}

module.exports = { buildReminderPrompt };
