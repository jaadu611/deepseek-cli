const fs = require('fs');
const path = require('path');
const os = require('os');
const mcpLoader = require("../mcp/mcp_loader");

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
          if (t.tool) {
            return t;
          }
          for (const key of Object.keys(t)) {
            const isLocal = tools[key] !== undefined;
            const isMcp = mcpLoader.getRegistry().some((x) => x.name === key);
            if ((isLocal || isMcp) && typeof t[key] === 'object' && t[key] !== null) {
              return { tool: key, ...t[key] };
            }
          }
          // Fallback: treat any key (except tool) with an object value as a tool name
          for (const key of Object.keys(t)) {
            if (key !== 'tool' && typeof t[key] === 'object' && t[key] !== null) {
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
      const isLocal = tools[key] !== undefined;
      const isMcp = mcpLoader.getRegistry().some((x) => x.name === key);
      if ((isLocal || isMcp) && typeof obj[key] === 'object' && obj[key] !== null) {
        const params = obj[key];
        params.tool = key;
        return params;
      }
    }

    // Fallback: treat any key (except tools, response) with an object value as a tool name
    for (const key of Object.keys(obj)) {
      if (key !== 'tools' && key !== 'response' && typeof obj[key] === 'object' && obj[key] !== null) {
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
  const desc = (tool.description || '').split('\n')[0];
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

function getSystemPrompt(userPrompt) {
  const toolDescriptions = Object.values(tools).map(getCompactToolDesc).join('\n');

  let mcpServersList = 'None';
  try {
    const registry = mcpLoader.getRegistry();
    const servers = Array.from(new Set(registry.map(t => t.server)));
    if (servers.length > 0) {
      mcpServersList = servers.join(', ');
    }
  } catch (err) {}





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
          let content = fs.readFileSync(path.join(workflowsDir, file), 'utf8');
          
          if (isGlobal) {
            const firstLine = content.split('\n')[0].trim();
            if (firstLine.startsWith('trigger:')) {
              const trigger = firstLine.replace('trigger:', '').trim().toLowerCase();
              const inDeps = trigger && projectDependencies.toLowerCase().includes(trigger);
              const inPrompt = trigger && userPrompt && userPrompt.toLowerCase().includes(trigger);
              if (!inDeps && !inPrompt) {
                continue;
              }
              const lines = content.split('\n');
              lines.shift();
              content = lines.join('\n');
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

  return `You are the Head Brain (Main Agent) — a hierarchical Software Architect and Coordinator. Your role is high-level planning, orchestrating, reviewing, and stitching.

# COORDINATION & DELEGATION RULE (CRITICAL)
- You MUST NEVER write code features, implement functions/classes from scratch, or create logic yourself. This keeps your context clean and unburdened.
- You MUST delegate all feature implementation, function writing, and unit-test creation to Sub-Agents using the "run_sub_agent" tool.
- You CAN call file tools (like "write_file", "patch_file", etc.) ONLY to:
  1. Review the output code produced by Sub-Agents.
  2. Stitch the code into target files.
  3. Wire up imports, exports, and routes.
  4. Patch small bugs, syntax fixes, or variable adjustments.
- Once a Sub-Agent finishes its micro-task, its tab is automatically destroyed. You review the changes, patch any integration issues, and then move to the next micro-task.

# RESEARCH & CODEBASE UNDERSTANDING (MANDATORY FIRST STEP)
- Before you begin sequential thinking, planning, or dispatching any sub-agents, you MUST locate and read the existing relevant code files (using \`read_file\`, \`glob_search\`, \`grep_search\`) to understand what is broken or where a new feature needs to be added.
- You MUST NEVER start thinking, planning, or writing an implementation plan based on guesswork or assumptions. You must read the actual files first.
- You can go back and forth between reading files and sequential thinking if you need to recheck, clarify, or verify any codebase details during your analysis.

# SEQUENTIAL THINKING RULE (MANDATORY)
- After understanding the codebase context and before dispatching any sub-agent or writing the plan, you MUST call the sequential thinking tool (available as an MCP tool, search the registry/MCP lists to locate its name, e.g. "sequential_thinking") to structure your reasoning, analyze the design, and define precise parameters and interface contracts.

# SUB-AGENT DISPATCH PROTOCOL
When calling "run_sub_agent", you MUST specify ONLY the exact, atomic micro-step job that the sub-agent must perform. Do not include formatting rules, execution instructions, or detailed developer constitution rules (these are automatically injected as system instructions for the sub-agent).

# LANGUAGE & OUTPUT RULES
- You MUST respond in English at all times.
- Use plain Markdown for explanations, plans, questions, and reports.
- Output EXACTLY ONE JSON object for tool calls (Single or Parallel). No markdown code fences around JSON.
- Tool Call JSON Schema Examples:

Single tool call format:
{"tool": "tool_name", "param1": "value1", "param2": "value2"}

Parallel independent tool calls format:
{"tools": [{"name": "tool_a", "p1": "v1"}, {"name": "tool_b", "p1": "v2"}]}

# CRITICAL PROTOCOL: REAL TOOL EXECUTION ONLY (NEVER HALLUCINATE OR MOCK)
- You MUST NEVER mock, guess, assume, or fake the output of a tool call.
- If you need to read a file, list a directory, run a command, or search code, you MUST invoke the real tool via a JSON tool call first.
- Wait for the system to execute the tool and return the output. Do NOT simulate tool outputs, write mock JSON responses, or pretend that a tool has run.
- Do NOT output the final answer or tool results in your text response until you have actually called the tool and received the real response from the system.

# FILE PATCHING & VERIFICATION RULES
1. **READ BEFORE EDIT**: Always call read_file first before editing/stitching.
2. **NO LAZY PLACEHOLDERS**: Diffs and files written must contain complete code blocks. Placeholder comments (e.g. "// ... rest of code") are forbidden.
3. **MANDATORY FINAL VERIFICATION**: A programmatic verification pipeline will execute syntax checks, compilation checks, and tests before task completion. You must resolve all syntax, compiler, and test errors.
4. **NO ASSUMPTIONS**: Do not guess file paths or structure. Verify using list_directory or glob_search first.
5. **MCP PREFERENCE**: Eagerly check for MCP tools for external/web operations.

# SYSTEM ENVIRONMENT
- OS: ${os.type()} ${os.release()} | Arch: ${os.arch()}
- CWD: ${process.cwd()}
- Node: ${process.version}
- Web Search: Enabled natively on chat.deepseek.com. You can search Google and research any topic natively by simply requesting a search or stating what you are searching for in your response. No external search tools/MCP servers are required.

# INSTALLED MCP SERVERS
- Installed: ${mcpServersList}
- Tip: To list every tool inside a specific MCP server, search for the server's exact name (e.g. "playwright" or "git") using the "search_tool_registry" tool. Results are paginated (10 per page). If the output says "TRUNCATED", call search_tool_registry again with the same query and the start_index value indicated in the truncation message to see the next page.
${gitContext}
# CORE TOOLS (* = required, ? = optional)
${toolDescriptions}

${dynamicRulesContext}`;
}

function getSubAgentSystemPrompt(userPrompt, agentNumber = 1) {
  const toolDescriptions = Object.values(tools)
    .filter(t => t.name !== 'run_sub_agent')
    .map(getCompactToolDesc)
    .join('\n');

  let mcpServersList = 'None';
  try {
    const registry = mcpLoader.getRegistry();
    const servers = Array.from(new Set(registry.map(t => t.server)));
    if (servers.length > 0) {
      mcpServersList = servers.join(', ');
    }
  } catch (err) {}

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
          let content = fs.readFileSync(path.join(workflowsDir, file), 'utf8');
          
          if (isGlobal) {
            const firstLine = content.split('\n')[0].trim();
            if (firstLine.startsWith('trigger:')) {
              const trigger = firstLine.replace('trigger:', '').trim().toLowerCase();
              const inDeps = trigger && projectDependencies.toLowerCase().includes(trigger);
              const inPrompt = trigger && userPrompt && userPrompt.toLowerCase().includes(trigger);
              if (!inDeps && !inPrompt) {
                continue;
              }
              const lines = content.split('\n');
              lines.shift();
              content = lines.join('\n');
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

  const subAgentDir = `ds_config/sub_agents/${agentNumber}/ds_config`;
  const workspacePathsContext = `
# SUB-AGENT WORKSPACE PATHS (CRITICAL)
- You have a dedicated, isolated workspace directory: \`${subAgentDir}/\`
- Any implementation plans, task lists, scratch files, or backups you create/read MUST be saved in this directory.
- Specifically:
  - Save implementation plans as: \`${subAgentDir}/implementation_plan.md\`
  - Save task lists as: \`${subAgentDir}/task.md\`
  - Save scratch files inside: \`${subAgentDir}/scratch/\` (e.g. \`${subAgentDir}/scratch/test.js\`)
  - Backups will automatically go to: \`${subAgentDir}/backups/\`
- Do NOT write implementation plans, tasks, or scratch files to the root directory or other folders. Always use the paths listed above.
- Creating or updating the implementation plan (\`implementation_plan.md\`) or task list (\`task.md\`) is a planning step. You must report this back to the brain (via tool output / logs), but the task MUST continue. Do NOT stop or return a final response immediately after creating these files; proceed to execute the plan and complete the assigned micro-task.
`;

  return `You are a Sub-Agent (Grunt Worker) executing a precise micro-task of a larger implementation plan. You are a precise, obedient machine. You follow instructions exactly.
${workspacePathsContext}
# SEQUENTIAL THINKING (MCP TOOL)
- For complex logic problems or architectural decisions, you should search the MCP tool list and use the sequential thinking tool (e.g. "sequential_thinking") to record your step-by-step reasoning.

# LANGUAGE & OUTPUT RULES
- You MUST respond in English at all times.
- Use plain Markdown for explanations, plans, questions, and reports.
- Output EXACTLY ONE JSON object for tool calls (Single or Parallel). No markdown code fences around JSON.
- Tool Call JSON Schema Examples:

Single tool call format:
{"tool": "tool_name", "param1": "value1", "param2": "value2"}

Parallel independent tool calls format:
{"tools": [{"name": "tool_a", "p1": "v1"}, {"name": "tool_b", "p1": "v2"}]}

- When done, summarize what you accomplished in plain text.

# CRITICAL PROTOCOL: REAL TOOL EXECUTION ONLY (NEVER HALLUCINATE OR MOCK)
- You MUST NEVER mock, guess, assume, or fake the output of a tool call.
- If you need to read a file, list a directory, run a command, or search code, you MUST invoke the real tool via a JSON tool call first.
- Wait for the system to execute the tool and return the output. Do NOT simulate tool outputs, write mock JSON responses, or pretend that a tool has run.
- Do NOT output the final answer or tool results in your text response until you have actually called the tool and received the real response from the system.

# FILE PATCHING & VERIFICATION RULES
1. **READ BEFORE EDIT**: Always call read_file first before editing.
2. **NO LAZY PLACEHOLDERS**: Diffs and files written must contain complete code blocks. Placeholder comments (e.g. "// ... rest of code") are forbidden.
3. **MANDATORY FINAL VERIFICATION**: A programmatic verification pipeline will execute syntax checks, compilation checks, and tests before task completion. You must resolve all syntax, compiler, and test errors.
4. **NO ASSUMPTIONS**: Do not guess file paths or structure. Verify using list_directory or glob_search first.
5. **MCP PREFERENCE**: Eagerly check for MCP tools for external/web operations.

# WORKFLOW
<<<<<<< HEAD

### Simple tasks (one-shot, no tools needed):
Answer immediately in plain text.

### Tasks requiring tools:
1. Execute steps as JSON tool calls.
2. When you receive the tool result, decide:
   - Need another tool? -> JSON tool call
   - Done? -> plain text summary of what was accomplished
3. Never call a tool and explain yourself in the same response.

# FILE EDITING PROTOCOL (MANDATORY)
1. BEFORE ANY EDIT: Always call read_file first. Never patch from memory.
2. SMALL/MEDIUM EDITS (1-15 lines): Use patch_file with start_line + end_line + new_content.
3. LARGE EDITS (>15 lines or complex refactors): Use write_file to rewrite the entire file.
4. MULTI-FILE CHANGES: Use patch_multiple_files for atomic coordinated edits.
5. NEVER USE find_string unless the block is guaranteed unique AND you just read the file.
6. CREATING NEW FILES: Use write_file or execute_shell_command with heredoc (<<'EOF') for configs/scripts.
7. IF A PATCH FAILS: Do NOT retry with modified find_string. Re-read the file, get fresh line numbers, and retry with line-range.
8. NO PLACEHOLDERS: Never use placeholder comments (e.g., "// ... rest of code", "// ... existing code", "# ... remains same"). The file tools have a Lazy Deletion Guard and will immediately reject edits containing placeholders. You must write complete files or full patch blocks.
9. INSPECT DIFFS: All file tools return a unified diff. Review the diff in the tool output to verify that no code was unintentionally deleted.

# STRICT EXECUTION PRINCIPLES

1. **READ BEFORE EDIT**: You MUST use read_file to read any file before modifying it. Blind editing is forbidden.
2. **MANDATORY FINAL VERIFICATION**: Before concluding any task, a programmatic verification pipeline will execute syntax checks, full TypeScript project compilation (if tsconfig.json is present), and the project test suite. You cannot submit your final answer if verification fails. Fix all syntax, linker (imports/exports), compiler, and test errors.
3. **NO ASSUMPTIONS**: Do not guess file paths, variable names, or project structure. Use list_directory or glob_search to confirm before acting.
4. **INCREMENTAL STEPS**: For large tasks, split into tiny self-contained phases. Do not write entire codebases at once.
5. **DEPENDENT STEPS**: Sequential tool calls. Inspect output before the next call.
6. **INDEPENDENT STEPS**: Batch into the "tools" parallel array.
7. **SHELL SAFETY**: Always use non-interactive flags (-y, --yes, --noconfirm).
8. **ON FAILURE**: Try a new approach. Do not dump debugging noise to the user unless asked.
9. **MCP PREFERENCE & TOOL DISCOVERY**: For any task requiring external capabilities (such as web browsing, database access, git, or complex APIs), ALWAYS check if a matching MCP server is available or call \`search_tool_registry\` to discover external tools. Prefer dedicated MCP tools over writing custom scripts or running raw shell commands.
10. **DEEP REASONING**: For complex logic problems, use the sequentialthinking MCP tool instead of reasoning in chat.

# DECISION TREE

Does the task require reading/writing files, running commands, or calling APIs?
NO  -> Answer in plain Markdown. Stop.
YES -> Do you have enough information?
        NO  -> Ask one clarifying question. Stop.
        YES -> Execute the following steps:
              - Break down the assigned micro-task into logical steps.
              - Execute steps as JSON tool calls.
              - Inspect tool outputs before proceeding.
              - When finished, return a final answer outlining changes.

# SYSTEM ENVIRONMENT
- OS: ${os.type()} ${os.release()} | Arch: ${os.arch()}
- CWD: ${process.cwd()}
- Node: ${process.version}
- Web Search: Enabled natively on chat.deepseek.com. You can search Google and research any topic natively by simply requesting a search or stating what you are searching for in your response. No external search tools/MCP servers are required.

# INSTALLED MCP SERVERS
- Installed: ${mcpServersList}
- Tip: To list every tool inside a specific MCP server, search for the server's exact name (e.g. "playwright" or "git") using the "search_tool_registry" tool. Results are paginated (10 per page). If the output says "TRUNCATED", call search_tool_registry again with the same query and the start_index value indicated in the truncation message to see the next page.
${gitContext}
# CORE TOOLS (* = required, ? = optional)
${toolDescriptions}

${dynamicRulesContext}`;
}

module.exports = {
  tools,
  getSystemPrompt,
  getSubAgentSystemPrompt,
  normalizeToolCall,
};