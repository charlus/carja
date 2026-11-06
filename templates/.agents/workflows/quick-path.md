---
description: Quick-Path (Fast-Track Implementation)
---

# Workflow: Quick-Path — Fast-Track Implementation

> **System Instruction:** Upon triggering this workflow, you MUST read the entire content of this file again to load the latest protocols. Do not rely on previous memory.

**Trigger:** "Quick path", "Just build this", "Skip discovery", "I know what I want"
**Goal:** Take a clear, scoped implementation request directly to spec and build — skipping the full Genesis → Storyboard → Blueprint pipeline.
**Output:** A Feature Spec, Implementation Plan, and built implementation.
**Prerequisites:** A clear user request. That's it.

**Technique:** Scope-lock uses `.agents/skills/grilling/SKILL.md` (questions in short numbered rounds, recommend an answer, look facts up rather than ask). Spec & plan use `.agents/skills/collaborative-drafting/SKILL.md` (lead with a draft, iterate to one confirm). Both stay deliberately terse here — this is the lean path.

---

## When to Use

Use Quick-Path when the user:
- Knows exactly what they want to build
- Has a scoped, standalone request (not a full product)
- Wants to skip discovery and go straight to building
- Is adding a feature to an existing codebase

**Don't use Quick-Path when:**
- The user is exploring an idea → use **Genesis**
- The scope is unclear or multi-epic → use **Grand PRD**
- The user says "I'm not sure what I need" → use **Genesis** or **Brainstorm**

---

## Phase 1: Scope Lock

**Goal:** Lock the scope in 3 questions or less. Inspired by Antigravity-Kit's Socratic Gate.

**Announce:** *"Quick-Path mode. Let me ask a few questions to lock the scope."*

### The Three Questions

Per the Grilling primitive: ask in short numbered rounds, each question with your recommended answer. Stop as soon as scope is clear.

1.  **"What are you building?"**
    * Get a clear description of the feature/change
    * If vague: ask a follow-up to sharpen it
    * If clear: move to question 2

2.  **"What does 'done' look like?"**
    * Get specific acceptance criteria
    * *"When this is done, what should a user be able to do that they can't do now?"*
    * If unclear: propose criteria and iterate

3.  **"Any constraints?"**
    * Files/folders that should or shouldn't be touched
    * Time constraints
    * Anything this must not break for existing users
    * **Do not ask about tech stack or existing patterns** — read them from the codebase (Grilling's *Whose Decision Is It*). Report what you found and what you chose, one line each.

### Scope Summary

After the questions, present a scope summary:

```markdown
## Scope Lock
- **What:** [One sentence]
- **Done when:** [Acceptance criteria list]
- **Constraints:** [Any constraints]
- **Estimated size:** [Small / Medium / Large]
```

**Brief check (before the confirm):** run Grilling's C1–C4 against this project's `carja/` docs and current behaviour. State any hit in two sentences with the source, or say **"Brief check: none found."** It does not block — the human answers in one line and you continue. Carry the result into `feature-spec.md`.

**Confirm:** *"Is this scope correct?"*

---

## Phase 2: Quick Spec

**Work in the item's worktree:** run `carja work <item name>` first, then read, edit, test and commit only in the folder it prints (`carja/` files too). The owner's folder stays on its default branch. In a loop beat, skip this. See `skills/git-worktrees/SKILL.md`.


**Goal:** Create a lightweight Feature Spec. No 12-page PRD — just enough to build.

**Announce:** *"Scope locked. Let me draft a quick spec."*

### AI Proposes First

Draft a Feature Spec with only these sections:

```markdown
# Feature Spec: [Name]

## What We're Building
[2-3 sentences]

## Acceptance Criteria
- [ ] [Criterion 1]
- [ ] [Criterion 2]
- [ ] [Criterion 3]

## Technical Approach
- [Key technical decisions]
- [Files to create/modify]
- [Patterns to follow]

## Out of Scope
- [What we're NOT building]

## Brief check
[The Phase 1 result: each hit with its source, or "None found."]
```

The `## Brief check` heading is required: the `pre-commit` hook rejects a `feature-spec.md` without it.

### Discussion Round
* *"Does this spec capture what you want? Anything to add or remove?"*
* Iterate until approved

### Save
* Save to the active Implementation folder as `feature-spec.md`
* Or to `carja/1-workbench/` if no Implementation folder exists yet

---

## Phase 3: Quick Plan

**Goal:** Create a bite-sized Implementation Plan. Each step should be 2-5 minutes of work.

**Announce:** *"Spec approved. Let me create the implementation plan."*

### AI Proposes First

Draft an Implementation Plan:

```markdown
# Implementation Plan: [Name]

## Phase 1: [Foundation]
- [ ] Task 1: [Specific action] — [File path]
- [ ] Task 2: [Specific action] — [File path]

## Phase 2: [Core]
- [ ] Task 3: [Specific action] — [File path]
- [ ] Task 4: [Specific action] — [File path]

## Phase 3: [Verification]
- [ ] Run tests: [exact command]
- [ ] Verify acceptance criteria: [how]
```

### Rules
* Each task is one atomic action
* Every task names exact file paths
* Every test step has an exact command
* Keep it SHORT — Quick-Path should stay quick

### No confirm
The plan is an engineering artefact. Save it as `implementation-plan.md` next to the spec and start Phase 4.

---

## Phase 4: Build

**Goal:** Execute the plan using the Build workflow's discipline.

**Announce:** *"Starting build."*

* Read `.agents/workflows/build.md` whole, then follow it. Reading only its first lines skips the steps below, and real builds lost all three.
* These Build steps are not optional on the quick path:
  1. **Personas:** before each task's RED, run `carja personas <the files the task creates or changes>` and read every persona and context path it lists. The Designer for UI files, the Security Auditor for auth, the Database Architect for schema.
  2. **Per task:** RED → GREEN → REFACTOR on the targeted tests, the two-stage self-review and a commit. The full suite runs once, at the end (Build Phase 3).
  3. **Independent review:** run `.agents/skills/independent-review/SKILL.md` on the whole diff. Hand the reviewer `.agents/skills/independent-review/reviewer.md` verbatim, plus the acceptance criteria and the Review Lens lines from `carja personas` on the diff. Never an improvised reviewer prompt. Record every finding and its disposition with `carja review-log append '{…}'`.

---

## Completion

* Verify all acceptance criteria from Phase 2.
* Quick-Path ends in **Ship** (`.agents/workflows/ship.md`): Quick-Path → Build → Ship. Never open a PR or MR outside Ship. Ship opens it and writes the ship-log entry, so a PR opened here leaves the product owner with no record.
* *"Done. [Feature name] is built and verified. Next: `/ship <implementation folder>`."*

---

*This workflow can be entered at any time. It does not require any upstream workflows.*
