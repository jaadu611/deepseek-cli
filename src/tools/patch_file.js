const fs = require('fs').promises;
const path = require('path');
const { getBackupsPath } = require('../utils/config');
const { isPathAllowed, getPermissionErrorPath } = require('../utils/permissions');

module.exports = {
  name: "patch_file",
  description: "Modifies an existing file by replacing a specific string block with a new string block. Backup is saved to ds_config/backups/.",
  parameters: {
    type: "object",
    properties: {
      path: { type: "string", description: "The path to the file to modify." },
      find_string: { type: "string", description: "The exact current text block to replace. Must be unique." },
      replace_string: { type: "string", description: "The new text block to insert." },
      create_backup: { type: "boolean", description: "Create a backup before modifying (default true)." }
    },
    required: ["path", "find_string", "replace_string"]
  },
  async execute({ path: filePath, find_string, replace_string, create_backup = true }) {
    try {
      if (!filePath || typeof filePath !== 'string' || filePath.trim() === '') {
        return 'Error: Required parameter "path" is missing or empty. Provide a valid file path.';
      }
      if (!find_string || typeof find_string !== 'string' || find_string.length === 0) {
        return 'Error: Required parameter "find_string" is missing or invalid.';
      }
      if (replace_string === undefined || replace_string === null) {
        return 'Error: Required parameter "replace_string" is missing or invalid.';
      }

      const resolvedPath = path.resolve(filePath);
      if (!isPathAllowed(resolvedPath)) {
        return getPermissionErrorPath(resolvedPath);
      }

      let stats;
      try {
        stats = await fs.stat(resolvedPath);
      } catch {
        return `Error: File does not exist at ${resolvedPath}`;
      }

      if (stats.isDirectory()) {
        return `Error: Path is a directory, not a file: ${resolvedPath}`;
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
        return `Error: The find_string matches ${occurrences} places in the file. Provide more surrounding context to make it unique.`;
      }

      if (create_backup) {
        const backupDir = getBackupsPath();
        const backupName = `${path.basename(resolvedPath)}.${Date.now()}.bak`;
        const backupPath = path.join(backupDir, backupName);
        await fs.writeFile(backupPath, content, 'utf8');
      }

      const lineNumber = content.slice(0, content.indexOf(find_string)).split('\n').length;
      const updatedContent = content.replace(find_string, replace_string);
      await fs.writeFile(resolvedPath, updatedContent, 'utf8');

      const removedLines = find_string.split('\n').length;
      const addedLines = replace_string.split('\n').length;
      return `[Success] File patched successfully at ${resolvedPath}\n- Line Modified: ~${lineNumber}\n- Lines Removed: ${removedLines}\n- Lines Added: ${addedLines}`;
    } catch (err) {
      return `Error patching file: ${err.message}`;
    }
  }
};
