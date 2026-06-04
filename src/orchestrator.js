const { tools, getSystemPrompt, normalizeToolCall } = require("./tools");
const mcpLoader = require("./mcp/mcp_loader");
const tui = require("./tui");
const brainRegistry = require("./brains/registry");
const { loadConfig } = require("./utils/config");
const {
  getCurrentSessionId,
  createSession,
  setCurrentSessionId,
  saveMessage,
  getSessions,
  updateSessionTitle,
} = require("./history");

let busy = false;

// ── JSON extraction ───────────────────────────────────────────────────────────
function isValidToolCall(normalized) {
  if (!normalized || typeof normalized !== "object") return false;
  if (normalized._isMulti && Array.isArray(normalized.calls) && normalized.calls.length > 0) {
    return true;
  }
  if (normalized.tool) {
    const isLocal = tools[normalized.tool] !== undefined;
    const isMcp = mcpLoader.getRegistry().some((x) => x.name === normalized.tool);
    return isLocal || isMcp;
  }
  return false;
}

// ── JSON extraction ───────────────────────────────────────────────────────────
function extractJSON(text) {
  if (!text) return null;

  const parsedObjects = [];
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
      } catch (err) {}
    }
    i = startIdx + 1;
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

  return null;
}

function safeTruncate(text) {
  const config = loadConfig();
  const maxLength = config.max_tool_output_length ?? 4000;
  const s = String(text ?? "");
  if (s.length <= maxLength) return s;
  return s.slice(0, maxLength) + `\n\n[truncated: ${s.length - maxLength} chars omitted]`;
}

function isBusy() {
  return busy;
}

function setBusy(val) {
  busy = val;
}

