#!/usr/bin/env node
// @ts-nocheck

const fs = require("fs");
// Create mcp-sandbox directory at startup
fs.mkdirSync("/tmp/mcp-sandbox", { recursive: true });

const cli = require("./src/cli/cli");

process.on('uncaughtException', (err) => {
  const fs = require('fs');
  fs.appendFileSync('/tmp/deepseek-cli-crash.log', `Uncaught Exception: ${err.stack}\n`);
  console.error('Fatal error, check /tmp/deepseek-cli-crash.log');
  process.exit(1);
});

process.on('unhandledRejection', (reason) => {
  const fs = require('fs');
  fs.appendFileSync('/tmp/deepseek-cli-crash.log', `Unhandled Rejection: ${reason}\n`);
  console.error('Unhandled rejection, check /tmp/deepseek-cli-crash.log');
});

if (require.main === module) {
  Promise.resolve(cli.main()).catch((err) => {
    const fs = require('fs');
    fs.appendFileSync('/tmp/deepseek-cli-crash.log', `Main error: ${err.stack}\n`);
    console.error('CLI crashed, see /tmp/deepseek-cli-crash.log');
  });
} else {
  // Backwards compatibility for exports if needed
  const tui = require("./src/tui/tui");
  module.exports = {
    renderMd: tui.renderMd,
    wrapText: tui.wrapText,
    inline: tui.inline,
    C: tui.C,
    R: tui.R,
  };
}