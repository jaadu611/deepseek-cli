const { exec } = require('child_process');

module.exports = {
  name: "execute_shell_command",
  description: "Executes a terminal command asynchronously. Use this to run build scripts, package managers, tests, or general shell utilities. Returns the standard output and standard error.",
  parameters: {
    type: "object",
    properties: {
      command: {
        type: "string",
        description: "The exact shell command to execute."
      },
      timeout: {
        type: "integer",
        description: "The execution timeout in milliseconds (optional, defaults to 30000)."
      }
    },
    required: ["command"]
  },
  async execute(params) {
    // Defensive parsing: params could be an object with command, or the command string itself, or undefined
    let command, timeout;
    if (typeof params === 'string') {
      command = params;
      timeout = 30000;
    } else if (params && typeof params === 'object') {
      command = params.command;
      timeout = params.timeout !== undefined ? params.timeout : 30000;
    } else {
      throw new Error('execute_shell_command called with invalid parameters: ' + JSON.stringify(params));
    }

    if (!command || typeof command !== 'string') {
      throw new Error('The "command" argument must be a non-empty string. Received: ' + JSON.stringify(command));
    }

    const limit = timeout || 30000;
    return new Promise((resolve) => {
      exec(command, { timeout: limit, shell: process.env.SHELL || '/bin/sh' }, (error, stdout, stderr) => {
        let result = '';
        if (stdout) result += stdout;
        if (stderr) result += `Stderr:\n${stderr}`;
        if (error) {
          if (error.killed) {
            result += `Error: Command execution timed out after ${limit}ms.`;
          } else {
            result += `Error: ${error.message}`;
          }
        }
        resolve(result || 'Command executed with no output.');
      });
    });
  }
};