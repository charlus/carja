---
trigger: manual
description: "Source of the framework block in the root AGENTS.md. Edit here, then run carja upgrade."
---

# Carja Framework

## Global Boundaries

> [!WARNING]
> **NEVER** rush to a solution. ALWAYS read the project context and product areas before acting.
> **ALWAYS** use the verification gate before claiming a task is completed. NO COMPLETION CLAIMS WITHOUT FRESH VERIFICATION EVIDENCE.
> **ALWAYS** write a failing test before implementation code during Build. See the Test-Driven Law below.
> **ASK FIRST** if you encounter ambiguous requirements or if a user request contradicts the project's technical vision.
> **LESSONS GO TO `carja/`**, never only to your harness memory: a convention to `4-context/technical/coding-patterns.md`, a decision and its reason to `4-context/meta/decision-log.md`.
> **PRECEDENCE:** when the code lives in a team repository with its own instructions (an `AGENTS.md` or `CLAUDE.md` inside it), those win for code style and repository process: branches, commit format, review. Carja's rules win for its own process: TDD, verification, `carja/` state.

## Request Classifier

Classify what the user needs before acting:

| If the user says... | Route to |
|---|---|
| A question ("what is", "how does", "explain") | Answer directly — no workflow needed |
| "I have an idea", "New app", "New feature area" | `workflows/genesis.md` |
| "I inherited this codebase", "Onboard this existing product", "What is this thing" | `workflows/survey.md` |
| "Grand PRD", "Create PRD" | `workflows/grand-prd.md` |
| "Carve", "Break it down" | `workflows/carve.md` |
| "Deepen", "Improve codebase architecture", "Find shallow modules" | `workflows/deepen.md` |
| "Design a flow", "Agentic flow" | `workflows/agentic-flow.md` |
| "Spec it", "Write the spec" | `workflows/spec-it.md` |
| "Build it", "Let's code" | `workflows/build.md` |
| "Ship it", "Audit and ship", "Release" | `workflows/ship.md` |
| "Quick path", "Just build this" | `workflows/quick-path.md` |
| "Let's reflect" | `workflows/retrospective.md` |
| "Loop", "Unattended", "Autonomous", "Loop-ready" | `workflows/unattended-loop.md` |
| "Merge the loop's MRs", "/merge-stack <project>", "Guide me through the loop report" | `workflows/merge-stack.md` |
| "Turn the loop on (or off) for <project>" | Run `carja loop on <project> --dry-run`, show the human its list, then run it with `--yes` once they agree (`off` takes no consent) |
| "Update the project card", "Refresh AGENTS.md" | `workflows/agents-md.md` |
| "CTO mode", "Designer mode", "PM mode", etc. | matching persona in `personas/` |
| "How does this framework work?" | `personas/carja-assistant.md` |
| **"Inbox: X", "Add to inbox: X"** | **`carja inbox add "X"`, else append `X` verbatim to `carja/1-workbench/inbox.md`. One-line confirm, stop.** |
| **"Scratchpad: X"** | **Append `X` verbatim to `carja/1-workbench/scratchpad.md`. Same rule.** |
| **"What's on our plate", "status"** | **`carja status`; show its output verbatim. `--live` for MR or deploy status.** |
| Small fix, bug, quick task (already well-scoped) | Add to `carja/2-backlog/task-backlog.md` |
| Not sure? | Default to `workflows/genesis.md` — it will help find the right scope |

Capture and status are zero-judgment: no workflow, no questions, no rewording. Prefer the `carja` commands: deterministic. Triage later, on purpose. Rendered docs: `carja view --open`.

The full classifier, folder purposes and registries live in **`.agents/how-it-works.md`**. Read it when this table is not enough.

> [!IMPORTANT]
> **Skill Discovery:** Use Progressive Disclosure to find capabilities beyond this table. Check the YAML frontmatter in `.agents/skills/` for triggers on demand — don't load every skill up front.
