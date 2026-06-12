trigger: small task

# SMALL TASK WORKFLOW (< 5 files, < 20 tool calls)

This workflow is for focused, single-purpose changes that touch fewer than 5 files.

## Steps

### 1. SNAPSHOT
```
snapshot_state(label="before-<feature>")
```
Always snapshot before editing. No exceptions.

### 2. READ ALL TARGETS
Read every file you plan to edit. Use `read_file` with `start_line`/`end_line` for precision. If the file is large (>200 lines), read only the relevant sections.

### 3. PLAN (inline)
Write a 3-5 bullet plan in your head:
- Which files to change
- What changes to make
- What to verify after

Do NOT write implementation_plan.md for small tasks. Keep it in your head.

### 4. EXECUTE (one change at a time)
For EACH file:
1. `patch_file` (preferred: `find_string` + `replace_string`) OR `write_file` (new files only)
2. `lsp_diagnostics` on the file you just changed
3. If errors → fix immediately, do NOT proceed to next file
4. If clean → move to next file

### 5. VERIFY
1. `execute_shell_command` with the project build command (`npm run build`, `tsc --noEmit`, `go build`, `cargo build`)
2. If build fails → fix and re-verify
3. Run the specific test for the changed module (if one exists)

### 6. FINAL ANSWER
Write your response. Include:
- What you changed
- PASS/FAIL self-test line

Do NOT claim success if the build failed.

## RULES
- Do NOT create task.md for small tasks
- Do NOT create implementation_plan.md for small tasks
- Do NOT create temporary test files for trivial changes (1-3 line fixes, comment edits, config changes)
- Do NOT use sub-agents for small tasks — do it yourself
- DO snapshot before editing
- DO read before editing
- DO verify after editing