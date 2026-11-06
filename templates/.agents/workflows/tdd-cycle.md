---
name: TDD-Cycle
description: "Use during execution to enforce the strict RED → GREEN → REFACTOR test-driven development loop."
---

# TDD Cycle (RED → GREEN → REFACTOR)

This workflow enforces the strict Test-Driven Development (TDD) cycle for all feature implementations.

## The Loop

1. **RED Phase**:
   - Write a failing test for the next increment of functionality based on the specification.
   - Run only that test and see it fail on an assertion, for the expected reason. An import error, a missing name or a syntax error is not a RED: fix it and run again. Do not write implementation code yet.

2. **GREEN Phase**:
   - Write the *minimum* amount of code necessary to make the failing test pass.
   - Run the targeted test once and see it pass.

3. **REFACTOR Phase**:
   - Review the newly written code and test for quality, readability, and adherence to clean code standards.
   - Refactor without changing behavior.
   - Re-run the targeted tests only. The full suite runs once, at the end of the change (`carja evidence run --label verify -- <verify command>`).
   - This per-increment refactor is **mandatory and not deferrable** — it is not replaced by review. A *second*, cross-cutting refactoring look also happens later at review stage (`skills/code-review`, Stage 2), which catches duplication/abstractions only visible once the whole change is assembled. The two are complementary: refactor small here every increment, refactor broad there once.

## Before the loop: agree the seams

You cannot test everything, so decide *where* the tests attach before writing any. A **seam** is an observable boundary you can drive and assert against.

- **Test behavior through public interfaces, not implementation.** A good test reads like a spec of what the unit does and survives a refactor that doesn't change behavior. Test *through* the interface, never past it into internals.
- **Pick the highest useful seam; the ideal number is one.** Prefer one test at the outermost boundary that exercises the slice over many tests wired into private functions. Confirm the chosen seams with the human before starting — this lands effort on the critical paths.

## Rules

- **Never skip the RED phase.** You must prove the test can fail before making it pass.
- **Work vertical slices, not horizontal.** Each cycle is one thin end-to-end slice (a tracer bullet), driven by what the last cycle taught — never "write all the tests, then all the implementation," which only verifies imagined behavior.
- **Micro-commits**: Consider committing or using `using-git-worktrees` after a successful GREEN or REFACTOR phase.
- **Traceability**: If this code fulfills a specific requirement from `carja/2-backlog/task-backlog.md`, ensure the commit message or the `trace.md` file references the exact task.

## Test anti-patterns (reject these in REFACTOR and review)

- **Implementation-coupled** — the test mocks or asserts on internals; tell: it breaks on a refactor that changed no behavior. Fix: assert on observable behavior at the seam.
- **Tautological** — the assertion recomputes the expected value the same way the code does, so it can never fail meaningfully. Fix: the expected value must come from an independent source of truth (a hand-written literal, a spec example).
- **Horizontal slicing** — see the vertical-slices rule above; a test suite built ahead of the implementation tests behavior nobody has observed yet.
