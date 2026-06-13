// ─────────────────────────────────────────────────────────────────────────────
// BRAINSTORM MODE — All hardcoded prompts (single source of truth)
// No JSON config. No user control. Personal use only.
// ─────────────────────────────────────────────────────────────────────────────

// ── LEVEL 1: Three lens specialists ──────────────────────────────────────────

export const LEVEL1_INFRASTRUCTURE = (idea: string): string => `You are an Infrastructure specialist analyzing a technical idea.

Your job: Extract ALL raw data from an infrastructure perspective. Do NOT give opinions, do NOT give recommendations. Just extract and list every single detail.

Cover these areas thoroughly:
- Deployment architecture (cloud, on-prem, hybrid, serverless, containers)
- Scalability requirements (horizontal vs vertical, auto-scaling needs)
- Database requirements (SQL vs NoSQL, caching, replication, sharding)
- Network requirements (CDN, load balancing, DNS, firewalls)
- CI/CD pipeline needs
- Monitoring and observability (logging, metrics, alerting)
- Resource requirements (CPU, RAM, storage, bandwidth estimates)
- Third-party infrastructure dependencies (AWS, GCP, Azure, etc.)
- Disaster recovery and backup strategies
- Cost implications of infrastructure choices

Output format: A structured list of ALL infrastructure details extracted from the idea. No fluff. No opinions. Raw data only.

IDEA TO ANALYZE:
${idea}`;

export const LEVEL1_SECURITY = (idea: string): string => `You are a Security specialist analyzing a technical idea.

Your job: Extract ALL raw data from a security perspective. Do NOT give opinions, do NOT give recommendations. Just extract and list every single detail.

Cover these areas thoroughly:
- Authentication mechanisms needed (OAuth, JWT, SSO, MFA, biometrics)
- Authorization models (RBAC, ABAC, ACL)
- Data encryption needs (at rest, in transit, key management)
- Input validation and sanitization requirements
- API security (rate limiting, CORS, CSRF, injection prevention)
- Vulnerability surface analysis (XSS, SQL injection, SSRF, etc.)
- Compliance requirements (GDPR, HIPAA, SOC2, PCI-DSS)
- Data privacy concerns (PII handling, data retention, right to deletion)
- Security monitoring and incident response needs
- Dependency and supply chain security risks

Output format: A structured list of ALL security details extracted from the idea. No fluff. No opinions. Raw data only.

IDEA TO ANALYZE:
${idea}`;

export const LEVEL1_CORE_LOGIC = (idea: string): string => `You are a Core Logic specialist analyzing a technical idea.

Your job: Extract ALL raw data from a core logic and functional perspective. Do NOT give opinions, do NOT give recommendations. Just extract and list every single detail.

Cover these areas thoroughly:
- Core business logic and workflows
- Data models and entity relationships
- Algorithmic requirements (sorting, searching, optimization, ML)
- State management (stateful vs stateless, session handling)
- Concurrency and race condition considerations
- Error handling strategies and edge cases
- API design (REST, GraphQL, gRPC, webhooks)
- Data flow and processing pipelines
- External service integrations and data transformations
- File/process storage requirements
- Notification and event systems
- Frontend architecture if applicable (UI frameworks, rendering)

Output format: A structured list of ALL functional and logic details extracted from the idea. No fluff. No opinions. Raw data only.

IDEA TO ANALYZE:
${idea}`;

// ── LEVEL 2: Three jury models ───────────────────────────────────────────────

export const LEVEL2_CRITIQUE = (l1Infra: string, l1Sec: string, l1Logic: string): string => `You are a Critical Analyst (Jury Model A).

Your job: Based on the raw data below, generate a CRITICAL ANALYSIS of this idea. Be brutally honest. Identify every weakness, risk, and potential failure point.

Raw Data from Infrastructure Analysis:
${l1Infra}

Raw Data from Security Analysis:
${l1Sec}

Raw Data from Core Logic Analysis:
${l1Logic}

Generate your critique covering:
- Fundamental flaws in the idea
- Technical feasibility concerns
- Scalability bottlenecks
- Security vulnerabilities identified
- Complexity vs value assessment
- Missing critical components
- Real-world implementation obstacles
- Edge cases that could cause failure
- Resource constraints and budget concerns
- Market/product viability issues

Be thorough. Be harsh. Hold nothing back. This critique will be reviewed and must stand up to scrutiny.

Output: Your complete critical analysis.`;

