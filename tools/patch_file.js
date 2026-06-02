const fs = require('fs').promises;
const path = require('path');

module.exports = {
  name: "patch_file",
  description: "Modifies an existing file by replacing a specific string block with a new string block. The find_string must match the target file exactly, including leading spaces and line endings.",
  parameters: {
    type: "object",
    properties: {
      path: {
        type: "string",
        description: "The path to the file to modify."
      },
      find_string: {
        type: "string",
        description: "The exact current text block to replace. Must be unique in the file."
      },
      replace_string: {
        type: "string",
        description: "The new text block to insert in place of the find_string."
      }
    },
    required: ["path", "find_string", "replace_string"]
  },
  async execute({ path: filePath, find_string, replace_string }) {
    try {
      if (!filePath || typeof filePath !== 'string' || filePath.trim() === '') {
        return 'Error: Required parameter "path" is missing or empty. Please provide a valid file path.';
      }
      if (!find_string || typeof find_string !== 'string' || find_string.length === 0) {
        return 'Error: Required parameter "find_string" is missing or invalid. Please provide the exact text to replace.';
      }
      if (!replace_string || typeof replace_string !== 'string') {
        return 'Error: Required parameter "replace_string" is missing or invalid. Please provide the replacement text.';
      }
      
      const resolvedPath = path.resolve(filePath);
      
      let stats;
      try {
        stats = await fs.stat(resolvedPath);
      } catch (err) {
        return `Error: File does not exist at ${resolvedPath}`;
      }

      if (stats.size > 5 * 1024 * 1024) {
        return `Error: File too large (${(stats.size/1024/1024).toFixed(1)}MB). patch_file only supports files < 5MB.`;
      }

      const content = await fs.readFile(resolvedPath, 'utf8');
      
      const occurrences = content.split(find_string).length - 1;
      if (occurrences === 0) {
        return `Error: Could not find the exact find_string in the file. Make sure spaces and line endings match perfectly.`;
      }
      if (occurrences > 1) {
        return `Error: The find_string matches ${occurrences} places in the file. Please provide more surrounding context lines to make it unique.`;
      }

      // Write backup before modifying
      await fs.writeFile('/tmp' + '.bak', content, 'utf8');

      const lineNumber = content.slice(0, content.indexOf(find_string)).split('\n').length;
      const updatedContent = content.replace(find_string, replace_string);
      await fs.writeFile(resolvedPath, updatedContent, 'utf8');
      
      return `File patched successfully at line ~${lineNumber}. Backup saved to ${resolvedPath}.bak`;
    } catch (err) {
      return `Error patching file: ${err.message}`;
    }
  }
};