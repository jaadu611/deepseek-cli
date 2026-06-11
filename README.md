# DeepSeek CLI & VS Code Extension

An advanced, developer-focused **AI Agent CLI** and companion **VS Code Webview Extension** powered by the DeepSeek AI model. This tool combines terminal execution, autonomous file-editing, multi-agent workflows, checkpoints, and Model Context Protocol (MCP) integrations in a unified terminal interface and a VS Code sidebar.

---

## Key Features

- **Double-Duty Shell & VS Code UI**: Use it in your terminal as an interactive TUI, or side-by-side in VS Code as a sidebar panel.
- **Three Mode Protocols**:
  - `/plan`: Read-only architecture/design mode. The AI proposes a markdown plan of changes before execution.
  - `/act`: Normal agent mode with full tool permissions for direct codebase modifications.
  - `/auto`: Auto-detects user intent per turn to switch mode (e.g., switches to `/plan` when asked to "plan it first").
- **Automatic Code Checkpointing**: Codebase changes are checkpointed automatically before executing prompts. You can review checkpoints using `/checkpoints` and revert with `/revert <id>`.
- **Model Context Protocol (MCP)**: Directly install and call tools from external MCP servers (like Playwright, Git, etc.).
- **Markdown Workflow Installer**: Download raw GitHub workflow instructions (`/install-workflow <url>`) and invoke them automatically via project context.
- **Session-Isolated Scratch Directories**: Independent temporary workspaces are created for each conversation session to keep scratch files clean and separated.

---

## Installation & Setup

### 1. Prerequisites
- Node.js (v18.0.0 or higher)
- npm or yarn
- An active DeepSeek API Key (configured in your environment or global config)

### 2. Global Installation (CLI)
Install the CLI globally or link it locally:
```bash
# Clone the repository
git clone https://github.com/jaadu611/deepseek-cli.git
cd deepseek-cli

# Install dependencies and build
npm install
npm run build

# Link the binaries globally
npm link
```
After linking, you can invoke the CLI with:
```bash
deepseek-cli
# or simply
ds
```

### 3. VS Code Extension Installation
To build the VS Code Extension package:
1. Ensure `vsce` (VS Code Extension Manager) is installed:
   ```bash
   npm install -g @vscode/vsce
   ```
2. Build and package the extension:
   ```bash
   npm run build
   vsce package
   ```
3. This creates a `.vsix` file (e.g., `deepseek-chat-1.0.0.vsix`). Install it in VS Code via:
   * Extensions View -> `...` (Views and More Actions) -> **Install from VSIX...**
   * Or via command-line:
     ```bash
     code --install-extension deepseek-chat-1.0.0.vsix
     ```

---

## TUI & Extension Commands

Type these commands directly in the prompt bar to trigger custom workflows:

| Command | Description |
| :--- | :--- |
| `/new` | Start a new chat session |
| `/chat` | Browse previous chat sessions & history |
| `/plan` | Switch to PLAN mode (read-only plan generation) |
| `/act` | Switch to ACT mode (full tool execution) |
| `/auto` | Switch to AUTO mode (auto-detect per turn) |
| `/install-workflow <url>` | Download a workflow `.md` from a raw GitHub URL |
| `/install-mcp <name> <pkg>` | Add a Model Context Protocol server to `mcp.json` |
| `/list-workflows` | List all installed workflows and their triggers |
| `/list-mcp` | List all configured MCP servers |
| `/checkpoints` | List local codebase checkpoints |
| `/revert <checkpoint_id>` | Revert the workspace to a previous checkpoint |
| `/help` | Show the help menu with all commands |

---

## Model Context Protocol (MCP) Setup

MCP servers can be added directly via the CLI or VS Code panel. To install the Puppeteer/Playwright MCP server:
```text
/install-mcp playwright @playwright/mcp
```
All MCP configurations are saved in the project's centralized config (`mcp.json`). During packaging, all installed servers are bundled inside the `.vsix` file so they work out-of-the-box.

---

## Directory Structure

```text
.
├── copy_assets.js        # Helper script to copy static assets to dist/
├── package.json          # Project metadata and build scripts
├── tsconfig.json         # TypeScript configuration
├── dist/                 # Compiled JavaScript and assets (packaged in .vsix)
│   └── src/
│       ├── webview/      # Packaged sidebar.html
│       └── mcp/          # Packaged mcp.json and installed_servers/
├── src/                  # TypeScript source code
│   ├── cli/              # Command Line Interface (TUI) source
│   ├── core/             # Orchestrator & agent execution brain
│   ├── mcp/              # MCP Server loader & registry
│   ├── tools/            # Agent custom tool implementation
│   ├── tui/              # TUI terminal interface widgets
│   ├── utils/            # Config, reminder prompts, and checkpoints
│   └── webview/          # VS Code extension sidebar webview HTML
└── public/               # Extension icons and static media
```

---

## License

This project is licensed under the ISC License.
