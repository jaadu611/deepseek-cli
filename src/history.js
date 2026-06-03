const fs = require('fs');
const path = require('path');
const { getSessionsPath } = require('./utils/config');

const HISTORY_DIR = getSessionsPath();
const SESSIONS_DIR = HISTORY_DIR;
const SESSIONS_INDEX = path.join(HISTORY_DIR, 'sessions.json');

let currentSessionId = null;

function getGitignorePath() {
  try {
    const cwd = process.cwd();
    return path.join(cwd, '.gitignore');
  } catch (err) {
    return null;
  }
}

function initHistory() {
  // No migration needed; all data now lives in global ~/.deepseek_cli/ds_config
  if (!fs.existsSync(HISTORY_DIR)) fs.mkdirSync(HISTORY_DIR, { recursive: true });
  if (!fs.existsSync(SESSIONS_DIR)) fs.mkdirSync(SESSIONS_DIR, { recursive: true });
  if (!fs.existsSync(SESSIONS_INDEX)) fs.writeFileSync(SESSIONS_INDEX, '[]', 'utf8');
  
  const gitignorePath = getGitignorePath();
  if (gitignorePath && fs.existsSync(gitignorePath)) {
    try {
      const ignoreContent = fs.readFileSync(gitignorePath, 'utf8');
      if (!ignoreContent.includes('ds_config/')) {
        fs.appendFileSync(gitignorePath, '\n# Deepseek CLI local data\nds_config/\nscratch/\n');
      }
    } catch (err) {
      // ignore errors updating .gitignore
    }
  }
}

function getSessions() {
  initHistory();
  try {
    const data = fs.readFileSync(SESSIONS_INDEX, 'utf8');
    if (!data.trim()) return [];
    return JSON.parse(data);
  } catch (err) {
    try {
      if (fs.existsSync(SESSIONS_INDEX)) {
        const backupName = `sessions.json.corrupted.${Date.now()}`;
        fs.renameSync(SESSIONS_INDEX, path.join(path.dirname(SESSIONS_INDEX), backupName));
      }
    } catch (e) {}
    return [];
  }
}

function saveSessions(sessions) {
  const tempPath = SESSIONS_INDEX + '.tmp';
  try {
    fs.writeFileSync(tempPath, JSON.stringify(sessions, null, 2), 'utf8');
    fs.renameSync(tempPath, SESSIONS_INDEX);
  } catch (err) {
    fs.writeFileSync(SESSIONS_INDEX, JSON.stringify(sessions, null, 2), 'utf8');
  }
}

function createSession(title = 'New Chat') {
  initHistory();
  const sessions = getSessions();
  const id = Date.now().toString(36) + Math.random().toString(36).substr(2, 5);
  const session = {
    id,
    deepseek_id: null,
    title,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString()
  };
  sessions.unshift(session);
  saveSessions(sessions);
  currentSessionId = id;
  return session;
}

function getCurrentSessionId() {
  return currentSessionId;
}

function setCurrentSessionId(id) {
  currentSessionId = id;
}

function updateSessionDeepseekId(sessionId, dsId) {
  const sessions = getSessions();
  const sess = sessions.find(s => s.id === sessionId);
  if (sess) {
    sess.deepseek_id = dsId;
    saveSessions(sessions);
  }
}

function updateSessionTitle(sessionId, title) {
  const sessions = getSessions();
  const sess = sessions.find(s => s.id === sessionId);
  if (sess) {
    sess.title = title;
    sess.updated_at = new Date().toISOString();
    saveSessions(sessions);
  }
}

function saveMessage(sessionId, role, content, metadata = {}) {
  if (!sessionId) return;
  const file = path.join(SESSIONS_DIR, `${sessionId}.jsonl`);
  const entry = {
    timestamp: new Date().toISOString(),
    role,
    content: typeof content === 'string' ? content : JSON.stringify(content),
    ...metadata
  };
  fs.appendFileSync(file, JSON.stringify(entry) + '\n', 'utf8');
  
  const sessions = getSessions();
  const sess = sessions.find(s => s.id === sessionId);
  if (sess) {
    sess.updated_at = new Date().toISOString();
    saveSessions(sessions);
  }
}

function loadSessionMessages(sessionId) {
  const file = path.join(SESSIONS_DIR, `${sessionId}.jsonl`);
  if (!fs.existsSync(file)) return [];
  const content = fs.readFileSync(file, 'utf8');
  return content.trim().split('\n').filter(Boolean).map(line => {
    try { return JSON.parse(line); } catch { return null; }
  }).filter(Boolean);
}

module.exports = {
  initHistory,
  createSession,
  getCurrentSessionId,
  setCurrentSessionId,
  updateSessionDeepseekId,
  updateSessionTitle,
  saveMessage,
  loadSessionMessages,
  getSessions
};
