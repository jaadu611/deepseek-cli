// @ts-nocheck
// update_task — thin, discoverable wrapper over write_scratch_file /
// read_scratch_file specifically for the agent's persistent "task.md".
// On first call in a session, this also auto-creates the file with a
// starter skeleton so the model is never stuck looking at "no such file".
const fs = require('fs');
const path = require('path');
const { getScratchPath } = require('../utils/config');

const TASK_FILENAME = "task.md";
const STARTER = `# Task

## Goal
<1-3 sentence description of the user's actual goal>

## Steps
- [ ] Step 1 — (pending)
- [ ] Step 2 — (pending)
- [ ] Step 3 — (pending)

## Done criteria
<How will you know this is finished? What does "done" look like?>

## Decisions / open questions
<Anything you decided along the way, or anything still unclear>

## Status
Current step: <which step you are on>
Last updated: <ISO timestamp>
`;

function getTaskPath() {
  const scratchDir = getScratchPath();
  if (!fs.existsSync(scratchDir)) fs.mkdirSync(scratchDir, { recursive: true });
  return path.join(scratchDir, TASK_FILENAME);
}

function ensureTaskFile() {
  const p = getTaskPath();
  if (!fs.existsSync(p)) {
    fs.writeFileSync(p, STARTER, "utf8");
  }
  return p;
}

function parseSections(md) {
  // Lightweight parser: collects top-level "## <heading>" blocks.
  const out = { sections: {}, order: [] };
  const lines = md.split("\n");
  let current = null;
  for (const line of lines) {
    const m = line.match(/^##\s+(.+?)\s*$/);
    if (m) {
      current = m[1].trim();
      out.sections[current] = [];
      out.order.push(current);
    } else if (current) {
      out.sections[current].push(line);
    }
  }
  return out;
}

module.exports = {
  name: "update_task",
  description: "Read or update the persistent task.md scratch file. On first call in a session, auto-creates a starter skeleton. The model is expected to: (1) call this at the start of any multi-step task to read the current state, (2) call it again whenever a step completes, (3) call it before final answer to confirm every step is done. The orchestrator ALSO reads this file on each turn to inject a 'progress so far' reminder. Supports three actions: 'get' (read), 'set' (replace whole file), 'mark_done' (flip a step to [x]), 'set_status' (set the Status section).",
  parameters: {
    type: "object",
    properties: {
      action: {
        type: "string",
        description: "One of: 'get' (default; returns current task.md), 'set' (replace whole content), 'mark_done' (set a step to [x]), 'set_status' (set the 'Current step' line in Status section)."
      },
      content: {
        type: "string",
        description: "For action='set': the new full task.md content."
      },
      step: {
        "type": ["string", "integer"],
        description: "For action='mark_done': the step number (1-indexed) or the step text. The matching '- [ ]' line is flipped to '- [x]'."
      },
      current_step: {
        "type": ["string", "integer"],
        description: "For action='set_status': which step you are currently working on (number or text)."
      }
    }
  },
  async execute({ action = "get", content, step, current_step } = {}) {
    try {
      const p = ensureTaskFile();
      if (action === "get") {
        return `[task.md at ${p}]\n\n` + fs.readFileSync(p, "utf8");
      }
      if (action === "set") {
        if (!content || typeof content !== "string") return "Error: 'content' required for action=set.";
        fs.writeFileSync(p, content, "utf8");
        return `✅ task.md overwritten (${content.length} chars at ${p}).`;
      }
      if (action === "mark_done") {
        const md = fs.readFileSync(p, "utf8");
        const lines = md.split("\n");
        let targetIdx = -1;
        if (typeof step === "number") {
          let seen = 0;
          for (let i = 0; i < lines.length; i++) {
            if (/^\s*-\s*\[\s*\]/.test(lines[i])) {
              seen++;
              if (seen === step) { targetIdx = i; break; }
            }
          }
        } else if (typeof step === "string") {
          for (let i = 0; i < lines.length; i++) {
            if (lines[i].includes(step) && /^\s*-\s*\[\s*\]/.test(lines[i])) {
              targetIdx = i; break;
            }
          }
        } else {
          return "Error: 'step' is required for action=mark_done.";
        }
        if (targetIdx === -1) return `Error: no pending step matched: ${JSON.stringify(step)}`;
        lines[targetIdx] = lines[targetIdx].replace(/\[\s*\]/, "[x]");
        const out = lines.join("\n");
        // Refresh 'Last updated'
        const stamped = out.replace(/(Last updated:\s*).*/, `$1${new Date().toISOString()}`);
        fs.writeFileSync(p, stamped, "utf8");
        return `✅ Marked step done: ${lines[targetIdx].trim()}`;
      }
      if (action === "set_status") {
        if (current_step === undefined || current_step === null) {
          return "Error: 'current_step' is required for action=set_status.";
        }
        const md = fs.readFileSync(p, "utf8");
        const parsed = parseSections(md);
        const statusLines = parsed.sections["Status"] || [];
        const newLine = `Current step: ${current_step}`;
        const next = statusLines.map(l => l.replace(/^\s*Current step:.*/, newLine));
        if (!next.some(l => l.startsWith("Current step:"))) next.unshift(newLine);
        const idx = md.indexOf("## Status");
        let replaced;
        if (idx === -1) {
          replaced = md.trimEnd() + "\n\n## Status\n" + newLine + "\n";
        } else {
          const before = md.slice(0, idx + "## Status".length);
          const afterStart = idx + "## Status".length;
          const nextHeadingMatch = md.slice(afterStart).search(/^##\s/m);
          const after = nextHeadingMatch === -1 ? "" : md.slice(afterStart + nextHeadingMatch);
          replaced = before + "\n" + next.join("\n") + (next[next.length - 1].endsWith("\n") ? "" : "\n") + after;
        }
        // Also refresh 'Last updated' anywhere
        replaced = replaced.replace(/(Last updated:\s*).*/, `$1${new Date().toISOString()}`);
        fs.writeFileSync(p, replaced, "utf8");
        return `✅ Status set: ${newLine}`;
      }
      return `Error: unknown action '${action}'. Use get | set | mark_done | set_status.`;
    } catch (err) {
      return `Error in update_task: ${err.message}`;
    }
  },
  // helpers exposed for the orchestrator
  getTaskPath,
  ensureTaskFile
};
