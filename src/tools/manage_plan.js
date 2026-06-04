const fs = require('fs');
const path = require('path');
const { getScratchPath } = require('../utils/config');

module.exports = {
  name: "manage_plan",
  description: "Creates or updates the implementation_plan.md file in the ds_config/scratch/ directory to organize the technical approach for the current goal.",
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
      const planPath = path.join(__dirname, '..', '..', 'implementation_plan.md');
      fs.writeFileSync(planPath, plan_markdown, 'utf8');
      return `Implementation plan updated successfully at ${planPath}`;
    } catch (err) {
      return `Error managing plan: ${err.message}`;
    }
  }
};