const fs = require('fs');
const path = require('path');

module.exports = {
  name: "write_file",
  description: "Creates a new file or completely overwrites an existing file with new content. Do not use this for minor edits.",
  parameters: {
    type: "object",
    properties: {
      path: {
        type: "string",
        description: "The path where the file will be written."
      },
      content: {
        type: "string",
        description: "The complete raw text content to write to the file."
      }
    },
    required: ["path", "content"]
  },
  async execute({ path: filePath, content }) {
    try {
      if (!filePath || typeof filePath !== 'string' || filePath.trim() === '') {
        return 'Error: Required parameter "path" is missing or empty. You must provide a non-empty string path for the file.';
      }
      if (content === undefined || content === null || typeof content !== 'string') {
        return 'Error: Required parameter "content" is missing or invalid. You must provide the file content as a string.';
      }
      const resolvedPath = path.resolve(filePath);
      fs.mkdirSync(path.dirname(resolvedPath), { recursive: true });
      fs.writeFileSync(resolvedPath, content, 'utf8');
      return `File written successfully to ${resolvedPath}`;
    } catch (err) {
      return `Error writing file: ${err.message}`;
    }
  }
};
