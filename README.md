<p align="center">
  <img src="public/deepseek-color.png" alt="DeepSeek CLI Logo" width="120" />
</p>

<h1 align="center">deepseek-cli</h1>

<p align="center">
  <strong>A dual-mode AI coding agent powered by DeepSeek — running from the terminal or inside VS Code.</strong>
</p>

<p align="center">
  <a href="#features">Features</a> · <a href="#installation">Installation</a> · <a href="#quick-start">Quick Start</a> · <a href="#architecture">Architecture</a> · <a href="#tools-reference">Tools</a> · <a href="#slash-commands">Commands</a> · <a href="#modes">Modes</a> · <a href="#mcp-integration">MCP</a> · <a href="#workflows">Workflows</a> · <a href="#configuration">Config</a> · <a href="#development">Dev</a>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/version-1.2.0-blue" alt="Version" />
  <img src="https://img.shields.io/badge/node-%3E%3D18.0.0-green" alt="Node.js" />
  <img src="https://img.shields.io/badge/license-MIT-yellow" alt="License" />
  <img src="https://img.shields.io/badge/TypeScript-5.3-blue" alt="TypeScript" />
</p>

---

## Overview

**deepseek-cli** (npm package: `deepseek-chat`) is an AI-powered autonomous coding assistant that operates in two modes:

1. **CLI Tool** — A rich terminal UI (built with `blessed`) invoked via `ds` or `deepseek-cli`
2. **VS Code Extension** — A sidebar webview panel integrated into the IDE activity bar

The agent communicates with **DeepSeek AI** through a headless browser and wields **38 built-in tools** for file exploration, surgical code editing, shell execution, git operations, language server integration, and more. It supports **PLAN**, **ACT**, **AUTO**, and **Brainstorm** operational modes, with automatic checkpoint creation, session persistence, sub-agent parallelism, and extensible MCP server integration.

---

## Features

### 🤖 AI Agent Core
- **DeepSeek Web Brain** — Communicates with DeepSeek AI via headless browser (Puppeteer/Playwright), maintaining persistent chat sessions
- **38 Built-in Tools** — File exploration, editing, execution, code intelligence, LSP, git, memory, workflows, and more
- **Sub-agent System** — Dispatch parallel, isolated micro-tasks to sub-agents for dramatically faster multi-file edits
- **Tool Normalization Engine** — Parses diverse JSON formats from LLM output: markdown code blocks, malformed JSON, trailing commas, unquoted keys, and nested objects
- **Circuit Breaker** — Blocks repeated identical tool calls (3+ in a row) to prevent infinite loops

### 🔄 Three Operational Modes + Brainstorm
- **PLAN Mode** — Read-only planning; AI produces `implementation_plan.md` without touching source code
- **ACT Mode** — Full execution with all tools enabled; follows a rigorous 6-step execution cycle
- **AUTO Mode** — Per-turn mode auto-detection via scoring-based NLP analysis, supporting 10+ languages
- **Brainstorm Mode** — Multi-level analysis pipeline: 3 specialist analysts → 3 jury critics → blueprint → verdict

### 🛠 38 AI Tools
- **Exploration (9)** — `codebase_summary`, `list_directory`, `file_info`, `read_file`, `glob_search`, `grep_search`, `quick_search`, `get_file_diff`, `get_recent_errors`
- **Editing (4)** — `write_file`, `patch_file`, `patch_multiple_files`, `restore_file`
- **Execution (3)** — `execute_shell_command`, `git_operation`, `run_tests`
- **Code Quality (2)** — `lint_code`, `repo_map`
- **Code Intelligence (3)** — `find_references`, `go_to_definition`, `get_symbol_info`
- **LSP (4)** — `lsp_diagnostics`, `lsp_hover`, `lsp_find_references`, `lsp_rename`
- **Memory/State (6)** — `write_scratch_file`, `read_scratch_file`, `list_scratch_files`, `update_task`, `update_project_memory`, `ask_user`
- **Snapshots (2)** — `snapshot_state`, `restore_to_snapshot`
- **Sub-agents (1)** — `run_sub_agent`
- **External (1)** — `search_tool_registry`
- **Workflows (2)** — `find_workflow`, `get_workflow_content`

### 🛡 Safety & Guardrails
- **Linker Checks** — Verifies imports/exports match, detects deleted methods still referenced elsewhere, flags undeclared package dependencies
- **Conflict Marker Detection** — Finds leftover git conflict markers (`<<<<<<<`, `=======`, `>>>>>>>`)
- **File Shrinkage Detection** — Flags files reduced by >30% (warns about accidental mass deletion)
- **JSON Syntax Validation** — Reports exact line/column for invalid JSON
- **Plan Mode Restrictions** — Blocks `patch_file`, `patch_multiple_files`, and mutating shell commands
- **Error Recovery Protocol** — Mandatory read-before-write, retry limits, escalation to `ask_user`
- **Self-test Requirement** — Every final answer must include `PASS  Self-test: <cmd> -> <result>`
- **Prohibited Phrases** — Prevents stalling preambles ("Let me think about this...")

### 💾 State Management
- **Session Persistence** — JSONL-based conversation storage per session in `~/.ds_config/sessions/`
- **Auto-Checkpoints** — Created before every user prompt with full workspace rollback capability
- **Scratch Files** — Agent's persistent memory across turns (per-session scratch directory)
- **task.md** — Running progress tracker for multi-step tasks via `update_task`
- **Project Memory (AGENTS.md)** — Persistent knowledge injected into every system prompt
- **Snapshots** — Git stash-based workspace state for safe experimentation

