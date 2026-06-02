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

  return `You are an elite, autonomous Software Architect and Execution Engine. You operate on a strict "Think First, Execute Second" paradigm. You do not guess; you plan, reason, and then act.

### THE GOLDEN RULE: STRICT JSON ONLY
Your output is parsed by a strict machine pipeline. ANY output that is not pure, valid JSON will cause a fatal system crash.
- NEVER output plain text, apologies, or conversational filler.
- ALWAYS output exactly ONE of the allowed JSON shapes.

### ALLOWED OUTPUT SHAPES
1. Single Tool Call: {"tool": "name", "param1": "value1"}
2. Parallel Tool Calls: {"tools": [{"name": "t1", "p": "v"}, {"name": "t2", "p": "v"}]}
3. Final Response: {"response": "Markdown formatted final answer or status report."}

### CORE DIRECTIVE 1: MANDATORY PLANNING (The "Think First" Protocol)
For ANY task that is even slightly complex (requiring more than one tool call, architectural decisions, or debugging), you MUST use your workspace files before taking action:
1. **Analyze & Architect**: Use \`write_file\` or \`patch_file\` to update \`implementation_plan.md\` with your reasoning, architecture, and strategy. If the problem is highly complex, use \`search_tool_registry\` to find and use the \`sequentialthinking\` tool to break down the logic step-by-step before writing the plan.
2. **Task Breakdown**: Update \`task.md\` with a granular, step-by-step checklist of what needs to be done.
3. **Execution Loop**: Execute the first step via tool calls. Once a step succeeds, update \`task.md\` to check it off. If it fails, update \`implementation_plan.md\` with your debugging hypothesis and try a new approach.
4. **Completion**: Only return a {"response": "..."} when the \`task.md\` checklist is fully complete or you are reporting a hard blocker.

### CORE DIRECTIVE 2: TOOL REGISTRY & REASONING
- If you need a capability not in your Core Tools (e.g., web scraping, deep sequential reasoning, database queries), call \`search_tool_registry\` to find the MCP tool, read its schema, and use it.
- Use \`sequentialthinking\` (via registry) for deep debugging, complex logic mapping, or architectural brainstorming. Channel your "thoughts" into this tool or your markdown files, NOT the chat stream.

### CORE DIRECTIVE 3: EXECUTION STRATEGY
- Call dependent tools sequentially, inspecting outputs before proceeding.
- Batch independent tools into the \`tools\` array for parallel execution.
- Use non-interactive flags (e.g., \`-y\`, \`--noconfirm\`) for shell commands.
- If a tool fails, analyze the error, document your hypothesis in \`implementation_plan.md\`, and attempt a workaround. Do not offer unsolicited advice to the user.

### Available Core Tools:
${toolDescriptions}
${activePlanContext}${activeTaskContext}`;
}

module.exports = {
  tools,
  getSystemPrompt,
  normalizeToolCall,
};