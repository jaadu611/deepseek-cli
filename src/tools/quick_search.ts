// @ts-nocheck
const fs = require('fs');
const path = require('path');
const { glob } = require('glob');
module.exports = {
    name: "quick_search",
    description: "One-shot grep+read: searches for a pattern and returns each match with 3 lines of context, optionally including the file path. Use this 10x more than separate grep_search + read_file — it's optimized for 'find the line that does X'.",
    parameters: {
        type: "object",
        properties: {
            pattern: { type: "string", description: "Regular expression pattern to search for." },
            directory: { type: "string", description: "Directory to search in (default CWD)." },
            file: { type: "string", description: "Restrict to a single file path (e.g. 'src/foo.ts'). If set, 'directory' is ignored." },
            include: { type: "string", description: "Glob pattern to filter files (e.g. '*.ts')." },
            context_lines: { type: "integer", description: "Lines of context before AND after each match (default 3, max 10)." },
            case_sensitive: { type: "boolean", description: "If true, case-sensitive (default false)." },
            max_results: { type: "integer", description: "Cap results (default 30, max 100)." }
        },
        "required": ["pattern"]
    },
    async execute({ pattern, directory, file, include, context_lines = 3, case_sensitive = false, max_results = 30 }) {
        try {
            if (!pattern || typeof pattern !== 'string' || !pattern.trim()) {
                return 'Error: Required parameter "pattern" is missing or empty.';
            }
            let regex;
            try {
                regex = new RegExp(pattern, case_sensitive ? 'g' : 'gi');
            }
            catch (e) {
                return `Error: Invalid regex: ${e.message}`;
            }
            const ctx = Math.min(Math.max(0, context_lines || 0), 10);
            const maxRes = Math.min(max_results || 30, 100);
            let files;
            if (file) {
                const resolved = path.resolve(file);
                if (!fs.existsSync(resolved)) {
                    return `Error: file not found: ${resolved}`;
                }
                files = [resolved];
            }
            else {
                const searchDir = directory ? path.resolve(directory) : process.cwd();
                if (!fs.existsSync(searchDir)) {
                    return `Error: directory not found: ${searchDir}`;
                }
                const globOptions = {
                    cwd: searchDir,
                    absolute: true,
                    nodir: true,
                    ignore: ['**/node_modules/**', '**/.git/**', '**/dist/**', '**/build/**']
                };
                const pattern_ = include || '**/*';
                files = await glob(pattern_, globOptions);
            }
            const out = [`[quick_search: /${pattern}/${case_sensitive ? "" : " (case-insensitive)"} in ${file || (directory || "CWD")}]`, ""];
            let total = 0;
            for (const f of files.slice(0, 200)) {
                // Binary sniff
                try {
                    const fd = fs.openSync(f, 'r');
                    const buf = Buffer.alloc(Math.min(8192, fs.fstatSync(fd).size));
                    fs.readSync(fd, buf, 0, buf.length, 0);
                    fs.closeSync(fd);
                    if (buf.includes(0))
                        continue;
                }
                catch {
                    continue;
                }
                let content;
                try {
                    content = fs.readFileSync(f, 'utf8');
                }
                catch {
                    continue;
                }
                const lines = content.split('\n');
                for (let i = 0; i < lines.length; i++) {
                    regex.lastIndex = 0;
                    if (regex.test(lines[i])) {
                        total++;
                        if (total > maxRes) {
                            out.push(`\n[... ${total}+ matches, capped at ${maxRes}. Use offset on grep_search for pagination.]`);
                            return out.join('\n');
                        }
                        const startLine = Math.max(0, i - ctx);
                        const endLine = Math.min(lines.length - 1, i + ctx);
                        const fileShort = path.relative(process.cwd(), f);
                        out.push(`📍 ${fileShort}:${i + 1}`);
                        for (let j = startLine; j <= endLine; j++) {
                            const marker = j === i ? "▶" : " ";
                            out.push(`  ${marker} ${String(j + 1).padStart(4, " ")} │ ${lines[j]}`);
                        }
                        out.push("");
                    }
                }
            }
            if (total === 0) {
                return `No matches for /${pattern}/ in ${file || (directory || "CWD")}.`;
            }
            out.push(`[${total} match(es)]`);
            return out.join('\n');
        }
        catch (err) {
            return `Error in quick_search: ${err.message}`;
        }
    }
};