### 🔌 Extensibility
- **MCP (Model Context Protocol)** — Plug in external tool servers via `mcp.json`
- **Workflows** — Install community workflow `.md` files with trigger-based activation
- **LSP Integration** — Real type checking via tsserver, pyright, gopls, rust-analyzer
- **Brain Registry** — Pluggable AI brain architecture (currently: DeepSeek Web)

### 🎨 Rich Terminal UI
- **ANSI 256-color palette** with semantic color tokens (accent, thinking, tool, error, etc.)
- **Markdown rendering** with syntax-highlighted code blocks and colored borders
- **Animated braille spinners** (8-frame cycle: ⠁⠂⠄⡀⢀⠠⠐⠈)
- **Scrollback** via PageUp/PageDown, Shift+Up/Down, Ctrl+U/Ctrl+D
- **Chat history browser** — Browse and restore previous sessions
- **Expandable tool call cards** — Tool name, parameters, status, and result
- **Thinking chain display** — Collapsible reasoning/thinking output
- **Mode badge** — Active mode (PLAN/ACT/AUTO) in the top bar
- **Auto-scroll** on new messages with manual override

---

## Installation

### From npm

```bash
npm install -g deepseek-chat
```

### From Source

```bash
git clone https://github.com/jaadu611/deepseek-cli.git
cd deepseek-cli
npm install
npm run build
```

### Prerequisites

| Requirement | Version | Notes |
|-------------|---------|-------|
| Node.js | ≥ 18.0.0 | Required for MCP SDK and ES modules |
| Git | Any recent | Used for checkpoints, snapshots, and git operations |
| Browser | Playwright/Puppeteer | Headless browser for DeepSeek web communication |
| VS Code | ≥ 1.80.0 | Optional — only for VS Code extension mode |

---

## Quick Start

### Launch the CLI

```bash
ds
# or
deepseek-cli
```

The agent boots a headless browser, connects to MCP servers, and presents the interactive TUI.

### Basic Usage

```bash
# Ask the agent to do something
> add error handling to src/utils.ts

# Switch to plan mode
> /plan

# Analyze the codebase
> analyze this project and suggest improvements

# Brainstorm an idea
> brainstorm: what if we migrate to a microservices architecture?

# Switch to act mode to implement
> /act
> go ahead and implement the plan
```

### VS Code

Open the DeepSeek Chat sidebar from the activity bar, then type in the webview panel.

---

## Architecture

### Dual-Mode Design

```
                    ┌─────────────────────┐
                    │     Orchestrator     │  ← Central brain
                    │  (orchestrator.ts)   │
                    └─────────┬───────────┘
                              │
              ┌───────────────┼───────────────┐
              │               │               │
     ┌────────┴──────┐  ┌────┴────┐  ┌───────┴──────┐
     │  CLI (TUI)    │  │ VS Code │  │  Brainstorm  │
     │  (cli.ts)     │  │ (ext)   │  │  (engine.ts) │
     └────────┬──────┘  └────┬────┘  └───────┬──────┘
              │              │               │
              └──────────────┼───────────────┘
                             │
                    ┌────────┴────────┐
                    │  Tools (38)     │  ← Auto-discovered
                    │  MCP Servers    │  ← Pluggable
                    │  Brain (DeepSeek)│ ← Headless browser
                    └─────────────────┘
```

### Core Components

| Component | Path | Purpose |
|-----------|------|---------|
| **Orchestrator** | `src/core/orchestrator.ts` | Central brain: prompt processing, tool execution, JSON extraction, linker checks, error recovery |
| **CLI** | `src/cli/cli.ts` | Terminal UI interaction loop, slash command handling, session management |
| **TUI** | `src/tui/tui.ts` | Terminal User Interface built with `blessed`: rendering, spinners, scrollback, input |
| **Extension** | `src/extension.ts` | VS Code sidebar webview panel, message handling, prompt queue |
| **Brain System** | `src/core/brains/` | AI model communication (DeepSeek Web via headless browser) |
| **Tools** | `src/tools/` | 38 auto-discovered AI tools with `name` + `execute` pattern |
| **Tool Registry** | `src/tools/index.ts` | Auto-scans, loads, registers tools; builds system prompts; manages modes |
| **Mode Prompts** | `src/utils/mode_prompts.ts` | Canonical system prompt blocks for PLAN, ACT, AUTO; scoring-based mode detector |
| **MCP Loader** | `src/mcp/mcp_loader.ts` | Connects to MCP servers via stdio transport, discovers external tools |
| **Config** | `src/utils/config.ts` | Loads/saves configuration from `~/.ds_config/config.json` |
| **History** | `src/core/history.ts` | Session persistence: create, load, save sessions and messages (JSONL format) |
| **Checkpoints** | `src/utils/checkpoints.ts` | Auto-checkpoint before each prompt, revert workspace to any checkpoint |
| **Brainstorm** | `src/core/brainstorm/` | Multi-level analysis pipeline with specialist/jury/blueprint phases |
| **LSP Client** | `src/utils/lsp_client.ts` | Language Server Protocol client for real type checking |
| **Context Compactor** | `src/utils/context_compactor.ts` | Compresses session context when it gets too large |
| **Code Graph** | `src/utils/code_graph.ts` | Code structure analysis (functions, classes, imports, exports) |
| **Diff Helper** | `src/utils/diff_helper.ts` | Diff generation utilities for file comparisons |
| **Ignore** | `src/utils/ignore.ts` | `.gitignore` / `.dsignore` file handling |
| **Permissions** | `src/utils/permissions.ts` | Tool permission checking and enforcement |
| **Harness Guards** | `src/utils/harness_guards.ts` | Safety harnesses for tool execution |

