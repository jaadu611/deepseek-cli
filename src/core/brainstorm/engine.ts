// ─────────────────────────────────────────────────────────────────────────────
// BRAINSTORM ENGINE — Sequential multi-level brainstorm pipeline
// All model calls are sequential (no parallelism)
// Uses the same browser page (single chat session)
// ─────────────────────────────────────────────────────────────────────────────

import tui from '../../tui/tui';
import brainRegistry from '../brains/registry';
import { createSession, saveMessage, setCurrentSessionId, updateSessionTitle, getCurrentSessionId } from '../history';
import {
  LEVEL1_INFRASTRUCTURE,
  LEVEL1_SECURITY,
  LEVEL1_CORE_LOGIC,
  LEVEL2_CRITIQUE,
  LEVEL2_REVIEW,
  LEVEL2_FOREMAN,
  LEVEL3_BLUEPRINT,
  DESTRUCTIVE_CRITIQUE,
  DESTRUCTIVE_REVIEW,
  DESTRUCTIVE_FOREMAN,
  DESTRUCTIVE_PATCH,
  FINAL_VERDICT,
  STATUS_MESSAGES,
} from './prompts';

// ── Helpers ──────────────────────────────────────────────────────────────────

function addStatus(logItems: any[], text: string) {
  logItems.push({ type: 'status', text });
  tui.renderLog();
}

function addAssistantMessage(logItems: any[], text: string) {
  logItems.push({ type: 'deepseek', text, spinning: false });
  tui.renderLog();
}

function addSpinningItem(logItems: any[], text: string) {
  const item = { type: 'deepseek', text: '', spinning: true, thinking: text };
  logItems.push(item);
  tui.renderLog();
  return item;
}

function updateSpinningItem(logItems: any[], item: any, thinking: string, text: string) {
  item.thinking = thinking;
  item.text = text;
  tui.renderLog();
}

function removeStatusByIndex(logItems: any[], idx: number) {
  if (idx >= 0 && idx < logItems.length) {
    logItems.splice(idx, 1);
    tui.renderLog();
  }
}

function removeSpinningItem(logItems: any[], item: any) {
  const idx = logItems.indexOf(item);
  if (idx !== -1) {
    logItems.splice(idx, 1);
    tui.renderLog();
  }
}

// Count issues from [ISSUES_COUNT: N] pattern
function extractIssueCount(text: string): number {
  const match = text.match(/\[ISSUES_COUNT:\s*(\d+)\]/i);
  if (match) return parseInt(match[1], 10);
  // Fallback: count lines in [ISSUES] ... [/ISSUES]
  const issueBlockMatch = text.match(/\[ISSUES\]([\s\S]*?)\[\/ISSUES\]/i);
  if (issueBlockMatch) {
    const issues = issueBlockMatch[1].trim().split('\n').filter(l => l.trim().startsWith('-'));
    return issues.length;
  }
  return -1; // unknown
}

// ── Main Pipeline ────────────────────────────────────────────────────────────

