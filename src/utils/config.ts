// @ts-nocheck
const fs = require('fs');
const path = require('path');
const os = require('os');
const { AsyncLocalStorage } = require('async_hooks');

const subAgentStorage = new AsyncLocalStorage();

const DS_CONFIG_DIR = path.join(os.homedir(), '.deepseek_cli', 'ds_config');
const CONFIG_PATH = path.join(DS_CONFIG_DIR, 'config.json');


function ensureConfigDir() {
  if (!fs.existsSync(DS_CONFIG_DIR)) {
    fs.mkdirSync(DS_CONFIG_DIR, { recursive: true });
  }
  const subdirs = ['backups', 'sessions'];
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
    allow_self_modification: true,
    allowed_directories: [],
    blocked_commands: [],
    max_tool_output_length: 4000,
    verification_commands: []
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

function getBackupsPath() {
  const store = subAgentStorage.getStore();
  if (store && store.subAgentDir) {
    const subAgentBackups = path.join(store.subAgentDir, 'backups');
    if (!fs.existsSync(subAgentBackups)) fs.mkdirSync(subAgentBackups, { recursive: true });
    return subAgentBackups;
  }
  ensureConfigDir();
  const backupsDir = path.join(DS_CONFIG_DIR, 'backups');
  if (!fs.existsSync(backupsDir)) fs.mkdirSync(backupsDir, { recursive: true });
  return backupsDir;
}

function resolveSubAgentPath(filePath) {
  if (!filePath || typeof filePath !== 'string') return filePath;
  const store = subAgentStorage.getStore();
  if (store && store.subAgentDir) {
    const filename = path.basename(filePath);
    const resolved = path.resolve(filePath);
    const relative = path.relative(process.cwd(), resolved);

    // Redirect implementation plan and task lists
    if (filename === 'implementation_plan.md' || filename === 'task.md') {
      return path.join(store.subAgentDir, filename);
    }
    
    // Redirect scratch files
    if (relative.includes('scratch') || filePath.includes('scratch')) {
      return path.join(store.subAgentDir, 'scratch', filename);
    }
  }
  return filePath;
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
  getBackupsPath,
  getSessionsPath,
  DS_CONFIG_DIR,
  CONFIG_PATH,
  subAgentStorage,
  resolveSubAgentPath
};
