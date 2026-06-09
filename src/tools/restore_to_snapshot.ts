// @ts-nocheck
// restore_to_snapshot — rolls back the working tree to a previous snapshot.
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const LABELS_FILE = path.join(require('os').homedir(), '.deepseek_cli', 'ds_config', 'snapshots.json');
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
module.exports = {
    name: "restore_to_snapshot",
    description: "Roll the working tree back to a previous snapshot created by snapshot_state. WARNING: this discards any changes made AFTER the snapshot. Use it when you've broken things and want to start over from a known-good point.",
    parameters: {
        type: "object",
        properties: {
            label: { type: "string", description: "The snapshot label to restore to. Run without label to list available snapshots." },
            delete_after_restore: { type: "boolean", description: "If true, also delete the snapshot after restoring (default false — keeps the snapshot for future use)." }
        }
    },
    async execute({ label, delete_after_restore = false } = {}) {
        try {
            const snapshots = loadSnapshots();
            const labels = Object.keys(snapshots);
            if (!label) {
                if (labels.length === 0)
                    return "No snapshots saved. Use snapshot_state to create one.";
                const out = ["[Available snapshots]", ""];
                for (const l of labels) {
                    const s = snapshots[l];
                    out.push(`  - ${l}  (HEAD: ${s.head ? s.head.slice(0, 8) : "n/a"}, created: ${s.createdAt})`);
                }
                out.push("\nUse label: 'restore_to_snapshot({ label: \"<one of the above>\" })' to roll back.");
                return out.join("\n");
            }
            if (!snapshots[label]) {
                return `Error: snapshot '${label}' not found. Available: ${labels.join(", ") || "none"}.`;
            }
            const snap = snapshots[label];
            if (!snap.stashRef) {
                return `Snapshot '${label}' has no stash (working tree was already clean when it was created). Nothing to restore — the tree is already at the recorded state.`;
            }
            try {
                execSync(`git stash pop`, { cwd: process.cwd(), stdio: ['ignore', 'pipe', 'pipe'] });
            }
            catch (err) {
                const out = (err.stderr || err.stdout || err.message || "").toString().slice(0, 1000);
                return `Error restoring snapshot '${label}':\n${out}\n\nThis usually means the working tree has changes that conflict with the snapshot. Try:\n  1. git stash list  (to see the stashes)\n  2. git status  (to see the conflict)\n  3. Resolve manually, or use restore_file on specific files instead.`;
            }
            if (delete_after_restore) {
                delete snapshots[label];
            }
            saveSnapshots(snapshots);
            return `✅ Restored to snapshot '${label}' (HEAD was ${snap.head ? snap.head.slice(0, 8) : "n/a"}${snap.stashRef ? `, applied ${snap.stashRef}` : ""}).\n\nThe current state of the working tree now matches what it was when the snapshot was created.\n\n${delete_after_restore ? "Snapshot deleted (delete_after_restore=true).\n" : ""}Other snapshots are still available: ${Object.keys(snapshots).filter(l => l !== label).join(", ") || "none"}.`;
        }
        catch (err) {
            return `Error in restore_to_snapshot: ${err.message}`;
        }
    }
};