export async function runBrainstormPipeline(userPrompt: string): Promise<string> {
  const brain = brainRegistry.getActiveBrain();
  if (!brain || typeof (brain as any).getCompletionStream !== 'function') {
    throw new Error('No active brain available for brainstorm mode');
  }

  const logItems = tui.getLogItems();

  // ── Step 0: Create new chat in browser ───────────────────────────────────
  addStatus(logItems, STATUS_MESSAGES.STARTING as string);

  try {
    if (typeof (brain as any).createNewChat === 'function') {
      await (brain as any).createNewChat();
    }
  } catch (e) {
    // Fallback: try onSessionLoad(null) to open a fresh chat
    try {
      if (typeof (brain as any).onSessionLoad === 'function') {
        await (brain as any).onSessionLoad(null);
      }
    } catch (e2) {
      // Ignore errors, proceed anyway
    }
  }

  // ── Helper: call brain and get response ──────────────────────────────────
  async function callBrain(promptText: string, statusLabel: string): Promise<string> {
    const spin = addSpinningItem(logItems, statusLabel);
    let thinking = '';
    let response = '';

    try {
      const result = await (brain as any).getCompletionStream(promptText, {
        onStartCalled: () => {},
        onProgress: ({ thinking: t, text }: { thinking: string; text: string }) => {
          thinking = t || '';
          response = text || '';
          updateSpinningItem(logItems, spin, thinking, response);
        },
      });

      thinking = result.thinkingText || '';
      response = result.responseText || '';
      updateSpinningItem(logItems, spin, '', response);
    } catch (e: any) {
      removeSpinningItem(logItems, spin);
      addStatus(logItems, `⚠️ Error in ${statusLabel}: ${e.message}`);
      throw e;
    }

    removeSpinningItem(logItems, spin);
    return response || thinking || '';
  }

  // ════════════════════════════════════════════════════════════════════════════
  // LEVEL 1: Run 3 lenses sequentially
  // ════════════════════════════════════════════════════════════════════════════

  addStatus(logItems, STATUS_MESSAGES.L1_INFRA as string);
  const l1Infra = await callBrain(LEVEL1_INFRASTRUCTURE(userPrompt), STATUS_MESSAGES.L1_INFRA as string);

  addStatus(logItems, STATUS_MESSAGES.L1_SEC as string);
  const l1Sec = await callBrain(LEVEL1_SECURITY(userPrompt), STATUS_MESSAGES.L1_SEC as string);

  addStatus(logItems, STATUS_MESSAGES.L1_LOGIC as string);
  const l1Logic = await callBrain(LEVEL1_CORE_LOGIC(userPrompt), STATUS_MESSAGES.L1_LOGIC as string);

  addStatus(logItems, STATUS_MESSAGES.L1_DONE as string);

  // ════════════════════════════════════════════════════════════════════════════
  // LEVEL 2: Run 3 jury models sequentially
  // ════════════════════════════════════════════════════════════════════════════

  addStatus(logItems, STATUS_MESSAGES.L2_CRITIQUE as string);
  const l2Critique = await callBrain(LEVEL2_CRITIQUE(l1Infra, l1Sec, l1Logic), STATUS_MESSAGES.L2_CRITIQUE as string);

  addStatus(logItems, STATUS_MESSAGES.L2_REVIEW as string);
  const l2Review = await callBrain(LEVEL2_REVIEW(l1Infra, l1Sec, l1Logic, l2Critique), STATUS_MESSAGES.L2_REVIEW as string);

  addStatus(logItems, STATUS_MESSAGES.L2_FOREMAN as string);
  const l2Consensus = await callBrain(LEVEL2_FOREMAN(l1Infra, l1Sec, l1Logic, l2Critique, l2Review), STATUS_MESSAGES.L2_FOREMAN as string);

  addStatus(logItems, STATUS_MESSAGES.L2_DONE as string);

  // ════════════════════════════════════════════════════════════════════════════
  // LEVEL 3: Assemble blueprint
  // ════════════════════════════════════════════════════════════════════════════

  addStatus(logItems, STATUS_MESSAGES.L3_BLUEPRINT as string);
  let blueprint = await callBrain(LEVEL3_BLUEPRINT(l1Infra, l1Sec, l1Logic, l2Consensus), STATUS_MESSAGES.L3_BLUEPRINT as string);
  addStatus(logItems, STATUS_MESSAGES.L3_DONE as string);

  // ════════════════════════════════════════════════════════════════════════════
  // DESTRUCTIVE LOOP: Level 2 jury tries to break blueprint
  // Loops until [ISSUES_COUNT: 0]
  // ════════════════════════════════════════════════════════════════════════════

  let loopCount = 0;
  let maxLoops = 50; // Safety limit to prevent infinite loops
  while (loopCount < maxLoops) {
    loopCount++;
    addStatus(logItems, (STATUS_MESSAGES.DESTRUCT_START as (n: number) => string)(loopCount));

    addStatus(logItems, STATUS_MESSAGES.DESTRUCT_CRITIQUE as string);
    const ductCritique = await callBrain(
      DESTRUCTIVE_CRITIQUE(blueprint, l1Infra, l1Sec, l1Logic),
      STATUS_MESSAGES.DESTRUCT_CRITIQUE as string
    );

    addStatus(logItems, STATUS_MESSAGES.DESTRUCT_REVIEW as string);
    const ductReview = await callBrain(
      DESTRUCTIVE_REVIEW(blueprint, ductCritique),
      STATUS_MESSAGES.DESTRUCT_REVIEW as string
    );

    addStatus(logItems, STATUS_MESSAGES.DESTRUCT_FOREMAN as string);
    const ductForeman = await callBrain(
      DESTRUCTIVE_FOREMAN(ductCritique, ductReview),
      STATUS_MESSAGES.DESTRUCT_FOREMAN as string
    );

    const issuesCount = extractIssueCount(ductForeman);
    if (issuesCount === 0 || issuesCount === 0) {
      addStatus(logItems, STATUS_MESSAGES.DESTRUCT_DONE as string);
      break;
    }

    addStatus(logItems, (STATUS_MESSAGES.DESTRUCT_PATCH as (n: number) => string)(issuesCount));
    blueprint = await callBrain(
      DESTRUCTIVE_PATCH(blueprint, ductCritique, ductReview, ductForeman),
      (STATUS_MESSAGES.DESTRUCT_PATCH as (n: number) => string)(issuesCount)
    );
  }

  if (loopCount >= maxLoops) {
    addStatus(logItems, `⚠️ Destructive loop hit safety limit of ${maxLoops} iterations. Proceeding with current blueprint.`);
  }

  // ════════════════════════════════════════════════════════════════════════════
  // FINAL: Brutal verdict + polished blueprint
  // ════════════════════════════════════════════════════════════════════════════

  addStatus(logItems, STATUS_MESSAGES.FINAL as string);
  const finalResult = await callBrain(
    FINAL_VERDICT(l1Infra, l1Sec, l1Logic, l2Critique, l2Review, l2Consensus, blueprint),
    STATUS_MESSAGES.FINAL as string
  );

  addStatus(logItems, STATUS_MESSAGES.COMPLETE as string);

  // ── Save to session ──────────────────────────────────────────────────────
  const sid = getCurrentSessionId();
  if (sid) {
    const fullPaperTrail =
      `\n\n--- BRAINSTORM PIPELINE RESULTS ---\n\n` +
      `## LEVEL 1 — INFRASTRUCTURE\n${l1Infra}\n\n` +
      `## LEVEL 1 — SECURITY\n${l1Sec}\n\n` +
      `## LEVEL 1 — CORE LOGIC\n${l1Logic}\n\n` +
      `## LEVEL 2 — CRITIQUE (Model A)\n${l2Critique}\n\n` +
      `## LEVEL 2 — REVIEW (Model B)\n${l2Review}\n\n` +
      `## LEVEL 2 — CONSENSUS (Model C)\n${l2Consensus}\n\n` +
      `## LEVEL 3 — BLUEPRINT\n${blueprint}\n\n` +
      `## FINAL VERDICT\n${finalResult}\n`;
    saveMessage(sid, 'assistant', finalResult, { thinking: fullPaperTrail });
  }

  // ── Display final result ─────────────────────────────────────────────────
  addAssistantMessage(logItems, finalResult);

  return finalResult;
}