### Brain System

The brain system is responsible for communicating with the AI model:

- **`src/core/brains/registry.ts`** — Factory/registry pattern that manages brain instances and the active brain
- **`src/core/brains/base.ts`** — Abstract base class defining the brain interface (`init`, `ask`, `cleanup`, `onSessionLoad`)
- **`src/core/brains/deepseek-web.ts`** — Concrete implementation using a headless browser to interact with DeepSeek's web chat interface

The brain maintains a persistent browser session, navigates to DeepSeek's chat page, injects prompts, reads responses (including the thinking chain), and supports session switching.

### Orchestrator Deep Dive

The orchestrator (`src/core/orchestrator.ts`, ~1575 lines) is the most complex component:

1. **JSON Extraction** — Parses LLM output with multiple strategies:
   - Markdown code block extraction (`` ```json ... ``` ``)
   - Standard JSON brace matching with depth tracking
   - JSON repair (trailing commas, unquoted keys)
   - First-brace-to-last-brace fallback
   - Response field detection for final answers

2. **Tool Execution Loop** — Feeds LLM output through JSON extraction → tool normalization → tool execution → result feedback, until the model produces a final answer

3. **Linker Checks** (post-patch verification):
   - `verifyImportsAndExports()` — Checks that imported names exist in the target file's exports
   - `verifyNoDeletedReferences()` — Compares current vs git HEAD to find deleted methods still referenced elsewhere
   - `verifyThirdPartyDependencies()` — Checks that non-relative imports have corresponding entries in `package.json`
   - `verifyNoConflictMarkers()` — Detects leftover git conflict markers
   - `verifyJsonSyntax()` — Validates JSON files with precise error location
   - `verifyFileShrinkage()` — Warns when files are reduced by >30% without explanation

4. **Safe Truncation** — Truncates large tool output to configurable `max_tool_output_length`

5. **Session Management** — Creates/loads sessions, saves messages, manages chat history

6. **Plan Handoff** — Parses `READY:` and `ASK_USER:` from implementation plans for PLAN→ACT transitions

7. **Scratch Injection** — Reads scratch files and injects their content into the model's context each turn

8. **Context Compaction** — When context grows too large, compresses session history

---

## Tools Reference

### Exploration Tools

| Tool | Description | Key Parameters |
|------|-------------|----------------|
| `codebase_summary` | One-shot project shape: directory tree, file counts by language, config files | `path?`, `max_depth?`, `max_files?` |
| `list_directory` | List files and folders with pagination and metadata | `path`, `recursive?`, `max_depth?`, `offset?`, `limit?`, `include_metadata?` |
| `file_info` | File metadata: type, size, modification time, line count | `path` |
| `read_file` | Read file content with 1-based line numbers | `path`, `start_line?`, `end_line?` |
| `glob_search` | Find files by glob pattern (e.g., `src/**/*.ts`) | `pattern`, `directory?`, `offset?`, `limit?` |
| `grep_search` | Regex search across files | `pattern`, `directory?`, `include?`, `exclude?`, `offset?`, `limit?` |
| `quick_search` | Grep + 3 lines of context, optimized for finding specific lines | `pattern`, `directory?`, `file?`, `include?`, `context_lines?`, `case_sensitive?`, `max_results?` |
| `get_file_diff` | Diff current file vs git HEAD or backup | `path`, `against?` |
| `get_recent_errors` | Structured summary of recent tool errors this turn | `limit?` |

### File Editing Tools

| Tool | Description | Key Parameters |
|------|-------------|----------------|
| `write_file` | Create a **new** file (rejected on existing files) | `path`, `content` |
| `patch_file` | Surgical edit via line ranges or string matching | `path`, `start_line?`, `end_line?`, `new_content?`, `find_string?`, `replace_string?` |
| `patch_multiple_files` | Atomic multi-file edits (rolls back on any failure) | `patches[]` |
| `restore_file` | Undo a bad edit by restoring from backup | `path`, `version?`, `dry_run?` |

**Patching Strategy:**
- **Preferred**: `find_string` + `replace_string` (line-drift immune, matches actual content)
- **Fallback**: `start_line` + `end_line` + `new_content` (dangerous — line numbers shift after edits)
- **Rule**: Always `read_file` after every patch before making another edit to the same file

### Execution Tools

| Tool | Description | Key Parameters |
|------|-------------|----------------|
| `execute_shell_command` | Run a shell command (non-interactive) | `command`, `cwd?`, `timeout?`, `retry_count?`, `retry_delay_ms?` |
| `git_operation` | Run git commands (status, diff, log, branch, checkout, stash) | `action`, `message?`, `file?`, `branch?`, `label?` |
| `run_tests` | Run project tests (auto-detects test runner) | `test_file?`, `pattern?`, `framework?`, `timeout?` |

`run_tests` auto-detects: `npm test`, `pytest`, `cargo test`, `go test`, `jest`, `mocha`, and more.

### Code Quality Tools

| Tool | Description | Key Parameters |
|------|-------------|----------------|
| `lint_code` | Run project linter on files | `path?`, `fix?` |
| `repo_map` | Build code structure map: functions, classes, imports, exports across all source files | `path?`, `max_depth?`, `include_tests?` |

