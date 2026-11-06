---
trigger: manual
inline: true
description: Red before green. No implementation code without a failing test first.
---

# Test-Driven Law

**RED BEFORE GREEN. NO IMPLEMENTATION CODE WITHOUT A FAILING TEST FIRST.**

For each increment of behavior in a Build task (`.agents/workflows/build.md`):

1. **RED** — Write a test for the next increment. Run only that test and see it fail on an assertion. An import error, a missing name or a syntax error is not a RED. Do not write implementation code yet.
2. **GREEN** — Write the minimum code to pass. Run the targeted test once.
3. **REFACTOR** — Clean up without changing behavior. Re-run the targeted tests only.

The full suite runs once, at the end of the change: `carja evidence run --label verify -- <verify command>`, again only if code changed after it.

Full mechanics: `.agents/workflows/tdd-cycle.md`. Enforced by the `pre-commit` hook: a commit that stages implementation code without a test change is rejected, and so is one whose test change adds or changes no assertion.

## The one exception

Pure config, documentation, static copy and generated code have no test surface. Only these skip the cycle, and the commit message says so (`no test: config-only change`). Unsure? Write the test.

Where this law sits among the test layers, and how the unattended loop splits it across two agents: `.agents/how-it-works.md` (Test-Driven by Default) and `.agents/workflows/unattended-loop.md`.
