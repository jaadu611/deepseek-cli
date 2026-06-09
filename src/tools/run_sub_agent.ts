// @ts-nocheck
const brainRegistry = require("../core/brains/registry");
const tui = require("../tui/tui");
const mcpLoader = require("../mcp/mcp_loader");
const fs = require("fs");
const path = require("path");
const { subAgentStorage } = require("../utils/config");

const agentQueues = {};

// Tools whose output must never be capped hard — sub-agents need real content
const READ_ONLY_TOOLS = new Set([
  'read_file', 'grep_search', 'list_directory', 'glob_search', 'file_info'
]);

const SUB_AGENT_REMINDER = `\n\n[Reminder: You MUST respond in English only. You can either invoke another tool using JSON, or output plain text to respond to the user if you are done.\n` +
  `JSON Format (Single):\n{"tool": "tool_name", "param1": "val"}\n` +
  `JSON Format (Parallel):\n{"tools": [{"name": "t1", "p1": "v1"}, {"name": "t2"}]}\n` +
  `CRITICAL: (1) NEVER use placeholder comments (e.g. "// ... rest of code"). Complete code only. (2) Review unified line diffs returned in tool outputs. (3) Verification checks (syntax/imports/tests) run automatically before completion. Ensure no errors are introduced.\n` +
  `LANGUAGE: English only. Never respond in Chinese or any other language.]`;

function isValidToolCall(normalized) {
  if (!normalized || typeof normalized !== "object") return false;
  if (normalized._isMulti && Array.isArray(normalized.calls) && normalized.calls.length > 0) {
    return true;
  }
  if (normalized.tool && typeof normalized.tool === "string") {
    return true;
  }
  return false;
}

function extractJSON(text, normalizeToolCall) {
  if (!text) return null;

  const parsedObjects = [];
  
  // First, try to extract JSON from markdown code blocks
  const codeBlockRegex = /```(?:json)?\s*([\s\S]*?)```/g;
  let match;
  while ((match = codeBlockRegex.exec(text)) !== null) {
    const blockContent = match[1].trim();
    try {
      const parsed = JSON.parse(blockContent);
      if (parsed && typeof parsed === 'object') {
        parsedObjects.push(parsed);
      }
    } catch (err) {
      // Not valid JSON, continue
    }
  }

  // If no code blocks, do standard extraction
  if (parsedObjects.length === 0) {
    let i = 0;
    while (i < text.length) {
      const startIdx = text.indexOf('{', i);
      if (startIdx === -1) break;

      let depth = 0;
      let endIdx = -1;
      let inString = false;
      let escape = false;

      for (let j = startIdx; j < text.length; j++) {
        const char = text[j];

        if (escape) {
          escape = false;
          continue;
        }

        if (char === '\\') {
          escape = true;
          continue;
        }

        if (char === '"') {
          inString = !inString;
          continue;
        }

        if (!inString) {
          if (char === '{') {
            depth++;
          } else if (char === '}') {
            depth--;
            if (depth === 0) {
              endIdx = j;
              break;
            }
          }
        }
      }

      if (endIdx !== -1) {
        const candidate = text.substring(startIdx, endIdx + 1);
        try {
          const parsed = JSON.parse(candidate);
          if (parsed && typeof parsed === 'object') {
            parsedObjects.push(parsed);
            i = endIdx + 1;
            continue;
          }
        } catch (err) {
          // Try to repair common issues: trailing commas, unquoted keys
          try {
            const repaired = candidate
              .replace(/,\s*}/g, '}')
              .replace(/,\s*]/g, ']')
              .replace(/([{,]\s*)([a-zA-Z0-9_]+)(\s*:)/g, '$1"$2"$3');
            const parsed = JSON.parse(repaired);
            if (parsed && typeof parsed === 'object') {
              parsedObjects.push(parsed);
              i = endIdx + 1;
              continue;
            }
          } catch (e) {}
        }
      }
      i = startIdx + 1;
    }
  }

  const validToolCalls = [];
  let finalResponse = null;

  for (const obj of parsedObjects) {
    const normalized = normalizeToolCall(obj);
    if (isValidToolCall(normalized)) {
      if (normalized._isMulti) {
        validToolCalls.push(...normalized.calls);
      } else {
        validToolCalls.push(normalized);
      }
    } else if (normalized && normalized.response !== undefined) {
      finalResponse = normalized;
    }
  }

  if (validToolCalls.length > 0) {
    if (validToolCalls.length === 1) {
      return validToolCalls[0];
    } else {
      return { _isMulti: true, calls: validToolCalls };
    }
  }

  if (finalResponse) {
    return finalResponse;
  }

  // Last resort: if text contains a valid JSON-like structure but we missed it, try to find first { and last }
  const firstBrace = text.indexOf('{');
  const lastBrace = text.lastIndexOf('}');
  if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
    const candidate = text.substring(firstBrace, lastBrace + 1);
    try {
      const parsed = JSON.parse(candidate);
      if (parsed && typeof parsed === 'object') {
        const normalized = normalizeToolCall(parsed);
        if (isValidToolCall(normalized)) {
          return normalized;
        }
        if (normalized && normalized.response !== undefined) {
          return normalized;
        }
      }
    } catch (err) {}
  }

  return null;
}

