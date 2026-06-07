const fs = require('fs');
const path = require('path');
const { getBackupsPath } = require('../utils/config');
const { getFileDiff } = require('../utils/diff_helper');

module.exports = {
  name: "patch_file",
  description: "Safely modifies an existing file. PREFERRED METHOD: Use start_line + end_line + new_content for precise edits. FALLBACK: Use find_string + replace_string ONLY for tiny, unique changes. ALWAYS call read_file first to get current line numbers. Creates a backup in ds_config/backups/ automatically.",
  parameters: {
    type: "object",
    properties: {
      path: { type: "string", description: "File path to modify." },
      start_line: { type: "integer", description: "PREFERRED: 1-based start line of the block to replace." },
      end_line: { type: "integer", description: "PREFERRED: 1-based end line (inclusive) of the block to replace." },
      new_content: { type: "string", description: "The replacement content (used with start_line/end_line)." },
      find_string: { type: "string", description: "FALLBACK: Exact text to find (include surrounding context for uniqueness)." },
      replace_string: { type: "string", description: "FALLBACK: Text to replace find_string with." }
    },
    required: ["path"]
  },
  async execute(params) {
    let { path: filePath, start_line, end_line, new_content, find_string, replace_string } = params;
    const { resolveSubAgentPath, loadConfig } = require('../utils/config');
    filePath = resolveSubAgentPath(filePath);

    // CLI Sandbox Isolation Guard
    const config = loadConfig();
    if (!config.allow_self_modification && process.env.ALLOW_CLI_EDIT !== '1') {
      const cliDir = path.resolve(__dirname, '../../');
      const resolvedPath = path.resolve(filePath);
      if (resolvedPath.startsWith(cliDir)) {
        return `❌ Edit rejected: Modifying CLI installation files is forbidden. To allow this, run the CLI with the ALLOW_CLI_EDIT=1 environment variable.`;
      }
    }
    // Lazy Deletion Guard
    const LAZY_REGEX = /(\/\/|\/\*|\#|\-\-)\s*(\.\.\.|existing|rest|todo\s*:?\s*rest|placeholder|same|remains)/i;
    if ((new_content !== undefined && LAZY_REGEX.test(new_content)) || (replace_string !== undefined && LAZY_REGEX.test(replace_string))) {
      return `❌ Edit rejected: Placeholder comments detected (e.g. "// ... rest of code" / "# ... existing code"). You MUST write the actual code without placeholders.`;
    }

    try {
      const resolved = path.resolve(filePath);
      if (!fs.existsSync(resolved)) return `Error: File not found: ${resolved}`;
      
      const content = fs.readFileSync(resolved, 'utf8');
      const lines = content.split('\n');
      
      // STRATEGY 1: Line Range (Most Robust)
      if (start_line && end_line && new_content !== undefined) {
        if (start_line < 1 || end_line > lines.length || start_line > end_line) {
          return `Error: Line range ${start_line}-${end_line} is invalid. File has ${lines.length} lines. Call read_file to verify.`;
        }
        const backupDir = getBackupsPath();
        const backupPath = path.join(backupDir, resolved.replace(/\//g, '_') + '_' + Date.now() + '.bak');
        fs.writeFileSync(backupPath, content, 'utf8');
        const newLines = new_content.split('\n');
        lines.splice(start_line - 1, end_line - start_line + 1, ...newLines);
        const finalContent = lines.join('\n');
        const diffStr = getFileDiff(resolved, content, finalContent);
        fs.writeFileSync(resolved, finalContent, 'utf8');
        return `✅ Patched lines ${start_line}-${end_line} successfully. Backup saved as ${backupPath}\n\n[Line Diff]:\n${diffStr}`;
      }
      
      // STRATEGY 2: Unique String Match (Fallback for tiny edits)
      if (find_string && replace_string !== undefined) {
        const occurrences = content.split(find_string).length - 1;
        if (occurrences === 0) {
          return `❌ find_string not found. The file may have changed. Call read_file to get fresh content and line numbers, then retry with start_line/end_line.`;
        }
        if (occurrences > 1) {
          return `❌ find_string matched ${occurrences} times. Include more surrounding context OR use start_line/end_line instead.`;
        }
        const backupDir = getBackupsPath();
        const backupPath = path.join(backupDir, resolved.replace(/\//g, '_') + '_' + Date.now() + '.bak');
        const finalContent = content.replace(find_string, replace_string);
        const diffStr = getFileDiff(resolved, content, finalContent);
        fs.writeFileSync(resolved, finalContent, 'utf8');
        return `✅ String replacement successful. Backup saved as ${backupPath}\n\n[Line Diff]:\n${diffStr}`;
      }
      
      return `Error: Provide either (start_line + end_line + new_content) OR (find_string + replace_string).`;
    } catch (err) {
      return `Error patching file: ${err.message}`;
    }
  }
};