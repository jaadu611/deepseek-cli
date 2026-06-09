// @ts-nocheck
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const { getFileDiff } = require('../utils/diff_helper');
module.exports = {
    name: "get_file_diff",
    description: "Shows the diff between the current state of a file and an earlier reference point. Use 'against: \"git\"' to compare against the last git commit, or 'against: \"backup\"' to compare against the most recent backup in ds_config/backups/. Returns a unified diff you can read.",
    parameters: {
        type: "object",
        properties: {
            path: { type: "string", description: "File to diff." },
            against: { type: "string", description: "What to diff against: 'git' (last commit, default) or 'backup' (most recent backup)." }
        },
        required: ["path"]
    },
    async execute({ path: filePath, against = "git" }) {
        try {
            if (!filePath || typeof filePath !== "string") {
                return 'Error: Required parameter "path" is missing.';
            }
            const resolved = path.resolve(filePath);
            if (!fs.existsSync(resolved)) {
                return `Error: File not found: ${resolved}`;
            }
            if (!fs.statSync(resolved).isFile()) {
                return `Error: Not a file: ${resolved}`;
            }
            const currentContent = fs.readFileSync(resolved, "utf8");
            if (against === "git") {
                let oldContent;
                try {
                    const relativePath = path.relative(process.cwd(), resolved);
                    oldContent = execSync(`git show "HEAD:${relativePath}"`, { stdio: ['ignore', 'pipe', 'ignore'] }).toString();
                }
                catch (err) {
                    return `Error: Cannot get git diff. File may not be tracked by git, or there is no HEAD commit. Try against: "backup" instead.\nUnderlying: ${err.message}`;
                }
                if (oldContent === currentContent) {
                    return `No changes: ${resolved} matches the last git commit.`;
                }
                return `[Diff: ${resolved} vs HEAD]\n` + getFileDiff(resolved, oldContent, currentContent);
            }
            if (against === "backup") {
                const { getBackupsPath } = require('../utils/config');
                const backupDir = getBackupsPath();
                // Backups are named: <sanitized_path>_<timestamp>.bak
                const sanitized = resolved.replace(/\//g, "_");
                let files;
                try {
                    files = fs.readdirSync(backupDir).filter(f => f.startsWith(sanitized + "_") && f.endsWith(".bak"));
                }
                catch {
                    return `Error: Cannot read backup dir: ${backupDir}`;
                }
                if (files.length === 0) {
                    return `Error: No backups found for ${resolved} in ${backupDir}.`;
                }
                // Pick the most recent
                const latest = files.sort().reverse()[0];
                const backupPath = path.join(backupDir, latest);
                const oldContent = fs.readFileSync(backupPath, "utf8");
                if (oldContent === currentContent) {
                    return `No changes: ${resolved} matches its most recent backup (${latest}).`;
                }
                return `[Diff: ${resolved} vs ${latest}]\n` + getFileDiff(resolved, oldContent, currentContent);
            }
            return `Error: 'against' must be 'git' or 'backup'. Got: ${against}`;
        }
        catch (err) {
            return `Error getting file diff: ${err.message}`;
        }
    }
};
