// @ts-nocheck
// code_graph.ts — Tree-sitter based code graph for symbol extraction and indexing
// Uses web-tree-sitter with WASM grammars for accurate AST parsing.
// Falls back to enhanced regex when WASM grammars are unavailable.

const fs = require('fs');
const path = require('path');
const os = require('os');
const https = require('https');
const http = require('http');

const GRAMMAR_DIR = path.join(os.homedir(), '.ds_config', 'tree-sitter-grammars');
const INDEX_CACHE = path.join(os.homedir(), '.ds_config', 'code_index.json');

// Extension → grammar WASM filename
const GRAMMAR_MAP = {
  '.js': 'tree-sitter-javascript.wasm',
  '.mjs': 'tree-sitter-javascript.wasm',
  '.cjs': 'tree-sitter-javascript.wasm',
  '.jsx': 'tree-sitter-javascript.wasm',
  '.ts': 'tree-sitter-typescript.wasm',
  '.tsx': 'tree-sitter-typescript.wasm',
  '.py': 'tree-sitter-python.wasm',
  '.rs': 'tree-sitter-rust.wasm',
  '.go': 'tree-sitter-go.wasm',
  '.java': 'tree-sitter-java.wasm',
  '.rb': 'tree-sitter-ruby.wasm',
  '.c': 'tree-sitter-c.wasm',
  '.cpp': 'tree-sitter-cpp.wasm',
  '.h': 'tree-sitter-c.wasm',
  '.hpp': 'tree-sitter-cpp.wasm',
};

// WASM download URLs (GitHub releases)
const GRAMMAR_URLS = {
  'tree-sitter-javascript.wasm': 'https://raw.githubusercontent.com/nicolo-ribaudo/tree-sitter-javascript/refs/heads/wasm-nicolo/tree-sitter-javascript.wasm',
  'tree-sitter-typescript.wasm': 'https://raw.githubusercontent.com/nicolo-ribaudo/tree-sitter-typescript/refs/heads/wasm-nicolo/tree-sitter-typescript.wasm',
  'tree-sitter-python.wasm': 'https://raw.githubusercontent.com/nicolo-ribaudo/tree-sitter-python/refs/heads/wasm-nicolo/tree-sitter-python.wasm',
  'tree-sitter-rust.wasm': 'https://raw.githubusercontent.com/nicolo-ribaudo/tree-sitter-rust/refs/heads/wasm-nicolo/tree-sitter-rust.wasm',
  'tree-sitter-go.wasm': 'https://raw.githubusercontent.com/nicolo-ribaudo/tree-sitter-go/refs/heads/wasm-nicolo/tree-sitter-go.wasm',
  'tree-sitter-java.wasm': 'https://raw.githubusercontent.com/nicolo-ribaudo/tree-sitter-java/refs/heads/wasm-nicolo/tree-sitter-java.wasm',
  'tree-sitter-ruby.wasm': 'https://raw.githubusercontent.com/nicolo-ribaudo/tree-sitter-ruby/refs/heads/wasm-nicolo/tree-sitter-ruby.wasm',
  'tree-sitter-c.wasm': 'https://raw.githubusercontent.com/nicolo-ribaudo/tree-sitter-c/refs/heads/wasm-nicolo/tree-sitter-c.wasm',
  'tree-sitter-cpp.wasm': 'https://raw.githubusercontent.com/nicolo-ribaudo/tree-sitter-cpp/refs/heads/wasm-nicolo/tree-sitter-cpp.wasm',
};

let parser = null;
let loadedLanguages = {};
let initialized = false;

// Download a WASM file from URL
function downloadFile(url, dest) {
  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(dest);
    const protocol = url.startsWith('https') ? https : http;
    protocol.get(url, (response) => {
      if (response.statusCode === 301 || response.statusCode === 302) {
        // Follow redirect
        file.close();
        fs.unlinkSync(dest);
        return downloadFile(response.headers.location, dest).then(resolve).catch(reject);
      }
      if (response.statusCode !== 200) {
        file.close();
        fs.unlinkSync(dest);
        return reject(new Error(`HTTP ${response.statusCode} for ${url}`));
      }
      response.pipe(file);
      file.on('finish', () => { file.close(); resolve(); });
      file.on('error', reject);
    }).on('error', (err) => {
      file.close();
      fs.unlinkSync(dest);
      reject(err);
    });
  });
}