async function ask(prompt) {
  busy = true;
  const brain = brainRegistry.getActiveBrain();
  
  let hasEditedFiles = false;
  let hasVerified = false;

  let sid = getCurrentSessionId();
  if (!sid) {
    const ns = createSession(prompt.slice(0, 40));
    sid = ns.id;
    setCurrentSessionId(sid);
    tui.setTopBarTitle(prompt.slice(0, 60));
  }

  const logItems = tui.getLogItems();

  // Clean up any initial boot status item before adding user message
  const bootIdx = logItems.findIndex((item) => item.type === "status");
  if (bootIdx !== -1) {
    logItems.splice(bootIdx, 1);
  }

  if (logItems.length) {
    logItems.push({ type: "separator" });
    logItems.push({ type: "divider" });
    logItems.push({ type: "separator" });
  }
  logItems.push({ type: "user", text: prompt });
  saveMessage(sid, "user", prompt);

  let dsItem = { type: "deepseek", text: "", spinning: true };
  logItems.push(dsItem);
  tui.startGlobalSpinner();
  tui.renderLog();

  // Await background initializations if they are still running
  const mcpPromise = mcpLoader.init();
  const brainPromise = brain ? brain.init() : Promise.resolve();

  let isMcpDone = false;
  let isBrainDone = false;

  const checkMcp = mcpPromise.then(() => { isMcpDone = true; });
  const checkBrain = brainPromise.then(() => { isBrainDone = true; });

  await Promise.race([
    Promise.all([checkMcp, checkBrain]),
    new Promise((r) => setTimeout(r, 100))
  ]);

  if (!isMcpDone || !isBrainDone) {
    let text = "waiting for background initialization...";
    if (!isMcpDone && isBrainDone) text = "connecting to MCP servers...";
    else if (!isBrainDone && isMcpDone) text = "connecting to browser...";

    let askBootItem = { type: "status", text };
    
    // Prevent double spinners
    dsItem.spinning = false;
    
    const dsIdx = logItems.indexOf(dsItem);
    if (dsIdx !== -1) {
      logItems.splice(dsIdx, 0, askBootItem);
    } else {
      logItems.push(askBootItem);
    }
    tui.renderLog();

    await Promise.all([
      mcpPromise.catch((err) => {
        logItems.push({ type: "error", message: `MCP Init Error: ${err.message}` });
      }),
      brainPromise.catch((err) => {
        logItems.push({ type: "error", message: `Brain Init Error: ${err.message}` });
      })
    ]);

    const askBootIdx = logItems.indexOf(askBootItem);
    if (askBootIdx !== -1) {
      logItems.splice(askBootIdx, 1);
    }
    
    // Restore main spinner
    dsItem.spinning = true;
    tui.renderLog();
  }

  try {
    let currentPrompt = `[System Instructions]\n${getSystemPrompt()}\n\n[User Request]\n${prompt}`;

    const registry = mcpLoader.getRegistry();
    if (registry.length > 0) {
      const q = prompt.toLowerCase();
      
      const triggeredServers = new Set();
      const mcpServers = mcpConfig?.mcpServers || {};
      for (const [serverName, serverCfg] of Object.entries(mcpServers)) {
        const triggers = serverCfg.triggers || [];
        for (const trigger of triggers) {
          const cleanTrigger = trigger.toLowerCase().trim();
          if (cleanTrigger && q.includes(cleanTrigger)) {
            triggeredServers.add(serverName);
            break;
          }
        }
      }

      const toolsToShow = registry.filter(tool => triggeredServers.has(tool.server));

      if (toolsToShow.length > 0) {
        const autoFuzzyContext = `\n\n[Auto-Discovered External Tools (Relevant to your request)]\n` + 
          `(Note: These tools were automatically matched based on your triggers.)\n\n` +
          toolsToShow.map((tool) => {
            const shortDesc = tool.description ? tool.description.split('\n')[0].substring(0, 150) : '';
            let paramsStr = '';
            if (tool.inputSchema && tool.inputSchema.properties) {
              paramsStr = Object.entries(tool.inputSchema.properties).map(([k, v]) => {
                const req = (tool.inputSchema.required || []).includes(k) ? '*' : '';
                return `  - ${k}${req} (${v.type || 'any'}): ${v.description ? v.description.split('\n')[0] : ''}`;
              }).join('\n');
            }
            return `Tool Name: ${tool.name}\nDescription: ${shortDesc}\nParameters (* = required):\n${paramsStr || '  (none)'}`;
          }).join('\n\n---\n');
        currentPrompt += autoFuzzyContext;
      }
    }

    let isInitial = true;

    while (busy) {
      if (!isInitial) {
        dsItem.spinning = true;
        tui.startGlobalSpinner();
        tui.renderLog();
      }

      const streamPromise = brain.getCompletionStream(currentPrompt, {
        onStartCalled: () => {
          dsItem.spinning = false;
          dsItem.expanded = true;
          tui.stopGlobalSpinner();
        },
        onProgress: ({ thinking, text, thinkingStartTime, thinkingEndTime }) => {
          dsItem.thinking = thinking;
          dsItem.text = text;
          dsItem._thinkingStartTime = thinkingStartTime;
          dsItem._thinkingEndTime = thinkingEndTime;
          tui.renderLog();
        },
      });

      const { thinkingText, responseText } = await streamPromise;
      dsItem.thinking = thinkingText;
      dsItem.text = responseText;
      dsItem.spinning = false;
      if (thinkingText) {
        dsItem._thinkingEndTime = Date.now();
        dsItem.expanded = false;
      }
      tui.stopGlobalSpinner();
      tui.renderLog();

      let parsed = null;
      if (responseText.includes("{")) {
        parsed = extractJSON(responseText);
      }
      if (!parsed && thinkingText && thinkingText.includes("{")) {
        parsed = extractJSON(thinkingText);
      }

      // FINAL ANSWER
      if (!parsed || parsed.response !== undefined) {
        if (hasEditedFiles && !hasVerified) {
          const interceptMsg = `[SYSTEM INTERCEPT] You modified code but attempted to complete the task without verifying your work. You MUST use 'execute_shell_command' to run tests, linters, or a build step to prove the code works before returning a final response.`;
          
          currentPrompt = interceptMsg;
          isInitial = false;
          
          dsItem = { type: "deepseek", text: "", spinning: true };
          logItems.push(dsItem);
          tui.renderLog();
          continue;
        }

        let finalText;
        if (parsed?.response !== undefined) {
          finalText = parsed.response;
          if (typeof finalText === "object" && finalText !== null)
            finalText = finalText.message || JSON.stringify(finalText, null, 2);
          finalText = String(finalText);
        } else {
          finalText = responseText;
        }

        dsItem.text = finalText;
        dsItem.thinking = thinkingText;
        dsItem.spinning = false;
        if (dsItem.thinking) dsItem.expanded = false;
        tui.renderLog();
        saveMessage(sid, "assistant", finalText, { thinking: thinkingText });
        syncSession(sid, prompt);
        break;
      }

      // TOOL CALL
      let textBeforeJson = responseText;
      const jsonStart = responseText.indexOf("{");
      if (jsonStart !== -1) {
        textBeforeJson = responseText.substring(0, jsonStart).trim();
      }
      dsItem.text = textBeforeJson;
      dsItem.thinking = thinkingText;
      dsItem.spinning = false;
      if (dsItem.thinking) {
        dsItem._thinkingEndTime = Date.now();
        dsItem.expanded = false;
      }
      tui.renderLog();
      syncSession(sid, prompt);

      if (parsed._isMulti) {
        const calls = parsed.calls;
        const MAX_PAR = 8;
        const batch = calls.slice(0, MAX_PAR);
        const toolItems = batch.map((c) => {
          const { tool: _, ...toolParams } = c;
          return {
            type: "tool",
            name: c.tool,
            params: toolParams,
            status: "executing",
            result: "",
            expanded: false,
          };
        });
        for (const t of toolItems) logItems.push(t);
        for (const c of batch) {
          saveMessage(sid, "tool_call", c.tool, { params: c });
          if (["write_file", "multi_patch_file", "patch_file"].includes(c.tool)) {
            hasEditedFiles = true;
            hasVerified = false;
          } else if (c.tool === "execute_shell_command") {
            hasVerified = true;
          }
        }
        tui.startGlobalSpinner();
        tui.renderLog();

        // Run each tool with a per-tool timeout (30 seconds)
        const TOOL_TIMEOUT_MS = 30000;
        const results = await Promise.all(
          batch.map(async (c) => {
            const timeoutPromise = new Promise((resolve) =>
              setTimeout(
                () =>
                  resolve(
                    `[Tool Timeout] ${c.tool} did not complete within ${
                      TOOL_TIMEOUT_MS / 1000
                    }s`
                  ),
                TOOL_TIMEOUT_MS
              )
            );
            const executePromise = (async () => {
              const t = tools[c.tool];
              if (t) {
                try {
                  const res = await t.execute(c);
                  return safeTruncate(String(res ?? ""));
                } catch (e) {
                  return safeTruncate(`Error: ${e.message}`);
                }
              }
              const isMcp = mcpLoader.getRegistry().some((x) => x.name === c.tool);
              if (isMcp) {
                try {
                  const res = await mcpLoader.callTool(c.tool, c);
                  return safeTruncate(String(res ?? ""));
                } catch (e) {
                  return safeTruncate(`MCP error: ${e.message}`);
                }
              }
              return `Error: tool '${c.tool}' not found.`;
            })();
            return Promise.race([executePromise, timeoutPromise]);
          })
        );

        results.forEach((res, i) => {
          toolItems[i].status = "completed";
          toolItems[i].result = res;
          saveMessage(sid, "tool_result", res, { tool: batch[i].tool });
        });
        tui.stopGlobalSpinner();
        tui.renderLog();

        const combined = results
          .map((r, i) => `[Tool Output for ${batch[i].tool}]\n${r}`)
          .join("\n\n");
        const overflow =
          calls.length > MAX_PAR
            ? `\n\nNote: ${
                calls.length - MAX_PAR
              } call(s) truncated — issue them next turn if needed.`
            : "";
        const FORMAT_REMINDER = `\n\n[Reminder: You can either invoke another tool using JSON, or output plain text to respond to the user if you are done.\n` +
          `JSON Format (Single):\n{"tool": "tool_name", "param1": "val"}\n` +
          `JSON Format (Parallel):\n{"tools": [{"name": "t1", "p1": "v1"}, {"name": "t2"}]}]`;
        currentPrompt = `${combined}${overflow}${FORMAT_REMINDER}`;
        isInitial = false;
        dsItem = { type: "deepseek", text: "", spinning: true };
        logItems.push(dsItem);
        tui.renderLog();
      } else if (parsed.tool) {
        const toolName = parsed.tool;
        const { tool: _, ...toolParams } = parsed;
        const toolItem = {
          type: "tool",
          name: toolName,
          params: toolParams,
          status: "executing",
          result: "",
          expanded: false,
        };
        logItems.push(toolItem);
        saveMessage(sid, "tool_call", toolName, { params: toolParams });
        
        if (["write_file", "multi_patch_file", "patch_file"].includes(toolName)) {
          hasEditedFiles = true;
          hasVerified = false;
        } else if (toolName === "execute_shell_command") {
          hasVerified = true;
        }
        
        tui.startGlobalSpinner();
        tui.renderLog();

        let toolResult = "";
        const localTool = tools[toolName];
        if (localTool) {
          try {
            toolResult = await localTool.execute(toolParams);
          } catch (e) {
            toolResult = `[Tool Failed]\n${toolName}: ${e.message}\n\n(You MUST reply in valid JSON.)`;
          }
        } else {
          const isMcp = mcpLoader.getRegistry().some((x) => x.name === toolName);
          if (isMcp) {
            try {
              toolResult = await mcpLoader.callTool(toolName, toolParams);
            } catch (e) {
              toolResult = `[MCP Failed]\n${toolName}: ${e.message}\n\n(You MUST reply in valid JSON.)`;
            }
          } else {
            toolResult = `Error: tool '${toolName}' not found locally or in MCP.`;
          }
        }

        toolResult = safeTruncate(String(toolResult));
        toolItem.status = "completed";
        toolItem.result = toolResult;
        saveMessage(sid, "tool_result", toolResult, { tool: toolName });
        tui.stopGlobalSpinner();
        tui.renderLog();

        await new Promise((r) => setTimeout(r, 100));

        const FORMAT_REMINDER = `\n\n[Reminder: You can either invoke another tool using JSON, or output plain text to respond to the user if you are done.\n` +
          `JSON Format (Single):\n{"tool": "tool_name", "param1": "val"}\n` +
          `JSON Format (Parallel):\n{"tools": [{"name": "t1", "p1": "v1"}, {"name": "t2"}]}]`;
        currentPrompt = `[Tool Output for ${toolName}]\n${toolResult}${FORMAT_REMINDER}`;
        isInitial = false;

        dsItem = { type: "deepseek", text: "", spinning: true };
        logItems.push(dsItem);
        tui.renderLog();
      } else {
        dsItem.text = responseText;
        tui.renderLog();
        saveMessage(sid, "assistant", responseText, { thinking: thinkingText });
        break;
      }
    }

    // Auto-delete implementation plan and task files on successful completion of task
    try {
      const planPath = path.join(__dirname, "..", "..", "implementation_plan.md");
      const taskPath = path.join(__dirname, "..", "..", "task.md");
      if (fs.existsSync(planPath)) fs.unlinkSync(planPath);
      if (fs.existsSync(taskPath)) fs.unlinkSync(taskPath);
    } catch (err) {}
  } catch (e) {
    if (dsItem?.spinning) {
      dsItem.spinning = false;
      tui.stopGlobalSpinner();
    }
    logItems.push({ type: "separator" });
    logItems.push({ type: "error", message: e.message });
    tui.renderLog();
  }

  busy = false;
  tui.refocusInput();
}

function syncSession(sid, prompt) {
  const sess = getSessions().find((s) => s.id === sid);
  if (!sess) return;
  
  const brain = brainRegistry.getActiveBrain();
  if (brain && typeof brain.onSessionSync === "function") {
    brain.onSessionSync(sess, prompt).catch(() => {});
  }

  if (sess.title === "New Chat") {
    const title = prompt.slice(0, 40);
    updateSessionTitle(sid, title);
    tui.setTopBarTitle(title);
  }
}

module.exports = {
  ask,
  isBusy,
  setBusy,
};
