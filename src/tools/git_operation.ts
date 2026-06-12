// @ts-nocheck
const { exec } = require('child_process');
const path = require('path');

function runGit(command, cwd) {
  return new Promise((resolve) => {
    const options = {
      timeout: 15000,
      shell: process.env.SHELL || '/bin/sh',
      maxBuffer: 5 * 1024 * 1024,
      ...(cwd && { cwd })
    };
    exec(`git ${command}`, options, (error, stdout, stderr) => {
      if (error && !stdout) {
        resolve(`Error: ${stderr || error.message}`);
      } else {
        resolve(stdout || stderr || '(no output)');
      }
    });
  });
}

module.exports = {
  name: "git_operation",
  description: "Run git commands with structured output. Actions: status, diff, log, branch, checkout, stash, stash_list, stash_pop. Use this to understand what changed, commit history, and manage branches. Read-only actions work in plan mode.",
  parameters: {
    type: "object",
    properties: {
      action: {
        type: "string",
        description: "Git action to perform.",
        enum: ["status", "diff", "log", "branch", "checkout", "stash", "stash_list", "stash_pop"]
      },
      file: {
        type: "string",
        description: "Specific file for diff/status (optional)."
      },
      branch: {
        type: "string",
        description: "Branch name for checkout action."
      },
      label: {
        type: "string",
        description: "Label for stash action (optional)."
      },
      message: {
        type: "string",
        description: "Commit message for commit action (optional, for future use)."
      },
      cwd: {
        type: "string",
        description: "Working directory (optional, defaults to project root)."
      }
    },
    required: ["action"]
  },
  async execute(params = {}) {
    try {
      const { action, file, branch, label, message, cwd } = params;

      if (!action) {
        return "Error: 'action' is required. Available: status, diff, log, branch, checkout, stash, stash_list, stash_pop";
      }

      const gitDir = cwd || process.cwd();

      // Verify this is a git repo
      const isRepo = await runGit('rev-parse --is-inside-work-tree', gitDir);
      if (isRepo.includes('Error') || !isRepo.includes('true')) {
        return "Error: Not a git repository. Run 'git init' first or specify a directory that contains a git repo.";
      }

      switch (action) {
        case 'status': {
          const output = await runGit('status --short', gitDir);
          if (!output.trim()) return "Working tree clean — no modified, added, or deleted files.";
          const lines = output.trim().split('\n');
          return `## Git Status (${lines.length} changed files)\n\n${output.trim()}`;
        }

        case 'diff': {
          let cmd = 'diff';
          if (file) {
            cmd += ` -- "${file}"`;
          }
          const output = await runGit(cmd, gitDir);
          if (!output.trim()) return "No changes to diff (working tree matches index).";
          return `## Git Diff\n\n${output}`;
        }

        case 'log': {
          const output = await runGit('log --oneline -20', gitDir);
          if (!output.trim()) return "No commits yet.";
          return `## Git Log (last 20 commits)\n\n${output.trim()}`;
        }

        case 'branch': {
          const output = await runGit('branch -a', gitDir);
          if (!output.trim()) return "No branches found.";
          return `## Git Branches\n\n${output.trim()}`;
        }

        case 'checkout': {
          if (!branch) return "Error: 'branch' parameter is required for checkout.";
          const output = await runGit(`checkout "${branch}"`, gitDir);
          return `## Git Checkout ${branch}\n\n${output}`;
        }

        case 'stash': {
          let cmd = 'stash push';
          if (label) cmd += ` -m "${label}"`;
          if (file) cmd += ` -- "${file}"`;
          const output = await runGit(cmd, gitDir);
          return `## Git Stash\n\n${output}`;
        }

        case 'stash_list': {
          const output = await runGit('stash list', gitDir);
          if (!output.trim()) return "No stashes found.";
          return `## Git Stash List\n\n${output.trim()}`;
        }

        case 'stash_pop': {
          const output = await runGit('stash pop', gitDir);
          return `## Git Stash Pop\n\n${output}`;
        }

        default:
          return `Error: Unknown action '${action}'. Available: status, diff, log, branch, checkout, stash, stash_list, stash_pop`;
      }
    } catch (err) {
      return `Error in git_operation: ${err.message}`;
    }
  }
};