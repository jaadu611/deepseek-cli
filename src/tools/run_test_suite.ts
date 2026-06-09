// @ts-nocheck
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
/**
 * Detects the project's test runner and runs it. Returns the last 100 lines
 * of output (most useful for debugging failures).
 */
module.exports = {
    name: "run_test_suite",
    description: "Runs the project's test suite (npm test / pytest / cargo test / go test). Detects the right runner automatically from project files. Returns the LAST 100 lines of output (most useful for debugging failures) plus the exit code. Use this to verify your changes before declaring a task done — do NOT just trust that the syntax is correct.",
    parameters: {
        type: "object",
        properties: {
            path: { type: "string", description: "Project root to run tests in (default: current working directory)." },
            test_pattern: { type: "string", description: "Optional pattern to pass to the test runner (e.g. a specific test name for jest/pytest). Omit to run the full suite." },
            timeout_seconds: { type: "integer", description: "Max seconds to wait before giving up (default 120)." }
        }
    },
    async execute({ path: cwd = ".", test_pattern, timeout_seconds = 120 } = {}) {
        try {
            const projectDir = path.resolve(cwd);
            if (!fs.existsSync(projectDir)) {
                return `Error: Project dir not found: ${projectDir}`;
            }
            let cmd = null;
            let runner = null;
            if (fs.existsSync(path.join(projectDir, "package.json"))) {
                const pkg = JSON.parse(fs.readFileSync(path.join(projectDir, "package.json"), "utf8"));
                if (pkg.scripts && pkg.scripts.test && !pkg.scripts.test.includes("no test specified")) {
                    // Use pnpm/yarn if available
                    if (fs.existsSync(path.join(projectDir, "pnpm-lock.yaml"))) {
                        cmd = `npm test`; // use npm so it finds pnpm via packageManager
                        runner = "npm test (pnpm-managed)";
                    }
                    else if (fs.existsSync(path.join(projectDir, "yarn.lock"))) {
                        cmd = `npm test`;
                        runner = "npm test (yarn-managed)";
                    }
                    else {
                        cmd = `npm test`;
                        runner = "npm test";
                    }
                    if (test_pattern) {
                        cmd += ` -- ${test_pattern}`;
                    }
                }
            }
            else if (fs.existsSync(path.join(projectDir, "Cargo.toml"))) {
                cmd = `cargo test`;
                if (test_pattern)
                    cmd += ` ${test_pattern}`;
                runner = "cargo test";
            }
            else if (fs.existsSync(path.join(projectDir, "go.mod"))) {
                cmd = `go test ./...`;
                if (test_pattern)
                    cmd += ` -run ${test_pattern}`;
                runner = "go test";
            }
            else if (fs.existsSync(path.join(projectDir, "pytest.ini")) || fs.existsSync(path.join(projectDir, "conftest.py")) || fs.existsSync(path.join(projectDir, "pyproject.toml"))) {
                cmd = `pytest`;
                if (test_pattern)
                    cmd += ` -k ${test_pattern}`;
                runner = "pytest";
            }
            else {
                return `Error: No recognized test runner found in ${projectDir}. Looked for: package.json (npm test), Cargo.toml (cargo test), go.mod (go test), pytest.ini / conftest.py / pyproject.toml (pytest).`;
            }
            const timeoutMs = Math.max(5, timeout_seconds) * 1000;
            let stdout = "";
            let stderr = "";
            let exitCode = 0;
            try {
                const out = execSync(cmd, {
                    cwd: projectDir,
                    timeout: timeoutMs,
                    stdio: ['ignore', 'pipe', 'pipe'],
                    maxBuffer: 10 * 1024 * 1024, // 10MB
                });
                stdout = out.toString();
            }
            catch (err) {
                exitCode = err.status || 1;
                stdout = err.stdout ? err.stdout.toString() : "";
                stderr = err.stderr ? err.stderr.toString() : "";
            }
            const allLines = (stdout + (stderr ? "\n" + stderr : "")).split("\n");
            const summary = exitCode === 0
                ? `✅ ${runner} PASSED (exit code 0, ${allLines.length} total lines of output)`
                : `❌ ${runner} FAILED (exit code ${exitCode}, ${allLines.length} total lines of output)`;
            let output = `${summary}\n\nCommand: ${cmd}\nWorking dir: ${projectDir}\n\n`;
            if (exitCode === 0) {
                output += `[Last 100 lines of output]:\n${allLines.slice(-100).join("\n")}`;
            }
            else {
                // For failures, show both the first 30 lines (headers) and the last 100 lines (the actual failure)
                output += `[First 30 lines (test setup / headers)]:\n${allLines.slice(0, 30).join("\n")}\n\n` +
                    `[Last 100 lines (the failure)]:\n${allLines.slice(-100).join("\n")}\n\n` +
                    `[Hint] If the failure says 'Cannot find module X' or 'No such file X', the tests likely need a build step first — try execute_shell_command('npm run build') or check that dependencies are installed ('npm install').`;
            }
            return output;
        }
        catch (err) {
            return `Error in run_test_suite: ${err.message}`;
        }
    }
};
