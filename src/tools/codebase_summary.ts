// @ts-nocheck
const fs = require('fs');
const path = require('path');
const { glob } = require('glob');
const IGNORE_DIRS = new Set(['node_modules', '.git', 'dist', 'build', '__pycache__', '.next', '.cache', 'target', 'venv', '.venv', '.ds_config']);
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
    description: "Returns a one-shot summary of a project: project architecture detection (VS Code extension, CLI tool, web app, Python/Rust/Go project, frameworks used), directory tree (depth 3, skipping generated dirs), file counts by language, and notable config files. Call this FIRST when you join a new project — it tells you the project type, tech stack, and file layout in one call. ~50-200 lines of output, far cheaper than 20 grep_search calls.",
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
                    const full = path.join(dir, item.name);
                    const { shouldIgnore } = require('../utils/ignore');
                    if (shouldIgnore(full)) {
                        if (item.isDirectory()) {
                            treeLines.push(`${prefix}[skip] ${item.name}/`);
                        }
                        continue;
                    }
                    const isLast = i === visible.length - 1;
                    const connector = isLast ? '└── ' : '├── ';
                    const childPrefix = prefix + (isLast ? '    ' : '│   ');
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
            // 4. Detect project architecture
            const architecture = [];
            const pkgJsonPath = path.join(projectDir, 'package.json');
            if (fs.existsSync(pkgJsonPath)) {
                try {
                    const pkg = JSON.parse(fs.readFileSync(pkgJsonPath, 'utf8'));
                    // VS Code Extension
                    if (pkg.engines && pkg.engines.vscode) {
                        architecture.push("Type: VS Code Extension");
                        architecture.push(`  - VS Code engine: ${pkg.engines.vscode}`);
                        if (pkg.contributes) {
                            const contributions = Object.keys(pkg.contributes);
                            architecture.push(`  - Contributions: ${contributions.join(', ')}`);
                        }
                        if (pkg.main) {
                            architecture.push(`  - Entry point: ${pkg.main}`);
                        }
                    }
                    // Node.js CLI tool
                    if (pkg.bin) {
                        const bins = typeof pkg.bin === 'string' ? [pkg.bin] : Object.keys(pkg.bin);
                        architecture.push(`Type: CLI tool (commands: ${bins.join(', ')})`);
                    }
                    // Web framework detection
                    const allDeps = { ...pkg.dependencies, ...pkg.devDependencies };
                    const frameworks = [];
                    if (allDeps.react) frameworks.push('React');
                    if (allDeps.vue) frameworks.push('Vue');
                    if (allDeps.angular || allDeps['@angular/core']) frameworks.push('Angular');
                    if (allDeps.svelte) frameworks.push('Svelte');
                    if (allDeps.next) frameworks.push('Next.js');
                    if (allDeps.nuxt) frameworks.push('Nuxt');
                    if (allDeps.express) frameworks.push('Express');
                    if (allDeps.fastify) frameworks.push('Fastify');
                    if (allDeps.koa) frameworks.push('Koa');
                    if (allDeps.hono) frameworks.push('Hono');
                    if (allDeps.typescript) frameworks.push('TypeScript');
                    if (frameworks.length > 0) {
                        architecture.push(`Frameworks: ${frameworks.join(', ')}`);
                    }
                    // Script detection
                    if (pkg.scripts) {
                        const scripts = Object.keys(pkg.scripts);
                        architecture.push(`  - Scripts: ${scripts.join(', ')}`);
                    }
                } catch (e) {
                    architecture.push(`Type: Could not parse package.json (${e.message})`);
                }
            }
            // Python detection
            if (allFiles.some(f => f.endsWith('requirements.txt') || f.endsWith('pyproject.toml') || f.endsWith('setup.py'))) {
                architecture.push("Type: Python project");
            }
            // Rust detection
            if (allFiles.some(f => f.endsWith('Cargo.toml'))) {
                architecture.push("Type: Rust project");
            }
            // Go detection
            if (allFiles.some(f => f.endsWith('go.mod'))) {
                architecture.push("Type: Go project");
            }
            // 5. Build output
            const out = [];
            out.push(`[Codebase Summary: ${projectDir}]`);
            out.push("");
            if (architecture.length > 0) {
                out.push(`## Project Architecture`);
                for (const line of architecture) {
                    out.push(`  ${line}`);
                }
                out.push("");
            }
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