### Code Intelligence (Tree-sitter AST)

| Tool | Description | Key Parameters |
|------|-------------|----------------|
| `find_references` | Find all references to a symbol across the codebase | `symbol`, `path?` |
| `go_to_definition` | Jump to where a symbol is defined | `symbol`, `path?` |
| `get_symbol_info` | Full details: type, file, line, references, imports | `symbol`, `path?` |

### Language Server Protocol (LSP)

| Tool | Description | Key Parameters |
|------|-------------|----------------|
| `lsp_diagnostics` | Get real type errors from the language server | `path` |
| `lsp_hover` | Get exact type signature and docs for a symbol | `path`, `line`, `character` |
| `lsp_find_references` | Find ALL references using LSP (more accurate than grep) | `path`, `line`, `character` |
| `lsp_rename` | Rename a symbol across ALL files using LSP | `path`, `line`, `character`, `new_name`, `dry_run?` |

**LSP vs grep:**
- Use LSP tools for TypeScript, JavaScript, Python, Go, Rust (when language server installed)
- Use `grep_search` for Dart, Ruby, Java, C/C++ (no LSP support yet)
- Use `find_references` (tree-sitter) as a backup when LSP is unavailable

Supported language servers: tsserver, pyright, gopls, rust-analyzer.

### Memory / State / Scratch

| Tool | Description | Key Parameters |
|------|-------------|----------------|
| `write_scratch_file` | Write to scratch/ directory | `filename`, `content`, `append?`, `delete?` |
| `read_scratch_file` | Read a scratch file | `filename`, `start_line?`, `end_line?` |
| `list_scratch_files` | List scratch/ contents | `subdir?`, `recursive?` |
| `update_task` | Read/write persistent task.md | `action`, `content?`, `step?`, `current_step?` |
| `update_project_memory` | Persist knowledge to AGENTS.md | `section`, `content`, `scope?`, `action?` |
| `ask_user` | Pause and ask the user a clarifying question | `question`, `context?`, `options?` |

### Snapshots & Checkpoints

| Tool | Description | Key Parameters |
|------|-------------|----------------|
| `snapshot_state` | Stash all working-tree changes with a label | `label`, `include_untracked?` |
| `restore_to_snapshot` | Roll back to a previous snapshot | `label`, `delete_after_restore?` |

Checkpoints are **auto-created** before every user prompt (managed by `checkpoints.ts`, not a tool).

### Sub-agents & External

| Tool | Description | Key Parameters |
|------|-------------|----------------|
| `run_sub_agent` | Dispatch a micro-task to an isolated sub-agent | `agentNumber`, `name`, `prompt` |
| `search_tool_registry` | Discover MCP / external tools (paginated, 10 per page) | `query`, `start_index?` |

**Sub-agent rules:**
- Prompt must be **120+ characters** with: exact file paths, precise line ranges, exact code, interface contracts, what NOT to touch
- Sub-agents **cannot** call `run_sub_agent` (no recursion)
- Use parallel dispatch for independent tasks on different files

### Workflow Tools

| Tool | Description | Key Parameters |
|------|-------------|----------------|
| `find_workflow` | Search installed workflow `.md` files | `query` |
| `get_workflow_content` | Load a workflow by id | `workflow_id` |

---

## Slash Commands

| Command | Description |
|---------|-------------|
| `/new` | Start a new chat session (clears TUI, opens new browser session) |
| `/chat` | Browse chat history — select and load a previous session |
| `/plan` | Switch to **PLAN** mode (read-only planning) |
| `/act` | Switch to **ACT** mode (full tool access) |
| `/auto` | Switch to **AUTO** mode (auto-detect per turn) |
| `/compact` | Compress current session context to save tokens |
| `/install-workflow <url>` | Download a workflow `.md` from a raw GitHub URL |
| `/install-mcp <name> <package> [args...]` | Add an MCP server to `mcp.json` |
| `/list-workflows` | List all installed workflows and their triggers |
| `/list-mcp` | List all configured MCP servers |
| `/checkpoints` | List all local checkpoints with timestamps |
| `/revert <checkpoint_id>` | Revert the entire workspace to a previous checkpoint |
| `/help` | Show the help message with all commands |

---

## Modes

### PLAN Mode

**Purpose**: Read-only planning — the AI analyzes the codebase and produces a detailed implementation plan without modifying any source code.

**What the AI CAN do:**
- All read-only tools: `read_file`, `grep_search`, `glob_search`, `codebase_summary`, etc.
- Read-only shell commands: `ls`, `cat`, `grep`, `find`, `git log/status/diff/show`
- Write `implementation_plan.md` and `verification.md`
- Dispatch read-only sub-agents

**What the AI CANNOT do:**
- `patch_file` — **BLOCKED**
- `patch_multiple_files` — **BLOCKED**
- `write_file` on any path other than `implementation_plan.md` or `verification.md`
- Mutating shell commands (rm, mv, cp, npm install, etc.)

**Plan File Schema:**
```
## 1. Summary
## 2. Research findings
## 3. File-by-file plan (MODIFY / CREATE / DELETE)
## 4. Sub-agent delegation plan
## 5. Verification plan
## 6. Risks and open questions
## 7. Done criteria (checklist)
## 8. Handoff (READY: or ASK_USER:)
```

**Transition**: The plan ends with `READY: <summary>` or `ASK_USER: <question>`. User types `/act` to execute.

### ACT Mode

**Purpose**: Full execution — the AI implements the user's request using the complete toolset.

