<p align="center">
  <img src="public/deepseek-color.png" alt="DeepSeek Chat Logo" width="120" />
</p>

<h1 align="center">DeepSeek Chat -- VS Code Extension</h1>

<p align="center">
  <strong>An AI-powered coding assistant that communicates with DeepSeek AI via a headless browser and wields 38+ built-in tools for file exploration, surgical code editing, shell execution, git operations, language server integration, and more.</strong>
</p>

<p align="center">
  <a href="#features">Features</a> . <a href="#installation">Installation</a> . <a href="#getting-started">Getting Started</a> . <a href="#tools-reference">Tools</a> . <a href="#operational-modes">Modes</a> . <a href="#slash-commands">Commands</a> . <a href="#mcp-integration">MCP</a> . <a href="#configuration">Config</a> . <a href="#troubleshooting">Troubleshooting</a> . <a href="#development">Dev</a>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/version-1.2.2-blue" alt="Version" />
  <img src="https://img.shields.io/badge/license-MIT-yellow" alt="License" />
  <img src="https://img.shields.io/badge/VS%20Code-%3E%3D1.80.0-blue" alt="VS Code" />
</p>

---

## Overview

DeepSeek Chat is a VS Code sidebar extension that gives you an AI-powered coding agent integrated directly into your editor. The agent communicates with DeepSeek AI through a headless browser and provides access to 38+ tools for file exploration, editing, shell execution, code intelligence, LSP, git, memory, workflows, and more.

### How It Works

1. Click the DeepSeek icon in the VS Code activity bar to open the sidebar
2. The extension launches a headless Chromium browser that logs into DeepSeek's web chat
3. Type a prompt -- the agent analyzes your codebase, plans, and executes tasks
4. Responses stream directly into the sidebar with full markdown rendering

### Key Capabilities

- **38+ Built-in Tools** -- File exploration, editing, shell execution, code intelligence, LSP, git, memory, workflows
- **Sub-agent System** -- Parallel, isolated micro-tasks for faster multi-file edits
- **Tool Normalization Engine** -- Parses diverse JSON formats from LLM output
- **Circuit Breaker** -- Blocks repeated identical tool calls to prevent infinite loops
- **PLAN / ACT / AUTO / Brainstorm** operational modes
- **Automatic Checkpoints** before every user prompt with full workspace rollback
- **Session Persistence** with chat history browsing
- **MCP (Model Context Protocol)** integration for extensible tool servers
- **Workflow System** for reusable task templates

---

## Installation

### From VSIX

