---
trigger: manual
inline: true
description: Red before green. No implementation code without a failing test first.
---

# Test-Driven Law

**RED BEFORE GREEN. NO IMPLEMENTATION CODE WITHOUT A FAILING TEST FIRST.**

This applies to every task in the Build workflow's per-task loop (`.agents/workflows/build.md`). For each increment of behavior:

1. **RED** — Write a test for the next increment. Run it. Confirm it fails, and fails for the expected reason. Do not write implementation code yet.
2. **GREEN** — Write the minimum code needed to make it pass. Run it. Confirm it passes.
3. **REFACTOR** — Clean up the code and test without changing behavior. Run the suite again to confirm it's still GREEN.

Full mechanics: `.agents/workflows/tdd-cycle.md`. Enforced by the `pre-commit` hook: a commit that stages implementation code without a test change is rejected, and so is one whose test change adds or changes no assertion.

## The one exception

Some changes have no meaningful test surface — pure config, documentation, static copy, generated code. For these, and only these, skip the cycle — but say so explicitly in the task tracker (`no test: config-only change`), never silently. If you're unsure whether a change is testable, assume it is and write the test.

Where this law sits among the test layers, and how the unattended loop splits it across two agents: `.agents/how-it-works.md` (Test-Driven by Default) and `.agents/workflows/unattended-loop.md`.
