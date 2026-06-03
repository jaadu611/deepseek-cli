const fs = require('fs');
const path = require('path');

module.exports = {
  name: "manage_task",
  description: "Creates or updates the task.md checklist file in the current working directory to track progress on completed, in-progress, and pending tasks.",
  parameters: {
    type: "object",
    properties: {
      task_markdown: {
        type: "string",
        description: "The complete markdown content of the checklist/tasks (use [ ] for pending, [/] for in-progress, [x] for completed)."
      }
    },
    required: ["task_markdown"]
  },
  async execute({ task_markdown }) {
    try {
      if (!task_markdown || typeof task_markdown !== 'string') {
        return 'Error: Required parameter "task_markdown" is missing or invalid. You must provide the task content as a string.';
      }
      const repoRoot = path.join(__dirname, '..', '..');
      const taskPath = path.join(repoRoot, 'task.md');
      fs.writeFileSync(taskPath, task_markdown, 'utf8');
      return `Checklist updated successfully at ${taskPath}`;
    } catch (err) {
      return `Error managing tasks: ${err.message}`;
    }
  }
};
