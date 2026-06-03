#!/usr/bin/env node

const fs = require("fs");
// Create mcp-sandbox directory at startup
fs.mkdirSync("/tmp/mcp-sandbox", { recursive: true });

const cli = require("./src/cli");

if (require.main === module) {
  Promise.resolve(cli.main()).catch(console.error);
} else {
  // Backwards compatibility for exports if needed
  const tui = require("./src/tui");
  module.exports = {
    renderMd: tui.renderMd,
    wrapText: tui.wrapText,
    inline: tui.inline,
    C: tui.C,
    R: tui.R,
  };
}