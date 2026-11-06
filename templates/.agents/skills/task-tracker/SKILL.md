---
name: task-tracker
description: Build writes the task tracker once, at the end. Until then, per-task commits are the state.
---

# Task Tracker

Build writes `task-tracker.md` in the active Implementation folder once, at the end (Build Phase 3). During the run, each task's commit carries its task number in the subject, so `git log` since the branch base shows what is done after a context reset.

## Format

```markdown
| # | Task | Status | Commit | Evidence |
|---|------|--------|--------|----------|
| 1 | Create user model | done | a1b2c3d | Tests: 5/5 pass |
| 2 | Add auth middleware | blocked | | Needs the IdP client secret |
```

Below the table: the deviations from the plan and the review verdict.

## Status Values

| Status | Meaning |
|--------|---------|
| `done` | Committed, with verification evidence |
| `blocked` | Cannot proceed: say why in Evidence |
| `cancelled` | Deliberately skipped: say why in Evidence |

## Rules

1. **Evidence is mandatory for `done`.** No evidence, not done.
2. **Table, deviations, verdict.** No other prose.
3. **Location:** inside the active Implementation folder, never a global file.
