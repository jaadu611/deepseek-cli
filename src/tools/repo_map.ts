// @ts-nocheck
const fs = require('fs');
const path = require('path');
const { glob } = require('glob');

const IGNORE_DIRS = new Set(['node_modules', '.git', 'dist', 'build', '__pycache__', '.next', '.cache', 'target', 'venv', '.venv', '.ds_config']);

const SOURCE_EXTENSIONS = {
  '.js': 'js', '.mjs': 'js', '.cjs': 'js',
  '.ts': 'ts', '.tsx': 'ts', '.jsx': 'ts',
  '.py': 'py',
  '.rs': 'rs',
  '.go': 'go',
  '.java': 'java',
  '.kt': 'java',
  '.rb': 'rb',
};

// Regex patterns per language for extracting definitions
const PATTERNS = {
  js: {
    functions: [
      /(?:export\s+)?(?:async\s+)?function\s+(\w+)/g,
      /(?:export\s+)?const\s+(\w+)\s*=\s*(?:async\s+)?(?:\([^)]*\)\s*=>|\w+\s*=>)/g,
      /(?:export\s+)?(?:const|let|var)\s+(\w+)\s*=\s*function/g,
    ],
    classes: [
      /(?:export\s+)?class\s+(\w+)/g,
    ],
    imports: [
      /import\s+.*?\s+from\s+['"]([^'"]+)['"]/g,
      /import\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
      /require\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
    ],
    exports: [
      /module\.exports\s*=?\s*{([^}]+)}/g,
      /export\s+(?:default\s+)?(?:function|class|const|let|var)\s+(\w+)/g,
    ],
  },
  ts: {
    functions: [
      /(?:export\s+)?(?:async\s+)?function\s+(\w+)/g,
      /(?:export\s+)?(?:const|let)\s+(\w+)\s*[=:]\s*(?:async\s+)?(?:\([^)]*\)\s*(?::\s*\w+[<>\[\]()]*)?\s*=>|\w+\s*=>)/g,
      /(?:export\s+)?(?:const|let|var)\s+(\w+)\s*=\s*function/g,
    ],
    classes: [
      /(?:export\s+)?(?:abstract\s+)?class\s+(\w+)/g,
    ],
    imports: [
      /import\s+.*?\s+from\s+['"]([^'"]+)['"]/g,
      /import\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
    ],
    exports: [
      /export\s+(?:default\s+)?(?:function|class|const|let|var|interface|type|enum)\s+(\w+)/g,
      /export\s+{([^}]+)}/g,
    ],
  },
  py: {
    functions: [
      /def\s+(\w+)\s*\(/g,
      /async\s+def\s+(\w+)\s*\(/g,
    ],
    classes: [
      /class\s+(\w+)\s*[\(:]/g,
    ],
    imports: [
      /from\s+([\w.]+)\s+import/g,
      /import\s+([\w.]+)/g,
    ],
    exports: [],
  },
  rs: {
    functions: [
      /(?:pub\s+)?(?:async\s+)?fn\s+(\w+)/g,
    ],
    classes: [
      /(?:pub\s+)?struct\s+(\w+)/g,
      /(?:pub\s+)?enum\s+(\w+)/g,
      /(?:pub\s+)?trait\s+(\w+)/g,
    ],
    imports: [
      /use\s+([\w:]+)/g,
    ],
    exports: [],
  },
  go: {
    functions: [
      /func\s+(?:\([^)]+\)\s+)?(\w+)\s*\(/g,
    ],
    classes: [
      /type\s+(\w+)\s+struct/g,
      /type\s+(\w+)\s+interface/g,
    ],
    imports: [
      /import\s+(?:\(\s*)?["']([^"']+)["']/g,
    ],
    exports: [],
  },
  java: {
    functions: [
      /(?:public|private|protected|static|final|abstract|synchronized|native)\s+[\w<>\[\]]+\s+(\w+)\s*\(/g,
    ],
    classes: [
      /(?:public|private|protected)\s+(?:static\s+)?(?:abstract\s+)?(?:class|interface|enum)\s+(\w+)/g,
    ],
    imports: [
      /import\s+([\w.]+);/g,
    ],
    exports: [],
  },
  rb: {
    functions: [
      /def\s+(self\.)?(\w+)/g,
    ],
    classes: [
      /class\s+(\w+)/g,
      /module\s+(\w+)/g,
    ],
    imports: [
      /require\s+['"]([^'"]+)['"]/g,
      /require_relative\s+['"]([^'"]+)['"]/g,
    ],
    exports: [],
  },
};

function extractSymbols(content, lang) {
  const patterns = PATTERNS[lang];
  if (!patterns) return { functions: [], classes: [], imports: [], exports: [] };

  const extract = (regexes) => {
    const found = new Set();
    for (const re of regexes) {
      const regex = new RegExp(re.source, re.flags);
      let match;
      while ((match = regex.exec(content)) !== null) {
        // For functions with named captures, prefer first group
        const name = match[1] || match[2];
        if (name && !name.startsWith('_') && name !== 'if' && name !== 'for' && name !== 'while') {
          found.add(name);
        }
      }
    }
    return Array.from(found).sort();
  };

  return {
    functions: extract(patterns.functions),
    classes: extract(patterns.classes),
    imports: extract(patterns.imports),
    exports: extract(patterns.exports),
  };
}

function buildReverseIndex(fileSymbols) {
  // symbol -> [{ file, type }]
  const index = {};
  for (const [file, symbols] of Object.entries(fileSymbols)) {
    for (const fn of symbols.functions) {
      if (!index[fn]) index[fn] = [];
      index[fn].push({ file, type: 'function' });
    }
    for (const cls of symbols.classes) {
      if (!index[cls]) index[cls] = [];
      index[cls].push({ file, type: 'class' });
    }
  }
  return index;
}

module.exports = {
  name: "repo_map",
  description: "Build a code structure map: functions, classes, imports, exports across all source files. Shows which files define and use each symbol. Use on large projects to understand code structure without reading every file.",
  parameters: {
    type: "object",
    properties: {
      path: {
        type: "string",
        description: "Project root to scan (optional, defaults to current directory)."
      },
      max_depth: {
        type: "integer",
        description: "Max directory depth to scan (default 4)."
      },
      include_tests: {
        type: "boolean",
        description: "Whether to include test files in the map (default true)."
      }
    }
  },
  async execute(params = {}) {
    try {
      const { path: cwd = '.', max_depth = 4, include_tests = true } = params;
      const projectDir = path.resolve(cwd);

      if (!fs.existsSync(projectDir)) {
        return `Error: Directory not found: ${projectDir}`;
      }

      // Find all source files
      const pattern = `${projectDir}/**/*{${Object.keys(SOURCE_EXTENSIONS).join(',')}}`;
      const allFiles = await glob(pattern, {
        ignore: ['**/node_modules/**', '**/.git/**', '**/dist/**', '**/build/**', '**/__pycache__/**', '**/target/**', '**/venv/**', '**/.venv/**'],
        maxDepth: max_depth,
      });

      // Filter test files if needed
      const files = include_tests ? allFiles : allFiles.filter(f => !f.match(/\.(test|spec|_test|_spec)\./));

      if (files.length === 0) {
        return "No source files found. Check the project path and directory depth.";
      }

      // Extract symbols from each file
      const fileSymbols = {};
      for (const file of files.slice(0, 2000)) { // cap at 2000 files
        try {
          const ext = path.extname(file).toLowerCase();
          const lang = SOURCE_EXTENSIONS[ext];
          if (!lang) continue;

          const content = fs.readFileSync(file, 'utf8');
          const symbols = extractSymbols(content, lang);

          if (symbols.functions.length > 0 || symbols.classes.length > 0) {
            const relPath = path.relative(projectDir, file);
            fileSymbols[relPath] = symbols;
          }
        } catch (e) {
          // Skip unreadable files
        }
      }

      // Build reverse index
      const reverseIndex = buildReverseIndex(fileSymbols);

      // Build output
      const out = [];
      out.push(`[Repo Map: ${projectDir}]`);
      out.push(`\n${files.length} source files scanned, ${Object.keys(fileSymbols).length} with definitions`);
      out.push('');

      // Per-file summary
      out.push('## Files with Definitions\n');
      for (const [file, symbols] of Object.entries(fileSymbols).sort((a, b) => a[0].localeCompare(b[0]))) {
        const fns = symbols.functions.length ? ` functions: ${symbols.functions.join(', ')}` : '';
        const cls = symbols.classes.length ? ` classes: ${symbols.classes.join(', ')}` : '';
        if (fns || cls) {
          out.push(`  ${file}:${fns}${cls}`);
        }
      }

      // Shared symbols (used in 2+ files)
      out.push('\n## Shared Symbols (defined in 2+ files)\n');
      const shared = Object.entries(reverseIndex)
        .filter(([_, locations]) => locations.length >= 2)
        .sort((a, b) => b[1].length - a[1].length);

      if (shared.length === 0) {
        out.push('  (none found)');
      } else {
        for (const [symbol, locations] of shared.slice(0, 50)) {
          const files = locations.map(l => l.file).join(', ');
          out.push(`  ${symbol} (${locations[0].type}): ${files}`);
        }
      }

      // Import graph summary
      out.push('\n## Import Graph (who imports what)\n');
      const importCounts = {};
      for (const [file, symbols] of Object.entries(fileSymbols)) {
        for (const imp of symbols.imports) {
          if (!importCounts[imp]) importCounts[imp] = [];
          importCounts[imp].push(file);
        }
      }
      const topImports = Object.entries(importCounts)
        .sort((a, b) => b[1].length - a[1].length)
        .slice(0, 30);
      for (const [imp, importers] of topImports) {
        if (importers.length >= 2) {
          out.push(`  ${imp} <- ${importers.length} files: ${importers.slice(0, 5).join(', ')}${importers.length > 5 ? '...' : ''}`);
        }
      }

      out.push('');
      return out.join('\n');
    } catch (err) {
      return `Error in repo_map: ${err.message}`;
    }
  }
};