function safeTruncate(text, toolName) {
  const { loadConfig } = require("../utils/config");
  const config = loadConfig();
  const baseMax = config.max_tool_output_length ?? 4000;
  // Read-only tools get 4x the limit — they need more context but still bounded
  const maxLength = (toolName && READ_ONLY_TOOLS.has(toolName)) ? baseMax * 4 : baseMax;
  const s = String(text ?? "");
  if (s.length <= maxLength) return s;
  const shownLines = s.slice(0, maxLength).split('\n').length;
  const totalLines = s.split('\n').length;
  return s.slice(0, maxLength) + `\n\n[truncated: showed ~${shownLines} of ${totalLines} lines. Use start_line/end_line to read the remaining content in chunks.]`;
}

// Block write_file on existing files — agents must use patch_file instead
function guardWriteFile(toolName, toolParams) {
  if (toolName !== 'write_file') return null;
  const filePath = toolParams && toolParams.path;
  if (!filePath) return null;
  const resolved = require('path').resolve(filePath);
  if (require('fs').existsSync(resolved)) {
    return `[SYSTEM INTERCEPT - FORBIDDEN OPERATION]\nwrite_file was called on an EXISTING file: ${filePath}\nThis is FORBIDDEN. You MUST use patch_file or patch_multiple_files for surgical edits to existing files.\nUsing write_file on existing files risks silently deleting working code outside your intended change.\nRe-read the file with read_file, then use patch_file with start_line + end_line + new_content to make your edit.`;
  }
  return null;
}

