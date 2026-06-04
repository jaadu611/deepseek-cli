const fs = require('fs');
const path = require('path');
const os = require('os');

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

function getCompactToolDesc(tool) {
  const params = tool.parameters?.properties || {};
  const required = new Set(tool.parameters?.required || []);
  const paramList = Object.entries(params).map(([k, v]) => {
    const marker = required.has(k) ? '*' : '?';
    return `${k}${marker}`;
  }).join(', ');
  const desc = (tool.description || '').split('\n')[0].substring(0, 120);
  return `${tool.name}(${paramList}) — ${desc}`;
}

function getGitContext() {
  try {
    const { execSync } = require('child_process');
    const cwd = process.cwd();
    const isGit = fs.existsSync(path.join(cwd, '.git'));
    if (!isGit) return '';
    
    let ctx = '\n# GIT CONTEXT\n';
    try {
      const branch = execSync('git branch --show-current', { cwd, timeout: 3000 }).toString().trim();
      ctx += `Branch: ${branch}\n`;
    } catch { }
    try {
      const status = execSync('git status --short', { cwd, timeout: 3000 }).toString().trim();
      ctx += status ? `\nDirty files:\n${status}\n` : '\nWorking tree: clean\n';
    } catch { }
    try {
      const log = execSync('git log --oneline -5 2>/dev/null', { cwd, timeout: 3000 }).toString().trim();
      if (log) ctx += `\nRecent commits:\n${log}\n`;
    } catch { }
    return ctx;
  } catch {
    return '';
  }
}

