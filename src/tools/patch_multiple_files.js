const fs = require('fs');
const path = require('path');
const { getBackupsPath } = require('../utils/config');
const { getFileDiff } = require('../utils/diff_helper');

module.exports = {
  name: "patch_multiple_files",
  description: "Applies patches to multiple files atomically. If ANY patch fails, ALL changes are rolled back. Each patch uses line-range replacement. Use this for coordinated refactors across related files. Backups are stored in ds_config/backups/.",
  parameters: {
    type: "object",
    properties: {
      patches: {
        type: "array",
        description: "Array of patch objects.",
        items: {
          type: "object",
          properties: {
            path: { type: "string" },
            start_line: { type: "integer" },
            end_line: { type: "integer" },
            new_content: { type: "string" },
            original_content: { type: "string", description: "Optional. The exact expected content of the line range to prevent patching drifted code." }
          },
          required: ["path", "start_line", "end_line", "new_content"]
        }
      }
    },
    required: ["patches"]
  },
  async execute({ patches }) {
    const { resolveSubAgentPath, loadConfig } = require('../utils/config');
    const config = loadConfig();
    const cliDir = path.resolve(__dirname, '../../');
    for (const p of patches) {
      if (p && p.path) {
        p.path = resolveSubAgentPath(p.path);
        
        // CLI Sandbox Isolation Guard
        if (!config.allow_self_modification && process.env.ALLOW_CLI_EDIT !== '1') {
          const resolvedPath = path.resolve(p.path);
          if (resolvedPath.startsWith(cliDir)) {
            return `❌ Edit rejected: Modifying CLI installation files is forbidden. To allow this, run the CLI with the ALLOW_CLI_EDIT=1 environment variable.`;
          }
        }
      }
    }
    const backups = []; // each entry: { original, backupPath }
    // Lazy Deletion Guard
    const LAZY_REGEX = /(\/\/|\/\*|\#|\-\-)\s*(\.\.\.|existing|rest|todo\s*:?\s*rest|placeholder|same|remains)/i;
    for (const p of patches) {
      if (p.new_content !== undefined && LAZY_REGEX.test(p.new_content)) {
        return `❌ Atomic patch FAILED. Placeholder comments detected (e.g. "// ... rest of code" / "# ... existing code") in patch for ${p.path}. You must write complete code without placeholders.`;
      }
    }

    try {
      // Phase 1: Validate all patches before applying any
      for (const p of patches) {
        const resolved = path.resolve(p.path);
        if (!fs.existsSync(resolved)) throw new Error(`File not found: ${resolved}`);
        const lines = fs.readFileSync(resolved, 'utf8').split('\n');
        if (p.start_line < 1 || p.end_line > lines.length || p.start_line > p.end_line) {
          throw new Error(`Invalid line range ${p.start_line}-${p.end_line} in ${p.path} (file has ${lines.length} lines)`);
        }
        if (p.original_content !== undefined) {
          const targetContent = lines.slice(p.start_line - 1, p.end_line).join('\n');
          if (targetContent !== p.original_content) {
            throw new Error(`Content mismatch in ${p.path} at lines ${p.start_line}-${p.end_line}. Expected:\n${p.original_content}\nFound:\n${targetContent}`);
          }
        }
      }
      
      // Phase 2: Create backups in centralized directory
      const backupDir = getBackupsPath();
      for (const p of patches) {
        const resolved = path.resolve(p.path);
        const originalContent = fs.readFileSync(resolved, 'utf8');
        const backupPath = path.join(backupDir, resolved.replace(/\//g, '_') + '_' + Date.now() + '.bak');
        fs.writeFileSync(backupPath, originalContent, 'utf8');
        backups.push({ original: resolved, backupPath });
      }
      
      // Phase 3: Apply all patches
      const results = [];
      const diffs = [];
      for (const p of patches) {
        const resolved = path.resolve(p.path);
        const originalContent = fs.readFileSync(resolved, 'utf8');
        const lines = originalContent.split('\n');
        const newLines = p.new_content.split('\n');
        lines.splice(p.start_line - 1, p.end_line - p.start_line + 1, ...newLines);
        const finalContent = lines.join('\n');
        const diffStr = getFileDiff(resolved, originalContent, finalContent);
        diffs.push(`[Diff for ${p.path}]:\n${diffStr}`);
        
        fs.writeFileSync(resolved, finalContent, 'utf8');
        results.push(`✅ ${p.path}: lines ${p.start_line}-${p.end_line}`);
      }
      
      return `Atomic patch successful:\n${results.join('\n')}\nBackups saved in ${backupDir}\n\n${diffs.join('\n\n')}`;
    } catch (err) {
      // ROLLBACK on any failure
      for (const b of backups) {
        try { fs.copyFileSync(b.backupPath, b.original); } catch {}
      }
      return `❌ Atomic patch FAILED. All changes rolled back.\nError: ${err.message}`;
    }
  }
};