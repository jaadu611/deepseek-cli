const fs = require('fs');
const path = require('path');
const os = require('os');

const DS_CONFIG_DIR = path.join(os.homedir(), '.deepseek_cli', 'ds_config');
const CONFIG_PATH = path.join(DS_CONFIG_DIR, 'config.json');
const CONTEXT_CACHE_PATH = path.join(DS_CONFIG_DIR, 'context_cache.json');

function ensureConfigDir() {
  if (!fs.existsSync(DS_CONFIG_DIR)) {
    fs.mkdirSync(DS_CONFIG_DIR, { recursive: true });
  }
  const subdirs = ['scratch', 'backups', 'sessions'];
  for (const sub of subdirs) {
    const subPath = path.join(DS_CONFIG_DIR, sub);
    if (!fs.existsSync(subPath)) {
      fs.mkdirSync(subPath, { recursive: true });
    }
  }
  return DS_CONFIG_DIR;
}

function loadConfig() {
  ensureConfigDir();
  const defaults = {
    allowed_directories: [],
    blocked_commands: [],
    max_tool_output_length: 4000
  };
  if (fs.existsSync(CONFIG_PATH)) {
    try {
      const userConfig = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
      return { ...defaults, ...userConfig };
    } catch(e) {
      return defaults;
    }
  }
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(defaults, null, 2), 'utf8');
  return defaults;
}

function saveConfig(config) {
  ensureConfigDir();
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2), 'utf8');
}

function getScratchPath(subpath = '') {
  ensureConfigDir();
  const scratchDir = path.join(DS_CONFIG_DIR, 'scratch');
  if (!fs.existsSync(scratchDir)) fs.mkdirSync(scratchDir, { recursive: true });
  if (subpath) {
    const fullPath = path.join(scratchDir, subpath);
    const dir = path.dirname(fullPath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    return fullPath;
  }
  return scratchDir;
}

function getBackupsPath() {
  ensureConfigDir();
  const backupsDir = path.join(DS_CONFIG_DIR, 'backups');
  if (!fs.existsSync(backupsDir)) fs.mkdirSync(backupsDir, { recursive: true });
  return backupsDir;
}

function getSessionsPath() {
  ensureConfigDir();
  const sessionsDir = path.join(DS_CONFIG_DIR, 'sessions');
  if (!fs.existsSync(sessionsDir)) fs.mkdirSync(sessionsDir, { recursive: true });
  return sessionsDir;
}

module.exports = {
  ensureConfigDir,
  loadConfig,
  saveConfig,
  getScratchPath,
  getBackupsPath,
  getSessionsPath,
  DS_CONFIG_DIR,
  CONFIG_PATH,
  CONTEXT_CACHE_PATH
};