**6-Step Execution Cycle:**
1. **DISCOVER** — Call `find_workflow` first with the task query
2. **UNDERSTAND** — Read the request; ask_user if ambiguous; call `codebase_summary` on new projects
3. **RESEARCH** — Read files, search code, find callers, understand the codebase
4. **EXECUTE** — `read_file` first, then `patch_file`; write tests; use sub-agents in parallel
5. **VERIFY** — Run the full test suite; use `find_workflow`/`get_workflow_content`
6. **SELF-AUDIT** — Diff review, dependency check, test re-run, final sanity

**Code Change Safety Rules:**
- Snapshot before any edit
- Atomic change + immediate verification (build + test after each patch)
- Read after every patch (line numbers are stale after edits)
- Post-mortem after failure (record in project memory)
- Final build verification before claiming completion

### AUTO Mode

**Purpose**: Automatic mode detection — the system analyzes each user prompt and switches between PLAN and ACT based on the user's wording.

**Detection examples:**
- "add a /health endpoint" → **ACT** (imperative verb "add")
- "plan this out first" → **PLAN** (explicit plan request)
- "what would you suggest?" → **PLAN** (question)
- "go ahead and implement" → **ACT** (go-ahead phrase)
- "analyze the codebase" → **PLAN** (analysis request)
- "fix the bug" → **ACT** (imperative verb "fix")

### Mode Detection (Scoring-Based)

The mode detector (`src/utils/mode_prompts.ts`) uses a **scoring-based system** with:

- **ACT_SIGNALS** — 13 regex patterns with weights (imperatives, go-ahead phrases, execution verbs, past tense, multi-language)
- **PLAN_SIGNALS** — 17 regex patterns with weights (plan nouns, questions, softeners, analysis verbs, multi-language)
- **NEGATION_ACT_TO_PLAN** — Reverses act signals ("don't just do it" → plan)
- **NEGATION_PLAN_TO_ACT** — Reverses plan signals ("skip the plan, just code" → act)

**Score computation:**
1. Strip filler words ("please", "hey", etc.)
2. Score all ACT and PLAN signals
3. Apply negation modifiers
4. Apply boosts: imperative starters (+2 act), questions (+2 plan)
5. Compare scores with threshold (1.5) and minimum difference (0.5)

**Supported languages**: English, German, Dutch, French, Spanish, Portuguese, Italian, Russian, Japanese, Chinese, Hindi, Korean.

---

## Brainstorm Mode

### Philosophy

Brainstorm mode is designed to deliver **unfiltered, brutally honest, research-backed truth**. The AI will:

- **Tell you the raw truth** — Even if it means bad-mouthing your idea. No corporate diplomacy, no hedging, no "that's interesting!"
- **Research everything** — Search Google for real competitors, Reddit threads, Hacker News discussions, forum posts, failed attempts, and market data
- **Cite real sources** — Every claim must be backed by a real URL or source. No speculation, no guessing
- **Fact-check itself** — Each level cross-references research data before rendering a verdict

**What the brainstorm does NOT do:**
- It does NOT tell you what you want to hear
- It does NOT sugarcoat bad ideas
- It does NOT make things up if it can't find evidence
- It does NOT give vague advice — everything is specific, actionable, and grounded in research

### Multi-Level Pipeline

Brainstorm mode (`src/core/brainstorm/engine.ts`) runs a **sequential multi-level analysis pipeline** using the same browser page:

```
User Idea
    │
    ▼
┌─────────────────────────────────────────┐
│ LEVEL 0: Web Research (NEW)              │
│  Searches Google for:                    │
│  • Competitors (URLs, pricing, weaknesses)│
│  • Failed attempts                       │
│  • Reddit & Hacker News discussions      │
│  • Market data & sizing                  │
│  • Technical feasibility                 │
│  • Pricing & monetization               │
│  • Timing assessment                     │
│  • User complaints                       │
│  • Legal/regulatory risks                │
│  Produces: Research Data + Direct Links  │
└─────────────────┬───────────────────────┘
                  │
                  ▼
┌─────────────────────────────────────────┐
│ LEVEL 1: Three Specialist Analysts       │
│  ├── Infrastructure Specialist           │
│  ├── Security Specialist                 │
│  └── Core Logic Specialist               │
│  (Each extracts raw data from their lens │
│   GROUNDED IN THE RESEARCH DATA)         │
└─────────────────┬───────────────────────┘
                  │
                  ▼
┌─────────────────────────────────────────┐
│ LEVEL 2: Three Jury Models              │
│  ├── Critical Analyst (BRUTAL critique) │
│  ├── Review Panel (Fact-checks critique) │
│  └── Foreman (Research-weighted verdict) │
│  (Each reviews Level 1 + 2 data)         │
└─────────────────┬───────────────────────┘
                  │
                  ▼
┌─────────────────────────────────────────┐
│ LEVEL 3: Blueprint                       │
│  Research-grounded architecture document │
│  with:                                   │
│  • Competitive differentiation           │
│  • Realistic timeline (solo dev)         │
│  • Monetization strategy (real pricing)  │
│  • Go-to-market (real user channels)     │
└─────────────────┬───────────────────────┘
                  │
                  ▼
┌─────────────────────────────────────────┐
│ DESTRUCTIVE LOOP (iterates until 0 bugs) │
│  Jury tries to BREAK the blueprint       │
│  Each cycle patches and re-tests         │
└─────────────────┬───────────────────────┘
                  │
                  ▼
┌─────────────────────────────────────────┐
│ FINAL VERDICT (RESEARCH-BACKED)          │
│  • Brutal Verdict (3-4 sentences)        │
│  • Decision: BUILD/ABANDON/PIVOT         │
│  • Honesty Score (1-10)                  │
│  • Deal-Breakers & Strengths             │
│  • Competitor Reality Check              │
│  • What Kills This Project               │
│  • What Could Save It                    │
│  • What NOT To Do                        │
│  • Final Blueprint (if BUILD)            │
│  • Next Steps (specific, actionable)     │
└─────────────────────────────────────────┘
```

