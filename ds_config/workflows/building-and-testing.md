trigger: build
trigger: test
trigger: verify
trigger: fix bug

# BUILDING & TESTING WORKFLOW

This workflow enforces the verification cycle after every code change.

## Build Detection
The system auto-detects the build command based on project files:
- `package.json` → `npm run build` (or `npx tsc --noEmit` for TS-only)
- `go.mod` → `go build ./...`
- `Cargo.toml` → `cargo build`
- `requirements.txt` → `python -m py_compile <main_file>`
- `pom.xml` / `build.gradle` → `mvn compile` / `gradle build`
- `Makefile` → `make`

If the project has a `tsconfig.json` with `noEmit: true`, prefer `npx tsc --noEmit` over `npm run build`.

## Verification Cycle (MANDATORY for every code change)

After EVERY file edit:

### Step 1: LSP Diagnostics
```
lsp_diagnostics(path="<changed_file>")
```
If type errors → fix them NOW. Do NOT proceed to build.

### Step 2: Build
```
execute_shell_command(command="<build_command>")
```
If build fails → read the error, fix the code, re-run build. Do NOT proceed to tests.

### Step 3: Tests
If the project has tests:
```
run_tests()  // or execute_shell_command with test command
```
If tests fail → read the error, fix the code, re-run tests.

### Step 4: Final Check
```
lsp_diagnostics(path="<changed_file>")  // re-check after fixes
```

## When to Skip Steps
- **LSP diagnostics**: Skip for config files (.json, .yaml, .toml, .env), markdown, or files that aren't TypeScript/Python/Go/Rust
- **Tests**: Skip for comment-only changes, formatting changes, or config changes that don't affect logic
- **Build**: Never skip if you changed any source code file

## Error Recovery
If the build fails:
1. Read the FULL error output (not just the last line)
2. Identify the file and line number from the error
3. `read_file` on that file to see the current state
4. Fix ONLY the reported error
5. Re-run build
6. Do NOT add "fixes" for other issues while the build is broken

If the same error persists after 2 attempts:
1. `get_recent_errors` to see the pattern
2. `ask_user` with the error output