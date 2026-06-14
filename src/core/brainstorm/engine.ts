// ─────────────────────────────────────────────────────────────────────────────
// BRAINSTORM ENGINE — Sequential multi-level brainstorm pipeline
//
// TAB STRATEGY: 3 L1/L2 tabs + 3 fresh destructive loop tabs + 1 research tab
//   - Level 0: 1 fresh tab for web research (closed after use)
//   - Level 1: Creates 3 persistent tabs (Tab A / B / C) — run IN PARALLEL
//   - Level 2: Reuses the same 3 tabs (models see Level 1 output in chat)
//   - Level 3 (Plan): Reuses Tab A — runs BEFORE destructive loop
//   - Destructive Loop: Creates 3 FRESH tabs (avoids context bloat from L1/L2)
//     Starts from the L3 plan (not empty string).
//     Each loop iteration uses the same destructive tabs (clean context).
//     Previous issues are passed via prompt to prevent re-raising fixed issues.
//   - Final Verdict: Reuses Tab A with the destructive loop's refined plan
//
// FIXED ORDER (vs original):
//   BEFORE: L1 → L2 → Destructive Loop (empty plan) → L3 overwrites → Final
//   AFTER:  L1 → L2 → L3 → Destructive Loop (L3 plan) → Final (refined plan)
//
// Destructive loop uses fresh tabs because reusing L1/L2 tabs caused:
//   - Massive context accumulation (10+ rounds of critique/review/patch)
//   - Models finding new issues from accumulated context instead of converging
//   - Issue counts oscillating (13→10→16→15→15→15→-1→15→-1→13)
//
// Total tabs: 7 max (1 research + 3 L1/L2 + 3 destructive loop)
//
// EVIDENCE FOLDER: ~/.ds_config/brainstorm_evidence/<timestamp>/
//   All outputs saved to disk for cross-level reference.
// ─────────────────────────────────────────────────────────────────────────────

const tui = require('../../tui/tui');
const brainRegistry = require('../brains/registry');
const { createSession, saveMessage, setCurrentSessionId, updateSessionTitle, getCurrentSessionId } = require('../history');
const fs = require('fs');
const path = require('path');
const os = require('os');
import {
  LEVEL0_RESEARCH,
  LEVEL1_MARKET,
  LEVEL1_FEASIBILITY,
  LEVEL1_REALITY_CHECK,
  LEVEL2_CRITIQUE,
  LEVEL2_REVIEW,
  LEVEL2_FOREMAN,
  LEVEL3_PLAN,
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
  const issueBlockMatch = text.match(/\[ISSUES\]([\s\S]*?)\[\/ISSUES\]/i);
  if (issueBlockMatch) {
    const issues = issueBlockMatch[1].trim().split('\n').filter(l => l.trim().startsWith('-'));
    return issues.length;
  }
  return -1;
}

// ── Evidence folder management ──────────────────────────────────────────────

function createEvidenceFolder(): string {
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const evidenceDir = path.join(os.homedir(), '.ds_config', 'brainstorm_evidence', timestamp);
  fs.mkdirSync(evidenceDir, { recursive: true });
  return evidenceDir;
}

function saveEvidence(evidenceDir: string, filename: string, content: string) {
  const filePath = path.join(evidenceDir, filename);
  fs.writeFileSync(filePath, content, 'utf8');
  return filePath;
}

// ── Checkpoint management for destructive loop ────────────────────────────────

interface DestructCheckpoint {
  loopCount: number;
  step: 'critique' | 'review' | 'foreman' | 'patch' | 'next';
  plan: string;
  previousIssues: string[];
  ductCritique?: string;
  ductReview?: string;
  ductForeman?: string;
}

function saveCheckpoint(evidenceDir: string, checkpoint: DestructCheckpoint) {
  const filePath = path.join(evidenceDir, '_destruct_checkpoint.json');
  fs.writeFileSync(filePath, JSON.stringify(checkpoint, null, 2), 'utf8');
}

function loadCheckpoint(evidenceDir: string): DestructCheckpoint | null {
  const filePath = path.join(evidenceDir, '_destruct_checkpoint.json');
  if (!fs.existsSync(filePath)) return null;
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return null;
  }
}

