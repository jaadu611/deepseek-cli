// @ts-nocheck
const fs = require('fs');
const path = require('path');
const os = require('os');

module.exports = {
  name: "find_workflow",
  description: "Searches for workflow files in global (~/.deepseek_cli/workflows/) and project-specific directories (./workflows, ./.workflows, ./.github/workflows, ./ds_config/workflows). Accepts a query string (minimum 3 characters) and returns matching workflows as JSON array.",
  parameters: {
    type: "object",
    properties: {
      query: {
        type: "string",
        description: "Search query to match against workflow titles and descriptions (minimum 3 characters)."
      }
    },
    required: ["query"]
  },
  async execute({ query }) {
    if (!query || typeof query !== 'string' || query.length < 3) {
      return JSON.stringify({ error: "Query must be a string with at least 3 characters" });
    }

    const results = [];
    const queryLower = query.toLowerCase();

    // Define directories to search
    const homeDir = os.homedir();
    const globalWorkflowsDir = path.join(homeDir, '.deepseek_cli', 'workflows');
    const projectRoot = process.cwd();
        // Scan multiple project-specific workflow directories (common patterns)
    const projectWorkflowDirs = [
      path.join(projectRoot, 'workflows'),
      path.join(projectRoot, '.workflows'),
      path.join(projectRoot, '.github', 'workflows'),
      path.join(projectRoot, 'ds_config', 'workflows') // backward compatibility
    ];

    const processDirectory = (dirPath) => {
      if (!fs.existsSync(dirPath)) return;
      const files = fs.readdirSync(dirPath);
      for (const file of files) {
        if (file.endsWith('.md')) {
          const fullPath = path.join(dirPath, file);
          const content = fs.readFileSync(fullPath, 'utf8');
          const lines = content.split('\n');
          const firstLine = lines[0] || '';
          
          // Extract title: first 50 chars of content or filename if empty
          let title = content.substring(0, 50).trim();
          if (!title) title = file.replace('.md', '');
          
          // Extract description: first line after removing prefix
          let description = firstLine;
          if (description.startsWith('trigger:') || description.startsWith('description:')) {
            const colonIndex = description.indexOf(':');
            if (colonIndex !== -1) {
              description = description.substring(colonIndex + 1).trim();
            }
          }
          if (!description && lines.length > 1) {
            description = lines[1] || '';
          }
          if (!description) description = title;
          
          // Check if query matches title or description (case-insensitive)
          const titleLower = title.toLowerCase();
          const descLower = description.toLowerCase();
          if (titleLower.includes(queryLower) || descLower.includes(queryLower)) {
            results.push({
              id: file.replace('.md', ''),
              title: title,
              description: description,
              path: fullPath
            });
          }
        }
      }
    };

    processDirectory(globalWorkflowsDir);
    for (const dir of projectWorkflowDirs) {
      processDirectory(dir);
    }

    return JSON.stringify(results);
  }
};
