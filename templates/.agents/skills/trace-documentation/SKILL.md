---
name: trace-documentation
description: "Use to generate or update trace.md files that link project backlog items directly to code modifications."
---

# Trace Documentation

This skill maintains the absolute traceability of the system. Every line of code changed must be traceable back to a specific requirement, backlog task, or issue.

## Directives

When completing a task or epic:

1. **Locate the Task**: Identify the completed item in `carja/2-backlog/task-backlog.md` or the relevant PRD in `carja/3-product-areas/`.
2. **Identify Changes**: Gather the list of files that were created, modified, or deleted during the execution.
3. **Generate Trace**: Create or update a `trace.md` document in the relevant feature directory (or globally in `carja/4-context/`).
   - The trace must map the Task ID or Description directly to the File Path and the nature of the change.
4. **Commit Context**: Ensure git commit messages also reference these Task IDs to maintain traceability in the version control history.
