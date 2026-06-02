const { exec } = require('child_process');

module.exports = {
  name: "execute_shell_command",
  description: "Executes a terminal command asynchronously. Use this to run build scripts, package managers, tests, or general shell utilities. Returns stdout, stderr, and exit status.",
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
        let output = '';
        
        // 1. Handle maxBuffer exceeded gracefully so it doesn't crash the agent
        if (error && error.code === 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER') {
          output += `[Warning: Output exceeded 10MB buffer and was truncated]\n\n`;
          if (stdout) output += `--- STDOUT (partial) ---\n${stdout.slice(0, 5000)}\n\n`;
          if (stderr) output += `--- STDERR (partial) ---\n${stderr.slice(0, 2000)}\n\n`;
          output += `--- STATUS ---\nExit Code: 1\nError: maxBuffer exceeded\n`;
          return resolve(output);
        }

        // 2. Format standard output
        if (stdout) output += `--- STDOUT ---\n${stdout}\n`;
        if (stderr) output += `--- STDERR ---\n${stderr}\n`;
        
        const exitCode = error?.code ?? 0;
        const timedOut = error?.killed ?? false;
        
        // 3. Format status block
        output += `--- STATUS ---\n`;
        output += `Exit Code: ${exitCode}\n`;
        if (timedOut) output += `Timed Out: Yes\n`;
        if (error && !error.killed && !error.code) output += `Error: ${error.message}\n`;
        
        // 4. Return the formatted string (fixes the [object Object] bug)
        if (!output.trim()) {
          resolve('Command executed successfully with no output.');
        } else {
          resolve(output);
        }
      });
    });
  }
};