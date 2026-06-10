// @ts-nocheck
// snapshot_state + restore_to_snapshot — uses git stash internally.
// Cheap "rollback to known good point" for the whole working tree.
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const LABELS_FILE = path.join(require('os').homedir(), '.ds_config', 'snapshots.json');
function loadSnapshots() {
    try {
        if (!fs.existsSync(LABELS_FILE))
            return {};
        return JSON.parse(fs.readFileSync(LABELS_FILE, 'utf8'));
    }
    catch {
        return {};
    }
}
function saveSnapshots(s) {
    try {
        fs.mkdirSync(path.dirname(LABELS_FILE), { recursive: true });
        fs.writeFileSync(LABELS_FILE, JSON.stringify(s, null, 2), 'utf8');
    }
    catch { }
}
function isGit() {
    return fs.existsSync(path.join(process.cwd(), '.git'));
}
function gitStashIdToMessage(stashId) {
    // stash@{0} is the latest
    return `dscli-snapshot: ${stashId}`;
}
module.exports = {
    name: "snapshot_state",
    description: "Mark a 'known good' point in the working tree by stashing all changes and tagging the stash with a label. Use this AFTER successful verification or a clean tool sequence, so you can later roll back to this exact state with restore_to_snapshot. Cheaper than per-file backup — covers ALL changes in one go. Requires the project to be a git repository.",
    parameters: {
        type: "object",
        properties: {
            label: { type: "string", description: "A short, descriptive label for this snapshot (e.g. 'after-adding-foo-tool', 'working-state-pre-refactor'). Required, must be unique." },
            include_untracked: { type: "boolean", description: "If true, also stash untracked files (default true)." }
        },
        required: ["label"]
    },
    async execute({ label, include_untracked = true } = {}) {
        try {
            if (!label || typeof label !== "string" || !label.trim()) {
                return 'Error: label is required and must be a non-empty string.';
            }
            if (!isGit()) {
                return `Error: snapshot_state requires a git repository (no .git found at ${process.cwd()}). Either init git, or use per-file restore_file instead.`;
            }
            const snapshots = loadSnapshots();
            if (snapshots[label]) {
                return `Error: snapshot with label '${label}' already exists. Use restore_to_snapshot(label) to roll back to it, or pick a different label.`;
            }
            // Capture current HEAD commit
            let head;
            try {
                head = execSync('git rev-parse HEAD', { cwd: process.cwd(), stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim();
            }
            catch {
                return `Error: could not read git HEAD. Are there any commits yet? Make an initial commit first.`;
            }
            // Stash everything (including untracked) as a snapshot
            const stashMsg = gitStashIdToMessage(label) + ` [head=${head}]`;
            const flags = include_untracked ? '-u' : '';
            try {
                // If nothing to stash, git stash will fail. Detect that.
                const status = execSync('git status --porcelain', { cwd: process.cwd(), stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim();
                if (!status) {
                    // Nothing to snapshot — just record the HEAD
                    snapshots[label] = { stashRef: null, head, createdAt: new Date().toISOString() };
                    saveSnapshots(snapshots);
                    return `✅ Snapshot '${label}' recorded at HEAD (${head.slice(0, 8)}). Working tree is already clean — nothing to stash.`;
                }
                // Push the stash and capture the ref
                const pushOut = execSync(`git stash push ${flags} -m "${stashMsg.replace(/"/g, '\\"')}"`, { cwd: process.cwd(), stdio: ['ignore', 'pipe', 'pipe'] }).toString();
                // After push, the stash is stash@{0}
                const stashRef = "stash@{0}";
                snapshots[label] = { stashRef, head, createdAt: new Date().toISOString() };
                saveSnapshots(snapshots);
                return `✅ Snapshot '${label}' created.\n   HEAD was ${head.slice(0, 8)}, working tree had ${status.split("\n").length} dirty file(s).\n   Use restore_to_snapshot(label) to roll back.`;
            }
            catch (err) {
                return `Error creating snapshot: ${(err.stderr || err.message || "").toString().slice(0, 800)}`;
            }
        }
        catch (err) {
            return `Error in snapshot_state: ${err.message}`;
        }
    }
};
// Also export the helper for restore_to_snapshot
module.exports.loadSnapshots = loadSnapshots;
module.exports.saveSnapshots = saveSnapshots;