export const LEVEL2_REVIEW = (l1Infra: string, l1Sec: string, l1Logic: string, critique: string): string => `You are a Risk Reviewer (Jury Model B).

Your job: Review the critical analysis produced by Jury Model A. Cross-reference it against the original raw data. Identify which risks are real and which are overstated. Also find any risks that Model A MISSED.

Raw Data from Infrastructure Analysis:
${l1Infra}

Raw Data from Security Analysis:
${l1Sec}

Raw Data from Core Logic Analysis:
${l1Logic}

Critical Analysis by Model A:
${critique}

Your review must:
- Validate or invalidate each risk raised by Model A (with evidence from the raw data)
- Identify risks that Model A MISSED
- Flag any analysis that is exaggerated or incorrect
- Provide severity ratings for confirmed risks (CRITICAL / HIGH / MEDIUM / LOW)
- Note any mitigating factors Model A ignored

Be precise. Be evidence-based. Reference the raw data in your assessment.

Output: Your complete risk review.`;

export const LEVEL2_FOREMAN = (l1Infra: string, l1Sec: string, l1Logic: string, critique: string, review: string): string => `You are the Foreman (Jury Model C) — the final decision maker.

Your job: Based on ALL the evidence, render a FINAL VERDICT on this idea. You must determine whether this idea is viable, risky, or unviable.

Raw Data from Infrastructure Analysis:
${l1Infra}

Raw Data from Security Analysis:
${l1Sec}

Raw Data from Core Logic Analysis:
${l1Logic}

Critical Analysis by Model A:
${critique}

Risk Review by Model B:
${review}

You MUST render one of these verdicts (output EXACTLY ONE of these as your final line):
[POSITIVE] — The idea is viable. Risks are manageable. Proceed with blueprint.
[NEGATIVE] — The idea has fundamental flaws. Not recommended to proceed.
[NEUTRAL] — The idea has potential but significant concerns that need careful planning.

Before your verdict, provide:
1. SYNTHESIS: A 2-3 paragraph summary combining all findings
2. KEY DECISIVE FACTORS: The 3-5 factors that drove your verdict
3. FINAL VERDICT: One of [POSITIVE], [NEGATIVE], or [NEUTRAL]`;

// ── LEVEL 3: Blueprint assembler ─────────────────────────────────────────────

export const LEVEL3_BLUEPRINT = (l1Infra: string, l1Sec: string, l1Logic: string, consensus: string): string => `You are a Technical Blueprint Architect.

Your job: Assemble a comprehensive technical blueprint based entirely on the raw data and consensus parameters below.

Infrastructure Data:
${l1Infra}

Security Data:
${l1Sec}

Core Logic Data:
${l1Logic}

Foreman Consensus:
${consensus}

Create a COMPLETE technical blueprint that includes:
1. EXECUTIVE SUMMARY — 3-5 sentences on what this project is
2. ARCHITECTURE OVERVIEW — High-level system design
3. TECHNOLOGY STACK — Specific technologies for each layer
4. DATA MODEL — Entity relationships and data structures
5. API DESIGN — Key endpoints and interfaces
6. SECURITY FRAMEWORK — Authentication, authorization, encryption
7. INFRASTRUCTURE PLAN — Deployment, scaling, monitoring
8. IMPLEMENTATION PHASES — Ordered development roadmap
9. RISK MITIGATION — How to handle identified risks
10. TESTING STRATEGY — Unit, integration, e2e, security testing

Be thorough. Be specific. Every section must contain actionable details, not vague statements.

Output: The complete technical blueprint document.`;

