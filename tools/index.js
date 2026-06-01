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
//
// Supported shapes (in priority order):
//   1. { "tool": "<name>", ...params }                       — single tool (flat)
//   2. { "name": "<name>", "parameters": { ... } }           — single tool (nested)
//   3. { "<tool_name>": { ...params } }                      — single tool (key-as-name)
//   4. { "response": "..." }                                 — final response (no tool)
//   5. { "tools": [ { "name": "<n>", ...params }, ... ] }    — MULTI-tool (parallel)
//      Each element may also use the { "<tool_name>": { ... } } shape.
//
// For single-tool shapes (1-3) the returned object mirrors the input but
// guarantees a top-level "tool" key. For the multi-tool shape (5) the function
// returns a sentinel object: { _isMulti: true, calls: [ {tool, ...params}, ... ] }.
function normalizeToolCall(obj) {
  if (!obj || typeof obj !== 'object') return obj;
  // Already has a "tool" key — return as-is (single tool, flat format)
  if (obj.tool) return obj;
  // Has a "response" key — return as-is (final answer to the user)
  if (obj.response !== undefined) return obj;

  // Multi-tool format: { "tools": [ ... ] }
  if (Array.isArray(obj.tools)) {
    const calls = obj.tools
      .filter(t => t && typeof t === 'object')
      .map(t => {
        // Element shape: { "name": "<n>", ...params }
        if (t.name) {
          const { name, ...rest } = t;
          return { tool: name, ...rest };
        }
        // Element shape: { "<tool_name>": { ...params } }
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

  // Single-tool shape: { "name": "<n>", "parameters": { ... } }
  if (obj.name && obj.parameters && typeof obj.parameters === 'object') {
    const result = { ...obj.parameters };
    result.tool = obj.name;
    return result;
  }
  // Single-tool shape: { "<tool_name>": { ...params } }
  for (const key of Object.keys(obj)) {
    if (tools[key] && typeof obj[key] === 'object' && obj[key] !== null) {
      const params = obj[key];
      params.tool = key;
      return params;
    }
  }
  return obj;
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
  } catch {}

  try {
    const taskPath = path.join(process.cwd(), 'task.md');
    if (fs.existsSync(taskPath)) {
      activeTaskContext = `\n\n[Active Checklist/Tasks]:\n${fs.readFileSync(taskPath, 'utf8')}`;
    }
  } catch {}

  return `You are an autonomous agent with access to tools and the ability to think through problems step by step.

When you need to use a tool, output valid JSON in one of these formats:

Single tool call:
{
  "tool": "read_file",
  "path": "main.js"
}

Parallel tool calls (for independent actions):
{
  "tools": [
    { "name": "read_file", "path": "main.js" },
    { "name": "list_directory", "path": "." }
  ]
}

Final response to user:
{
  "response": "Your answer here."
}

Rules:
- Every single response MUST be valid JSON. No exceptions — not for greetings, not for errors, not for thinking out loud. Always pick one shape per turn: "response", a single tool call, or a "tools" array. Plain text responses are a critical failure.- For dependent steps, call one tool at a time and inspect the output before the next call.
- For independent steps, batch them into a "tools" array so they run in parallel.
- Use non-interactive flags for shell commands (e.g. --noconfirm, -y) to avoid hanging on prompts.

Available Tools:
${toolDescriptions}

${activePlanContext}${activeTaskContext}`;
}

module.exports = {
  tools,
  getSystemPrompt,
  normalizeToolCall,
};
