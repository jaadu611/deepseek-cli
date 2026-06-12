// @ts-nocheck
const { exec } = require('child_process');
const fs = require('fs');
const path = require('path');

const TEST_RUNNERS = [
  { name: 'npm', detection: ['package.json'], command: 'npm test', lang: 'Node.js' },
  { name: 'pytest', detection: ['requirements.txt', 'pyproject.toml', 'setup.py'], command: 'python -m pytest', lang: 'Python' },
  { name: 'cargo', detection: ['Cargo.toml'], command: 'cargo test', lang: 'Rust' },
  { name: 'go', detection: ['go.mod'], command: 'go test ./...', lang: 'Go' },
  { name: 'mvn', detection: ['pom.xml'], command: 'mvn test', lang: 'Java' },
  { name: 'gradle', detection: ['build.gradle', 'build.gradle.kts'], command: './gradlew test', lang: 'Java/Kotlin' },
];

function detectTestRunner(cwd) {
  for (const runner of TEST_RUNNERS) {
    for (const file of runner.detection) {
      if (fs.existsSync(path.join(cwd, file))) {
        return runner;
      }
    }
  }
  return null;
}

function runCommand(command, cwd, timeout) {
  return new Promise((resolve) => {
    const options = {
      timeout: timeout || 60000,
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
  name: "run_tests",
  description: "Run project tests. Auto-detects test runner (npm test, pytest, cargo test, go test, mvn test). Can run specific test file or pattern. Returns pass/fail summary and output.",
  parameters: {
    type: "object",
    properties: {
      test_file: {
        type: "string",
        description: "Specific test file to run (optional). E.g., 'test_foo.js' or 'tests/test_auth.py'."
      },
      pattern: {
        type: "string",
        description: "Test name pattern to filter (optional). E.g., 'test_health' or '-k auth'."
      },
      framework: {
        type: "string",
        description: "Force a specific test runner: npm, pytest, cargo, go, mvn, gradle. Auto-detected if not provided."
      },
      timeout: {
        type: "integer",
        description: "Timeout in milliseconds (default 60000)."
      },
      cwd: {
        type: "string",
        description: "Working directory (optional, defaults to project root)."
      }
    }
  },
  async execute(params = {}) {
    try {
      const { test_file, pattern, framework, timeout, cwd } = params;
      const projectDir = cwd || process.cwd();

      // Detect or use specified runner
      let runner = null;
      if (framework) {
        runner = TEST_RUNNERS.find(r => r.name === framework);
        if (!runner) {
          return `Error: Unknown framework '${framework}'. Available: ${TEST_RUNNERS.map(r => r.name).join(', ')}`;
        }
      } else {
        runner = detectTestRunner(projectDir);
        if (!runner) {
          return "Error: Could not auto-detect test runner. No package.json, requirements.txt, Cargo.toml, go.mod, or pom.xml found. Use the 'framework' parameter to specify one.";
        }
      }

      // Build command
      let command = runner.command;
      if (test_file) {
        if (runner.name === 'npm') {
          command = `npx jest "${test_file}"`;
          // Check if jest is available, fall back to node
          if (!fs.existsSync(path.join(projectDir, 'node_modules', '.bin', 'jest'))) {
            command = `node "${test_file}"`;
          }
        } else if (runner.name === 'pytest') {
          command = `python -m pytest "${test_file}"`;
        } else if (runner.name === 'cargo') {
          command = `cargo test "${test_file}"`;
        } else if (runner.name === 'go') {
          command = `go test -run "${test_file}" ./...`;
        } else if (runner.name === 'mvn') {
          command = `mvn test -Dtest="${test_file}"`;
        }
      } else if (pattern) {
        if (runner.name === 'npm') {
          command = `npx jest --testNamePattern="${pattern}"`;
          if (!fs.existsSync(path.join(projectDir, 'node_modules', '.bin', 'jest'))) {
            command = `npm test -- --grep "${pattern}"`;
          }
        } else if (runner.name === 'pytest') {
          command = `python -m pytest -k "${pattern}"`;
        } else if (runner.name === 'cargo') {
          command = `cargo test "${pattern}"`;
        } else if (runner.name === 'go') {
          command = `go test -run "${pattern}" ./...`;
        } else if (runner.name === 'mvn') {
          command = `mvn test -Dtest="${pattern}"`;
        }
      }

      // Run tests
      const result = await runCommand(command, projectDir, timeout || 60000);

      // Parse output for pass/fail summary
      const output = result.output;
      let summary = '';

      // Try to extract pass/fail counts
      const jestMatch = output.match(/Tests:\s+(\d+)\s+failed.*?(\d+)\s+passed/);
      const pytestMatch = output.match(/(\d+)\s+passed.*?(\d+)\s+failed/);
      const cargoMatch = output.match(/test result:\s+(ok|FAILED)\.\s+(\d+)\s+passed.*?(\d+)\s+failed/);

      if (jestMatch) {
        summary = `Result: ${jestMatch[1]} failed, ${jestMatch[2]} passed`;
      } else if (pytestMatch) {
        summary = `Result: ${pytestMatch[1]} passed, ${pytestMatch[2]} failed`;
      } else if (cargoMatch) {
        summary = `Result: ${cargoMatch[1] === 'ok' ? 'ALL PASSED' : 'FAILED'} — ${cargoMatch[2]} passed, ${cargoMatch[3]} failed`;
      } else if (result.exitCode === 0) {
        summary = 'Result: ALL PASSED (exit code 0)';
      } else {
        summary = `Result: FAILED (exit code ${result.exitCode})`;
      }

      return `## Test Results (${runner.name} — ${runner.lang})\nCommand: ${command}\n${summary}\n\n\`\`\`\n${output.slice(-3000)}\n\`\`\``;
    } catch (err) {
      return `Error in run_tests: ${err.message}`;
    }
  }
};