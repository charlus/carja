---
name: analyze-tests
description: "Use before starting the Build workflow to generate a comprehensive test strategy and verification plan."
---

# Analyze Tests

Testing is not an afterthought. This skill enforces the creation of a testing strategy *before* any implementation code is written.

## Directives

1. **Review Requirements**: Read the current task in `carja/1-workbench/` or `carja/2-backlog/`.
2. **Identify Boundaries**: Determine the integration boundaries, core domain logic, and edge cases for the task.
3. **Formulate Strategy**: Decide on the necessary types of tests:
   - Unit Tests (for isolated logic)
   - Integration Tests (for boundary interactions)
   - End-to-End Tests (for user workflows)
4. **Document**: Write down the explicit test cases that must pass before this task can be considered complete.
5. **Enforce**: You must not proceed to `build.md` or `tdd-cycle.md` until the test strategy is clearly defined and agreed upon.
