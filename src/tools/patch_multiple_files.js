const fs = require('fs');
const path = require('path');

module.exports = {
  name: "patch_multiple_files",
  description: "Applies patches to multiple files atomically. If ANY patch fails, ALL changes are rolled back. Each patch uses line-range replacement. Use this for coordinated refactors across related files.",
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
    const backups = [];
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
      
      // Phase 2: Create backups
      for (const p of patches) {
        const resolved = path.resolve(p.path);
        const bakPath = resolved + '.bak';
        fs.writeFileSync(bakPath, fs.readFileSync(resolved, 'utf8'), 'utf8');
        backups.push({ original: resolved, backup: bakPath });
      }
      
      // Phase 3: Apply all patches
      const results = [];
      for (const p of patches) {
        const resolved = path.resolve(p.path);
        const lines = fs.readFileSync(resolved, 'utf8').split('\n');
        const newLines = p.new_content.split('\n');
        lines.splice(p.start_line - 1, p.end_line - p.start_line + 1, ...newLines);
        fs.writeFileSync(resolved, lines.join('\n'), 'utf8');
        results.push(`✅ ${p.path}: lines ${p.start_line}-${p.end_line}`);
      }
      
      return `Atomic patch successful:\n${results.join('\n')}`;
    } catch (err) {
      // ROLLBACK on any failure
      for (const b of backups) {
        try { fs.copyFileSync(b.backup, b.original); } catch {}
      }
      return `❌ Atomic patch FAILED. All changes rolled back.\nError: ${err.message}`;
    }
  }
};
