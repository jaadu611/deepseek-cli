// @ts-nocheck
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const os = require('os');
module.exports = {
    name: "apply_unified_diff",
    description: "Apply a standard unified diff (output of 'diff -u' or 'git diff') to a file. Validates the patch applies cleanly with `patch --dry-run` BEFORE writing. Useful for sub-agents that want to prepare a complete diff offline and have the parent apply it.",
    parameters: {
        type: "object",
        properties: {
            path: { type: "string", description: "File to apply the diff to." },
            diff: { type: "string", description: "Unified diff content (output of `diff -u` or `git diff`)." },
            dry_run: { type: "boolean", description: "If true, validate the diff applies but don't write (default false)." }
        },
        required: ["path", "diff"]
    },
    async execute({ path: filePath, diff, dry_run = false }) {
        try {
            if (!filePath || typeof filePath !== "string") {
                return 'Error: Required parameter "path" is missing.';
            }
            if (!diff || typeof diff !== "string" || !diff.trim()) {
                return 'Error: Required parameter "diff" is missing or empty.';
            }
            const resolved = path.resolve(filePath);
            if (!fs.existsSync(resolved)) {
                return `Error: Target file does not exist: ${resolved}. Use patch_file or write_file to create a new file, then apply further diffs.`;
            }
            // Write the diff to a temp file, run `patch --dry-run` to validate
            const tmpDiff = path.join(os.tmpdir(), `dscli-diff-${Date.now()}-${process.pid}.patch`);
            fs.writeFileSync(tmpDiff, diff, "utf8");
            try {
                // -p0 means no path stripping (the diff was made against the file directly)
                execSync(`patch --dry-run -p0 -i "${tmpDiff}"`, { cwd: path.dirname(resolved), stdio: ['ignore', 'pipe', 'pipe'] });
            }
            catch (dryErr) {
                const out = (dryErr.stdout ? dryErr.stdout.toString() : "") + "\n" + (dryErr.stderr ? dryErr.stderr.toString() : "");
                return `Error: diff does not apply cleanly to ${resolved}.\n\npatch --dry-run output:\n${out.slice(0, 1500)}\n\nThis usually means the file has changed since the diff was generated. Re-read the file and regenerate the diff.`;
            }
            finally {
                try {
                    fs.unlinkSync(tmpDiff);
                }
                catch { }
            }
            if (dry_run) {
                return `✅ DRY RUN: diff applies cleanly to ${resolved}. No changes written.\n\nDiff summary:\n${summarizeDiff(diff)}`;
            }
            // Apply for real
            try {
                execSync(`patch -p0 -i "${tmpDiff}"`, { cwd: path.dirname(resolved), stdio: ['ignore', 'pipe', 'pipe'] });
                // patch created a backup .orig file, remove it
                try {
                    fs.unlinkSync(resolved + ".orig");
                }
                catch { }
                // The patch command consumed the tmpDiff; re-create for second call (it was deleted in the dry-run)
                return `✅ Applied diff to ${resolved}.\n\n${summarizeDiff(diff)}\n\nThe file is now updated. Use get_file_diff to see the change vs. the previous backup.`;
            }
            catch (applyErr) {
                const out = (applyErr.stdout ? applyErr.stdout.toString() : "") + "\n" + (applyErr.stderr ? applyErr.stderr.toString() : "");
                return `Error: failed to apply diff to ${resolved}:\n${out.slice(0, 1000)}`;
            }
        }
        catch (err) {
            return `Error applying unified diff: ${err.message}`;
        }
    }
};
function summarizeDiff(diff) {
    let added = 0, removed = 0, files = new Set();
    for (const line of diff.split("\n")) {
        if (line.startsWith("+") && !line.startsWith("+++"))
            added++;
        else if (line.startsWith("-") && !line.startsWith("---"))
            removed++;
        const m = line.match(/^(\+\+\+|---)\s+(\S+)/);
        if (m)
            files.add(m[2]);
    }
    return `  + ${added} lines, - ${removed} lines across ${files.size} file(s).`;
}
