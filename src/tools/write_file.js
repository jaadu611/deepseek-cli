const fs = require('fs');
const path = require('path');
const { getBackupsPath } = require('../utils/config');
const { getFileDiff } = require('../utils/diff_helper');

module.exports = {
  name: "write_file",
  description: "Writes complete content to a file. USE THIS INSTEAD OF patch_file WHEN: creating new files, rewriting entire files, or making changes larger than 15 lines. Automatically creates parent directories. Creates backup in ds_config/backups/ if file exists.",
  parameters: {
    type: "object",
    properties: {
      path: { type: "string", description: "File path to write to." },
      content: { type: "string", description: "The complete file content to write." }
    },
    required: ["path", "content"]
  },
  async execute({ path: filePath, content }) {
    // Lazy Deletion Guard
    const LAZY_REGEX = /(\/\/|\/\*|\#|\-\-)\s*(\.\.\.|existing|rest|todo\s*:?\s*rest|placeholder|same|remains)/i;
    if (content && LAZY_REGEX.test(content)) {
      return `❌ Edit rejected: Placeholder comments detected (e.g. "// ... rest of code" / "# ... existing code"). You MUST write complete code without placeholders.`;
    }

    try {
      const resolved = path.resolve(filePath);
      const dir = path.dirname(resolved);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      
      let backupPath = null;
      let diffStr = '';
      if (fs.existsSync(resolved)) {
        const backupDir = getBackupsPath();
        backupPath = path.join(backupDir, resolved.replace(/\//g, '_') + '_' + Date.now() + '.bak');
        const oldContent = fs.readFileSync(resolved, 'utf8');
        fs.writeFileSync(backupPath, oldContent, 'utf8');
        diffStr = getFileDiff(resolved, oldContent, content);
      } else {
        diffStr = `[New File Created: ${content.split('\n').length} lines]`;
      }
      
      fs.writeFileSync(resolved, content, 'utf8');
      const action = backupPath ? 'Overwritten (backup created)' : 'Created';
      return `✅ ${action} ${resolved} (${content.split('\n').length} lines). Backup: ${backupPath || 'none'}\n\n[Line Diff]:\n${diffStr}`;
    } catch (err) {
      return `Error writing file: ${err.message}`;
    }
  }
};