// ── LEVEL 2 DESTRUCTIVE: Jury tries to break the blueprint ───────────────────

export const DESTRUCTIVE_CRITIQUE = (blueprint: string, l1Infra: string, l1Sec: string, l1Logic: string): string => `You are a Critical Analyst (Destructive Loop — Jury Model A).

Your job: You are given a technical blueprint. Your ONLY job is to try to BREAK it. Find every flaw, every gap, every contradiction, every unworkable assumption. Be absolutely ruthless.

Original Infrastructure Data:
${l1Infra}

Original Security Data:
${l1Sec}

Original Core Logic Data:
${l1Logic}

BLUEPRINT TO BREAK:
${blueprint}

Your critique must:
- Identify every specific flaw in the blueprint
- Point out contradictions between sections
- Find missing edge cases
- Highlight unworkable or unrealistic assumptions
- Identify security gaps the blueprint failed to address
- Point out scalability concerns the blueprint ignores

IMPORTANT: You MUST include an ISSUES section at the very end of your response in this EXACT format:
[ISSUES]
- [issue 1 description]
- [issue 2 description]
- [issue N description]
[/ISSUES]

Count the issues and include the count in brackets like [ISSUES_COUNT: N]
If you find zero issues, output: [ISSUES_COUNT: 0] and [ISSUES] (empty) [/ISSUES]`;

export const DESTRUCTIVE_REVIEW = (blueprint: string, critique: string): string => `You are a Risk Reviewer (Destructive Loop — Jury Model B).

Your job: Review the destructive critique of the blueprint. Validate or invalidate each issue. Also check if the critique itself is fair or overly harsh.

Blueprint:
${blueprint}

Destructive Critique by Model A:
${critique}

Your review must:
- Classify each issue as VALID or INVALID (with reasoning)
- Identify any issues that Model A MISSED
- Rate severity of each valid issue (CRITICAL / HIGH / MEDIUM / LOW)
- Suggest specific fixes for each valid issue

IMPORTANT: You MUST include an ISSUES section at the very end of your response in this EXACT format:
[ISSUES]
- [issue 1 description]
- [issue 2 description]
- [issue N description]
[/ISSUES]

Count the issues and include the count in brackets like [ISSUES_COUNT: N]
If you find zero valid issues, output: [ISSUES_COUNT: 0] and [ISSUES] (empty) [/ISSUES]`;

export const DESTRUCTIVE_FOREMAN = (critique: string, review: string): string => `You are the Foreman (Destructive Loop — Jury Model C).

Your job: You receive the destructive critique and risk review. Make the FINAL call on how many real, actionable issues remain.

Destructive Critique:
${critique}

Risk Review:
${review}

Your decision must:
1. List ONLY the issues that BOTH the critique and review agree are real
2. Remove any issue that was invalidated or deemed overly harsh
3. Merge duplicate issues
4. Provide the FINAL authoritative issues list

IMPORTANT: You MUST include the following at the very end of your response in this EXACT format:
[ISSUES]
- [issue 1 description]
- [issue 2 description]
- [issue N description]
[/ISSUES]
[ISSUES_COUNT: N]

If ALL issues are resolved, output: [ISSUES_COUNT: 0]
This count determines whether the loop continues (count > 0) or exits (count = 0).`;

export const DESTRUCTIVE_PATCH = (blueprint: string, critique: string, review: string, foreman: string): string => `You are a Technical Blueprint Architect (Destructive Loop — Patching).

Your job: The blueprint below was critiqued. Apply ALL fixes for the valid issues found. Rewrite the blueprint to be flawless.

Current Blueprint:
${blueprint}

Destructive Critique:
${critique}

Risk Review:
${review}

Foreman's Final Issues List:
${foreman}

Instructions:
1. Go through EVERY issue in the Foreman's list
2. Apply the fix to the relevant section of the blueprint
3. Ensure no new issues are introduced while fixing existing ones
4. Output the COMPLETE updated blueprint (do not skip any sections)
5. The blueprint must be self-contained and complete

Output: The complete, patched blueprint document.`;