### Destructive Critique Pipeline

After the main pipeline, a **destructive critique** phase runs (iterating until all issues are resolved):

1. **Destructive Critique** — Ruthlessly attacks every flaw in the blueprint with research-backed evidence
2. **Destructive Review** — Fact-checks the critique against real data, calls out BS from Model A
3. **Destructive Foreman** — Ties the knot, decides which issues are real vs overexaggerated
4. **Destructive Patch** — Applies fixes, then loops back to critique again

The loop continues until `[ISSUES_COUNT: 0]` (no remaining issues) or hits the safety limit of 50 iterations.

### Final Verdict Sections

The final verdict delivers these specific sections:
- 🎯 **BRUTAL VERDICT** — Raw truth, no hedging
- ⚡ **DECISION** — BUILD / ABANDON / PIVOT with research-backed justification
- 📊 **HONESTY SCORE** — How realistic was the original idea (1-10)
- 🔥 **TOP 3 DEAL-BREAKERS** — The things that will kill the project
- ✅ **TOP 3 STRENGTHS** — What's genuinely strong (or "none found")
- 🏆 **COMPETITOR REALITY CHECK** — Top 3 competitors and what they do better
- 💀 **WHAT WILL ACTUALLY KILL THIS PROJECT** — The hard truth
- 💡 **WHAT COULD SAVE THIS PROJECT** — If there's a path to success
- 📋 **FINAL BLUEPRINT** — Complete technical architecture (or "NOT APPLICABLE")
- 🗺️ **NEXT STEPS** — 5 specific, actionable steps with URLs
- 🚫 **WHAT NOT TO DO** — Based on competitor failures

**Each level's specialist lenses cover:**
- **Infrastructure**: deployment, scalability, databases, networking, CI/CD, monitoring, costs (grounded in competitor research)
- **Security**: auth, authorization, encryption, API security, compliance, vulnerabilities (citing real incidents)
- **Core Logic**: business logic, data models, algorithms, state management, error handling, API design (comparing to real products)

---

## MCP Integration

### How MCP Works

MCP (Model Context Protocol) provides an extensible tool system via external servers. The MCP loader (`src/mcp/mcp_loader.ts`):

1. Reads `mcp.json` (located at `src/mcp/mcp.json` or `~/.ds_config/mcp.json`)
2. For each server entry, resolves the binary path (auto-installs npm packages if needed)
3. Connects via `StdioClientTransport` with a 10-second timeout
4. Discovers available tools from each server
5. Registers discovered tools into the flat `toolRegistry`
6. Tools become available to the AI agent via `search_tool_registry`

**Built-in MCP servers** (in `src/mcp/installed_servers/`):
- `@playwright/mcp` — Playwright browser automation
- `mcp-server-git` — Git operations via MCP

### Installing MCP Servers

```bash
# Add an MCP server
/install-mcp server-name npx-package [extra-args...]

# Example: Add a Puppeteer server
/install-mcp puppeteer @anthropic/server-puppeteer

# List configured servers
/list-mcp
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

---

## Checkpoints & Rollback

Checkpoints provide automatic workspace safety:

### Auto-Checkpoints

Before **every user prompt**, the system:
1. Runs `git status --porcelain` to detect modified files
2. Copies modified files into `~/.ds_config/checkpoints/cp_<timestamp>/files/`
3. Writes `meta.json` with id, timestamp, original prompt, and file list
4. Includes the checkpoint ID in the prompt metadata

### Managing Checkpoints

```bash
# List all checkpoints
/checkpoints
# Output: cp_20260613_222200 (10:22 PM): "add error handling" [3 files]

# Revert to a specific checkpoint
/revert cp_20260613_222200
# Output: ✓ Reverted workspace to Checkpoint cp_20260613_222200

# Revert process:
# 1. git reset --hard HEAD
# 2. git clean -fd (removes untracked files)
# 3. Restores files from checkpoint's files/ directory
```

### Checkpoint Storage

```
~/.ds_config/checkpoints/
├── cp_20260613_222200/
│   ├── meta.json
│   │   { "id": "cp_...", "timestamp": "...", "userPrompt": "...", "files": [...] }
│   └── files/
│       ├── src/utils.ts
│       └── src/server.ts
├── cp_20260613_223400/
│   └── ...
```

---

## Workflows

### Installing Workflows

```bash
# Install from a raw GitHub URL
/install-workflow https://raw.githubusercontent.com/user/repo/main/workflow.md

# List installed workflows
/list-workflows
```

Workflows are saved to `~/.ds_config/workflows/`.

### Workflow Triggers

Each workflow `.md` file can specify a trigger keyword on its first line:

```markdown
trigger: react-component

