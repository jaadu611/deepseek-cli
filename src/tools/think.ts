// @ts-nocheck
// think — a native sequential thinking tool.
// The model uses this to structure its reasoning and logic sequentially.
const fs = require('fs');
const path = require('path');
const { getScratchPath } = require('../utils/config');

module.exports = {
  name: "think",
  description: "A detailed tool for dynamic and extensive sequential thinking. Use this tool when you need to think through a complex problem step-by-step. It helps you break down problems, track revisions, and maintain a chain of thought. You can use this repeatedly to build up your logic.",
  parameters: {
    type: "object",
    properties: {
      thought: {
        type: "string",
        description: "Your current thinking step or reasoning."
      },
      nextThoughtNeeded: {
        type: "boolean",
        description: "Whether another thought step is needed."
      },
      thoughtNumber: {
        type: "integer",
        description: "Your current thought number in the sequence.",
        minimum: 1
      },
      totalThoughts: {
        type: "integer",
        description: "The estimated total number of thoughts needed.",
        minimum: 1
      },
      isRevision: {
        type: "boolean",
        description: "Whether this thought revises previous thinking."
      },
      revisesThought: {
        type: "integer",
        description: "If revising, which thought number is being revised.",
        minimum: 1
      },
      branchFromThought: {
        type: "integer",
        description: "If branching, which thought number is the branching point.",
        minimum: 1
      },
      branchId: {
        type: "string",
        description: "Branch identifier for parallel thinking paths."
      },
      needsMoreThoughts: {
        type: "boolean",
        description: "If the total estimate needs to be increased."
      }
    },
    required: ["thought", "nextThoughtNeeded", "thoughtNumber", "totalThoughts"]
  },
  async execute(params = {}) {
    try {
      const {
        thought,
        thoughtNumber,
        totalThoughts,
        nextThoughtNeeded,
        isRevision,
        revisesThought,
        branchFromThought,
        branchId,
        needsMoreThoughts
      } = params;

      if (!thought || typeof thought !== "string" || thought.trim() === "") {
        return "Error: 'thought' is required and must be a non-empty string.";
      }

      const scratchDir = getScratchPath();
      if (!fs.existsSync(scratchDir)) fs.mkdirSync(scratchDir, { recursive: true });
      const logPath = path.join(scratchDir, "thinking.md");
      const ts = new Date().toISOString();

      let header = `## Thought ${thoughtNumber}/${totalThoughts}`;
      if (isRevision) header += ` (Revising Thought ${revisesThought})`;
      if (branchFromThought) header += ` (Branching from Thought ${branchFromThought}, ID: ${branchId})`;
      
      const entry = `\n${header} - ${ts}\n\n${thought.trim()}\n`;
      fs.appendFileSync(logPath, entry, "utf8");

      let response = `✅ Thought ${thoughtNumber} recorded.`;
      if (needsMoreThoughts) {
        response += ` Total thoughts estimate adjusted.`;
      }
      if (nextThoughtNeeded) {
        response += ` Please continue your thinking by calling this tool again.`;
      } else {
        response += ` Thinking sequence complete.`;
      }

      return response;
    } catch (err) {
      return `Error in think: ${err.message}`;
    }
  }
};