1. Download the `.vsix` file from the [releases page](https://github.com/jaadu611/deepseek-cli/releases)
2. In VS Code / Codium, go to Extensions -> `...` -> Install from VSIX...
3. Select the `.vsix` file and install
4. Click the DeepSeek icon in the activity bar to open the sidebar

### From Source

```bash
git clone https://github.com/jaadu611/deepseek-cli.git
cd deepseek-cli
npm install
npm run build
npx vsce package
```

Then install the generated `.vsix` file.

### Prerequisites

| Requirement | Version | Notes |
|-------------|---------|-------|
| VS Code / VSCodium | >= 1.80.0 | Required |
| Node.js | >= 18.0.0 | For MCP SDK and dependency resolution |
| Git | Any recent | Used for checkpoints, snapshots, git operations |
| Chromium | System-installed | Launched headless for DeepSeek web communication |

---

## Getting Started

### First Launch

1. After installing the extension, click the **DeepSeek** icon in the activity bar
2. The sidebar panel opens with a status message: "booting agent brain (launching headless browser)..."
3. Wait for the browser to connect (this may take 10-30 seconds on first launch)
4. Once connected, you'll see the chat interface with an input box at the bottom
5. Type your first prompt and press Enter or click Send

### Basic Usage

```
add error handling to src/utils.ts
analyze this project and suggest improvements
/plan -> analyze the codebase and plan the implementation
/act -> go ahead and implement the plan
brainstorm: what if we migrate to a microservices architecture?
```

### VS Code Integration

The extension integrates directly with your VS Code workspace:

- **Workspace Awareness** -- The agent automatically uses the first workspace folder as its working directory
- **LSP Integration** -- Uses your project's language servers (tsserver, pyright, gopls, rust-analyzer) for type-accurate code analysis
- **Git Integration** -- Full git support (status, diff, log, branch, stash, checkout) via the `git_operation` tool
- **File System Access** -- Reads and edits files within your workspace, respects `.gitignore` and `.dsignore`
- **Terminal Integration** -- Executes shell commands in the workspace directory

### What to Expect

- **First boot** launches a headless Chromium browser -- you may see a browser window open briefly
- **Prompt processing** may take a few seconds while the agent analyzes your codebase
- **Tool calls** appear as expandable cards showing the tool name and parameters
- **DeepSeek's thinking** appears in a collapsible gold-colored section
- **Errors** appear in red with actionable guidance

---

## Features

### AI Agent Core

- **DeepSeek Web Brain** -- Communicates with DeepSeek AI via headless browser (Playwright), maintaining persistent chat sessions
- **38+ Built-in Tools** -- File exploration, editing, execution, code intelligence, LSP, git, memory, workflows
- **Sub-agent System** -- Dispatch parallel, isolated micro-tasks to sub-agents for faster multi-file edits
- **Tool Normalization Engine** -- Parses diverse JSON formats from LLM output: markdown code blocks, malformed JSON, trailing commas, unquoted keys, nested objects
- **Circuit Breaker** -- Blocks repeated identical tool calls (3+ in a row) to prevent infinite loops
- **Prompt Queue** -- Queues prompts when the agent is busy; processes sequentially

### Operational Modes

- **PLAN Mode** -- Read-only planning; AI produces implementation plans without touching source code
- **ACT Mode** -- Full execution with all tools enabled; follows a rigorous 6-step execution cycle
- **AUTO Mode** -- Per-turn mode auto-detection via scoring-based NLP analysis (supports 10+ languages)
- **Brainstorm Mode** -- Multi-level analysis pipeline: 3 specialist analysts -> 3 jury critics -> blueprint -> destructive critique loop -> final verdict

### Safety & Guardrails

- **Linker Checks** -- Verifies imports/exports match, detects deleted methods still referenced elsewhere, flags undeclared package dependencies
- **Conflict Marker Detection** -- Finds leftover git conflict markers (`<<<<<<<`, `=======`, `>>>>>>>`)
- **File Shrinkage Detection** -- Flags files reduced by >30% (warns about accidental mass deletion)
- **JSON Syntax Validation** -- Reports exact line/column for invalid JSON
- **Plan Mode Restrictions** -- Blocks `patch_file`, `patch_multiple_files`, mutating shell commands
- **Error Recovery Protocol** -- Mandatory read-before-write, retry limits, escalation to `ask_user`
- **Self-test Requirement** -- Every final answer must include `PASS  Self-test: <cmd> -> <result>`

### State Management

- **Session Persistence** -- JSONL-based conversation storage per session in `~/.ds_config/sessions/`
- **Auto-Checkpoints** -- Created before every user prompt with full workspace rollback capability
- **Scratch Files** -- Agent's persistent memory across turns (per-session scratch directory)
- **task.md** -- Running progress tracker for multi-step tasks via `update_task`
- **Project Memory (AGENTS.md)** -- Persistent knowledge injected into every system prompt
- **Snapshots** -- Git stash-based workspace state for safe experimentation

### Extensibility

- **MCP (Model Context Protocol)** -- Plug in external tool servers via `mcp.json`
- **Workflows** -- Install community workflow `.md` files with trigger-based activation
- **LSP Integration** -- Real type checking via tsserver, pyright, gopls, rust-analyzer
- **Brain Registry** -- Pluggable AI brain architecture (currently: DeepSeek Web)

### Webview UI

- **Rich HTML/CSS Sidebar** -- Styled to match VS Code theme (light/dark)
- **Markdown Rendering** -- Code blocks, tables, blockquotes, inline formatting
- **Collapsible Thinking Chain** -- Expand/collapse DeepSeek's reasoning output
- **Tool Call Cards** -- Expandable cards showing tool name, parameters, status, and result
- **Chat History Browser** -- Browse and restore previous sessions
- **Mode Badge** -- Active mode (PLAN/ACT/AUTO) displayed in the header
- **Queue Bar** -- Shows queued prompts when agent is busy
- **Budget Display** -- Token usage bar showing approximate context consumption
- **Slash Command Menu** -- Auto-suggestions when typing `/`
- **Ask User Modal** -- Inline clarification dialogs from the agent
- **Mode Dropdown** -- Switch between ACT, PLAN, AUTO, and Brainstorm modes
- **Browser Controls** -- Toggle headless mode, restart the browser
- **New Chat Button** -- Start a fresh conversation

---

## Operational Modes

### PLAN Mode

**Purpose**: Read-only planning -- the AI analyzes the codebase and produces a detailed implementation plan without modifying any source code.

**What the AI CAN do:**
- All read-only tools: `read_file`, `grep_search`, `glob_search`, `codebase_summary`, etc.
- Read-only shell commands: `ls`, `cat`, `grep`, `find`, `git log/status/diff/show`
- Write `implementation_plan.md` and `verification.md`
- Dispatch read-only sub-agents

**What the AI CANNOT do:**
- `patch_file`, `patch_multiple_files` -- BLOCKED
- `write_file` on any path other than `implementation_plan.md` or `verification.md`
- Mutating shell commands (rm, mv, cp, npm install, etc.)

### ACT Mode

**Purpose**: Full execution -- the AI implements the user's request using the complete toolset.

**6-Step Execution Cycle:**
1. DISCOVER -- Call `find_workflow` first with the task query
2. UNDERSTAND -- Read the request; `ask_user` if ambiguous; call `codebase_summary` on new projects
3. RESEARCH -- Read files, search code, find callers, understand the codebase
4. EXECUTE -- `read_file` first, then `patch_file`; write tests; use sub-agents in parallel
5. VERIFY -- Run the full test suite; use `find_workflow`/`get_workflow_content`
6. SELF-AUDIT -- Diff review, dependency check, test re-run, final sanity

### AUTO Mode

**Purpose**: Automatic mode detection -- the system analyzes each user prompt and switches between PLAN and ACT based on the user's wording.

**Detection examples:**
- "add a /health endpoint" -> ACT (imperative verb "add")
- "plan this out first" -> PLAN (explicit plan request)
- "what would you suggest?" -> PLAN (question)
- "go ahead and implement" -> ACT (go-ahead phrase)

### Brainstorm Mode

A multi-level analysis pipeline designed to deliver unfiltered, brutally honest, research-backed truth:

1. **Level 0: Web Research** -- Searches for competitors, failed attempts, discussions, market data
2. **Level 1: Three Specialist Analysts** -- Infrastructure, Security, Core Logic analysts extract raw data
3. **Level 2: Three Jury Models** -- Critical Analyst, Review Panel, Foreman cross-reference findings
4. **Level 3: Blueprint** -- Research-grounded architecture document
5. **Destructive Critique Loop** -- Iterates until all issues are resolved
6. **Final Verdict** -- BUILD / ABANDON / PIVOT with research-backed justification

---

## Slash Commands

| Command | Description |
|---------|-------------|
| `/clear` | Clear current chat session |
| `/compact` | Compress current session context to save tokens |
| `/install-workflow <url>` | Download a workflow `.md` from a raw GitHub URL |
| `/install-mcp <name> <package> [args...]` | Add an MCP server to `mcp.json` |
| `/list-workflows` | List all installed workflows and their triggers |

---

## Tools Reference

### Exploration Tools

| Tool | Description | Key Parameters |
|------|-------------|----------------|
| `codebase_summary` | One-shot project shape: directory tree, file counts by language, config files | `path?`, `max_depth?`, `max_files?` |
| `list_directory` | List files and folders with pagination and metadata | `path`, `recursive?`, `max_depth?`, `limit?` |
| `file_info` | File metadata: type, size, modification time, line count | `path` |
| `read_file` | Read file content with 1-based line numbers | `path`, `start_line?`, `end_line?` |
| `glob_search` | Find files by glob pattern | `pattern`, `directory?` |
| `grep_search` | Regex search across files | `pattern`, `directory?`, `include?` |
| `quick_search` | Grep + context lines, optimized for finding specific lines | `pattern`, `directory?`, `context_lines?` |
| `get_file_diff` | Diff current file vs git HEAD or backup | `path`, `against?` |
| `get_recent_errors` | Structured summary of recent tool errors this turn | `limit?` |

### File Editing Tools

| Tool | Description | Key Parameters |
|------|-------------|----------------|
| `write_file` | Create a **new** file (rejected on existing files) | `path`, `content` |
| `patch_file` | Surgical edit via line ranges or string matching | `path`, `start_line?`, `end_line?`, `find_string?`, `replace_string?` |
| `patch_multiple_files` | Atomic multi-file edits (rolls back on any failure) | `patches[]` |
| `restore_file` | Undo a bad edit by restoring from backup | `path`, `version?`, `dry_run?` |

### Execution Tools

| Tool | Description | Key Parameters |
|------|-------------|----------------|
| `execute_shell_command` | Run a shell command (non-interactive) | `command`, `cwd?`, `timeout?` |
| `git_operation` | Run git commands (status, diff, log, branch, checkout, stash) | `action`, `message?`, `file?` |
| `run_tests` | Run project tests (auto-detects test runner) | `test_file?`, `pattern?`, `timeout?` |

### LSP & Code Intelligence

| Tool | Description | Key Parameters |
|------|-------------|----------------|
| `lsp_diagnostics` | Get real type errors from the language server | `path` |
| `lsp_hover` | Get exact type signature and docs for a symbol | `path`, `line`, `character` |
| `lsp_find_references` | Find ALL references using LSP | `path`, `line`, `character` |
| `lsp_rename` | Rename a symbol across ALL files using LSP | `path`, `line`, `character`, `new_name` |
| `find_references` | Find all references via tree-sitter AST | `symbol`, `path?` |
| `go_to_definition` | Jump to where a symbol is defined | `symbol`, `path?` |
| `get_symbol_info` | Full symbol details: type, file, line, references | `symbol`, `path?` |

### Memory & State

| Tool | Description | Key Parameters |
|------|-------------|----------------|
| `write_scratch_file` | Write to scratch/ directory | `filename`, `content`, `append?` |
| `read_scratch_file` | Read a scratch file | `filename`, `start_line?`, `end_line?` |
| `list_scratch_files` | List scratch/ contents | `subdir?`, `recursive?` |
| `update_task` | Read/write persistent task.md | `action`, `content?`, `step?` |
| `update_project_memory` | Persist knowledge to AGENTS.md | `section`, `content`, `scope?` |
| `ask_user` | Pause and ask the user a clarifying question | `question`, `context?`, `options?` |

### Snapshots & Sub-agents

| Tool | Description | Key Parameters |
|------|-------------|----------------|
| `snapshot_state` | Stash all working-tree changes with a label | `label`, `include_untracked?` |
| `restore_to_snapshot` | Roll back to a previous snapshot | `label`, `delete_after_restore?` |
| `run_sub_agent` | Dispatch a micro-task to an isolated sub-agent | `agentNumber`, `name`, `prompt` |
| `search_tool_registry` | Discover MCP / external tools | `query`, `start_index?` |

### Workflow Tools

| Tool | Description | Key Parameters |
|------|-------------|----------------|
| `find_workflow` | Search installed workflow `.md` files | `query` |
| `get_workflow_content` | Load a workflow by id | `workflow_id` |

### Code Quality

| Tool | Description | Key Parameters |
|------|-------------|----------------|
| `lint_code` | Run project linter on files | `path?`, `fix?` |
| `repo_map` | Build code structure map: functions, classes, imports, exports | `path?`, `max_depth?` |

---

## MCP Integration

MCP (Model Context Protocol) provides an extensible tool system via external servers.

### Installing MCP Servers

```
/install-mcp server-name npx-package [extra-args...]
```

Example:
```
/install-mcp puppeteer @anthropic/server-puppeteer
```

Or manually edit `~/.ds_config/mcp.json`:

```json
{
  "mcpServers": {
    "server-name": {
      "command": "npx",
      "args": ["-y", "@package/name", "...extra-args"]
    }
  }
}
```

### Built-in MCP Servers

The extension ships with these MCP servers in `src/mcp/installed_servers/`:
- `@playwright/mcp` -- Playwright browser automation
- `mcp-server-git` -- Git operations via MCP

---

## Checkpoints & Rollback

Before **every user prompt**, the system automatically creates a checkpoint:

1. Runs `git status --porcelain` to detect modified files
2. Copies modified files into `~/.ds_config/checkpoints/cp_<timestamp>/`
3. Writes `meta.json` with id, timestamp, original prompt, and file list

To revert, use the `/revert <checkpoint_id>` command in the sidebar.

### Checkpoint Storage

```
~/.ds_config/checkpoints/
├── cp_20260613_222200/
│   ├── meta.json
│   └── files/
│       ├── src/utils.ts
│       └── src/server.ts
```

---

## Configuration

### Config File Location

`~/.ds_config/config.json`

### Default Configuration

```json
{
  "allow_self_modification": true,
  "allowed_directories": [],
  "blocked_commands": [],
  "max_tool_output_length": 4000,
  "verification_commands": [],
  "headless": false,
  "enforcements": {
    "require_type_cross_reference": true,
    "require_build_attempt": true,
    "require_edge_case_analysis": true,
    "deny_skip_without_documentation": true,
    "self_test_required": "pass_or_skipped_with_reason"
  },
  "plan_mode": {
    "disable_all_verification": true,
    "allow_write_implementation_plan": true,
    "allow_write_verification_md": true,
    "allow_read_all_files": true,
    "blocked_actions": []
  }
}
```

### Configuration Options

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `allow_self_modification` | boolean | `true` | Allow the agent to modify its own installation files |
| `allowed_directories` | string[] | `[]` | Restrict file access to specific directories (empty = all) |
| `blocked_commands` | string[] | `[]` | Shell commands that the agent cannot execute |
| `max_tool_output_length` | number | `4000` | Maximum characters for tool output (truncated beyond this) |
| `headless` | boolean | `false` | Run browser in headless mode (no visible window) |

### Directory Structure

```
~/.ds_config/
├── config.json              # Configuration
├── AGENTS.md                # Global project memory
├── sessions/                # Session storage
│   ├── index.json           # Session metadata index
│   └── <session-id>.jsonl   # Message logs
├── checkpoints/             # Auto-checkpoints
│   └── cp_<timestamp>/
│       ├── meta.json
│       └── files/
├── backups/                 # File backups
├── scratch/                 # Scratch files (per-session)
│   └── <session-id>/
│       ├── task.md
│       └── *.md
├── workflows/               # Installed workflows
│   └── *.md
└── mcp.json                 # MCP server configuration (optional override)
```

---

## Troubleshooting

### Common Issues

**Chat keeps loading / spinner never stops**
- The extension needs `node_modules/` in the VSIX. Ensure you're using the latest package (v1.2.2+).
- Check `/tmp/deepseek-cli-debug.log` for errors.
- Try restarting VS Code.

**Browser fails to launch**
- Ensure Chromium is installed on your system: `which chromium`
- On Ubuntu/Debian: `sudo apt install chromium`
- On Arch: `sudo pacman -S chromium`
- On macOS: `brew install --cask chromium`

**"Failed to connect to CDP port"**
- Another Chrome instance may be using port 9222. Kill it: `pkill -f "remote-debugging-port=9222"`
- Or wait for the existing instance to finish.

**Headless browser does not start in headless mode**
- Toggle headless mode from the Browser dropdown in the sidebar header
- Or set `"headless": true` in `~/.ds_config/config.json`
- Restart the browser from the Browser dropdown after toggling

**Agent responses are empty or truncated**
- Run `/compact` to compress session context
- Start a new chat session with the New Chat button

**MCP server connection fails**
- Check `~/.ds_config/mcp.json` for correct server configuration
- Run `/install-mcp` again to reinstall
- Check `/tmp/deepseek-cli-debug.log` for connection errors

### Debug Logging

The extension writes debug logs to `/tmp/deepseek-cli-debug.log`:

```bash
tail -f /tmp/deepseek-cli-debug.log
```

This log contains:
- Browser initialization progress
- Network stream chunk processing
- Session loading events
- Error stack traces

### Restarting the Extension

1. Click the **Restart Browser** option in the Browser dropdown menu
2. Or use `Ctrl+Shift+P` -> "Developer: Reload Window"
3. Or close and re-open the sidebar panel

---

## Session Management

### Chat History

Click the history icon in the sidebar header to browse and restore previous sessions. Each session shows:
- Session title (first prompt or "Brainstorm: ...")
- Last updated date
- Delete button to remove old sessions

### Session Storage

```
~/.ds_config/sessions/
├── index.json          # Session metadata
└── <session-id>.jsonl  # One JSON object per message
```

### JSONL Message Format

```json
{"role":"user","content":"add error handling","metadata":{"checkpointId":"cp_..."}}
{"role":"assistant","content":"I'll add error handling...","metadata":{"thinking":"..."}}
{"role":"tool_call","content":"read_file","metadata":{"params":{"path":"src/utils.ts"}}}
{"role":"tool_result","content":"...file contents...","metadata":{"tool":"read_file"}}
```

---

## Safety & Guardrails

### Linker Checks

After every `patch_file` or `patch_multiple_files`, the orchestrator runs 6 verification checks:

| Check | What It Catches |
|-------|----------------|
| Import/Export Verification | Imports a name that doesn't exist in the target file's exports |
| Deleted Method Detection | Methods/functions removed but still referenced in other files |
| Undeclared Dependencies | Non-relative imports without corresponding `package.json` entries |
| Conflict Markers | Leftover `<<<<<<<` / `=======` / `>>>>>>>` markers |
| JSON Syntax | Invalid JSON with line/column error reporting |
| File Shrinkage | Files reduced by >30% without explanation keywords |

### Plan Mode Restrictions

When in PLAN mode:
- `patch_file` / `patch_multiple_files` -> BLOCKED
- `write_file` -> Only `implementation_plan.md` and `verification.md`
- Shell commands -> Read-only only (ls, cat, grep, git log etc.)

### Error Recovery Protocol

1. Read the error message -- orchestrator provides recommended next steps
2. Never retry identical calls -- max 2 retries with same tool + parameters
3. After 2+ failures -- re-read file, try different approach, or fix root cause
4. After 3 identical errors -- STOP, use `ask_user` to escalate to the human

---

## Architecture

### Core Components

| Component | Path | Purpose |
|-----------|------|---------|
| Extension | `src/extension.ts` | VS Code sidebar webview panel, message handling, prompt queue, boot agent |
| Orchestrator | `src/core/orchestrator.ts` | Central brain: prompt processing, tool execution, JSON extraction, linker checks, error recovery |
| Webview UI | `src/webview/sidebar.html` | Full-featured sidebar UI with markdown rendering, modals, history |
| TUI (Shared) | `src/tui/tui.ts` | Rendering engine shared between CLI and VS Code; webview message relay |
| Brain System | `src/core/brains/` | AI model communication (DeepSeek Web via headless browser) |
| Tools (38+) | `src/tools/` | Auto-discovered AI tools with `name` + `execute` pattern |
| Tool Registry | `src/tools/index.ts` | Auto-scans, loads, registers tools; builds system prompts; manages modes |
| MCP Loader | `src/mcp/mcp_loader.ts` | Connects to MCP servers via stdio transport, discovers external tools |
| Config | `src/utils/config.ts` | Loads/saves configuration from `~/.ds_config/config.json` |
| History | `src/core/history.ts` | Session persistence: create, load, save sessions and messages (JSONL format) |
| Checkpoints | `src/utils/checkpoints.ts` | Auto-checkpoint before each prompt, revert workspace to any checkpoint |
| Brainstorm | `src/core/brainstorm/` | Multi-level analysis pipeline with specialist/jury/blueprint phases |
| LSP Client | `src/utils/lsp_client.ts` | Language Server Protocol client for real type checking |
| Context Compactor | `src/utils/context_compactor.ts` | Compresses session context when it gets too large |
| Mode Prompts | `src/utils/mode_prompts.ts` | Canonical system prompt blocks for PLAN, ACT, AUTO; scoring-based mode detector |
| Code Graph | `src/utils/code_graph.ts` | Code structure analysis (functions, classes, imports, exports) |
| Diff Helper | `src/utils/diff_helper.ts` | Diff generation utilities for file comparisons |
| Ignore | `src/utils/ignore.ts` | `.gitignore` / `.dsignore` file handling |
| Permissions | `src/utils/permissions.ts` | Tool permission checking and enforcement |
| Harness Guards | `src/utils/harness_guards.ts` | Safety harnesses for tool execution |

### VS Code Contribution Points

```json
{
  "contributes": {
    "viewsContainers": {
      "activitybar": [{
        "id": "deepseek-sidebar-container",
        "title": "DeepSeek",
        "icon": "public/deepseek-gray.svg"
      }]
    },
    "views": {
      "deepseek-sidebar-container": [{
        "type": "webview",
        "id": "deepseek-cli-sidebar",
        "name": "DeepSeek Chat"
      }]
    }
  }
}
```

---

## Development

### Project Structure

```
deepseek-cli/
├── package.json                     # VS Code extension manifest
├── tsconfig.json                    # TypeScript configuration
├── copy_assets.js                   # Build script to copy assets
├── LICENSE                          # MIT license
├── public/                          # Extension icons (SVG, PNG)
├── src/
│   ├── extension.ts                 # VS Code extension entry point
│   ├── tui/
│   │   └── tui.ts                   # Rendering engine (shared)
│   ├── core/
│   │   ├── orchestrator.ts          # Central brain
│   │   ├── history.ts               # Session persistence (JSONL)
│   │   ├── brains/
│   │   │   ├── registry.ts          # Brain factory/registry
│   │   │   ├── base.ts              # Brain abstract base class
│   │   │   └── deepseek-web.ts      # DeepSeek web brain implementation
│   │   └── brainstorm/
│   │       ├── engine.ts            # Multi-level brainstorm pipeline
│   │       └── prompts.ts           # Brainstorm system prompts
│   ├── tools/                       # 38 AI tools (auto-discovered)
│   │   ├── index.ts                 # Tool registry + system prompt builder
│   │   ├── ask_user.ts
│   │   ├── codebase_summary.ts
│   │   ├── execute_shell_command.ts
│   │   ├── file_info.ts
│   │   ├── find_references.ts
│   │   ├── find_workflow.ts
│   │   ├── get_file_diff.ts
│   │   ├── get_recent_errors.ts
│   │   ├── get_symbol_info.ts
│   │   ├── get_workflow_content.ts
│   │   ├── git_operation.ts
│   │   ├── glob_search.ts
│   │   ├── go_to_definition.ts
│   │   ├── grep_search.ts
│   │   ├── lint_code.ts
│   │   ├── list_directory.ts
│   │   ├── list_scratch_files.ts
│   │   ├── lsp_diagnostics.ts
│   │   ├── lsp_find_references.ts
│   │   ├── lsp_hover.ts
│   │   ├── lsp_rename.ts
│   │   ├── patch_file.ts
│   │   ├── patch_multiple_files.ts
│   │   ├── quick_search.ts
│   │   ├── read_file.ts
│   │   ├── read_scratch_file.ts
│   │   ├── repo_map.ts
│   │   ├── restore_file.ts
│   │   ├── restore_to_snapshot.ts
│   │   ├── run_sub_agent.ts
│   │   ├── run_tests.ts
│   │   ├── search_tool_registry.ts
│   │   ├── snapshot_state.ts
│   │   ├── update_project_memory.ts
│   │   ├── update_task.ts
│   │   ├── write_file.ts
│   │   └── write_scratch_file.ts
│   ├── utils/
│   │   ├── checkpoints.ts           # Auto-checkpoints + rollback
│   │   ├── code_graph.ts            # Code structure analysis
│   │   ├── config.ts                # Configuration management
│   │   ├── context_compactor.ts     # Session context compression
│   │   ├── diff_helper.ts           # Diff generation utilities
│   │   ├── error_formatter.ts       # Error formatting
│   │   ├── harness_guards.ts        # Safety harnesses
│   │   ├── ignore.ts                # .gitignore / .dsignore handling
│   │   ├── lsp_client.ts            # Language Server Protocol client
│   │   ├── mode_prompts.ts          # System prompts + mode detection
│   │   ├── permissions.ts           # Tool permission checking
│   │   └── reminder_prompt.ts       # Per-turn reminder builder
│   ├── mcp/
│   │   ├── mcp_loader.ts            # MCP server connection manager
│   │   ├── mcp.json                 # MCP server configuration
│   │   └── installed_servers/       # Auto-installed MCP packages
│   └── webview/
│       └── sidebar.html             # VS Code webview HTML (full UI)
└── dist/                            # Compiled output
```

### Build Commands

```bash
# Build TypeScript + copy assets
npm run build

# Watch mode (rebuild on change)
npm run watch

# Package VS Code extension
npx vsce package

# Install dependencies
npm install
```

### Adding a New Tool

1. Create a new file in `src/tools/` (e.g., `my_tool.ts`)
2. Export `name` (string) and `execute` (async function):

```typescript
module.exports = {
  name: "my_tool",
  description: "Description for the system prompt",
  parameters: {
    type: "object",
    properties: {
      input: { type: "string", description: "The input parameter" }
    },
    required: ["input"]
  },
  execute: async (params) => {
    // Tool logic here
    return { success: true, result: "..." };
  }
};
```

3. The tool is **auto-discovered** by `tools/index.ts` which scans `__dirname` for modules with `name` + `execute`
4. The tool automatically appears in the system prompt and becomes available to the AI agent

### Key Technical Details

- **Module System**: CommonJS (`"type": "commonjs"` in package.json)
- **TypeScript**: Target ES2022, module CommonJS
- **Auto-discovery**: Tools are loaded by scanning the tools directory for any module exporting `name` + `execute`
- **System Prompt Construction**: Built from modular blocks in `mode_prompts.ts` (tool catalog, safety rules, examples, mode-specific instructions)
- **Sub-agent Isolation**: Each sub-agent gets its own scratch directory and filesystem context via `AsyncLocalStorage`
- **Atomic Writes**: Session index uses temp-file + rename pattern for crash safety
- **Global State**: `global.currentSessionId` tracks the active session across modules
- **Browser Management**: Headless Chromium is launched with `--remote-debugging-port=9222`; Playwright connects via CDP

---

## License

MIT

---

<p align="center">
  <sub>Built with focus by <a href="https://github.com/jaadu611">jaadu611</a></sub>
</p>