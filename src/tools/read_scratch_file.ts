// @ts-nocheck
const fs = require('fs');
const path = require('path');
const { getScratchPath } = require('../utils/config');
module.exports = {
    name: "read_scratch_file",
    description: "Reads a file from the agent's scratch directory. Supports optional start_line/end_line for pagination. Use list_scratch_files first to see what's available.",
    parameters: {
        type: "object",
        properties: {
            filename: { type: "string", description: "Name of the file (relative to scratch dir). May include subdirs (e.g. 'notes/todo.md')." },
            start_line: { type: "integer", description: "Optional 1-based start line." },
            end_line: { type: "integer", description: "Optional 1-based end line (inclusive)." }
        },
        required: ["filename"]
    },
    async execute({ filename, start_line, end_line }) {
        try {
            if (!filename || typeof filename !== "string" || filename.trim() === "") {
                return 'Error: Required parameter "filename" is missing or empty.';
            }
            if (path.isAbsolute(filename) || filename.includes("..")) {
                return `Error: filename must be relative to the scratch dir, no absolute paths or '..' allowed.`;
            }
            const scratchDir = getScratchPath();
            const fullPath = path.join(scratchDir, filename);
            const resolved = path.resolve(fullPath);
            if (!resolved.startsWith(path.resolve(scratchDir))) {
                return `Error: filename resolved outside scratch dir.`;
            }
            if (!fs.existsSync(resolved)) {
                // List nearby files to help the model recover
                let hint = "";
                try {
                    const all = fs.readdirSync(scratchDir);
                    const sameName = all.filter(f => f.toLowerCase().includes(filename.toLowerCase().split("/").pop().split(".")[0] || ""));
                    if (sameName.length > 0)
                        hint = `\n\nDid you mean: ${sameName.map(f => `'${f}'`).join(", ")}?`;
                }
                catch { }
                return `Error: scratch file not found: ${resolved}${hint}\nUse list_scratch_files to see what's available.`;
            }
            const content = fs.readFileSync(resolved, "utf8");
            const allLines = content.split("\n");
            let lines = allLines;
            let offset = 0;
            if (start_line || end_line) {
                const s = Math.max(1, start_line || 1);
                const e = Math.min(allLines.length, end_line || allLines.length);
                lines = allLines.slice(s - 1, e);
                offset = s - 1;
            }
            const maxNum = String(offset + lines.length).length;
            const numbered = lines.map((line, i) => {
                const num = String(offset + i + 1).padStart(maxNum, " ");
                return `${num} │ ${line}`;
            }).join("\n");
            const header = `[Scratch File: ${resolved}] [Lines: ${offset + 1}-${offset + lines.length} of ${allLines.length}]\n`;
            return header + numbered;
        }
        catch (err) {
            return `Error reading scratch file: ${err.message}`;
        }
    }
};