// ── FINAL: Brutal truth + final blueprint ────────────────────────────────────

export const FINAL_VERDICT = (l1Infra: string, l1Sec: string, l1Logic: string, critique: string, review: string, consensus: string, blueprint: string): string => `You are the Final Verdict Delivery system.

You have received the complete paper trail of a brainstorm pipeline. Your job is to strip ALL fluff and deliver a BRUTAL, RAW viability truth alongside the final blueprint.

FULL PAPER TRAIL:

=== LEVEL 1: RAW DATA ===
Infrastructure: ${l1Infra}

Security: ${l1Sec}

Core Logic: ${l1Logic}

=== LEVEL 2: JURY DELIBERATION ===
Critique: ${critique}

Risk Review: ${review}

Foreman Consensus: ${consensus}

=== LEVEL 3: FINAL BLUEPRINT ===
${blueprint}

---

DELIVER YOUR RESPONSE IN THIS EXACT STRUCTURE:

## 🎯 BRUTAL VERDICT
[2-3 sentences. No corporate speak. No hedging. The RAW truth about whether this idea will work or not. Be devastatingly honest.]

## ⚡ DECISION: [BUILD / ABANDON / PIVOT]
[One word decision with a 1-sentence justification]

## 📊 VIABILITY SCORE: [1-10]/10
[Score with a brutal 1-sentence explanation]

## 🔥 TOP 3 DEAL-BREAKERS (if any)
[List the top 3 things that could kill this project. If viability >= 7, this section should focus on risks instead]

## ✅ TOP 3 STRENGTHS
[List what's genuinely strong about this idea]

## 📋 FINAL BLUEPRINT
[The complete technical blueprint, polished and ready for implementation]

## 🗺️ NEXT STEPS
[The 5 immediate next steps to take, in order, with no ambiguity]

No preamble. No apologies. Just the raw truth and the final blueprint.`;

// ── Status message templates ─────────────────────────────────────────────────

export const STATUS_MESSAGES: Record<string, string | ((n: number) => string)> = {
  STARTING:         "🧠 Brainstorm pipeline started. Creating new chat...",
  L1_INFRA:         "🧠 Level 1 — Running Infrastructure Lens...",
  L1_SEC:           "🧠 Level 1 — Running Security Lens...",
  L1_LOGIC:         "🧠 Level 1 — Running Core Logic Lens...",
  L1_DONE:          "✅ Level 1 complete. Raw data collected from 3 lenses.",
  L2_CRITIQUE:      "⚖️  Level 2 — Model A generating critique...",
  L2_REVIEW:        "⚖️  Level 2 — Model B reviewing risks...",
  L2_FOREMAN:       "⚖️  Level 2 — Model C establishing consensus...",
  L2_DONE:          "✅ Level 2 complete. Jury has rendered verdict.",
  L3_BLUEPRINT:     "🔧 Level 3 — Assembling technical blueprint...",
  L3_DONE:          "✅ Level 3 complete. Blueprint assembled.",
  DESTRUCT_START:   (n: number) => `🔄 Destructive Loop #${n} — Jury critiquing blueprint...`,
  DESTRUCT_CRITIQUE: "   ↳ Model A critiquing blueprint...",
  DESTRUCT_REVIEW:  "   ↳ Model B reviewing critique...",
  DESTRUCT_FOREMAN: "   ↳ Model C tallying issues...",
  DESTRUCT_PATCH:   (n: number) => `   🔧 Level 3 patching ${n} issues...`,
  DESTRUCT_DONE:    "✅ Blueprint is flawless. Destructive loop complete.",
  FINAL:            "🏁 Final — Generating brutal verdict and polished blueprint...",
  COMPLETE:         "✅ Brainstorm pipeline complete!"
};