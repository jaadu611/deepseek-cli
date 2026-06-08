// @ts-nocheck
const fs = require('fs');
const path = require('path');
const { getBackupsPath } = require('../utils/config');
const { getFileDiff } = require('../utils/diff_helper');

module.exports = {
  name: "write_file",
  description: "Writes complete content to a brand-new file. THIS IS STRICTLY FOR CREATING NEW FILES ONLY. Calling this on an existing file will fail. To modify an existing file, you MUST use patch_file or patch_multiple_files.",
  parameters: {
    type: "object",
    properties: {
      path: { type: "string", description: "File path to write to (new files only)." },
      content: { type: "string", description: "The complete file content to write." }
    },
    required: ["path", "content"]
  },
  async execute({ path: filePath, content }) {
    const { resolveSubAgentPath, loadConfig } = require('../utils/config');
    filePath = resolveSubAgentPath(filePath);
    
    // CLI Sandbox Isolation Guard
    const config = loadConfig();
    if (!config.allow_self_modification) {
      const cliDir = path.resolve(__dirname, '../../');
      const resolvedPath = path.resolve(filePath);
      if (resolvedPath.startsWith(cliDir + path.sep) || resolvedPath === cliDir) {
        return `❌ Edit rejected: Modifying CLI installation files is forbidden when allow_self_modification is false in config.json. Set "allow_self_modification": true in your ds_config/config.json to allow this.`;
      }
    }

    // Lazy Deletion Guard
    const LAZY_REGEX = /(\/\/|\/\*|\#|\-\-)\s*(\.\.\.|existing|rest|todo\s*:?\s*rest|placeholder|same|remains)/i;
    if (content && LAZY_REGEX.test(content)) {
      return `❌ Edit rejected: Placeholder comments detected (e.g. "// ... rest of code" / "# ... existing code"). You MUST write complete code without placeholders.`;
    }

    try {
      const resolved = path.resolve(filePath);
      if (fs.existsSync(resolved)) {
        return `❌ Edit rejected: write_file was called on an EXISTING file: ${filePath}\nThis is FORBIDDEN. You MUST use patch_file or patch_multiple_files for surgical edits to existing files.\nUsing write_file on existing files risks silently deleting working code outside your intended change.\nRe-read the file with read_file, then use patch_file with start_line + end_line + new_content to make your edit.`;
      }
      
      const dir = path.dirname(resolved);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      
      const diffStr = `[New File Created: ${content.split('\n').length} lines]`;
      fs.writeFileSync(resolved, content, 'utf8');
      return `✅ Created ${resolved} (${content.split('\n').length} lines).\n\n[Line Diff]:\n${diffStr}`;
    } catch (err) {
      return `Error writing file: ${err.message}`;
    }
  }
};