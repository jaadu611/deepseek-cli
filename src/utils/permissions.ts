// @ts-nocheck
const fs = require('fs');
const path = require('path');
const { loadConfig } = require('./config');

function isPathAllowed(requestedPath) {
  const config = loadConfig();
  const allowedDirs = config.allowed_directories;
  if (!allowedDirs || allowedDirs.length === 0) {
    // No restrictions
    return true;
  }
  const resolved = path.resolve(requestedPath);
  for (const allowed of allowedDirs) {
    const resolvedAllowed = path.resolve(allowed);
    if (resolved.startsWith(resolvedAllowed)) {
      return true;
    }
  }
  return false;
}

function isCommandAllowed(command) {
  const config = loadConfig();
  const blocked = config.blocked_commands;
  if (!blocked || blocked.length === 0) {
    return true;
  }
  for (const pattern of blocked) {
    try {
      const regex = new RegExp(pattern);
      if (regex.test(command)) {
        return false;
      }
    } catch(e) {
      // Invalid regex, skip
    }
  }
  return true;
}

function getPermissionErrorPath(path) {
  return `Error: Access denied - path outside allowed directories: ${path}`;
}

function getPermissionErrorCommand(command) {
  return `Error: Command blocked by configuration: ${command}`;
}

module.exports = {
  isPathAllowed,
  isCommandAllowed,
  getPermissionErrorPath,
  getPermissionErrorCommand
};
