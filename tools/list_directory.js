const fs = require('fs');
const path = require('path');

module.exports = {
  name: "list_directory",
  description: "Retrieves an array of file and folder names within a given directory. Use this to understand project structure.",
  parameters: {
    type: "object",
    properties: {
      path: {
        type: "string",
        description: "The directory path to inspect (optional, defaults to current directory '.')."
      }
    }
  },
  async execute({ path: dirPath }) {
    try {
      const resolvedPath = path.resolve(dirPath || '.');
      const items = fs.readdirSync(resolvedPath, { withFileTypes: true });
      const list = items.map(item => {
        const type = item.isDirectory() ? 'dir' : 'file';
        return `${type}: ${item.name}`;
      });
      return list.join('\n') || 'Directory is empty.';
    } catch (err) {
      return `Error listing directory: ${err.message}`;
    }
  }
};
