// @ts-nocheck
const fs = require('fs');
const path = require('path');
const { getScratchPath } = require('../utils/config');
function formatSize(bytes) {
    if (bytes < 1024)
        return `${bytes}B`;
    if (bytes < 1024 * 1024)
        return `${(bytes / 1024).toFixed(1)}KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
}
module.exports = {
    name: "list_scratch_files",
    description: "Lists all files in the agent's scratch directory with sizes and modification times. Use to recover work that was saved between turns (write_scratch_file persists across the session).",
    parameters: {
        type: "object",
        properties: {
            subdir: { type: "string", description: "Optional subdirectory to list (e.g. 'notes'). Omit for the root scratch dir." },
            recursive: { type: "boolean", description: "Recurse into subdirectories (default true)." }
        }
    },
    async execute({ subdir, recursive = true } = {}) {
        try {
            const scratchDir = getScratchPath();
            const target = subdir ? path.join(scratchDir, subdir) : scratchDir;
            const resolved = path.resolve(target);
            if (!resolved.startsWith(path.resolve(scratchDir))) {
                return `Error: subdir resolved outside scratch dir.`;
            }
            if (!fs.existsSync(resolved)) {
                return `Scratch dir (or subdir) does not exist: ${resolved}\nIt will be created automatically the first time you call write_scratch_file.`;
            }
            if (!fs.statSync(resolved).isDirectory()) {
                return `Error: ${resolved} is a file, not a directory.`;
            }
            const results = [];
            function walk(dir, prefix) {
                let items;
                try {
                    items = fs.readdirSync(dir, { withFileTypes: true });
                }
                catch {
                    return;
                }
                for (const item of items) {
                    if (item.name.startsWith("."))
                        continue;
                    const full = path.join(dir, item.name);
                    let stat;
                    try {
                        stat = fs.statSync(full);
                    }
                    catch {
                        continue;
                    }
                    if (item.isDirectory()) {
                        results.push(`${prefix}${item.name}/`);
                        if (recursive)
                            walk(full, prefix + "  ");
                    }
                    else {
                        const mtime = new Date(stat.mtimeMs).toISOString().replace(/T/, " ").slice(0, 19);
                        results.push(`${prefix}${item.name}  (${formatSize(stat.size)}, modified ${mtime})`);
                    }
                }
            }
            walk(resolved, "");
            if (results.length === 0) {
                return `Scratch dir is empty: ${resolved}\nUse write_scratch_file to save notes / partial diffs / output.`;
            }
            return `${resolved}\n${results.join("\n")}`;
        }
        catch (err) {
            return `Error listing scratch files: ${err.message}`;
        }
    }
};
