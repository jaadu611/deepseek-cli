// @ts-nocheck
const { exec } = require('child_process');
const fs = require('fs');
const path = require('path');

function detectLinter(cwd) {
  const configFiles = {
    eslint: ['.eslintrc.js', '.eslintrc.json', '.eslintrc.yml', '.eslintrc', 'eslint.config.js', 'eslint.config.mjs'],
    prettier: ['.prettierrc', '.prettierrc.json', 'prettier.config.js'],
    pylint: ['.pylintrc', 'pylintrc'],
    ruff: ['ruff.toml', 'pyproject.toml'],
    clippy: ['Cargo.toml'],
    golint: ['go.mod'],
    tsc: ['tsconfig.json']
  };

  for (const [linter, files] of Object.entries(configFiles)) {
    for (const file of files) {
      if (fs.existsSync(path.join(cwd, file))) {
        return linter;
      }
    }
  }

  // Check for node_modules eslint
  if (fs.existsSync(path.join(cwd, 'node_modules', '.bin', 'eslint'))) {
    return 'eslint';
  }

  return null;
}

function runCommand(command, cwd, timeout) {
  return new Promise((resolve) => {
    const options = {
      timeout: timeout || 30000,
      shell: process.env.SHELL || '/bin/sh',
      maxBuffer: 10 * 1024 * 1024,
      cwd: cwd || process.cwd()
    };
    exec(command, options, (error, stdout, stderr) => {
      const output = [];
      if (stdout) output.push(stdout);
      if (stderr) output.push(stderr);
      if (error && !stdout) output.push(error.message);
      resolve({
        exitCode: error ? error.code || 1 : 0,
        output: output.join('\n') || '(no output)'
      });
    });
  });
}

module.exports = {
  name: "lint_code",
  description: "Run the project's linter on files. Auto-detects linter (eslint, prettier, pylint, ruff, clippy, golint, tsc). Returns errors and warnings. Use fix=true to auto-fix issues.",
  parameters: {
    type: "object",
    properties: {
      path: {
        type: "string",
        description: "File or directory to lint (optional, defaults to project root)."
      },
      fix: {
        type: "boolean",
        description: "Whether to auto-fix issues (default false). Only works with eslint, prettier, ruff, clippy."
      },
      framework: {
        type: "string",
        description: "Force a specific linter: eslint, prettier, pylint, ruff, clippy, golint, tsc. Auto-detected if not provided."
      },
      timeout: {
        type: "integer",
        description: "Timeout in milliseconds (default 30000)."
      },
      cwd: {
        type: "string",
        description: "Working directory (optional, defaults to project root)."
      }
    }
  },
  async execute(params = {}) {
    try {
      const { path: targetPath, fix, framework, timeout, cwd } = params;
      const projectDir = cwd || process.cwd();
      const target = targetPath || '.';

      // Detect or use specified linter
      let linter = framework || detectLinter(projectDir);
      if (!linter) {
        return "Error: Could not auto-detect linter. No .eslintrc, .prettierrc, .pylintrc, ruff.toml, Cargo.toml, go.mod, or tsconfig.json found. Use the 'framework' parameter to specify one.";
      }

      let command = '';
      switch (linter) {
        case 'eslint':
          command = fix ? `npx eslint --fix "${target}"` : `npx eslint "${target}"`;
          break;
        case 'prettier':
          command = fix ? `npx prettier --write "${target}"` : `npx prettier --check "${target}"`;
          break;
        case 'pylint':
          command = `python -m pylint "${target}"`;
          break;
        case 'ruff':
          command = fix ? `ruff check --fix "${target}"` : `ruff check "${target}"`;
          break;
        case 'clippy':
          command = fix ? `cargo clippy --fix` : `cargo clippy`;
          break;
        case 'golint':
          command = `golangci-lint run "${target}"`;
          break;
        case 'tsc':
          command = `npx tsc --noEmit`;
          break;
        default:
          return `Error: Unknown linter '${linter}'.`;
      }

      const result = await runCommand(command, projectDir, timeout || 30000);

      // Parse output for error/warning counts
      const output = result.output;
      const errorCount = (output.match(/error/gi) || []).length;
      const warningCount = (output.match(/warning/gi) || []).length;

      let summary = `Linter: ${linter}`;
      if (fix) summary += ' (auto-fix applied)';
      summary += `\nCommand: ${command}\n`;
      summary += `Status: ${result.exitCode === 0 ? 'NO ERRORS' : 'ERRORS FOUND'}`;
      if (errorCount) summary += ` | ${errorCount} errors`;
      if (warningCount) summary += ` | ${warningCount} warnings`;

      return `## Lint Results\n${summary}\n\n\`\`\`\n${output.slice(-3000)}\n\`\`\``;
    } catch (err) {
      return `Error in lint_code: ${err.message}`;
    }
  }
};