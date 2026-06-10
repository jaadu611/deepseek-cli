// @ts-nocheck
// Persistent project memory. Read from and appended to ./AGENTS.md
// (and ~/.ds_config/AGENTS.md for global). The orchestrator injects
// these on every system-prompt build.
const fs = require('fs');
const path = require('path');
const os = require('os');
const PROJECT_FILE = path.join(process.cwd(), 'AGENTS.md');
const GLOBAL_FILE = path.join(os.homedir(), '.ds_config', 'AGENTS.md');
function readMd(file) {
    try {
        if (!fs.existsSync(file))
            return "";
        return fs.readFileSync(file, 'utf8');
    }
    catch {
        return "";
    }
}
function writeMd(file, content) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, content, 'utf8');
}
function buildMemoryContext() {
    const proj = readMd(PROJECT_FILE);
    const glob = readMd(GLOBAL_FILE);
    const parts = [];
    if (glob.trim()) {
        parts.push(`[Global Memory from ${GLOBAL_FILE}]\n${glob.trim()}`);
    }
    if (proj.trim()) {
        parts.push(`[Project Memory from ${PROJECT_FILE}]\n${proj.trim()}`);
    }
    return parts.join("\n\n");
}
module.exports = {
    name: "update_project_memory",
    description: "Add to or update the persistent AGENTS.md memory file. There are two scopes: 'project' (./AGENTS.md, shared with anyone working on this project) and 'global' (~/.ds_config/AGENTS.md, applies to all your sessions). The memory is automatically loaded into every system prompt. Use this to remember: project conventions, user preferences, build/test commands, common pitfalls, architecture decisions.",
    parameters: {
        type: "object",
        properties: {
            section: { type: "string", description: "Markdown section heading (e.g. '## Build commands', '## Architecture', '## User preferences'). If the section exists, the content is appended; if not, a new section is created." },
            content: { type: "string", description: "The content to add under this section. Can be multiple lines / a markdown list / etc." },
            scope: { type: "string", description: "'project' (./AGENTS.md, default) or 'global' (~/.ds_config/AGENTS.md)." },
            action: { type: "string", description: "'append' (default) adds to the section, 'replace' overwrites the whole section, 'delete' removes the section." }
        },
        "required": ["section", "content"]
    },
    async execute({ section, content, scope = "project", action = "append" } = {}) {
        try {
            if (!section || typeof section !== "string") {
                return 'Error: section is required (e.g. "## Conventions").';
            }
            if (!content && action !== "delete") {
                return 'Error: content is required (unless action is "delete").';
            }
            const file = scope === "global" ? GLOBAL_FILE : PROJECT_FILE;
            let md = readMd(file);
            if (action === "delete") {
                // Remove the section (heading + content until next heading of same or higher level)
                const lines = md.split("\n");
                const headingLevel = (section.match(/^#+/) || ["#"])[0].length;
                const startIdx = lines.findIndex(l => l.trim() === section);
                if (startIdx === -1)
                    return `Section '${section}' not found in ${file}. Nothing to delete.`;
                let endIdx = lines.length;
                for (let i = startIdx + 1; i < lines.length; i++) {
                    const h = (lines[i].match(/^#+/) || [""])[0];
                    if (h.length > 0 && h.length <= headingLevel) {
                        endIdx = i;
                        break;
                    }
                }
                md = lines.slice(0, startIdx).concat(lines.slice(endIdx)).join("\n").replace(/\n{3,}/g, "\n\n").trim() + "\n";
                writeMd(file, md);
                return `✅ Deleted section '${section}' from ${file}.`;
            }
            if (action === "replace") {
                // Replace the section entirely
                const lines = md.split("\n");
                const startIdx = lines.findIndex(l => l.trim() === section);
                if (startIdx === -1) {
                    // Section doesn't exist, append it
                    md = (md.trim() + "\n\n" + section + "\n" + content.trim() + "\n");
                }
                else {
                    const headingLevel = section.match(/^#+/)[0].length;
                    let endIdx = lines.length;
                    for (let i = startIdx + 1; i < lines.length; i++) {
                        const h = (lines[i].match(/^#+/) || [""])[0];
                        if (h.length > 0 && h.length <= headingLevel) {
                            endIdx = i;
                            break;
                        }
                    }
                    const newSection = section + "\n" + content.trim() + "\n";
                    md = lines.slice(0, startIdx).concat([newSection]).concat(lines.slice(endIdx)).join("\n").replace(/\n{3,}/g, "\n\n").trim() + "\n";
                }
                writeMd(file, md);
                return `✅ Replaced section '${section}' in ${file}.`;
            }
            // action === "append" (default)
            if (md.includes(section)) {
                // Section exists, append
                const lines = md.split("\n");
                const startIdx = lines.findIndex(l => l.trim() === section);
                const headingLevel = section.match(/^#+/)[0].length;
                let endIdx = lines.length;
                for (let i = startIdx + 1; i < lines.length; i++) {
                    const h = (lines[i].match(/^#+/) || [""])[0];
                    if (h.length > 0 && h.length <= headingLevel) {
                        endIdx = i;
                        break;
                    }
                }
                // Insert content before endIdx (preserving any trailing empty line)
                const insertion = content.trim().split("\n");
                md = lines.slice(0, endIdx).concat(insertion).concat(lines.slice(endIdx)).join("\n").replace(/\n{3,}/g, "\n\n").trim() + "\n";
            }
            else {
                // Section doesn't exist, create it
                md = (md.trim() + "\n\n" + section + "\n" + content.trim() + "\n").replace(/\n{3,}/g, "\n\n").trim() + "\n";
            }
            writeMd(file, md);
            return `✅ Updated section '${section}' in ${file} (scope: ${scope}). The new content will appear in the next system prompt.`;
        }
        catch (err) {
            return `Error in update_project_memory: ${err.message}`;
        }
    }
};
module.exports.buildMemoryContext = buildMemoryContext;
module.exports.PROJECT_FILE = PROJECT_FILE;
module.exports.GLOBAL_FILE = GLOBAL_FILE;