function clearCheckpoint(evidenceDir: string) {
  const filePath = path.join(evidenceDir, '_destruct_checkpoint.json');
  if (fs.existsSync(filePath)) {
    fs.unlinkSync(filePath);
  }
}

// ── Pipeline state for crash recovery ────────────────────────────────────────

interface PipelineState {
  userPrompt: string;
  evidenceDir: string;
  level: string; // 'L0' | 'L1' | 'L2' | 'L3' | 'destructive' | 'final'
  step: string;  // sub-step within level, e.g. 'market', 'critique', 'foreman'
  loopCount?: number;
  loopStep?: string;
  // Completed outputs (loaded from evidence files on resume)
  research?: string;
  l1Market?: string;
  l1Feasibility?: string;
  l1Reality?: string;
  l2Critique?: string;
  l2Review?: string;
  l2Consensus?: string;
  l3Plan?: string;
  plan?: string;
  previousIssues?: string[];
  timestamp: number;
}

const PIPELINE_STATE_FILE = '_pipeline_state.json';

function savePipelineState(state: PipelineState) {
  const filePath = path.join(state.evidenceDir, PIPELINE_STATE_FILE);
  fs.writeFileSync(filePath, JSON.stringify(state, null, 2), 'utf8');
}

function loadPipelineState(evidenceDir: string): PipelineState | null {
  const filePath = path.join(evidenceDir, PIPELINE_STATE_FILE);
  if (!fs.existsSync(filePath)) return null;
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return null;
  }
}

function clearPipelineState(evidenceDir: string) {
  const filePath = path.join(evidenceDir, PIPELINE_STATE_FILE);
  if (fs.existsSync(filePath)) {
    fs.unlinkSync(filePath);
  }
}

function loadEvidenceIfExists(evidenceDir: string, filename: string): string {
  const filePath = path.join(evidenceDir, filename);
  if (!fs.existsSync(filePath)) return '';
  try {
    return fs.readFileSync(filePath, 'utf8').trim();
  } catch {
    return '';
  }
}

// Returns the latest pipeline state file from any brainstorm evidence folder
export function findLatestPipelineState(): PipelineState | null {
  const brainstormDir = path.join(os.homedir(), '.ds_config', 'brainstorm_evidence');
  if (!fs.existsSync(brainstormDir)) return null;
  
  const dirs = fs.readdirSync(brainstormDir)
    .filter(d => fs.statSync(path.join(brainstormDir, d)).isDirectory())
    .sort()
    .reverse();
  
  for (const dir of dirs) {
    const state = loadPipelineState(path.join(brainstormDir, dir));
    if (state) return state;
  }
  return null;
}

const MAX_CALL_RETRIES = 3;
const RETRY_DELAY_MS = 5000;

// Helper to retry a brain call with backoff
async function retryCallBrain(
  callFn: () => Promise<string>,
  logItems: any[],
  label: string,
  maxRetries: number = MAX_CALL_RETRIES,
): Promise<string> {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      return await callFn();
    } catch (e: any) {
      addStatus(logItems, `⚠️ ${label} failed (attempt ${attempt}/${maxRetries}): ${e.message}`);
      if (attempt < maxRetries) {
        const delay = RETRY_DELAY_MS * attempt;
        addStatus(logItems, `🔄 Retrying ${label} in ${delay / 1000}s...`);
        await new Promise(r => setTimeout(r, delay));
      } else {
        throw e;
      }
    }
  }
  throw new Error(`unreachable: retry loop exhausted`);
}

// ── Main Pipeline ────────────────────────────────────────────────────────────

