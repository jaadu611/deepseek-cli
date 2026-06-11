// @ts-nocheck
const fs = require('fs');
const path = require('path');
const { getBackupsPath } = require('../utils/config');
const { getFileDiff } = require('../utils/diff_helper');

module.exports = {
  name: "patch_multiple_files",
  description: "Applies multiple patches atomically across one or more files. If ANY patch fails, ALL changes are rolled back. Each entry supports two modes:\n\n(a) PREFERRED — string-match: provide find_string + replace_string. Context-aware and immune to line-number drift. Multiple string-match patches on the SAME file are allowed and applied in order.\n\n(b) FALLBACK — line-range: provide start_line + end_line + new_content. Multiple line-range patches on the SAME file are NOT allowed in one call since line numbers shift after each edit — use sequential turns instead.\n\nUse this tool instead of calling patch_file multiple times in parallel. Backups are stored in ds_config/backups/.",
  parameters: {
    type: "object",
    properties: {
      patches: {
        type: "array",
        description: "Array of patch objects. Each must have 'path' and either (find_string + replace_string) or (start_line + end_line + new_content).",
        items: {
          type: "object",
          properties: {
            path: { type: "string", description: "File path to modify." },
            find_string: { type: "string", description: "PREFERRED: Exact text to find. Must match exactly once in the file." },
            replace_string: { type: "string", description: "PREFERRED: Replacement for find_string." },
            start_line: { type: "integer", description: "FALLBACK: 1-based start line of the block to replace." },
            end_line: { type: "integer", description: "FALLBACK: 1-based end line (inclusive) of the block to replace." },
            new_content: { type: "string", description: "FALLBACK: Replacement content (used with start_line/end_line)." },
            original_content: { type: "string", description: "FALLBACK optional: Expected content of the line range — prevents patching drifted code." }
          },
          required: ["path"]
        }
      }
    },
    required: ["patches"]
  },
  async execute({ patches }) {
    const { resolveSubAgentPath, loadConfig } = require('../utils/config');
    const config = loadConfig();
    const cliDir = path.resolve(__dirname, '../../');

    // Resolve paths and apply sandbox guard
    for (const p of patches) {
      if (p && p.path) {
        p.path = resolveSubAgentPath(p.path);
        if (!config.allow_self_modification) {
          const resolvedPath = path.resolve(p.path);
          if (resolvedPath.startsWith(cliDir + path.sep) || resolvedPath === cliDir) {
            return `❌ Edit rejected: Modifying CLI installation files is forbidden when allow_self_modification is false in config.json. Set "allow_self_modification": true in your ds_config/config.json to allow this.`;
          }
        }
      }
    }

    // Validate each patch has a valid mode
    for (const p of patches) {
      const hasStringMatch = p.find_string !== undefined && p.replace_string !== undefined;
      const hasLineRange = p.start_line !== undefined && p.end_line !== undefined && p.new_content !== undefined;
      if (!hasStringMatch && !hasLineRange) {
        return `❌ Patch for '${p.path}' is invalid: must provide either (find_string + replace_string) or (start_line + end_line + new_content).`;
      }
    }

    // Line-range patches cannot target the same file more than once (line numbers shift)
    const lineRangeFiles = new Set();
    for (const p of patches) {
      if (p.start_line !== undefined && p.end_line !== undefined && p.path) {
        const resolved = path.resolve(p.path);
        if (lineRangeFiles.has(resolved)) {
          return `❌ Rejection: Multiple line-range patches for the same file '${path.basename(p.path)}' are not allowed in one call — line numbers shift after each edit and cause corruption. Use find_string/replace_string mode instead (allows multiple patches per file), or apply line-range patches in sequential turns.`;
        }
        lineRangeFiles.add(resolved);
      }
    }

    // Lazy deletion guard
    const LAZY_REGEX = /(\/\/|\/\*|\#|\-\-)\s*(\.\.\.existing|rest of code|todo\s*:?\s*rest|placeholder|same as before|remains the same)/i;
    for (const p of patches) {
      const contentToCheck = p.replace_string !== undefined ? p.replace_string : p.new_content;
      if (contentToCheck !== undefined && LAZY_REGEX.test(contentToCheck)) {
        return `❌ Atomic patch FAILED. Placeholder comments detected in patch for '${p.path}'. Write the complete code — no placeholders.`;
      }
    }

    // Pre-validate find_string: must exist exactly once in the current file content
    for (const p of patches) {
      if (p.find_string !== undefined) {
        const resolved = path.resolve(p.path);
        if (!fs.existsSync(resolved)) {
          return `❌ Atomic patch FAILED (validation). File not found: ${resolved}`;
        }
        const content = fs.readFileSync(resolved, 'utf8');
        const occurrences = content.split(p.find_string).length - 1;
        if (occurrences === 0) {
          return `❌ Atomic patch FAILED (validation). find_string not found in '${path.basename(p.path)}':\n${String(p.find_string).slice(0, 300)}\n\nCall read_file to get fresh content, then retry.`;
        }
        if (occurrences > 1) {
          return `❌ Atomic patch FAILED (validation). find_string matched ${occurrences} times in '${path.basename(p.path)}'. Add more surrounding context to make it unique.`;
        }
      }
    }

    // Build unique file list and back up each file once
    const backupDir = getBackupsPath();
    const backups = [];
    const backedUp = new Set();

    try {
      // Phase 1: Validate and backup
      for (const p of patches) {
        const resolved = path.resolve(p.path);
        if (!fs.existsSync(resolved)) {
          throw new Error(`File not found: ${resolved}`);
        }
        if (!backedUp.has(resolved)) {
          const originalContent = fs.readFileSync(resolved, 'utf8');
          const backupPath = path.join(backupDir, path.basename(resolved) + '_' + Date.now() + '.bak');
          fs.writeFileSync(backupPath, originalContent, 'utf8');
          backups.push({ original: resolved, backupPath, originalContent });
          backedUp.add(resolved);
        }
      }

      // Phase 2: Build final file states in-memory (chain patches on same file)
      const fileStates = new Map();
      for (const { original, originalContent } of backups) {
        fileStates.set(original, originalContent);
      }

      const results = [];
      for (const p of patches) {
        const resolved = path.resolve(p.path);
        let content = fileStates.get(resolved);

        if (p.find_string !== undefined) {
          // String-match mode: replace first occurrence (uniqueness already validated)
          const idx = content.indexOf(p.find_string);
          if (idx === -1) {
            throw new Error(`find_string no longer present in '${path.basename(p.path)}' after prior patches in this batch. Adjust patch order or use more context.`);
          }
          const replacement = p.replace_string !== undefined ? p.replace_string : '';
          content = content.slice(0, idx) + replacement + content.slice(idx + p.find_string.length);
          results.push(`✅ ${path.basename(p.path)}: string-match replacement`);
        } else {
          // Line-range mode
          const lines = content.split('\n');
          if (p.start_line < 1 || p.end_line > lines.length || p.start_line > p.end_line) {
            throw new Error(`Invalid line range ${p.start_line}-${p.end_line} in '${p.path}' (content has ${lines.length} lines)`);
          }
          if (p.original_content !== undefined) {
            const target = lines.slice(p.start_line - 1, p.end_line).join('\n');
            if (target !== p.original_content) {
              throw new Error(`Content mismatch in '${path.basename(p.path)}' at lines ${p.start_line}-${p.end_line}. Expected:\n${p.original_content}\nFound:\n${target}`);
            }
          }
          lines.splice(p.start_line - 1, p.end_line - p.start_line + 1, ...p.new_content.split('\n'));
          content = lines.join('\n');
          results.push(`✅ ${path.basename(p.path)}: lines ${p.start_line}-${p.end_line}`);
        }

        fileStates.set(resolved, content);
      }

      // Phase 3: Write all files and collect diffs
      const diffs = [];
      for (const { original, originalContent } of backups) {
        const finalContent = fileStates.get(original);
        const diffStr = getFileDiff(original, originalContent, finalContent);
        diffs.push(`[Diff for ${path.basename(original)}]:\n${diffStr}`);
        fs.writeFileSync(original, finalContent, 'utf8');
      }

      return `Atomic patch successful:\n${results.join('\n')}\nBackups saved in ${backupDir}\n\n${diffs.join('\n\n')}`;
    } catch (err) {
      // Rollback: restore every backed-up file
      for (const b of backups) {
        try { fs.writeFileSync(b.original, b.originalContent, 'utf8'); } catch {}
      }
      return `❌ Atomic patch FAILED. All changes rolled back.\nError: ${err.message}`;
    }
  }
};