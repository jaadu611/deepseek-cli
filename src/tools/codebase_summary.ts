// @ts-nocheck
const fs = require('fs');
const path = require('path');
const { glob } = require('glob');
const IGNORE_DIRS = new Set(['node_modules', '.git', 'dist', 'build', '__pycache__', '.next', '.cache', 'target', 'venv', '.venv', '.deepseek_cli']);
const NOTABLE_FILES = [
    'package.json', 'package-lock.json', 'pnpm-lock.yaml', 'yarn.lock',
    'requirements.txt', 'pyproject.toml', 'setup.py', 'Pipfile',
    'Cargo.toml', 'go.mod', 'pom.xml', 'build.gradle', 'build.gradle.kts',
    'tsconfig.json', 'tsconfig.base.json', 'jsconfig.json',
    'README.md', 'README.rst', 'README', 'LICENSE', 'CHANGELOG.md',
    'Dockerfile', 'docker-compose.yml', 'docker-compose.yaml',
    '.env.example', '.gitignore', '.editorconfig', '.prettierrc', '.eslintrc',
    'Makefile', 'AGENTS.md', 'CLAUDE.md'
];
function formatSize(bytes) {
    if (bytes < 1024)
        return `${bytes}B`;
    if (bytes < 1024 * 1024)
        return `${(bytes / 1024).toFixed(1)}KB`;
    if (bytes < 1024 * 1024 * 1024)
        return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
    return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)}GB`;
}
function countByExt(files) {
    const counts = {};
    for (const f of files) {
        const ext = path.extname(f).toLowerCase() || "(no ext)";
        counts[ext] = (counts[ext] || 0) + 1;
    }
    return counts;
}
module.exports = {
    name: "codebase_summary",
    description: "Returns a one-shot summary of a project: directory tree (depth 3, skipping generated dirs), file counts by language, and a list of notable config files (package.json, README, Dockerfile, etc.). Call this FIRST when you join a new project to understand its shape. ~50-200 lines of output, far cheaper than 20 grep_search calls.",
    parameters: {
        type: "object",
        properties: {
            path: { type: "string", description: "Project root to summarize (default: current working directory)." },
            max_depth: { type: "integer", description: "Max directory depth to display (default 3)." },
            max_files: { type: "integer", description: "Max files to enumerate for the language count (default 5000)." }
        }
    },
    async execute({ path: cwd = ".", max_depth = 3, max_files = 5000 } = {}) {
        try {
            const projectDir = path.resolve(cwd);
            if (!fs.existsSync(projectDir)) {
                return `Error: Project dir not found: ${projectDir}`;
            }
            const stat = fs.statSync(projectDir);
            if (!stat.isDirectory()) {
                return `Error: Not a directory: ${projectDir}`;
            }
            // 1. Build a directory tree
            const treeLines = [];
            const allFiles = [];
            function walk(dir, depth, prefix) {
                if (depth > max_depth) {
                    treeLines.push(`${prefix}... (deeper levels hidden)`);
                    return;
                }
                let items;
                try {
                    items = fs.readdirSync(dir, { withFileTypes: true });
                }
                catch {
                    return;
                }
                // Sort: directories first, then files
                items.sort((a, b) => {
                    if (a.isDirectory() !== b.isDirectory())
                        return a.isDirectory() ? -1 : 1;
                    return a.name.localeCompare(b.name);
                });
                const visible = items.filter(it => !it.name.startsWith('.') || it.name === '.gitignore' || it.name === '.env.example' || it.name === '.editorconfig');
                for (let i = 0; i < visible.length; i++) {
                    const item = visible[i];
                    if (IGNORE_DIRS.has(item.name)) {
                        treeLines.push(`${prefix}[skip] ${item.name}/`);
                        continue;
                    }
                    const isLast = i === visible.length - 1;
                    const connector = isLast ? '└── ' : '├── ';
                    const childPrefix = prefix + (isLast ? '    ' : '│   ');
                    const full = path.join(dir, item.name);
                    if (item.isDirectory()) {
                        treeLines.push(`${prefix}${connector}${item.name}/`);
                        walk(full, depth + 1, childPrefix);
                    }
                    else {
                        let size = "?";
                        try {
                            const s = fs.statSync(full);
                            size = formatSize(s.size);
                            allFiles.push(full);
                        }
                        catch { }
                        treeLines.push(`${prefix}${connector}${item.name}  (${size})`);
                    }
                    if (allFiles.length >= max_files)
                        return;
                }
            }
            walk(projectDir, 1, "");
            // 2. Count by extension (top 15)
            const extCounts = countByExt(allFiles);
            const topExt = Object.entries(extCounts)
                .sort((a, b) => b[1] - a[1])
                .slice(0, 15);
            // 3. Notable files
            const notable = [];
            for (const nf of NOTABLE_FILES) {
                const full = path.join(projectDir, nf);
                if (fs.existsSync(full) && fs.statSync(full).isFile()) {
                    let size = "?";
                    try {
                        size = formatSize(fs.statSync(full).size);
                    }
                    catch { }
                    notable.push(`  - ${nf}  (${size})`);
                }
            }
            // 4. Build output
            const out = [];
            out.push(`[Codebase Summary: ${projectDir}]`);
            out.push("");
            out.push(`## Directory tree (depth ${max_depth}, ${allFiles.length} files enumerated)`);
            out.push("");
            out.push(projectDir);
            out.push(treeLines.join("\n"));
            out.push("");
            out.push(`## File counts by extension (top ${topExt.length} of ${Object.keys(extCounts).length})`);
            for (const [ext, n] of topExt) {
                out.push(`  - ${ext}: ${n}`);
            }
            out.push("");
            if (notable.length > 0) {
                out.push(`## Notable config files (${notable.length} found)`);
                out.push(notable.join("\n"));
            }
            else {
                out.push("## No notable config files found at top level.");
            }
            out.push("");
            out.push(`## Stats`);
            out.push(`  - Total files: ${allFiles.length}`);
            out.push(`  - Skipped dirs: ${Array.from(IGNORE_DIRS).join(", ")}`);
            return out.join("\n");
        }
        catch (err) {
            return `Error building codebase summary: ${err.message}`;
        }
    }
};
