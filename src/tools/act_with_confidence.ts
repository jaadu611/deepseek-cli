// @ts-nocheck
// Tool for the model to declare its confidence and plan before acting.
// The orchestrator uses this to decide whether to inject extra planning prompts.
let _lastConfidence = null;
let _lastPlan = null;
let _lastReasoning = null;
function recordConfidence(confidence, plan, reasoning) {
    _lastConfidence = confidence;
    _lastPlan = plan;
    _lastReasoning = reasoning;
}
function getLastConfidence() {
    return { confidence: _lastConfidence, plan: _lastPlan, reasoning: _lastReasoning };
}
module.exports = {
    name: "act_with_confidence",
    description: "Declare your confidence (0-100) and a brief plan BEFORE your first tool call in a turn. The orchestrator uses this to add guard reminders when your confidence is low. Optional but recommended for non-trivial tasks. Example: {\"confidence\": 65, \"plan\": [\"read foo.ts to confirm current state\", \"patch line 47 to add the null check\", \"run tests\"]}",
    parameters: {
        type: "object",
        properties: {
            confidence: { type: "integer", description: "Your confidence in your plan, 0-100. Below 70 = orchestrator will add a 'justify your weakest assumption' reminder. Below 50 = orchestrator will strongly suggest sequential_thinking or enter_plan_mode." },
            plan: { type: "array", items: { type: "string" }, description: "Numbered list of steps you intend to take. Be concrete: file paths, line numbers, expected outcomes." },
            reasoning: { type: "string", description: "1-3 sentences explaining the WHY behind your confidence score. What's the weakest assumption?" }
        },
        "required": ["confidence", "plan"]
    },
    async execute({ confidence, plan, reasoning }) {
        try {
            if (typeof confidence !== "number" || confidence < 0 || confidence > 100) {
                return 'Error: confidence must be a number between 0 and 100.';
            }
            if (!Array.isArray(plan) || plan.length === 0) {
                return 'Error: plan must be a non-empty array of steps.';
            }
            recordConfidence(confidence, plan, reasoning || "");
            let hint = "";
            if (confidence < 50) {
                hint = "\n[Orchestrator hint] Your confidence is below 50. Consider using sequential_thinking to break this down, or call enter_plan_mode to confirm with the user before acting.";
            }
            else if (confidence < 70) {
                hint = "\n[Orchestrator hint] Your confidence is below 70. Identify your weakest assumption in your next response and either justify it or adjust your plan.";
            }
            else if (confidence < 85) {
                hint = "\n[Orchestrator hint] Confidence is moderate. Proceed, but be ready to re-plan if you hit unexpected tool errors.";
            }
            else {
                hint = "\n[Orchestrator hint] High confidence. Proceed.";
            }
            const planText = plan.map((s, i) => `  ${i + 1}. ${s}`).join("\n");
            return `✅ Confidence recorded: ${confidence}/100${hint}\n\nPlan:\n${planText}\n${reasoning ? `\nReasoning: ${reasoning}` : ""}\n\nThe orchestrator has noted this. Now proceed with your first tool call.`;
        }
        catch (err) {
            return `Error in act_with_confidence: ${err.message}`;
        }
    },
    recordConfidence,
    getLastConfidence,
};
