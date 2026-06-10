// @ts-nocheck
// ask_user — emits a structured "[ORCHESTRATOR: ASK USER]" block that
// the harness parses (see harness_guards.parsePlanModeResponse) and
// surfaces to the user as a real interactive question with optional
// numbered options. Use this whenever you would otherwise guess or stall.
const tui = (() => { try { return require("../tui/tui"); } catch { return null; } })();

function buildAskBlock(question, options, context) {
  const lines = ["[ORCHESTRATOR: ASK USER]"];
  if (context) lines.push(`Context: ${context}`);
  lines.push(question);
  if (Array.isArray(options) && options.length > 0) {
    lines.push("");
    lines.push("Options:");
    options.forEach((o, i) => {
      const text = (o && typeof o === "object") ? (o.label || o.text || JSON.stringify(o)) : String(o);
      lines.push(`  ${i + 1}. ${text}`);
    });
    lines.push("");
    lines.push("Default: 1");
  }
  return lines.join("\n");
}

module.exports = {
  name: "ask_user",
  description: "Pause execution and ask the user a clarifying question. Use this when you are about to make an assumption, pick between equally valid options, or need info that is not in the codebase. Provide a clear question, optional context, and (if applicable) 2-5 numbered options for the user to pick from. The harness will surface this interactively; the user types 1-5 (or free text) and your turn resumes. ALWAYS prefer this over guessing. If you find yourself writing 'I will assume X', stop and call ask_user instead.",
  parameters: {
    type: "object",
    properties: {
      question: {
        type: "string",
        description: "The clarifying question for the user. One sentence, no preamble. Example: 'Do you want to add the new endpoint to the public API or keep it internal?'"
      },
      context: {
        type: "string",
        description: "Optional 1-2 sentence context explaining WHY you're asking, so the user can answer faster. Example: 'Both approaches are valid and require different file changes.'"
      },
      options: {
        type: "array",
        description: "Optional 2-5 options for the user to pick from. Each option is a short string. If omitted, the user types free text.",
        items: { type: "string" }
      }
    },
    required: ["question"]
  },
  registerExtensionHandler(handler) {
    extensionHandler = handler;
  },
  async execute({ question, context, options } = {}) {
    try {
      if (!question || typeof question !== "string" || question.trim() === "") {
        return "Error: 'question' is required.";
      }
      if (Array.isArray(options)) {
        if (options.length < 1 || options.length > 5) {
          return "Error: 'options' must have between 1 and 5 entries.";
        }
        for (const o of options) {
          if (typeof o !== "string" || !o.trim()) {
            return "Error: every option must be a non-empty string.";
          }
        }
      }

      if (extensionHandler) {
        const answer = await extensionHandler({ question, context, options });
        return answer;
      }

      const block = buildAskBlock(question, options, context);
      // Try to surface an interactive prompt if the TUI exposes one.
      // The TUI's askConfirmation is binary; the orchestrator handles
      // numbered parsing later. We log it as a status item so the user
      // sees the question in the TUI.
      if (tui && tui.getLogItems) {
        const items = tui.getLogItems();
        items.push({ type: "status", text: "❓ " + block.replace(/\n/g, " ") });
        if (typeof tui.renderLog === "function") tui.renderLog();
      }
      return block;
    } catch (err) {
      return `Error in ask_user: ${err.message}`;
    }
  }
};

let extensionHandler = null;