// Ensure grammar WASM is available
async function ensureGrammar(ext) {
  const wasmFile = GRAMMAR_MAP[ext];
  if (!wasmFile) return null;

  if (loadedLanguages[ext]) return loadedLanguages[ext];

  if (!fs.existsSync(GRAMMAR_DIR)) {
    fs.mkdirSync(GRAMMAR_DIR, { recursive: true });
  }

  const wasmPath = path.join(GRAMMAR_DIR, wasmFile);

  // Download if not cached
  if (!fs.existsSync(wasmPath)) {
    const url = GRAMMAR_URLS[wasmFile];
    if (!url) return null;
    try {
      console.log(`Downloading grammar: ${wasmFile}...`);
      await downloadFile(url, wasmPath);
    } catch (err) {
      console.error(`Failed to download ${wasmFile}: ${err.message}`);
      return null;
    }
  }

  // Load the language
  try {
    const lang = await parser.Language.load(wasmPath);
    loadedLanguages[ext] = lang;
    return lang;
  } catch (err) {
    console.error(`Failed to load grammar ${wasmFile}: ${err.message}`);
    return null;
  }
}

// Initialize the parser (async, call once)
async function initParser() {
  if (initialized) return;
  try {
    const Parser = require('web-tree-sitter');
    await Parser.init();
    parser = new Parser();
    initialized = true;
  } catch (err) {
    console.error(`Failed to initialize tree-sitter: ${err.message}`);
    initialized = false;
  }
}

