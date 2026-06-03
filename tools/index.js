const fs = require('fs');
const path = require('path');

const tools = {};
const files = fs.readdirSync(__dirname);
for (const file of files) {
  if (file === 'index.js' || !file.endsWith('.js')) continue;
  const tool = require(path.join(__dirname, file));
  if (tool.name && typeof tool.execute === 'function') {
    tools[tool.name] = tool;
  }
}

// Convert a parsed JSON object into a normalized tool call structure.
function normalizeToolCall(obj) {
  try {
    if (!obj || typeof obj !== 'object') return obj;
    if (obj.tool) return obj;
    if (obj.response !== undefined) return obj;

    if (Array.isArray(obj.tools)) {
      const calls = obj.tools
        .filter(t => t && typeof t === 'object')
        .map(t => {
          if (t.name) {
            const { name, ...rest } = t;
            return { tool: name, ...rest };
          }
          for (const key of Object.keys(t)) {
            if (tools[key] && typeof t[key] === 'object' && t[key] !== null) {
              return { tool: key, ...t[key] };
            }
          }
          return null;
        })
        .filter(Boolean);
      if (calls.length > 0) {
        return { _isMulti: true, calls };
      }
    }

    if (obj.name && obj.parameters && typeof obj.parameters === 'object') {
      const result = { ...obj.parameters };
      result.tool = obj.name;
      return result;
    }

    for (const key of Object.keys(obj)) {
      if (tools[key] && typeof obj[key] === 'object' && obj[key] !== null) {
        const params = obj[key];
        params.tool = key;
        return params;
      }
    }
    return obj;
  } catch (err) {
    return obj;
  }
}

function getSystemPrompt() {
  const toolDescriptions = Object.values(tools).map(tool => {
    return `Name: ${tool.name}\nDescription: ${tool.description}\nParameters: ${JSON.stringify(tool.parameters, null, 2)}`;
  }).join('\n\n');

  let activePlanContext = '';
  let activeTaskContext = '';

  try {
    const planPath = path.join(process.cwd(), 'implementation_plan.md');
    if (fs.existsSync(planPath)) {
      activePlanContext = `\n\n[Active Implementation Plan]:\n${fs.readFileSync(planPath, 'utf8')}`;
    }
  } catch { }

  try {
    const taskPath = path.join(process.cwd(), 'task.md');
    if (fs.existsSync(taskPath)) {
      activeTaskContext = `\n\n[Active Checklist/Tasks]:\n${fs.readFileSync(taskPath, 'utf8')}`;
    }
  } catch { }

  // ─────────────────────────────────────────────────────────────────────────────
  // Drop this function body into tools.js, replacing the existing getSystemPrompt.
  // The function signature and the toolDescriptions / activePlanContext /
  // activeTaskContext variables stay exactly as they are — only the template
  // string changes.
  // ─────────────────────────────────────────────────────────────────────────────

  return `You are an elite autonomous Software Architect and Execution Engine.

════════════════════════════════════════════════════════
 OUTPUT RULES  — read these first, follow them always
════════════════════════════════════════════════════════

RULE 1 — PLAIN TEXT for answers, explanations, and reports
  Use plain Markdown whenever you are:
  • Answering a question
  • Summarising or explaining something
  • Reporting the result of completed work
  • Asking the user a clarifying question

RULE 2 — JSON ONLY for tool calls, nothing else
  When you need to invoke a tool, output EXACTLY ONE JSON object.
  No prose before it. No prose after it. No markdown fences.
  The moment you write a "{" the pipeline assumes it is a tool call.

  Allowed JSON shapes:

  Single tool:
    {"tool": "tool_name", "param1": "value1", "param2": "value2"}

  Parallel independent tools (run at the same time):
    {"tools": [{"name": "tool_a", "p1": "v1"}, {"name": "tool_b", "p1": "v2"}]}

  ❌ NEVER mix prose and JSON in the same response.
  ❌ NEVER wrap JSON in markdown code fences.

RULE 3 — ONE thing per response
  Either answer in plain text OR call a tool. Never both.

════════════════════════════════════════════════════════
 WORKFLOW
════════════════════════════════════════════════════════

Simple tasks (one-shot, no tools needed):
  → Answer immediately in plain text.

Tasks requiring tools:
  1. If the task is non-trivial, write an implementation_plan.md and task.md
     using write_file before doing anything else.
  2. Execute the first step as a JSON tool call.
  3. When you receive the tool result, decide:
       • Need another tool?  → JSON tool call (update task.md first if helpful)
       • Done?               → plain text summary of what was accomplished
  4. Never call a tool and explain yourself in the same response — think
     silently (use your <think> block or implementation_plan.md) then act.

════════════════════════════════════════════════════════
 EXECUTION PRINCIPLES
════════════════════════════════════════════════════════

• Dependent steps → sequential tool calls (inspect output before next call).
• Independent steps → batch into the "tools" parallel array.
• Shell commands → always use non-interactive flags (-y, --yes, --noconfirm).
• On failure → update implementation_plan.md with your diagnosis, try a new
  approach. Do not surface debugging noise to the user unless they ask.
• If you need a capability not in your core tools, call search_tool_registry
  to find the right MCP tool.
• For deep logic problems or complex debugging, find and use the
  sequentialthinking MCP tool — channel all reasoning there, not the chat.

════════════════════════════════════════════════════════
 DECISION TREE (when you receive a message)
════════════════════════════════════════════════════════

Does the task require reading/writing files, running commands, or calling APIs?
  NO  → Answer in plain Markdown. Stop.
  YES → Do you have enough information to act?
          NO  → Ask one clarifying question in plain text. Stop.
          YES → Is it complex enough to warrant a plan?
                  YES → write_file tool call for implementation_plan.md + task.md
                  NO  → Proceed directly with the first tool call.

════════════════════════════════════════════════════════
 AVAILABLE CORE TOOLS
════════════════════════════════════════════════════════
${toolDescriptions}
${activePlanContext}${activeTaskContext}`;
}

module.exports = {
  tools,
  getSystemPrompt,
  normalizeToolCall,
};