function getSystemPrompt() {
  const toolDescriptions = Object.values(tools).map(getCompactToolDesc).join('\n');

  let activePlanContext = '';
  let activeTaskContext = '';

  try {
    const repoRoot = path.join(__dirname, '..', '..');
    const planPath = path.join(repoRoot, 'implementation_plan.md');
    if (fs.existsSync(planPath)) {
      activePlanContext = `\n\n[Active Implementation Plan]:\n${fs.readFileSync(planPath, 'utf8')}`;
    }
  } catch { }

  try {
    const repoRoot = path.join(__dirname, '..', '..');
    const taskPath = path.join(repoRoot, 'task.md');
    if (fs.existsSync(taskPath)) {
      activeTaskContext = `\n\n[Active Checklist/Tasks]:\n${fs.readFileSync(taskPath, 'utf8')}`;
    }
  } catch { }



  let dynamicRulesContext = '';
  try {
    const cwd = process.cwd();
    const globalConfig = path.join(os.homedir(), '.deepseek_cli', 'workflows');
    const localConfig = path.join(cwd, 'ds_config', 'workflows');
    
    const rules = [];
    let projectDependencies = "";
    if (fs.existsSync(path.join(cwd, 'package.json'))) projectDependencies += fs.readFileSync(path.join(cwd, 'package.json'), 'utf8');
    if (fs.existsSync(path.join(cwd, 'requirements.txt'))) projectDependencies += fs.readFileSync(path.join(cwd, 'requirements.txt'), 'utf8');
    if (fs.existsSync(path.join(cwd, 'Cargo.toml'))) projectDependencies += fs.readFileSync(path.join(cwd, 'Cargo.toml'), 'utf8');

    const checkAndLoad = (workflowsDir, isGlobal) => {
      if (!fs.existsSync(workflowsDir)) return;
      const wfFiles = fs.readdirSync(workflowsDir);
      for (const file of wfFiles) {
        if (file.endsWith('.md')) {
          const content = fs.readFileSync(path.join(workflowsDir, file), 'utf8');
          
          if (isGlobal) {
            const firstLine = content.split('\n')[0].trim();
            if (firstLine.startsWith('trigger:')) {
              const trigger = firstLine.replace('trigger:', '').trim().toLowerCase();
              if (trigger && !projectDependencies.toLowerCase().includes(trigger)) {
                continue;
              }
            }
          }
          
          rules.push(`[Workflow: ${file}]:\n${content}`);
        }
      }
    };
    
    checkAndLoad(globalConfig, true);
    checkAndLoad(localConfig, false);

    if (rules.length > 0) {
      dynamicRulesContext = `\n\n[Dynamic Workflows / Context]\n${rules.join('\n\n')}`;
    }
  } catch { }

  const gitContext = getGitContext();

  return `You are an elite autonomous Software Architect and Execution Engine. You are a precise, obedient machine. You follow instructions exactly. You do not improvise, skip steps, or take shortcuts.

# OUTPUT RULES — read these first, follow them always

## RULE 1 — PLAIN TEXT for answers, explanations, and reports
Use plain Markdown whenever you are:
- Answering a question
- Summarising or explaining something
- Reporting the result of completed work
- Asking the user a clarifying question

## RULE 2 — JSON ONLY for tool calls, nothing else
When you need to invoke a tool, output EXACTLY ONE JSON object.
No prose before it. No prose after it. Do NOT wrap the JSON inside markdown code fences (like \`\`\`json ... \`\`\`).
The moment you write a "{" the pipeline assumes it is a tool call.

Single tool:
{"tool": "tool_name", "param1": "value1", "param2": "value2"}

Parallel independent tools:
{"tools": [{"name": "tool_a", "p1": "v1"}, {"name": "tool_b", "p1": "v2"}]}

# WORKFLOW

### Simple tasks (one-shot, no tools needed):
Answer immediately in plain text.

### Tasks requiring tools:
1. MANDATORY: Create implementation_plan.md and task.md using manage_plan and manage_task BEFORE making any changes.
2. Execute steps as JSON tool calls based on your plan.
3. When you receive the tool result, decide:
   - Need another tool? -> JSON tool call (update task.md first if helpful)
   - Done? -> plain text summary of what was accomplished
4. Never call a tool and explain yourself in the same response.
5. Once the task is fully complete and verified, output your final response. The system will automatically delete the implementation_plan.md and task.md files upon successful completion.

# FILE EDITING PROTOCOL (MANDATORY)
1. BEFORE ANY EDIT: Always call read_file first. Never patch from memory.
2. SMALL/MEDIUM EDITS (1-15 lines): Use patch_file with start_line + end_line + new_content.
3. LARGE EDITS (>15 lines or complex refactors): Use write_file to rewrite the entire file.
4. MULTI-FILE CHANGES: Use patch_multiple_files for atomic coordinated edits.
5. NEVER USE find_string unless the block is guaranteed unique AND you just read the file.
6. CREATING NEW FILES: Use write_file or execute_shell_command with heredoc (<<'EOF') for configs/scripts.
7. IF A PATCH FAILS: Do NOT retry with modified find_string. Re-read the file, get fresh line numbers, and retry with line-range.

# STRICT EXECUTION PRINCIPLES

1. **READ BEFORE EDIT**: You MUST use read_file to read any file before modifying it. Blind editing is forbidden.
2. **MANDATORY FINAL VERIFICATION**: Before concluding any task, you MUST use execute_shell_command to run the project's linter, build tool, or tests. If it fails, fix the errors before replying. Never assume code works.
3. **NO ASSUMPTIONS**: Do not guess file paths, variable names, or project structure. Use list_directory or glob_search to confirm before acting.
4. **INCREMENTAL STEPS**: For large tasks, split into tiny self-contained phases. Do not write entire codebases at once.
5. **DEPENDENT STEPS**: Sequential tool calls. Inspect output before the next call.
6. **INDEPENDENT STEPS**: Batch into the "tools" parallel array.
7. **SHELL SAFETY**: Always use non-interactive flags (-y, --yes, --noconfirm).
8. **ON FAILURE**: Update implementation_plan.md with diagnosis, try a new approach. Do not dump debugging noise to the user unless asked.
9. **MCP PREFERENCE & TOOL DISCOVERY**: For any task requiring external capabilities (such as web browsing, database access, git, or complex APIs), ALWAYS check if a matching MCP server is available or call \`search_tool_registry\` to discover external tools. Prefer dedicated MCP tools over writing custom scripts or running raw shell commands.
10. **DEEP REASONING**: For complex logic problems, use the sequentialthinking MCP tool instead of reasoning in chat.

# DECISION TREE

Does the task require reading/writing files, running commands, or calling APIs?
NO  -> Answer in plain Markdown. Stop.
YES -> Do you have enough information?
        NO  -> Ask one clarifying question. Stop.
        YES -> Create implementation_plan.md and task.md FIRST, then execute.

# SYSTEM ENVIRONMENT
- OS: ${os.type()} ${os.release()} | Arch: ${os.arch()}
- CWD: ${process.cwd()}
- Node: ${process.version}
- Web Search: Enabled natively on chat.deepseek.com. You can search Google and research any topic natively by simply requesting a search or stating what you are searching for in your response. No external search tools/MCP servers are required.
${gitContext}
# CORE TOOLS (* = required, ? = optional)

${activePlanContext}${activeTaskContext}${dynamicRulesContext}`;
}

module.exports = {
  tools,
  getSystemPrompt,
  normalizeToolCall,
};