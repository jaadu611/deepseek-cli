const { exec } = require('child_process');

module.exports = {
  name: "execute_shell_command",
  description: "Executes a terminal command asynchronously. Use this to run build scripts, package managers, tests, or general shell utilities. Returns stdout, stderr, exit code, and timeout status separately.",
  parameters: {
    type: "object",
    properties: {
      command: {
        type: "string",
        description: "The exact shell command to execute."
      },
      cwd: {
        type: "string",
        description: "Working directory to run the command in (optional, defaults to current process cwd)."
      },
      timeout: {
        type: "integer",
        description: "Execution timeout in milliseconds (optional, defaults to 30000)."
      }
    },
    required: ["command"]
  },
  async execute(params) {
    let command, timeout, cwd;

    if (typeof params === 'string') {
      command = params;
      timeout = 30000;
      cwd = undefined;
    } else if (params && typeof params === 'object') {
      command = params.command;
      timeout = params.timeout ?? 30000;
      cwd = params.cwd || undefined;
    } else {
      throw new Error('execute_shell_command called with invalid parameters: ' + JSON.stringify(params));
    }

    if (!command || typeof command !== 'string') {
      throw new Error('The "command" argument must be a non-empty string. Received: ' + JSON.stringify(command));
    }

    const options = {
      timeout,
      shell: process.env.SHELL || '/bin/sh',
      maxBuffer: 10 * 1024 * 1024, // 10MB
      ...(cwd && { cwd })
    };

    return new Promise((resolve) => {
      exec(command, options, (error, stdout, stderr) => {
        resolve({
          stdout: stdout || '',
          stderr: stderr || '',
          exitCode: error?.code ?? 0,
          timedOut: error?.killed ?? false,
          ...(error && !error.killed && { error: error.message })
        });
      });
    });
  }
};