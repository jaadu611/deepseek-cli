trigger: error
trigger: fail
trigger: broken
trigger: not working

# ERROR RECOVERY WORKFLOW

This workflow enforces the error recovery protocol when things go wrong.

## When to Use
- A tool call returns an error
- Build fails
- Tests fail
- LSP reports type errors
- The model is stuck (3+ attempts on the same problem)

## Step 1: READ THE ERROR
```
execute_shell_command(command="<command> 2>&1")
```
Read the FULL output. Do NOT assume the error is the last line. Common patterns:
- TypeScript: `TS2345: Argument of type 'X' is not assignable to parameter of type 'Y'`
- Python: `TypeError: missing required argument 'X' at line 42`
- Go: `undefined: X`
- Rust: `cannot find value X in this scope`

## Step 2: READ THE FILE
```
read_file(path="<file_with_error>", start_line=<error_line - 5>, end_line=<error_line + 5>)
```
Read 10 lines around the error. Do NOT read the whole file unless you need to.

## Step 3: UNDERSTAND THE ROOT CAUSE
Before fixing, ask yourself:
- What is the ACTUAL error? (not what I think it is)
- What line caused it?
- What did I change that introduced it?
- Is this a regression from my change or a pre-existing issue?

## Step 4: FIX
```
patch_file(path="<file>", find_string="<exact context>", replace_string="<fixed code>")
```
Fix ONLY the reported error. Do NOT refactor, clean up, or "improve" other code while the build is broken.

## Step 5: VERIFY
```
execute_shell_command(command="<build_command>")
```
If it passes → continue. If it fails → go back to Step 1.

## Step 6: IF STUCK (3+ attempts)
If you've tried 3 times and the error persists:
1. `get_recent_errors` to see the full pattern
2. `snapshot_state(label="stuck-state")` to save current state
3. `ask_user` with:
   - The exact error message
   - What you tried
   - What you think is wrong
   - What you need help with

## NEVER DO THESE
- Retry the exact same fix without reading the file first
- Assume the error is in a different file without grep_search to verify
- Add "fixes" for other issues while the build is broken
- Rewrite the whole file to fix one error
- Skip the verification step after fixing

## ALWAYS DO THESE
- Read the file before fixing
- Fix one error at a time
- Verify after each fix
- Ask user if stuck after 3 attempts