module.exports = {
  name: "run_sub_agent",
  description: "Dispatches a micro-task to a fresh, isolated sub-agent tab. Sub-agents must be given highly detailed specifications, interface contracts, and rules. Returns the sub-agent's response text.",
  parameters: {
    type: "object",
    properties: {
      agentNumber: {
        type: "integer",
        description: "The unique sequential number/ID for this sub-agent instance (e.g. 1, 2, 3)."
      },
      name: {
        type: "string",
        description: "The name of the specific LLM model/agent type to run (e.g. 'deepseek', 'qwen', 'gemini'). This is now mandatory."
      },
      prompt: {
        type: "string",
        description: "The micro-step instruction task description for the sub-agent. High-level rules are auto-injected."
      }
    },
    required: ["agentNumber", "name", "prompt"]
  },
  async execute({ agentNumber, name = "deepseek", prompt }) {
    const brain = brainRegistry.getActiveBrain();
    if (!brain) {
      return "Error: No active brain found to run sub-agent.";
    }

    const { tools, getSubAgentSystemPrompt, normalizeToolCall } = require("./index");
    const { runAutomaticVerification } = require("../core/orchestrator");

    let lastToolCalls = [];
    function checkToolLoop(tool, params) {
      const key = JSON.stringify({ tool, params });
      if (lastToolCalls.length > 0 && lastToolCalls[lastToolCalls.length - 1] === key) {
        let count = 1;
        for (let i = lastToolCalls.length - 2; i >= 0; i--) {
          if (lastToolCalls[i] === key) count++;
          else break;
        }
        if (count >= 2) return true;
      }
      lastToolCalls.push(key);
      if (lastToolCalls.length > 10) lastToolCalls.shift();
      return false;
    }

    // Setup sub-agent workspace folder
    const subAgentBaseDir = path.join(process.cwd(), "ds_config", "sub_agents", String(agentNumber));
    const subAgentDir = path.join(subAgentBaseDir, "ds_config");
    if (!fs.existsSync(subAgentDir)) {
      fs.mkdirSync(subAgentDir, { recursive: true });
    }
    const backupsDir = path.join(subAgentDir, "backups");
    if (!fs.existsSync(backupsDir)) {
      fs.mkdirSync(backupsDir, { recursive: true });
    }
    const scratchDir = path.join(subAgentDir, "scratch");
    if (!fs.existsSync(scratchDir)) {
      fs.mkdirSync(scratchDir, { recursive: true });
    }

    const agentName = String(name || "deepseek").toLowerCase();
    if (!agentQueues[agentName]) {
      agentQueues[agentName] = Promise.resolve();
    }
    const myTurn = agentQueues[agentName];
    let resolveNext;
    agentQueues[agentName] = new Promise((resolve) => {
      resolveNext = resolve;
    });

    await myTurn;

    let page;
    try {
      // Spawn isolated tab
      page = await brain.createNewPage();
    } catch (err) {
      resolveNext();
      return `Error creating sub-agent tab: ${err.message}`;
    }

    const modifiedFiles = new Set();
    let hasEditedFiles = false;
    let hasVerified = false;

    try {
      let currentPrompt = `[System Instructions]\n${getSubAgentSystemPrompt(prompt, agentNumber)}\n\n[Micro-Task]\n${prompt}`;
      let subAgentBusy = true;

      while (subAgentBusy) {
        // Log status to TUI
        const activeSpinners = tui.startGlobalSpinner ? tui.startGlobalSpinner() : null;
        const statusItem = { type: "status", text: `[Sub-Agent #${agentNumber}] thinking...` };
        tui.getLogItems().push(statusItem);
        tui.renderLog();

        const result = await brain.getCompletionStream(currentPrompt, {
          page,
          webSearch: false
        });

        // Clean up spinner status item
        const idxStatus = tui.getLogItems().indexOf(statusItem);
        if (idxStatus !== -1) tui.getLogItems().splice(idxStatus, 1);
        if (tui.stopGlobalSpinner) tui.stopGlobalSpinner();
        tui.renderLog();

        const responseText = result.responseText;
        const thinkingText = result.thinkingText;

        let parsed = null;
        if (responseText.includes("{")) {
          parsed = extractJSON(responseText, normalizeToolCall);
        }
        if (!parsed && thinkingText && thinkingText.includes("{")) {
          parsed = extractJSON(thinkingText, normalizeToolCall);
        }

        // ── FINAL RESPONSE ──
        if (!parsed || parsed.response !== undefined || (!parsed.tool && !parsed._isMulti)) {
          if (hasEditedFiles && !hasVerified) {
            // Run automatic verification before finishing within the sub-agent context
            const verificationResult = await subAgentStorage.run({ subAgentDir }, async () => {
              return await runAutomaticVerification(modifiedFiles, responseText || thinkingText);
            });
            if (!verificationResult.success) {
              const interceptMsg = `[SYSTEM INTERCEPT - VERIFICATION FAILED]\n${verificationResult.error}\n\nYou modified code but verification failed. You MUST fix these errors before returning a final response.`;
              currentPrompt = interceptMsg + SUB_AGENT_REMINDER;
              continue;
            } else {
              hasVerified = true;
            }
          }
          return responseText;
        }

        // ── TOOL CALL ──
        if (parsed._isMulti) {
          const calls = parsed.calls;
          const MAX_PAR = 8;
          const batch = calls.slice(0, MAX_PAR);

          const toolStatuses = [];
          for (const c of batch) {
            if (c.tool === "run_sub_agent") continue;
            
            const toolItem = { type: "status", text: `[Sub-Agent #${agentNumber}] calling ${c.tool}...` };
            tui.getLogItems().push(toolItem);
            toolStatuses.push(toolItem);

            if (["write_file", "patch_multiple_files", "patch_file"].includes(c.tool)) {
              hasEditedFiles = true;
              hasVerified = false;
              if (c.tool === "write_file" || c.tool === "patch_file") {
                if (c.path) modifiedFiles.add(path.resolve(c.path));
              } else if (c.tool === "patch_multiple_files") {
                if (c.patches && Array.isArray(c.patches)) {
                  for (const p of c.patches) {
                    if (p && p.path) modifiedFiles.add(path.resolve(p.path));
                  }
                }
              }
            } else if (c.tool === "execute_shell_command") {
              hasVerified = true;
            }
          }
          tui.renderLog();

          const results = await Promise.all(
            batch.map(async (c) => {
              if (c.tool === "run_sub_agent") {
                return "Error: Sub-agents are forbidden from calling run_sub_agent tool.";
              }
              if (checkToolLoop(c.tool, c)) {
                return `❌ Loop detected: Identical tool call was repeated 3 times consecutively. Aborting execution to prevent infinite looping.`;
              }
              const t = tools[c.tool];
              if (t) {
                try {
                  // Guard: block write_file on existing files
                  const writeGuard = guardWriteFile(c.tool, c);
                  if (writeGuard) return writeGuard;
                  const res = await subAgentStorage.run({ subAgentDir }, async () => {
                    return await t.execute(c);
                  });
                  return safeTruncate(String(res ?? ""), c.tool);
                } catch (e) {
                  return safeTruncate(`Error: ${e.message}`, c.tool);
                }
              }
              const isMcp = mcpLoader.getRegistry().some((x) => x.name === c.tool);
              if (isMcp) {
                try {
                  const res = await subAgentStorage.run({ subAgentDir }, async () => {
                    return await mcpLoader.callTool(c.tool, c);
                  });
                  return safeTruncate(String(res ?? ""), c.tool);
                } catch (e) {
                  return safeTruncate(`MCP error: ${e.message}`, c.tool);
                }
              }
              return `Error: tool '${c.tool}' not found.`;
            })
          );

          // Clean up tool status logs
          for (const item of toolStatuses) {
            const index = tui.getLogItems().indexOf(item);
            if (index !== -1) tui.getLogItems().splice(index, 1);
          }
          tui.renderLog();

          const combined = results
            .map((r, i) => `[Tool Output for ${batch[i].tool}]\n${r}`)
            .join("\n\n");
          const overflow = calls.length > MAX_PAR ? `\n\nNote: ${calls.length - MAX_PAR} call(s) truncated.` : "";

          currentPrompt = `${combined}${overflow}${SUB_AGENT_REMINDER}`;
        } else {
          const toolName = parsed.tool;
          const { tool: _, ...toolParams } = parsed;

          if (toolName === "run_sub_agent") {
            currentPrompt = `[SYSTEM INTERCEPT - ERROR] Sub-agents are forbidden from calling run_sub_agent tool.${SUB_AGENT_REMINDER}`;
            continue;
          }

          const statusItem = { type: "status", text: `[Sub-Agent #${agentNumber}] calling ${toolName}...` };
          tui.getLogItems().push(statusItem);
          tui.renderLog();

          if (["write_file", "patch_multiple_files", "patch_file"].includes(toolName)) {
            hasEditedFiles = true;
            hasVerified = false;
            if (toolName === "write_file" || toolName === "patch_file") {
              if (toolParams && toolParams.path) {
                modifiedFiles.add(path.resolve(toolParams.path));
              }
            } else if (toolName === "patch_multiple_files") {
              if (toolParams && toolParams.patches && Array.isArray(toolParams.patches)) {
                for (const p of toolParams.patches) {
                  if (p && p.path) modifiedFiles.add(path.resolve(p.path));
                }
              }
            }
          } else if (toolName === "execute_shell_command") {
            hasVerified = true;
          }

          // Guard: block write_file on existing files
          const writeGuard = guardWriteFile(toolName, toolParams);
          if (writeGuard) {
            const idx2 = tui.getLogItems().indexOf(statusItem);
            if (idx2 !== -1) tui.getLogItems().splice(idx2, 1);
            tui.renderLog();
            currentPrompt = `[Tool Output for ${toolName}]\n${writeGuard}${SUB_AGENT_REMINDER}`;
            continue;
          }

          if (checkToolLoop(toolName, toolParams)) {
            const idx2 = tui.getLogItems().indexOf(statusItem);
            if (idx2 !== -1) tui.getLogItems().splice(idx2, 1);
            tui.renderLog();
            currentPrompt = `[Tool Output for ${toolName}]\n❌ Loop detected: Identical tool call was repeated 3 times consecutively. Aborting execution to prevent infinite looping.${SUB_AGENT_REMINDER}`;
            continue;
          }

          let toolResult = "";
          const localTool = tools[toolName];
          if (localTool) {
            try {
              toolResult = await subAgentStorage.run({ subAgentDir }, async () => {
                return await localTool.execute(toolParams);
              });
            } catch (e) {
              toolResult = `[Tool Failed]\n${toolName}: ${e.message}`;
            }
          } else {
            const isMcp = mcpLoader.getRegistry().some((x) => x.name === toolName);
            if (isMcp) {
              try {
                toolResult = await subAgentStorage.run({ subAgentDir }, async () => {
                  return await mcpLoader.callTool(toolName, toolParams);
                });
              } catch (e) {
                toolResult = `[MCP Failed]\n${toolName}: ${e.message}`;
              }
            } else {
              toolResult = `Error: tool '${toolName}' not found.`;
            }
          }

          // Clean up status
          const idx = tui.getLogItems().indexOf(statusItem);
          if (idx !== -1) tui.getLogItems().splice(idx, 1);
          tui.renderLog();

          toolResult = safeTruncate(String(toolResult), toolName);
          currentPrompt = `[Tool Output for ${toolName}]\n${toolResult}${SUB_AGENT_REMINDER}`;
        }
      }
    } catch (err) {
      return `Error executing sub-agent task: ${err.message}`;
    } finally {
      resolveNext();
      if (page) {
        await page.close().catch(() => {});
      }
      // Clean up sub-agent workspace directory
      try {
        fs.rmSync(subAgentBaseDir, { recursive: true, force: true });
      } catch (cleanupErr) {
        // Non-critical: log but don't fail the response
      }
    }
  }
};
