const fs = require('fs');
const path = require('path');
const { getBackupsPath } = require('../utils/config');
const { isPathAllowed, getPermissionErrorPath } = require('../utils/permissions');

module.exports = {
  name: "write_file",
  description: "Creates a new file or completely overwrites an existing file with new content. Optionally creates a backup in .ds_config/backups/.",
  parameters: {
    type: "object",
    properties: {
      path: { type: "string", description: "The path where the file will be written." },
      content: { type: "string", description: "The complete raw text content to write to the file." },
      create_backup: { type: "boolean", description: "Create a backup before overwriting if file exists (default false)." }
    },
    required: ["path", "content"]
  },
  async execute({ path: filePath, content, create_backup = false }) {
    try {
      if (!filePath || typeof filePath !== 'string' || filePath.trim() === '') {
        return 'Error: Required parameter "path" is missing or empty.';
      }
      if (content === undefined || content === null || typeof content !== 'string') {
        return 'Error: Required parameter "content" is missing or invalid.';
      }

      const resolvedPath = path.resolve(filePath);
      if (!isPathAllowed(resolvedPath)) {
        return getPermissionErrorPath(resolvedPath);
      }

      if (content.length > 50 * 1024 * 1024) {
        return `Error: Content size ${(content.length/1024/1024).toFixed(1)}MB exceeds 50MB limit.`;
      }

      if (create_backup && fs.existsSync(resolvedPath)) {
        const backupDir = getBackupsPath();
        const backupName = `${path.basename(resolvedPath)}.${Date.now()}.bak`;
        const backupPath = path.join(backupDir, backupName);
        const existingContent = fs.readFileSync(resolvedPath, 'utf8');
        fs.writeFileSync(backupPath, existingContent, 'utf8');
      }

      fs.mkdirSync(path.dirname(resolvedPath), { recursive: true });
      fs.writeFileSync(resolvedPath, content, 'utf8');
      return `File written successfully to ${resolvedPath}`;
    } catch (err) {
      return `Error writing file: ${err.message}`;
    }
  }
};
