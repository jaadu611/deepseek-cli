trigger: test-language

# Test Workflow for Dynamic Verification

This is a test workflow to demonstrate dynamic, language-agnostic verification.

## Description

When the user mentions "test-language" or asks to verify a change, this workflow instructs the agent to run a simple syntax check on any changed `.js` or `.ts` files using Node.js.

## Steps

1. For each modified JavaScript/TypeScript file, run `node --check <filepath>`.
2. If any file fails, report the error and do not proceed.
3. If all pass, respond with "Test workflow verification passed."

This workflow is only an example. Real projects will have workflows for Python, Go, Rust, etc.