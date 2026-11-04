---
name: context-engineering
description: "Use when updating the task backlog, reading PRDs, or modifying project state in the carja/ directory"
---

# Context Engineering (The Bridge)

This skill bridges the gap between the open-standard agent environment (`.agents/`) and the human-facing collaborative dashboard (`carja/`).

## Core Directives

When interacting with the `carja/` directory, you must strictly follow these rules to protect the human user's decisions:

1. **Never Delete Human Context**: When updating a backlog, ship-log, or PRD, you may append to it or update status markers (e.g., `[ ]` to `[x]`). You must NEVER delete or drastically rewrite the human's original thoughts or epics.
2. **Dashboard Navigation**: The human-facing dashboard contains:
   - `carja/0-compass/` (North Star, Ship Log)
   - `carja/1-workbench/` (Inbox, Scratchpad, Active Implementations)
   - `carja/2-backlog/` (Task Backlog, Project Backlog)
   - `carja/3-product-areas/` (Features, Epics)
   - `carja/4-context/` (Technical, Design, Identity)
3. **Task Updates**: When completing a task, immediately update `carja/2-backlog/task-backlog.md` and log your victory in `carja/0-compass/ship-log.md`.
4. **Quick Capture**: Prefer `carja inbox add "X"` or `/inbox`. Fallback when unavailable: on `Inbox: X` / `Add to inbox: X` append `X` verbatim as a bullet to `carja/1-workbench/inbox.md`; on `Scratchpad: X`, to `scratchpad.md`. Multiple items (one per line, or semicolon-separated) each get their own bullet. No workflow, no questions, no judgment about where it "should" go — speed is the point. Confirm in one line and stop.
5. **Reading State**: `carja status` for the digest, `carja view --open` for every document rendered. Never hand-summarise `carja/` when a command already does it.

## Execution

Execute file reads or writes exclusively inside the `carja/` directory based on the user's request, adhering to the boundaries above.
