// @ts-nocheck
const fs = require('fs');
const path = require('path');
const { getBackupsPath } = require('../utils/config');
module.exports = {
    name: "restore_file",
    description: "Restores a file from its most recent backup (created automatically by patch_file / write_file). Use this to undo a bad edit. Defaults to the most recent backup; pass 'version: N' to go back further. Shows the diff of what will be restored before applying.",
    parameters: {
        type: "object",
        properties: {
            path: { type: "string", description: "File to restore." },
            version: { type: "integer", description: "Which backup to use, 1 = most recent, 2 = second most recent, etc. (default 1)." },
            dry_run: { type: "boolean", description: "If true, only show the diff of what WOULD be restored, don't write (default false)." }
        },
        required: ["path"]
    },
    async execute({ path: filePath, version = 1, dry_run = false }) {
        try {
            if (!filePath || typeof filePath !== "string") {
                return 'Error: Required parameter "path" is missing.';
            }
            const resolved = path.resolve(filePath);
            if (!fs.existsSync(resolved)) {
                return `Error: File not found: ${resolved}. restore_file can only restore files that still exist (use the backup manually otherwise).`;
            }
            const { getFileDiff } = require('../utils/diff_helper');
            const backupDir = getBackupsPath();
            const sanitized = resolved.replace(/\//g, "_");
            let backups;
            try {
                backups = fs.readdirSync(backupDir).filter(f => f.startsWith(sanitized + "_") && f.endsWith(".bak"));
            }
            catch {
                return `Error: Cannot read backup dir: ${backupDir}`;
            }
            if (backups.length === 0) {
                return `Error: No backups found for ${resolved} in ${backupDir}. The file may have never been edited via patch_file / write_file.`;
            }
            // Sort lexicographically — backup names include a timestamp so this is chronological
            backups.sort();
            backups.reverse(); // most recent first
            const idx = Math.max(1, Math.min(version, backups.length)) - 1;
            const chosen = backups[idx];
            const backupPath = path.join(backupDir, chosen);
            const backupContent = fs.readFileSync(backupPath, "utf8");
            const currentContent = fs.readFileSync(resolved, "utf8");
            if (backupContent === currentContent) {
                return `No-op: ${resolved} is already identical to backup #${version} (${chosen}). Nothing to restore.`;
            }
            if (dry_run) {
                return `[DRY RUN: ${resolved}]\nWould restore from backup ${chosen} (version ${version} of ${backups.length}). Diff that would be applied:\n\n` +
                    getFileDiff(resolved, currentContent, backupContent) +
                    `\n\nPass dry_run: false to actually apply.`;
            }
            // Apply: backup the current state first, then restore
            const newBackupName = sanitized + "_" + Date.now() + ".bak";
            const newBackupPath = path.join(backupDir, newBackupName);
            fs.writeFileSync(newBackupPath, currentContent, "utf8");
            fs.writeFileSync(resolved, backupContent, "utf8");
            return `✅ Restored ${resolved} from backup ${chosen} (version ${version} of ${backups.length}).\n` +
                `The current state was saved as a new backup: ${newBackupName}\n\n` +
                `Diff applied:\n` + getFileDiff(resolved, currentContent, backupContent) +
                `\n\nAvailable backups: ${backups.length}. Use version: ${Math.min(version + 1, backups.length)} to go further back.`;
        }
        catch (err) {
            return `Error restoring file: ${err.message}`;
        }
    }
};
