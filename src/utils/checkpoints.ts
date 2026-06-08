// @ts-nocheck
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const CHECKPOINTS_DIR = path.join(process.cwd(), 'ds_config', 'checkpoints');

let lastRevertedCheckpoint = null;

function getModifiedFiles() {
  try {
    const output = execSync('git status --porcelain', { stdio: 'pipe' }).toString();
    const files = [];
    const lines = output.split('\n');
    for (const line of lines) {
      if (!line.trim()) continue;
      // Format is XY path or XY "path"
      const filePath = line.substring(3).trim().replace(/^['"]|['"]$/g, '');
      if (filePath && !filePath.startsWith('ds_config/') && !filePath.startsWith('scratch/')) {
        files.push(filePath);
      }
    }
    return files;
  } catch (err) {
    return [];
  }
}

function createCheckpoint(userPrompt) {
  try {
    if (!fs.existsSync(CHECKPOINTS_DIR)) {
      fs.mkdirSync(CHECKPOINTS_DIR, { recursive: true });
    }

    const files = getModifiedFiles();
    const id = 'cp_' + Date.now();
    const cpDir = path.join(CHECKPOINTS_DIR, id);
    fs.mkdirSync(cpDir, { recursive: true });

    // Copy each modified/untracked file
    for (const f of files) {
      const src = path.join(process.cwd(), f);
      const dest = path.join(cpDir, 'files', f);
      if (fs.existsSync(src) && fs.statSync(src).isFile()) {
        const destDir = path.dirname(dest);
        if (!fs.existsSync(destDir)) fs.mkdirSync(destDir, { recursive: true });
        fs.copyFileSync(src, dest);
      }
    }

    const meta = {
      id,
      timestamp: new Date().toISOString(),
      userPrompt,
      files
    };

    fs.writeFileSync(path.join(cpDir, 'meta.json'), JSON.stringify(meta, null, 2), 'utf8');
    return meta;
  } catch (err) {
    fs.appendFileSync('/tmp/deepseek-cli-debug.log', `[checkpoints] Error creating checkpoint: ${err.message}\n`);
    return null;
  }
}

function listCheckpoints() {
  try {
    if (!fs.existsSync(CHECKPOINTS_DIR)) return [];
    const dirs = fs.readdirSync(CHECKPOINTS_DIR);
    const list = [];
    for (const d of dirs) {
      const metaPath = path.join(CHECKPOINTS_DIR, d, 'meta.json');
      if (fs.existsSync(metaPath)) {
        try {
          const meta = JSON.parse(fs.readFileSync(metaPath, 'utf8'));
          list.push(meta);
        } catch (e) {}
      }
    }
    return list.sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
  } catch (err) {
    return [];
  }
}

function revertToCheckpoint(id) {
  try {
    const cpDir = path.join(CHECKPOINTS_DIR, id);
    if (!fs.existsSync(cpDir)) {
      throw new Error(`Checkpoint ${id} not found.`);
    }
    const meta = JSON.parse(fs.readFileSync(path.join(cpDir, 'meta.json'), 'utf8'));

    // 1. Revert current changes using git
    try {
      execSync('git reset --hard HEAD', { stdio: 'pipe' });
      execSync('git clean -fd', { stdio: 'pipe' });
    } catch (e) {}

    // 2. Restore files from the checkpoint
    const filesDir = path.join(cpDir, 'files');
    if (fs.existsSync(filesDir)) {
      function copyRecursive(src, dest) {
        const stats = fs.statSync(src);
        if (stats.isDirectory()) {
          if (!fs.existsSync(dest)) fs.mkdirSync(dest, { recursive: true });
          fs.readdirSync(src).forEach(child => {
            copyRecursive(path.join(src, child), path.join(dest, child));
          });
        } else {
          const destDir = path.dirname(dest);
          if (!fs.existsSync(destDir)) fs.mkdirSync(destDir, { recursive: true });
          fs.copyFileSync(src, dest);
        }
      }
      copyRecursive(filesDir, process.cwd());
    }

    lastRevertedCheckpoint = meta;
    return meta;
  } catch (err) {
    throw new Error(`Failed to revert to checkpoint: ${err.message}`);
  }
}

function getLastRevertedCheckpointInfo() {
  const info = lastRevertedCheckpoint;
  lastRevertedCheckpoint = null;
  return info;
}

module.exports = {
  createCheckpoint,
  listCheckpoints,
  revertToCheckpoint,
  getLastRevertedCheckpointInfo
};
