const fs = require('fs').promises;
const path = require('path');
const { getBackupsPath } = require('../utils/config');
const { isPathAllowed, getPermissionErrorPath } = require('../utils/permissions');
const { recordContext } = require('../utils/context');

module.exports = {
  name: "multi_patch_file",
  description: "Apply multiple non‑overlapping find/replace edits to a single file in one call. Supports dry-run and backup.",
  parameters: {
    type: "object",
    properties: {
      path: { type: "string", description: "The path to the file to modify." },
      edits: {
        type: "array",
        description: "Array of edit objects, each with 'find_string' and 'replace_string'.",
        items: {
          type: "object",
          properties: {
            find_string: { type: "string" },
            replace_string: { type: "string" }
          },
          required: ["find_string", "replace_string"]
        }
      },
      create_backup: { type: "boolean", description: "Create a backup before modifying (default true)." },
      dry_run: { type: "boolean", description: "Preview changes without writing to disk (default false)." }
    },
    required: ["path", "edits"]
  },
  async execute({ path: filePath, edits, create_backup = true, dry_run = false }) {
    try {
      if (!filePath || typeof filePath !== 'string' || filePath.trim() === '') {
        return 'Error: Required parameter "path" is missing or empty.';
      }
      if (!edits || !Array.isArray(edits) || edits.length === 0) {
        return 'Error: Required parameter "edits" must be a non-empty array.';
      }
      for (let i = 0; i < edits.length; i++) {
        const e = edits[i];
        if (!e.find_string || typeof e.find_string !== 'string') {
          return `Error: Edit at index ${i} missing or invalid 'find_string'.`;
        }
        if (e.replace_string === undefined || e.replace_string === null) {
          return `Error: Edit at index ${i} missing 'replace_string'.`;
        }
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
        return `Error: File too large (${(stats.size/1024/1024).toFixed(1)}MB). multi_patch_file only supports files < 5MB.`;
      }

      let content = await fs.readFile(resolvedPath, 'utf8');
      const originalContent = content;
      const appliedEdits = [];

      for (let i = 0; i < edits.length; i++) {
        const { find_string, replace_string } = edits[i];
        const occurrences = content.split(find_string).length - 1;
        if (occurrences === 0) {
          return `Error: Edit ${i+1}: Could not find '${find_string.substring(0, 50)}...' in the file (after previous edits).`;
        }
        if (occurrences > 1) {
          return `Error: Edit ${i+1}: '${find_string.substring(0, 50)}...' matches ${occurrences} places. Provide more context to make it unique.`;
        }
        const beforeReplace = content;
        content = content.replace(find_string, replace_string);
        const line = beforeReplace.slice(0, beforeReplace.indexOf(find_string)).split('\n').length;
        appliedEdits.push({ find_string, replace_string, line });
      }

      recordContext(resolvedPath);

      if (dry_run) {
        const diffLines = [];
        diffLines.push(`--- ${resolvedPath}`);
        diffLines.push(`+++ (dry run)`);
        const originalLines = originalContent.split('\n');
        const newLines = content.split('\n');
        let diffCount = 0;
        for (let i = 0; i < Math.max(originalLines.length, newLines.length); i++) {
          const oldLine = originalLines[i] ?? '';
          const newLine = newLines[i] ?? '';
          if (oldLine !== newLine) {
            diffLines.push(`-${oldLine}`);
            diffLines.push(`+${newLine}`);
            diffCount++;
            if (diffCount > 50) {
              diffLines.push('... (truncated)');
              break;
            }
          }
        }
        return `[DRY RUN] Would apply ${appliedEdits.length} edit(s):\n${diffLines.join('\n')}`;
      }

      if (create_backup) {
        const backupDir = getBackupsPath();
        const backupName = `${path.basename(resolvedPath)}.${Date.now()}.bak`;
        const backupPath = path.join(backupDir, backupName);
        await fs.writeFile(backupPath, originalContent, 'utf8');
      }

      await fs.writeFile(resolvedPath, content, 'utf8');
      const editSummary = appliedEdits.map((e, idx) => `  ${idx+1}: at line ~${e.line}`).join('\n');
      return `File patched successfully with ${appliedEdits.length} edit(s):\n${editSummary}\nBackup saved to .ds_config/backups/ directory.`;
    } catch (err) {
      return `Error in multi_patch_file: ${err.message}`;
    }
  }
};