# React Component Workflow
## Step 1: Create the component file...
## Step 2: Create the test file...
```

When `find_workflow` is called, it searches workflow files for relevant content. If a trigger matches the user's task, that workflow is prioritized.

### Workflow File Format

Workflow files are standard Markdown with step-by-step instructions. The agent calls `find_workflow` at the **start of every task** to discover relevant workflows, then `get_workflow_content` to read the full instructions.

---

## Session Management

### Chat History

```bash
# Browse previous sessions
/chat

# Start a new session (clear screen, new browser session)
/new
```

### Session Storage

Sessions are stored in `~/.ds_config/sessions/`:

```
~/.ds_config/sessions/
├── index.json          # Array of session metadata
└── <session-id>.jsonl  # One JSON object per message
```

**index.json** structure:
```json
[
  {
    "id": "abc123",
    "title": "Add error handling",
    "created_at": "2026-06-13T22:00:00Z",
    "updated_at": "2026-06-13T22:15:00Z",
    "deepseekId": "..."
  }
]
```

**JSONL message format** (one per line):
```json
{"role":"user","content":"add error handling","metadata":{"checkpointId":"cp_..."}}
{"role":"assistant","content":"I'll add error handling...","metadata":{"thinking":"..."}}
{"role":"tool_call","content":"read_file","metadata":{"params":{"path":"src/utils.ts"}}}
{"role":"tool_result","content":"...file contents...","metadata":{"tool":"read_file"}}
```

---

## Scratch Files & Task Tracking

### Scratch Files

Scratch files are the agent's **persistent memory across turns**. Stored in `~/.ds_config/scratch/<session-id>/`:

```bash
# The agent can read, write, and list scratch files
write_scratch_file(filename="research.md", content="...")
read_scratch_file(filename="research.md")
list_scratch_files()
```

At the start of each turn, the agent receives a `[SCRATCH FILES]` section in its reminder, listing all scratch files with sizes and timestamps.

### task.md (Progress Tracker)

For multi-step tasks (3+ tool calls), the agent maintains a `task.md` in scratch/:

```bash
# Read current task state
update_task(action="get")

# Set/update the plan
update_task(action="set", content="## Goal\n...\n## Steps\n1. [ ] ...")

# Mark a step as done
update_task(action="mark_done", step=1)

# Update current step status
update_task(action="set_status", current_step="Patching src/utils.ts")
```

### Project Memory (AGENTS.md)

Persistent knowledge injected into every system prompt:

```bash
# Store project-specific knowledge
update_project_memory(section="architecture", content="This project uses Express 4.18...", scope="project")

# Store global knowledge
update_project_memory(section="preferences", content="Always use single quotes...", scope="global")
```

- **Project scope**: `./AGENTS.md` (in the workspace root)
- **Global scope**: `~/.ds_config/AGENTS.md`

---

## Safety & Guardrails

### Linker Checks

After every `patch_file` or `patch_multiple_files`, the orchestrator runs 6 verification checks:

| Check | What It Catches |
|-------|----------------|
| **Import/Export Verification** | Imports a name that doesn't exist in the target file's exports |
| **Deleted Method Detection** | Methods/functions removed but still referenced in other files |
| **Undeclared Dependencies** | Non-relative imports without corresponding `package.json` entries |
| **Conflict Markers** | Leftover `<<<<<<<` / `=======` / `>>>>>>>` markers |
| **JSON Syntax** | Invalid JSON with line/column error reporting |
| **File Shrinkage** | Files reduced by >30% without explanation keywords |

Each check returns a detailed error with a **"Recommended next step"** section to guide the AI's recovery.

### Conflict Marker Detection

```javascript
// Detects patterns like:
// <<<<<<< HEAD
// =========
// >>>>>>> branch
if (/^[<>=]{7}(?:\s|$)/m.test(content)) { /* flagged */ }
```

### File Shrinkage Detection

```javascript
// Flags when:
// - Original file > 100 lines
// - New file < 70% of original
// - > 40 lines removed
if (oldLines > 100 && newLines < oldLines * 0.7 && (oldLines - newLines) > 40) { /* flagged */ }
```

### Plan Mode Restrictions

When in PLAN mode, `canCallToolInPlanMode()` enforces:
- `patch_file` → **BLOCKED**
- `patch_multiple_files` → **BLOCKED**
- `write_file` → Only allowed for `implementation_plan.md` and `verification.md`
- `execute_shell_command` → Only read-only commands (ls, cat, grep, find, git log/diff/status/show/branch/tag/remote, version checks)

### Error Recovery Protocol

1. **Read the error message** — the orchestrator provides recommended next steps
2. **Never retry identical calls** — max 2 retries with same tool + parameters
3. **After 2+ failures** — re-read the file, try a different approach, or fix the root cause
4. **After 3 identical errors** — STOP, use `ask_user` to escalate to the human
5. **Never reset to zero** — build on what partially succeeded

---

## Context Compaction

When the conversation context grows too large, the agent can compact it:

```bash
/compact
```

The context compactor (`src/utils/context_compactor.ts`) compresses session history while preserving important information, allowing longer conversations without hitting token limits.

---

## TUI (Terminal User Interface)

The TUI (`src/tui/tui.ts`, ~634 lines) provides a rich terminal experience:

### Color Palette

| Token | RGB | Usage |
|-------|-----|-------|
| `body` | (220, 220, 225) | Default text |
| `dim` | (130, 130, 130) | Dimmed text |
| `accent` | (6, 182, 212) | Cyan accent, user messages |
| `think` | (180, 140, 80) | Gold — thinking chain |
| `tool` | (52, 211, 153) | Green — tool calls |
| `err` | (248, 113, 113) | Red — errors |
| `code` | (190, 235, 190) | Light green — code blocks |
| `bold` | (255, 255, 255) | White — bold text |
| `compact` | (0, 191, 255) | Blue — compact mode |

### Keyboard Shortcuts

| Key | Action |
|-----|--------|
| `Enter` | Submit prompt |
| `Page Up` | Scroll up one page |
| `Page Down` | Scroll down one page |
| `Shift+Up` | Scroll up 3 lines |
| `Shift+Down` | Scroll down 3 lines |
| `Ctrl+U` | Scroll up one page |
| `Ctrl+D` | Scroll down one page |
| `Ctrl+C` | Exit (with cleanup) |

### Message Types

| Type | Display |
|------|---------|
| `user` | User prompt in cyan |
| `deepseek` | AI response with markdown rendering, expandable thinking chain |
| `tool` | Expandable tool call card with name, params, status, result |
| `status` | Status messages (booting, connecting, etc.) |
| `error` | Error messages in red |
| `separator` | Visual separator line |
| `divider` | Divider between messages |

---

## VS Code Extension

The VS Code extension (`src/extension.ts`, ~596 lines) provides:

- **Sidebar Webview Panel** — Registered in the VS Code activity bar as "DeepSeek Chat"
- **Message Passing** — Bidirectional communication between webview and extension host
- **Prompt Queue** — Prompts are queued and processed sequentially
- **Brainstorm Integration** — Full brainstorm pipeline accessible from the sidebar
- **Session Management** — Create, load, switch, and delete sessions
- **Mode Switching** — PLAN/ACT/AUTO mode switching from the webview
- **Chat History** — Browse and restore previous sessions
- **File Upload** — Image and file upload support via the webview

### VS Code Contribution Points

```json
{
  "contributes": {
    "viewsContainers": {
      "activitybar": [{
        "id": "deepseek-sidebar-container",
        "title": "DeepSeek Chat",
        "icon": "public/deepseek-gray.svg"
      }]
    },
    "views": {
      "deepseek-sidebar-container": [{
        "type": "webview",
        "id": "deepseek-sidebar",
        "name": "DeepSeek Chat"
      }]
    }
  }
}
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
| `verification_commands` | string[] | `[]` | Commands to run for verification |
| `headless` | boolean | `false` | Run browser in headless mode |
| `enforcements.type_cross_reference` | boolean | `true` | Require type cross-referencing |
| `enforcements.require_build_attempt` | boolean | `true` | Require build attempt after changes |
| `enforcements.require_edge_case_analysis` | boolean | `true` | Require edge case analysis |
| `enforcements.deny_skip_without_documentation` | boolean | `true` | Deny skipping steps without documentation |
| `enforcements.self_test_required` | string | `"pass_or_skipped_with_reason"` | Self-test enforcement level |
| `plan_mode.disable_all_verification` | boolean | `true` | Disable verification commands in plan mode |

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
└── workflows/               # Installed workflows
    └── *.md
