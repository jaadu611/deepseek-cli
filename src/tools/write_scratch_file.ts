// @ts-nocheck
const fs = require('fs');
const path = require('path');
const { getScratchPath } = require('../utils/config');
module.exports = {
    name: "write_scratch_file",
    description: "Writes a file into the agent's scratch directory (ds_config/scratch/ for the main agent, ds_config/sub_agents/N/scratch/ for sub-agents). Files persist between turns. Use this for: working notes, output of long commands, partial diffs you're planning, repro scripts, anything you'd otherwise lose when the context scrolls away. Filenames may contain slashes for subdirectories (e.g. 'research/foo.md'). Set 'delete: true' to remove a file instead of writing it.",
    parameters: {
        type: "object",
        properties: {
            filename: { type: "string", description: "Name of the file (relative to scratch dir). May include subdirs (e.g. 'notes/todo.md')." },
            content: { type: "string", description: "The full text content to write. Replaces any existing file at the same path. Ignored if 'delete' is true." },
            append: { type: "boolean", description: "If true, append to the file instead of replacing (default false)." },
            delete: { type: "boolean", description: "If true, delete the file at this path instead of writing. Returns 'File not found' if the file doesn't exist (or if you spelled it wrong)." }
        },
        required: ["filename"]
    },
    async execute({ filename, content = "", append = false, delete: del = false }) {
        try {
            if (!filename || typeof filename !== "string" || filename.trim() === "") {
                return 'Error: Required parameter "filename" is missing or empty.';
            }
            if (path.isAbsolute(filename) || filename.includes("..")) {
                return `Error: filename must be relative to the scratch dir, no absolute paths or '..' allowed. Got: ${filename}`;
            }
            const scratchDir = getScratchPath();
            const fullPath = path.join(scratchDir, filename);
            const resolved = path.resolve(fullPath);
            if (!resolved.startsWith(path.resolve(scratchDir))) {
                return `Error: filename resolved outside scratch dir. Got: ${filename}`;
            }
            if (del) {
                if (!fs.existsSync(resolved)) {
                    return `Error: scratch file not found, cannot delete: ${resolved}\nUse list_scratch_files to see what's available.`;
                }
                fs.unlinkSync(resolved);
                return `✅ Deleted scratch file: ${resolved}\n   Use list_scratch_files to confirm.`;
            }
            if (typeof content !== "string") {
                return 'Error: Required parameter "content" must be a string.';
            }
            fs.mkdirSync(path.dirname(resolved), { recursive: true });
            if (append) {
                fs.appendFileSync(resolved, content, "utf8");
            }
            else {
                fs.writeFileSync(resolved, content, "utf8");
            }
            const size = fs.statSync(resolved).size;
            const lineCount = content.split("\n").length;
            return `✅ ${append ? "Appended to" : "Wrote"} scratch file: ${resolved}\n   ${size} bytes, ${lineCount} line(s).\n   Use read_scratch_file to retrieve, list_scratch_files to see all files, or write_scratch_file(filename, '', delete=true) to clean up.`;
        }
        catch (err) {
            return `Error writing scratch file: ${err.message}`;
        }
    }
};
