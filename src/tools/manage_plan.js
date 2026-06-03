const fs = require('fs');
const path = require('path');

module.exports = {
  name: "manage_plan",
  description: "Creates or updates the implementation_plan.md file in the current working directory to organize the technical approach for the current goal.",
  parameters: {
    type: "object",
    properties: {
      plan_markdown: {
        type: "string",
        description: "The complete markdown content of the implementation plan."
      }
    },
    required: ["plan_markdown"]
  },
  async execute({ plan_markdown }) {
    try {
      if (!plan_markdown || typeof plan_markdown !== 'string') {
        return 'Error: Required parameter "plan_markdown" is missing or invalid. You must provide the plan content as a string.';
      }
      const repoRoot = path.join(__dirname, '..', '..');
      const planPath = path.join(repoRoot, 'implementation_plan.md');
      fs.writeFileSync(planPath, plan_markdown, 'utf8');
      return `Implementation plan updated successfully at ${planPath}`;
    } catch (err) {
      return `Error managing plan: ${err.message}`;
    }
  }
};