```

### .dsignore

The `.dsignore` file (project root) controls which files/directories are excluded from search and listing operations:

```
scraper-profile/
ds_config/
scratch/
dist/
node_modules/
.git/
deepseek-chat-1.0.0.vsix
test/
```

---

## Development

### Project Structure

```
deepseek-cli/
├── main.ts                          # CLI entry point (#!/usr/bin/env node)
├── package.json                     # Dual: CLI bin + VS Code extension
├── tsconfig.json                    # TypeScript configuration
├── copy_assets.js                   # Build script to copy public/ assets
├── public/                          # Extension icons (SVG, PNG)
├── src/
│   ├── extension.ts                 # VS Code extension entry point
│   ├── cli/
│   │   └── cli.ts                   # Terminal UI + slash commands
│   ├── tui/
│   │   └── tui.ts                   # Terminal User Interface (blessed)
│   ├── core/
│   │   ├── orchestrator.ts          # Central brain (~1575 lines)
│   │   ├── history.ts               # Session persistence (JSONL)
│   │   ├── brains/
│   │   │   ├── registry.ts          # Brain factory/registry
│   │   │   ├── base.ts              # Brain abstract base class
│   │   │   └── deepseek-web.ts      # DeepSeek web brain implementation
│   │   └── brainstorm/
│   │       ├── engine.ts            # Multi-level brainstorm pipeline
│   │       └── prompts.ts           # Hardcoded brainstorm prompts
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
│       └── sidebar.html             # VS Code webview HTML
└── verification.md                  # Verification documentation
```

### Build Commands

```bash
# Build TypeScript + copy assets
npm run build

# Watch mode (rebuild on change)
npm run watch

# Run compiled CLI
npm start

# Run from source (dev mode)
npm run dev

# Package VS Code extension
npx vsce package
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
- **TypeScript**: Target ES2022, module CommonJS, strict mode
- **Auto-discovery**: Tools are loaded by scanning the tools directory for any module exporting `name` + `execute`
- **System Prompt Construction**: Built from modular blocks in `mode_prompts.ts` (tool catalog, safety rules, examples, mode-specific instructions)
- **Sub-agent Isolation**: Each sub-agent gets its own scratch directory and filesystem context via `AsyncLocalStorage`
- **Atomic Writes**: Session index uses temp-file + rename pattern for crash safety
- **Global State**: `global.currentSessionId` tracks the active session across modules

---

## License

MIT

---

<p align="center">
  <sub>Built with 🧠 by <a href="https://github.com/jaadu611">jaadu611</a></sub>
</p>