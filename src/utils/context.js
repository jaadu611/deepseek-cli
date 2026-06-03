const fs = require('fs');
const { CONTEXT_CACHE_PATH, ensureConfigDir } = require('./config');

let contextCache = [];

function loadContext() {
  ensureConfigDir();
  if (fs.existsSync(CONTEXT_CACHE_PATH)) {
    try {
      const data = JSON.parse(fs.readFileSync(CONTEXT_CACHE_PATH, 'utf8'));
      contextCache = Array.isArray(data) ? data : [];
    } catch (e) { contextCache = []; }
  } else {
    contextCache = [];
  }
  return contextCache;
}

function saveContext() {
  ensureConfigDir();
  fs.writeFileSync(CONTEXT_CACHE_PATH, JSON.stringify(contextCache.slice(-100), null, 2), 'utf8');
}

function recordContext(entry) {
  if (!entry || typeof entry !== 'string') return;
  loadContext();
  if (!contextCache.includes(entry)) {
    contextCache.push(entry);
    saveContext();
  }
}

function getContextSummary() {
  loadContext();
  if (contextCache.length === 0) return '';
  return `\n\n[Recent Context]\n${contextCache.slice(-20).map(p => `- ${p}`).join('\n')}`;
}

function clearContext() {
  contextCache = [];
  saveContext();
}

module.exports = { recordContext, getContextSummary, clearContext };