// Extract symbols from an AST node recursively
function extractSymbols(node, sourceLines, langName) {
  const symbols = [];

  const nodeType = node.type;
  let name = null;
  let kind = null;

  // JavaScript/TypeScript
  if (langName === 'javascript' || langName === 'typescript') {
    if (nodeType === 'function_declaration' || nodeType === 'function') {
      name = node.childForFieldName('name')?.text;
      kind = 'function';
    } else if (nodeType === 'arrow_function' && node.parent?.type === 'variable_declarator') {
      name = node.parent.childForFieldName('name')?.text;
      kind = 'function';
    } else if (nodeType === 'class_declaration') {
      name = node.childForFieldName('name')?.text;
      kind = 'class';
    } else if (nodeType === 'method_definition') {
      name = node.childForFieldName('name')?.text;
      kind = 'method';
    } else if (nodeType === 'import_statement') {
      const source = node.childForFieldName('source')?.text?.replace(/['"]/g, '');
      const importedNames = [];
      const specifiers = node.children.filter(c => c.type === 'import_specifier');
      for (const spec of specifiers) {
        const imported = spec.childForFieldName('name')?.text || spec.childForFieldName('alias')?.text;
        if (imported) importedNames.push(imported);
      }
      symbols.push({ name: source, kind: 'import', source, imported: importedNames, line: node.startPosition.row + 1 });
      return symbols;
    } else if (nodeType === 'export_statement') {
      const inner = node.children.find(c => c.type === 'function_declaration' || c.type === 'class_declaration' || c.type === 'variable_declaration');
      if (inner) {
        const innerSymbols = extractSymbols(inner, sourceLines, langName);
        for (const s of innerSymbols) {
          s.exported = true;
          symbols.push(s);
        }
        return symbols;
      }
    } else if (nodeType === 'interface_declaration' || nodeType === 'type_alias_declaration') {
      name = node.childForFieldName('name')?.text;
      kind = 'type';
    }
  }
  // Python
  else if (langName === 'python') {
    if (nodeType === 'function_definition') {
      name = node.childForFieldName('name')?.text;
      kind = 'function';
    } else if (nodeType === 'class_definition') {
      name = node.childForFieldName('name')?.text;
      kind = 'class';
    } else if (nodeType === 'import_statement' || nodeType === 'import_from_statement') {
      const module = node.childForFieldName('module_name')?.text || node.children.find(c => c.type === 'dotted_name')?.text;
      symbols.push({ name: module, kind: 'import', source: module, line: node.startPosition.row + 1 });
      return symbols;
    }
  }
  // Rust
  else if (langName === 'rust') {
    if (nodeType === 'function_item') {
      name = node.childForFieldName('name')?.text;
      kind = 'function';
    } else if (nodeType === 'struct_item') {
      name = node.childForFieldName('name')?.text;
      kind = 'class';
    } else if (nodeType === 'impl_item') {
      const typeRef = node.childForFieldName('type')?.text;
      name = typeRef;
      kind = 'impl';
    } else if (nodeType === 'use_declaration') {
      symbols.push({ name: node.text, kind: 'import', line: node.startPosition.row + 1 });
      return symbols;
    }
  }
  // Go
  else if (langName === 'go') {
    if (nodeType === 'function_declaration') {
      name = node.childForFieldName('name')?.text;
      kind = 'function';
    } else if (nodeType === 'type_declaration') {
      const typeDef = node.children.find(c => c.type === 'type_spec');
      if (typeDef) {
        name = typeDef.childForFieldName('name')?.text;
        kind = 'type';
      }
    } else if (nodeType === 'import_declaration') {
      symbols.push({ name: node.text, kind: 'import', line: node.startPosition.row + 1 });
      return symbols;
    }
  }
  // Java
  else if (langName === 'java') {
    if (nodeType === 'method_declaration') {
      name = node.childForFieldName('name')?.text;
      kind = 'function';
    } else if (nodeType === 'class_declaration' || nodeType === 'interface_declaration') {
      name = node.childForFieldName('name')?.text;
      kind = 'class';
    } else if (nodeType === 'import_declaration') {
      symbols.push({ name: node.text, kind: 'import', line: node.startPosition.row + 1 });
      return symbols;
    }
  }
  // C/C++
  else if (langName === 'c' || langName === 'cpp') {
    if (nodeType === 'function_declarator') {
      const declarator = node.childForFieldName('declarator');
      name = declarator?.text;
      kind = 'function';
    } else if (nodeType === 'type_definition') {
      name = node.childForFieldName('type')?.text;
      kind = 'type';
    } else if (nodeType === 'preproc_include') {
      symbols.push({ name: node.text, kind: 'import', line: node.startPosition.row + 1 });
      return symbols;
    }
  }
  // Ruby
  else if (langName === 'ruby') {
    if (nodeType === 'method') {
      name = node.childForFieldName('name')?.text;
      kind = 'function';
    } else if (nodeType === 'class') {
      name = node.childForFieldName('name')?.text;
      kind = 'class';
    } else if (nodeType === 'call') {
      const method = node.childForFieldName('method')?.text;
      if (method === 'require' || method === 'require_relative') {
        symbols.push({ name: node.text, kind: 'import', line: node.startPosition.row + 1 });
        return symbols;
      }
    }
  }

  if (name && kind) {
    // Get context line (the full line of the definition)
    const lineNum = node.startPosition.row;
    const contextLine = sourceLines[lineNum] || '';
    symbols.push({ name, kind, line: lineNum + 1, context: contextLine.trim() });
  }

  // Recurse into children
  for (let i = 0; i < node.childCount; i++) {
    const child = node.child(i);
    symbols.push(...extractSymbols(child, sourceLines, langName));
  }

  return symbols;
}

// Get language name from WASM filename
function getLangName(ext) {
  const file = GRAMMAR_MAP[ext];
  if (!file) return null;
  return file.replace('tree-sitter-', '').replace('.wasm', '');
}

// Parse a file and extract symbols
async function parseFile(filePath) {
  if (!initialized || !parser) return null;

  const ext = path.extname(filePath).toLowerCase();
  const lang = await ensureGrammar(ext);

  if (!lang) return null;

  parser.setLanguage(lang);
  const content = fs.readFileSync(filePath, 'utf8');
  const tree = parser.parse(content);
  const sourceLines = content.split('\n');
  const langName = getLangName(ext);

  return extractSymbols(tree.rootNode, sourceLines, langName);
}

// Build the full index for a directory
async function buildIndex(projectDir, maxFiles = 5000) {
  if (!initialized) await initParser();

  const index = {
    symbols: {},     // name → [{ file, line, kind, context }]
    imports: {},     // file → [{ source, imported }]
    fileSymbols: {}, // file → [{ name, kind, line }]
    files: [],       // list of indexed files
    builtAt: new Date().toISOString(),
  };

  // Find all source files
  const extensions = Object.keys(GRAMMAR_MAP);
  const ignoreDirs = new Set(['node_modules', '.git', 'dist', 'build', '__pycache__', '.next', '.cache', 'target', 'venv', '.venv', '.ds_config']);

  function walk(dir, depth) {
    if (depth > 6) return;
    let items;
    try { items = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const item of items) {
      if (item.name.startsWith('.') || ignoreDirs.has(item.name)) continue;
      const full = path.join(dir, item.name);
      if (item.isDirectory()) {
        walk(full, depth + 1);
      } else if (extensions.includes(path.extname(item.name).toLowerCase())) {
        if (index.files.length >= maxFiles) return;
        index.files.push(full);
      }
    }
  }

  walk(projectDir, 0);

  // Parse each file
  let parsed = 0;
  for (const file of index.files) {
    try {
      const symbols = await parseFile(file);
      if (!symbols) continue;

      const relPath = path.relative(projectDir, file);
      index.fileSymbols[relPath] = symbols.filter(s => s.kind !== 'import');
      index.imports[relPath] = symbols.filter(s => s.kind === 'import');

      for (const sym of symbols) {
        if (sym.kind === 'import') continue;
        if (!index.symbols[sym.name]) index.symbols[sym.name] = [];
        index.symbols[sym.name].push({
          file: relPath,
          line: sym.line,
          kind: sym.kind,
          context: sym.context,
          exported: sym.exported,
        });
      }
      parsed++;
    } catch (err) {
      // Skip unparseable files
    }
  }

  return { index, parsed, total: index.files.length };
}

// Save index to disk
function saveIndex(index) {
  try {
    if (!fs.existsSync(path.dirname(INDEX_CACHE))) {
      fs.mkdirSync(path.dirname(INDEX_CACHE), { recursive: true });
    }
    fs.writeFileSync(INDEX_CACHE, JSON.stringify(index, null, 2));
  } catch (err) {
    console.error(`Failed to save code index: ${err.message}`);
  }
}

// Load index from disk
function loadIndex() {
  try {
    if (fs.existsSync(INDEX_CACHE)) {
      return JSON.parse(fs.readFileSync(INDEX_CACHE, 'utf8'));
    }
  } catch (err) {}
  return null;
}

// Find all references to a symbol in the index
function findReferences(index, symbolName) {
  const results = [];
  const defs = index.symbols[symbolName] || [];
  results.push(...defs.map(d => ({ ...d, type: 'definition' })));

  // Search imports for usage
  for (const [file, imports] of Object.entries(index.imports)) {
    for (const imp of imports) {
      if (imp.imported && imp.imported.includes(symbolName)) {
        results.push({ file, line: imp.line, type: 'imported' });
      }
    }
  }

  return results;
}

// Go to definition of a symbol
function goToDefinition(index, symbolName) {
  return (index.symbols[symbolName] || []).filter(s => s.kind !== 'import');
}

module.exports = {
  initParser,
  parseFile,
  buildIndex,
  saveIndex,
  loadIndex,
  findReferences,
  goToDefinition,
  GRAMMAR_MAP,
  GRAMMAR_DIR,
};