export async function runBrainstormPipeline(userPrompt: string): Promise<string> {
  const brain = brainRegistry.getActiveBrain();
  if (!brain || typeof (brain as any).getCompletionStream !== 'function') {
    throw new Error('No active brain available for brainstorm mode');
  }

  const logItems = tui.getLogItems();

  // ── Create evidence folder ──────────────────────────────────────────────
  const evidenceDir = createEvidenceFolder();
  addStatus(logItems, `📁 Evidence folder: ${evidenceDir}`);
  saveEvidence(evidenceDir, '00_original_idea.md', `# Original Idea\n\n${userPrompt}\n`);

  // ── Helper: create new browser tab ──────────────────────────────────────
  async function newTab(): Promise<any> {
    const page = await (brain as any).createNewPage();
    await new Promise(r => setTimeout(r, 1000));
    return page;
  }

  // ── Helper: call brain on a specific page ───────────────────────────────
  async function callBrainOnPage(page: any, promptText: string, statusLabel: string): Promise<string> {
    const spin = addSpinningItem(logItems, statusLabel);
    let thinking = '';
    let response = '';

    try {
      const result = await (brain as any).getCompletionStream(promptText, {
        page,
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
  // LEVEL 0: Web Research — fresh single tab, CLOSED after use
  // ════════════════════════════════════════════════════════════════════════════

  addStatus(logItems, STATUS_MESSAGES.L0_RESEARCH as string);
  const researchTab = await newTab();
  const research = await callBrainOnPage(researchTab, LEVEL0_RESEARCH(userPrompt), STATUS_MESSAGES.L0_RESEARCH as string);
  saveEvidence(evidenceDir, '01_level0_research.md', research);

  // FIX: Close the research tab — it was leaking before
  try { await (researchTab as any).close?.(); } catch {}
  addStatus(logItems, STATUS_MESSAGES.L0_DONE as string);

  // ════════════════════════════════════════════════════════════════════════════
  // LEVEL 1: Three Analysts — CREATE 3 PERSISTENT TABS, run IN PARALLEL
  // All three analysts get identical inputs so there's no reason to run them
  // sequentially. Promise.all() cuts L1 time by ~66%.
  // These tabs are reused for L2 and L3/Final (but NOT the destructive loop).
  // ════════════════════════════════════════════════════════════════════════════

  addStatus(logItems, '📊 Level 1 — Opening 3 persistent tabs (reuse throughout)...');
  const tabA = await newTab(); // Market → Critique → Plan → Final
  const tabB = await newTab(); // Feasibility → Review
  const tabC = await newTab(); // Reality Check → Foreman
  addStatus(logItems, '📊 Level 1 — Running all 3 analysts in parallel...');

  // FIX: Run L1 analysts in parallel — they are fully independent.
  // Use Promise.allSettled so one tab's failure doesn't kill the whole pipeline.
  // Each analyst also gets engine-level retries via retryCallBrain (3 attempts),
  // in addition to the internal 5 retries within getCompletionStream.
  const l1Results = await Promise.allSettled([
    retryCallBrain(
      () => callBrainOnPage(tabA, LEVEL1_MARKET(userPrompt, research), STATUS_MESSAGES.L1_MARKET as string),
      logItems,
      STATUS_MESSAGES.L1_MARKET as string,
    ),
    retryCallBrain(
      () => callBrainOnPage(tabB, LEVEL1_FEASIBILITY(userPrompt, research), STATUS_MESSAGES.L1_FEASIBILITY as string),
      logItems,
      STATUS_MESSAGES.L1_FEASIBILITY as string,
    ),
    retryCallBrain(
      () => callBrainOnPage(tabC, LEVEL1_REALITY_CHECK(userPrompt, research), STATUS_MESSAGES.L1_REALITY as string),
      logItems,
      STATUS_MESSAGES.L1_REALITY as string,
    ),
  ]);

  const l1Market = l1Results[0].status === 'fulfilled' ? l1Results[0].value : '';
  const l1Feasibility = l1Results[1].status === 'fulfilled' ? l1Results[1].value : '';
  const l1Reality = l1Results[2].status === 'fulfilled' ? l1Results[2].value : '';

  // Log any failures but continue with what we have
  for (let i = 0; i < l1Results.length; i++) {
    if (l1Results[i].status === 'rejected') {
      const labels = ['Market Analysis', 'Feasibility Analysis', 'Reality Check'];
      addStatus(logItems, `⚠️ ${labels[i]} failed: ${(l1Results[i] as PromiseRejectedResult).reason?.message || 'unknown error'}. Continuing with remaining results.`);
    }
  }

  saveEvidence(evidenceDir, '02_level1_market.md', l1Market);
  saveEvidence(evidenceDir, '03_level1_feasibility.md', l1Feasibility);
  saveEvidence(evidenceDir, '04_level1_reality_check.md', l1Reality);
  addStatus(logItems, STATUS_MESSAGES.L1_DONE as string);

  // Save pipeline state for crash recovery
  savePipelineState({ userPrompt, evidenceDir, level: 'L2', step: 'critique', research, l1Market, l1Feasibility, l1Reality, timestamp: Date.now() });

  // ════════════════════════════════════════════════════════════════════════════
  // LEVEL 2: Three Jury Models — REUSE Level 1's 3 tabs
  // Models see Level 1 output in the same chat history.
  // L2 is inherently sequential: Review needs Critique, Foreman needs both.
  // ════════════════════════════════════════════════════════════════════════════

  addStatus(logItems, '⚖️  Level 2 — Reusing 3 tabs for jury debate...');

  addStatus(logItems, STATUS_MESSAGES.L2_CRITIQUE as string);
  const l2Critique = await callBrainOnPage(
    tabA,
    LEVEL2_CRITIQUE(l1Market, l1Feasibility, l1Reality, research),
    STATUS_MESSAGES.L2_CRITIQUE as string
  );
  saveEvidence(evidenceDir, '05_level2_critique.md', l2Critique);

  addStatus(logItems, STATUS_MESSAGES.L2_REVIEW as string);
  const l2Review = await callBrainOnPage(
    tabB,
    LEVEL2_REVIEW(l1Market, l1Feasibility, l1Reality, l2Critique, research),
    STATUS_MESSAGES.L2_REVIEW as string
  );
  saveEvidence(evidenceDir, '06_level2_review.md', l2Review);

  addStatus(logItems, STATUS_MESSAGES.L2_FOREMAN as string);
  const l2Consensus = await callBrainOnPage(
    tabC,
    LEVEL2_FOREMAN(l1Market, l1Feasibility, l1Reality, l2Critique, l2Review, research),
    STATUS_MESSAGES.L2_FOREMAN as string
  );
  saveEvidence(evidenceDir, '07_level2_foreman.md', l2Consensus);
  addStatus(logItems, STATUS_MESSAGES.L2_DONE as string);

  // ════════════════════════════════════════════════════════════════════════════
  // LEVEL 3: Strategic Plan — REUSE Tab A, runs BEFORE destructive loop
  //
  // FIX: This was running AFTER the destructive loop and overwriting its output.
  // Now it runs first and produces the initial plan the destructive loop will
  // iterate on. The destructive loop starts with a real plan, not an empty string.
  // ════════════════════════════════════════════════════════════════════════════

  addStatus(logItems, STATUS_MESSAGES.L3_PLAN as string);
  const l3Plan = await callBrainOnPage(
    tabA,
    LEVEL3_PLAN(l1Market, l1Feasibility, l1Reality, l2Consensus, research),
    STATUS_MESSAGES.L3_PLAN as string
  );
  saveEvidence(evidenceDir, '08_level3_plan.md', l3Plan);
  addStatus(logItems, STATUS_MESSAGES.L3_DONE as string);

  // ════════════════════════════════════════════════════════════════════════════
  // DESTRUCTIVE LOOP: 3 FRESH tabs (same roles, but no L1/L2/L3 history)
  //
  // FIX: Now starts from l3Plan instead of an empty string. The destructive
  // loop's job is to find flaws in the real plan and patch them — not to build
  // a plan from scratch that never reaches the final output.
  //
  // Fresh tabs prevent context bloat that caused issue count oscillation.
  // Previous issues tracked via prompt to prevent re-raising fixed items.
  // Loops until [ISSUES_COUNT: 0] or maxLoops reached.
  // ════════════════════════════════════════════════════════════════════════════

  addStatus(logItems, '🔄 Destructive loop — creating fresh tabs for iterative debate...');
  const destructTabA = await newTab(); // Critique + Patch
  const destructTabB = await newTab(); // Review
  const destructTabC = await newTab(); // Foreman

  // ── Checkpoint: load if resuming from a crash ──────────────────────────
  // FIX: plan starts from l3Plan, not '' — so a resumed run also benefits
  let plan = l3Plan;
  let loopCount = 0;
  let maxLoops = Infinity;
  let previousIssues: string[] = [];
  let ductCritique = '';
  let ductReview = '';
  let ductForeman = '';
  let resumeStep: 'critique' | 'review' | 'foreman' | 'patch' | 'next' = 'critique';

  const existingCheckpoint = loadCheckpoint(evidenceDir);
  if (existingCheckpoint) {
    plan = existingCheckpoint.plan;
    previousIssues = existingCheckpoint.previousIssues;
    ductCritique = existingCheckpoint.ductCritique || '';
    ductReview = existingCheckpoint.ductReview || '';
    ductForeman = existingCheckpoint.ductForeman || '';
    resumeStep = existingCheckpoint.step;
    if (resumeStep === 'next') {
      loopCount = existingCheckpoint.loopCount;
    } else {
      loopCount = existingCheckpoint.loopCount - 1;
    }
    addStatus(logItems, `📂 Resuming destructive loop from Loop #${existingCheckpoint.loopCount}, step: ${resumeStep}`);
  }

  while (true) {
    loopCount++;
    addStatus(logItems, (STATUS_MESSAGES.DESTRUCT_START as (n: number) => string)(loopCount));

    // ── Step: Critique ──────────────────────────────────────────────────
    if (resumeStep === 'critique' || !ductCritique) {
      addStatus(logItems, STATUS_MESSAGES.DESTRUCT_CRITIQUE as string);
      ductCritique = await retryCallBrain(
        () => callBrainOnPage(
          destructTabA,
          DESTRUCTIVE_CRITIQUE(plan, research, previousIssues),
          STATUS_MESSAGES.DESTRUCT_CRITIQUE as string
        ),
        logItems,
        STATUS_MESSAGES.DESTRUCT_CRITIQUE as string,
      );
      saveEvidence(evidenceDir, `09_destruct_loop${loopCount}_critique.md`, ductCritique);
      saveCheckpoint(evidenceDir, { loopCount, step: 'review', plan, previousIssues, ductCritique, ductReview, ductForeman });
    }
    resumeStep = 'review';

    // ── Step: Review ────────────────────────────────────────────────────
    if (resumeStep === 'review' || !ductReview) {
      addStatus(logItems, STATUS_MESSAGES.DESTRUCT_REVIEW as string);
      ductReview = await retryCallBrain(
        () => callBrainOnPage(
          destructTabB,
          DESTRUCTIVE_REVIEW(plan, ductCritique, research),
          STATUS_MESSAGES.DESTRUCT_REVIEW as string
        ),
        logItems,
        STATUS_MESSAGES.DESTRUCT_REVIEW as string,
      );
      saveEvidence(evidenceDir, `10_destruct_loop${loopCount}_review.md`, ductReview);
      saveCheckpoint(evidenceDir, { loopCount, step: 'foreman', plan, previousIssues, ductCritique, ductReview, ductForeman });
    }
    resumeStep = 'foreman';

    // ── Step: Foreman ───────────────────────────────────────────────────
    if (resumeStep === 'foreman' || !ductForeman) {
      addStatus(logItems, STATUS_MESSAGES.DESTRUCT_FOREMAN as string);
      ductForeman = await retryCallBrain(
        () => callBrainOnPage(
          destructTabC,
          DESTRUCTIVE_FOREMAN(ductCritique, ductReview, previousIssues),
          STATUS_MESSAGES.DESTRUCT_FOREMAN as string
        ),
        logItems,
        STATUS_MESSAGES.DESTRUCT_FOREMAN as string,
      );
      saveEvidence(evidenceDir, `11_destruct_loop${loopCount}_foreman.md`, ductForeman);
      saveCheckpoint(evidenceDir, { loopCount, step: 'patch', plan, previousIssues, ductCritique, ductReview, ductForeman });
    }
    resumeStep = 'patch';

    // ── Check issues ────────────────────────────────────────────────────
    const issuesCount = extractIssueCount(ductForeman);
    if (issuesCount === 0) {
      addStatus(logItems, STATUS_MESSAGES.DESTRUCT_DONE as string);
      clearCheckpoint(evidenceDir);
      break;
    }
    if (issuesCount === -1) {
      addStatus(logItems, `⚠️ Loop ${loopCount}: Foreman did not include [ISSUES_COUNT]. Treating as 1 issue.`);
    }

    // Extract the actual issues list from the foreman output for tracking
    const issueBlockMatch = ductForeman.match(/\[ISSUES\]([\s\S]*?)\[\/ISSUES\]/i);
    if (issueBlockMatch) {
      const newIssues = issueBlockMatch[1]
        .trim()
        .split('\n')
        .filter(l => l.trim().startsWith('-'))
        .map(l => l.trim());
      previousIssues = [...previousIssues, ...newIssues];
    }

    // ── Step: Patch ─────────────────────────────────────────────────────
    const effectiveCount = issuesCount === -1 ? 1 : issuesCount;
    addStatus(logItems, (STATUS_MESSAGES.DESTRUCT_PATCH as (n: number) => string)(effectiveCount));
    plan = await retryCallBrain(
      () => callBrainOnPage(
        destructTabA,
        DESTRUCTIVE_PATCH(plan, ductCritique, ductReview, ductForeman),
        (STATUS_MESSAGES.DESTRUCT_PATCH as (n: number) => string)(effectiveCount)
      ),
      logItems,
      (STATUS_MESSAGES.DESTRUCT_PATCH as (n: number) => string)(effectiveCount),
    );
    saveEvidence(evidenceDir, `12_destruct_loop${loopCount}_patched_plan.md`, plan);

    // ── Reset for next loop ─────────────────────────────────────────────
    ductCritique = '';
    ductReview = '';
    ductForeman = '';
    resumeStep = 'critique';
    saveCheckpoint(evidenceDir, { loopCount, step: 'next', plan, previousIssues });
  }

  // Close destructive loop tabs
  try { await (destructTabA as any).close?.(); } catch {}
  try { await (destructTabB as any).close?.(); } catch {}
  try { await (destructTabC as any).close?.(); } catch {}

  clearCheckpoint(evidenceDir);

  // Save the final refined plan from the destructive loop
  saveEvidence(evidenceDir, '12_final_refined_plan.md', plan);

  // ════════════════════════════════════════════════════════════════════════════
  // FINAL: Brutal truth verdict — REUSE Tab A (sees full L1+L2+L3 history)
  //
  // FIX: `plan` is now the destructive loop's battle-tested output, not the
  // L3 plan that was being passed before. The final verdict reflects the full
  // pipeline: research → analysis → jury → plan → adversarial iteration → truth.
  // ════════════════════════════════════════════════════════════════════════════

  addStatus(logItems, STATUS_MESSAGES.FINAL as string);
  const finalResult = await callBrainOnPage(
    tabA,
    FINAL_VERDICT(l1Market, l1Feasibility, l1Reality, l2Critique, l2Review, l2Consensus, plan, research),
    STATUS_MESSAGES.FINAL as string
  );
  saveEvidence(evidenceDir, '13_final_verdict.md', finalResult);

  addStatus(logItems, STATUS_MESSAGES.COMPLETE as string);
  addStatus(logItems, `📁 All evidence saved to: ${evidenceDir}`);

  // ── Save to session ──────────────────────────────────────────────────────
  const sid = getCurrentSessionId();
  if (sid) {
    const fullPaperTrail =
      `\n\n--- BRAINSTORM PIPELINE RESULTS ---\n\n` +
      `📁 Evidence folder: ${evidenceDir}\n\n` +
      `## LEVEL 0 — WEB RESEARCH\n${research}\n\n` +
      `## LEVEL 1 — MARKET ANALYSIS\n${l1Market}\n\n` +
      `## LEVEL 1 — FEASIBILITY ANALYSIS\n${l1Feasibility}\n\n` +
      `## LEVEL 1 — REALITY CHECK\n${l1Reality}\n\n` +
      `## LEVEL 2 — CRITIQUE (Model A)\n${l2Critique}\n\n` +
      `## LEVEL 2 — REVIEW (Model B)\n${l2Review}\n\n` +
      `## LEVEL 2 — CONSENSUS (Model C)\n${l2Consensus}\n\n` +
      `## LEVEL 3 — INITIAL PLAN (pre-destructive loop)\n${l3Plan}\n\n` +
      `## LEVEL 3 — REFINED PLAN (post-destructive loop)\n${plan}\n\n` +
      `## FINAL VERDICT\n${finalResult}\n`;
    saveMessage(sid, 'assistant', finalResult, { thinking: fullPaperTrail });
  }

  // ── Display final result ─────────────────────────────────────────────────
  addAssistantMessage(logItems, finalResult);

  return finalResult;
}