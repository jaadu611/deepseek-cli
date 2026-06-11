import * as fs from 'fs';
import * as path from 'path';

let cachedIgnoreLines: string[] | null = null;

export function getIgnorePatterns(): string[] {
  if (cachedIgnoreLines !== null) {
    return cachedIgnoreLines;
  }

  const dsignorePath = path.join(process.cwd(), '.dsignore');
  if (fs.existsSync(dsignorePath)) {
    try {
      const content = fs.readFileSync(dsignorePath, 'utf8');
      cachedIgnoreLines = content
        .split('\n')
        .map(line => line.trim())
        .filter(line => line && !line.startsWith('#'));
      return cachedIgnoreLines;
    } catch {
      return [];
    }
  }
  return [];
}

export function getGlobIgnorePatterns(): string[] {
  const patterns = getIgnorePatterns();
  const ignore = [
    '**/node_modules/**',
    '**/.git/**',
    '**/dist/**',
    '**/build/**',
    '**/.ds_config/**',
    '**/scratch/**'
  ];
  for (const p of patterns) {
    const clean = p.endsWith('/') ? p.slice(0, -1) : p;
    if (clean) {
      ignore.push(`**/${clean}/**`);
      ignore.push(`**/${clean}`);
    }
  }
  // De-duplicate patterns
  return Array.from(new Set(ignore));
}

export function shouldIgnore(filePath: string): boolean {
  const baseIgnore = ['node_modules', '.git', 'dist', 'build', '.ds_config', 'scratch', 'deepseek-chat-1.0.0.vsix'];
  const name = path.basename(filePath);
  if (baseIgnore.includes(name)) return true;

  const patterns = getIgnorePatterns();
  const relPath = path.relative(process.cwd(), filePath);
  
  for (const pattern of patterns) {
    const clean = pattern.endsWith('/') ? pattern.slice(0, -1) : pattern;
    if (relPath === clean || relPath.startsWith(clean + path.sep) || name === clean) {
      return true;
    }
  }
  return false;
}
