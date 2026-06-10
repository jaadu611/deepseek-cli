// @ts-nocheck
const fs = require('fs');
const path = require('path');
const os = require('os');

module.exports = {
  name: 'get_workflow_content',
  description: 'Retrieves the full content of a workflow file by its ID (filename without .md extension). Searches in project-specific directories (./workflows, ./.workflows, ./.github/workflows, ./ds_config/workflows) first, then in the global ~/.ds_config/workflows/ directory.',
  parameters: {
    type: 'object',
    properties: {
      workflow_id: {
        type: 'string',
        description: 'The workflow ID (filename without .md extension)'
      }
    },
    required: ['workflow_id']
  },
  async execute({ workflow_id }) {
    if (!workflow_id || workflow_id.trim() === '') {
      return 'Error: workflow_id parameter is required and cannot be empty';
    }

    // Sanitize workflow_id to prevent path traversal
    const safeId = workflow_id.replace(/[^a-zA-Z0-9_-]/g, '');
    if (safeId !== workflow_id) {
      return 'Error: workflow_id contains invalid characters. Only alphanumeric, underscore, and hyphen are allowed.';
    }

    const projectRoot = process.cwd();
    const projectWorkflowDirs = [
      path.join(projectRoot, 'workflows'),
      path.join(projectRoot, '.workflows'),
      path.join(projectRoot, '.github', 'workflows'),
      path.join(projectRoot, 'ds_config', 'workflows') // backward compatibility
    ];
    const globalWorkflowsDir = path.join(os.homedir(), '.ds_config', 'workflows');
    const filename = `${safeId}.md`;

    // Check project directories in order
    for (const dir of projectWorkflowDirs) {
      const filePath = path.join(dir, filename);
      if (fs.existsSync(filePath)) {
        try {
          const content = fs.readFileSync(filePath, 'utf8');
          return content;
        } catch (err) {
          return `Error reading workflow file from ${dir}: ${err.message}`;
        }
      }
    }

    // Check global directory
    const globalPath = path.join(globalWorkflowsDir, filename);
    if (fs.existsSync(globalPath)) {
      try {
        const content = fs.readFileSync(globalPath, 'utf8');
        return content;
      } catch (err) {
        return `Error reading workflow file from global directory: ${err.message}`;
      }
    }

    return `Error: Workflow with ID '${workflow_id}' not found in any project workflow directory (${projectWorkflowDirs.join(', ')}) or global workflows (${globalWorkflowsDir})`;
  }
};
