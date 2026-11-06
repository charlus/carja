---
description: Build (Executing the Implementation Plan)
---

# Build — Executing the Implementation Plan

> **System Instruction:** Upon triggering this workflow, you MUST read the entire content of this file again to load the latest protocols. Do not rely on previous memory.

Execute the Implementation Plan task by task until it is **ship-ready**. **Never ask permission to continue**: stop only for *When to stop*.

## Prerequisites

`implementation-plan.md` and `feature-spec.md` (the acceptance criteria) must exist **and are written**. A file that still holds Carve's template placeholders (such as `[Implementation Name]`) is **missing**: building from `project-documentation.md` skips the spec, its Brief check and its review.

* **No Implementation Plan?** → Run **Spec-It** first (`.agents/workflows/spec-it.md`)
* **No Feature Spec and the user wants to skip?** → Run **Quick-Path** (`.agents/workflows/quick-path.md`)

## Behavioral Rules

1. **One task at a time**, each with its own RED → GREEN → REFACTOR and commit. Parallel work is the unattended swarm's job.
2. **Red before green** (`.agents/rules/test-driven-law.md`). **Follow the plan**, never widen scope.
3. **Decide engineering, escalate product.** When the plan does not match reality, decide the fix and record the deviation in the task's commit message.

## Phase 0: Setup & Load Context

1. **Target (fact — look it up):** if this workflow was started with a path (`/<workflow> <path>`), that folder is the Implementation: read from it and do not ask. Otherwise list `carja/2-backlog/project-backlog/` by last change and recommend the first Implementation specced but not built. Read its `handoff.md` if there is one, and delete it once its items are handled.
   * **Work in the item's worktree:** `carja work <project>/<NN-slice>` (a backlog item: `carja work <item name>`), then work only in the folder it prints. In a loop beat, skip this (`skills/git-worktrees/SKILL.md`).
2. **Load context:** `implementation-plan.md`, `feature-spec.md` and `carja/4-context/technical/coding-patterns.md`. Other files only when the plan names them. A UI task also reads `DESIGN.md` (code repository root) and its screens in `blueprint/ux-ui-design-brief.md` (Project folder, two levels up).
3. **Review critically:** decide engineering concerns. Ask product concerns now, in one message: the last planned question.
4. **Test strategy:** the plan's Testing Decisions name the seams. None? Run `.agents/skills/analyze-tests/SKILL.md`. A task that calls an LLM provider adds an evalset to its RED (`.agents/skills/writing-evals/SKILL.md`): `pre-commit` blocks it otherwise.
5. **Domain personas:** `carja personas <every file the plan names>`. If the Designer is listed and the code repository has no `DESIGN.md`, run `.agents/skills/design-system/SKILL.md` first and save it once the human confirms the look and feel.
6. **Start:** *"Context loaded. [X] tasks. Building to ship-ready."* Do not wait for a reply.

## Phase 1: Execute Tasks

For each task:

1. **Personas:** `carja personas <the files this task changes>`. Read each persona and context path listed before RED.
2. **RED → GREEN → REFACTOR** per behaviour (`.agents/workflows/tdd-cycle.md`):
   * **RED:** write the test, run only it, see it fail on an assertion. An import error, a missing name or a syntax error is not a RED.
   * **GREEN:** the minimum code. The plan says "create file X" → exactly file X. Run the targeted test once: it passes.
   * **REFACTOR:** clean up, no behaviour change. Re-run the targeted tests only.
   * No test surface (config, docs, generated code): `no test: <reason>` in the commit message.
3. **Self-review:** spec first (its acceptance criteria, nothing extra), then quality (project patterns, error handling, each **Review Lens** line).
4. **Commit** (`.agents/skills/git-workflow/SKILL.md`) with the task number in the subject: `feat: export as CSV (task 3)`. The commit records that the task is done.

**After a compaction, a context reset or in a new session:** re-read the plan and the spec, run `git log --oneline <base>..HEAD` (`<base>` = `git merge-base HEAD <default branch>`), and continue from the first task not `done`: the first with no commit. Do not ask. If the session must end before ship-ready, write what no commit holds to `handoff.md` in the Implementation folder (`.agents/skills/handoff/SKILL.md`) and give the command: `/build <implementation folder>`.

## Phase 2: Independent Review (once)

The whole change is the unit of independent review.

1. **Personas from the real diff:** `carja personas` with no paths. Load any new persona, one not listed in Phase 0. A Designer with no `DESIGN.md`: run Phase 0's design-system step first.
2. **Skip rule:** under 50 changed non-test lines *and* no risk path (auth, payments, migrations, API contracts, security, CI, hooks): no subagent, record `review: skipped (small, no risk path)`.
3. **Otherwise** run `.agents/skills/independent-review/SKILL.md`, **Diff** lens, on `git diff <base>...HEAD`, with `reviewer.md` verbatim, the acceptance criteria and the Review Lens lines. Wait for the verdict. Fix every **BLOCKER**. Fix an **IMPORTANT** item if cheap, else record it for the PR body. `APPROVE` means zero blockers.
4. **One delta round:** after fixes, one fresh reviewer on your dispositions and the fix commits. Remaining security or data-loss blockers go to the user in one question. Fix the others or record them as known gaps.
5. **In the autonomous loop** the Checker (`.agents/workflows/loop-checker.md`) is this review. Do not run both.

## Phase 3: Final Verification

1. **Full suite, once:** `carja evidence run --label verify -- <verify command>` (the `verify` command in `carja.config.json`). Run it again only when code changed after it. `pre-push` then skips its own run for this tree.
2. **Build:** the production build, if there is one.
3. **Acceptance criteria:** walk `feature-spec.md` and cite the evidence for each. Not met → fix (Phase 1), then step 1 again.
4. **Visual review (off by default):** when the Designer was listed, end the report with *"Visual review skipped by default. Ask and a fresh Designer reviews screenshots of the screens touched."* Run it only when the product owner asks (`.agents/skills/ux-reviewer/SKILL.md`).
5. **Write `task-tracker.md` once:** one row per task (status, commit, evidence), the deviations and the review verdict.
6. **Report:** tests, build, criteria met, caveats.

## Phase 4: Handoff to Ship

*"All verified. Ready to Ship."* No deployment, PR or cleanup here: next is **Ship**.

## Error Handling

### When to stop

Ask the human only for these, once, with your recommendation. Continue with what the question does not block.

* The answer changes what a user sees or does
* It changes what the product costs to run
* It cannot be undone cheaply: data model, auth model, vendor, public API
* It contradicts an earlier decision of the human
* It is a scope or priority question: never expand scope silently
* A security or data-loss blocker survives the delta round
* A real blocker you cannot remove: missing access, tests still red after `.agents/skills/systematic-debugging/SKILL.md`

Everything else is an engineering decision: decide, record the deviation, continue. "Skip verification": push back once, then record it in the tracker.

### Backtracking

A failed criterion → a targeted fix in Phase 1. The whole approach is wrong → stop: the plan goes back to Spec-It.

## Completion Checklist

- [ ] Every task has a commit and a RED → GREEN → REFACTOR or a `no test:` reason
- [ ] The change passed the independent review (or the Checker), or met the skip rule
- [ ] The verify run is green for the current tree, the build succeeds
- [ ] Every acceptance criterion is verified, `task-tracker.md` is written

**The Verification Iron Law applies.**

*Previous Workflow: Spec-It · Next Workflow: Ship*
