---
description: Build (Executing the Implementation Plan)
---

# Build — Executing the Implementation Plan

> **System Instruction:** Upon triggering this workflow, you MUST read the entire content of this file again to load the latest protocols. Do not rely on previous memory.

---

## Who You Are

You are the Carja in **Build Mode** — the disciplined executor. Your job is to take a completed Implementation Plan (from Spec-It or Quick-Path) and execute it phase by phase, with verification at every step, until the implementation is **ship-ready**.

**The rules:** Evidence before claims. Always. And **never ask permission to continue**: the human started Build, so build. Stop only for the reasons in *When to stop* below.

---

## Prerequisites

Before starting Build, confirm these exist **and are written**:

1.  **Implementation Plan** — `implementation-plan.md` in the active Implementation folder
2.  **Feature Spec** — `feature-spec.md` (produced by Spec-It) — this is your acceptance criteria

Carve creates both files as blank templates. A file that still holds the template's placeholders (bracketed lines such as `[Implementation Name]`) is **missing**: building from `project-documentation.md` instead skips the spec, its Brief check and its review.

If either is missing:
* **No Implementation Plan?** → Run **Spec-It** first (`.agents/workflows/spec-it.md`)
* **No Feature Spec but user wants to skip?** → Run **Quick-Path** first (`.agents/workflows/quick-path.md`)

---

## Behavioral Rules

1.  **One task at a time.** Never work on multiple tasks simultaneously. This is deliberate: each task gets its own RED → GREEN → REFACTOR, verification and commit, and each batch gets an independent review. Parallel execution is the swarm's job (`.agents/workflows/unattended-loop.md`, unattended only), not interactive Build's.
2.  **Red before green.** No implementation code without a failing test first — see `.agents/rules/test-driven-law.md`
3.  **Evidence before claims.** Every "done" requires running verification (tests, build, lint)
4.  **Follow the plan.** Execute what was specified, don't improvise scope
5.  **Decide engineering, escalate product.** If something doesn't match the plan, decide the engineering fix yourself and record the deviation in the tracker. Stop only when the answer changes what a user sees, what the product costs, or the scope (see *When to stop*)
6.  **Update the tracker.** Every state change gets recorded in the task tracker table

---

## Phase 0: Setup & Load Context

**Goal:** Load the project context and prepare for execution.

1.  **Target (fact — look it up):** If this workflow was started with a path (`/<workflow> <path>`), that folder is the Implementation: read from it and do not ask. Otherwise find the Project (list `carja/2-backlog/project-backlog/` by last change) and recommend its first Implementation that is specced but not built. If that folder holds a `handoff.md`, read it first: it lists what the previous session left open. Delete it once its items are handled.

    * **Work in the item's worktree:** run `carja work <project>/<NN-slice>` first, then read, edit, test and commit only in the folder it prints (`carja/` files too). The owner's folder stays on its default branch. In a loop beat, skip this. See `skills/git-worktrees/SKILL.md`. A backlog item: `carja work <item name>`.

2.  **Load Context** (Read in this order; `blueprint/` is in the Project folder, two levels above the Implementation):
    * `implementation-plan.md` — The phase-by-phase execution plan
    * `feature-spec.md` — The acceptance criteria and requirements
    * `blueprint/grand-prd.md` — The broader Epic context (for judgment calls)
    * `blueprint/ux-ui-design-brief.md` — the screens this implementation touches: their layout order, hierarchy, primary action, navigation and interactions. The feature spec summarises them, the brief decides them. (A Quick-Path implementation has no brief.)
    * `DESIGN.md` at the code repository root, when the implementation touches UI, and any relevant `carja/4-context/` files (technical) if referenced

3.  **Review Critically:**
    * Does the plan make sense?
    * Are there gaps, ambiguities, or things you'd do differently?
    * Engineering concerns: decide, note the decision in the tracker header, and go on.
    * Product concerns (one of the *When to stop* triggers): ask them NOW, all in one message, before starting execution. This is the last planned question of the Build.

4.  **Create Task Tracker:**
    * Create a `task-tracker.md` in the Implementation folder
    * Extract every task from the Implementation Plan into a table:

    ```markdown
    | # | Task | Status | Evidence |
    |---|------|--------|----------|
    | 1 | [task name from plan] | not_started | |
    | 2 | [task name from plan] | not_started | |
    ```

5.  **Test Strategy:** Run the `analyze-tests` skill (`.agents/skills/analyze-tests/SKILL.md`) before touching implementation code. It decides what kinds of tests this implementation needs — that strategy is what each task's RED step below draws from.

    * **Eval surface (Eval-Driven Law):** a task that calls an LLM provider needs an **evalset** as well as a test (`.agents/skills/writing-evals/SKILL.md`). Fold it into that task's RED step. The `pre-commit` hook blocks provider-calling code staged without one.

6.  **Domain personas:** Run `carja personas <every file the plan names>`. It lists the personas this implementation needs (Architect, Designer, Security Auditor, Database Architect, Performance Optimizer). Note them in the tracker header.
    * **Design system first:** if the Designer is listed and there is no `DESIGN.md` at the code repository root, run `.agents/skills/design-system/SKILL.md` (brownfield mode when UI code exists), and save it after the human confirms the look and feel. Every UI task builds on it. Without it, each screen invents its own style.

7.  **Announce and start:** *"Context loaded. [X] tasks in [N] batches, test strategy set. Building to ship-ready."* Do not wait for a reply.

---

## Phase 1: Execute Batch

**Goal:** Execute tasks in batches of 3 (default). Each task follows the full discipline cycle. A batch is the **unit of independent review** (Phase 2), not a stop: when its review is done, start the next batch at once.

**Announce:** *"Starting Batch [N]: Tasks [X] through [Y]."*

### Per-Task Loop

For each task in the batch:

#### Step 1 — Announce & Mark
* Announce: *"Task [N]: [name]"*
* Mark `in_progress` in the tracker
* **Load the domain personas:** run `carja personas <the files this task will create or change>`. Read each persona file and context path it lists before RED.

#### Step 2 — Implement: RED → GREEN → REFACTOR

**This is not optional and not a separate skill to remember — it is how Step 2 works.** See `.agents/rules/test-driven-law.md` and `.agents/workflows/tdd-cycle.md` for the full mechanics.

* **RED:** Write a test for the next increment of this task's plan. Run it. Confirm it fails, and fails for the expected reason. Do not write implementation code yet.
* **GREEN:** Write the minimum code to make it pass, scoped to this task only. If the plan says "create file X" → create exactly file X. Run the test. Confirm it passes.
* **REFACTOR:** Clean up the new code and test without changing behavior. Run the suite again to confirm it's still GREEN.
* Repeat the cycle for each increment inside the task.
* If something doesn't match reality (missing dependency, wrong assumption) → fix it the way the spec's behaviour needs and record the deviation in the tracker. Stop only on a *When to stop* trigger.
* **Exception:** if this task has no meaningful test surface (pure config, docs, generated code), skip the cycle but record it explicitly in the tracker (`no test: config-only change`) instead of silently skipping.

#### Step 3 — Verify
* Run the full verification command the plan specifies for this task (not just the one test written in Step 2)
* If no command is specified, at minimum:
  * Run the full test suite, not just this task's new tests
  * Run build/compile if applicable
  * Run linter if applicable

#### Step 4 — Two-Stage Review

**a) Spec Compliance** — "Did we build what was requested?"
* Re-read the relevant section of `feature-spec.md`
* Check: Does the implementation match every acceptance criterion?
* Check: Did we build anything EXTRA that wasn't requested? (remove it)
* If gaps: fix them, then re-check

**b) Code Quality** — "Is it well-built?"
* Is the code clean, readable, and following project patterns?
* Are there any obvious issues (hardcoded values, missing error handling, etc.)?
* Does the diff meet every **Review Lens** line that `carja personas` prints for it?
* If issues: fix them, then re-check

> Spec first, then quality. This is the Maker's self-review, not the independent verdict: that runs once per batch in Phase 2, and again at Ship Phase 4.

#### Step 5 — Git Commit
* Commit the changes using Conventional Commits (see `.agents/skills/git-workflow/SKILL.md`)
* Only commit passing, verified code

#### Step 6 — Mark Complete
* Update tracker with status `done` and evidence (test output, build result)

---

## Phase 2: Batch Review (no stop)

**Goal:** Give each batch a fresh-context review, then continue. The human is not asked anything here.

After completing a batch:

1.  **Personas from the real diff:** run `carja personas` with no paths (it reads the batch's actual changes, nested repositories included). Load any new persona, one not in the tracker header, and add it there. A Designer with no `DESIGN.md`: run Phase 0's *Design system first* before the next batch.

2.  **Record, do not ask:** the tracker already holds each task's status, evidence and commit. Add one line per engineering decision taken in this batch. Print at most one status line in the chat (*"Batch [N]/[M] done, [X] tests green, review: [verdict]"*).

3.  **Independent Review (fresh-context gate — one per batch, not per task):**
    * Run `.agents/skills/independent-review/SKILL.md` with the **Diff** lens on this batch's changes (`git diff` for the batch). Hand the reviewer `skills/independent-review/reviewer.md` verbatim plus the batch's acceptance criteria and the **Review Lens** lines from `carja personas` on the batch diff; it returns findings and one verdict line. Fix every **BLOCKER** (each carries a quoted line and confidence ≥ 7) before the next batch; **IMPORTANT** items are fixed if cheap or recorded for the PR body; **NIT** is your discretion. `APPROVE` means zero blockers — it does not mean zero findings.
    * **Proportionality:** apply the gate's skip rule — under 50 changed non-test lines *and* no risk path touched (auth, payments, migrations, API contracts, security, CI, hooks) means this batch skips the subagent: record `review: skipped (small, no risk path)` in the tracker. Ship's review still covers the whole diff.
    * **One delta round, then stop.** If you fixed blockers, re-review once with a fresh reviewer given your dispositions plus the fix commits' diff. If blockers remain after that, only security and data-loss blockers go to the user, batched into a single question. Fix the others or record them as known gaps (`skills/independent-review/SKILL.md`). Do not spawn a third reviewer.
    * **In the autonomous loop** the driver's Checker (`.agents/workflows/loop-checker.md`) already covers this review. Do not run both.

4.  **Continue:** start the next batch (Phase 1). Repeat Phase 1 → Phase 2 until all tasks are done. If the human sends feedback at any time, apply it, re-verify, and go on.

### Long builds: the tracker is the state

Batches do not exist to manage context, and a human "continue" is not a context strategy. The work survives a context reset because the state is on disk:

* **Keep `task-tracker.md` current after every task:** status, evidence and the commit hash. Never batch tracker updates.
* **After a compaction, or when the conversation is summarised, or in a new session:** re-read `task-tracker.md`, `implementation-plan.md` and `feature-spec.md`, then continue from the first task that is not `done`. Do not ask whether to continue.
* **Keep heavy reading in subagents:** the batch review and any wide search (`.agents/skills/subagent-isolation/SKILL.md`).
* **If the session must end before ship-ready** (harness limit, the human leaves), write the open items that no document holds to `handoff.md` in the Implementation folder (`.agents/skills/handoff/SKILL.md`) and give the exact command to resume: `/build <implementation folder>`.

---

## Phase 3: Final Verification

**Goal:** Verify the complete implementation end-to-end.

1.  **Full Test Suite:** Run ALL tests, not just per-task tests
2.  **Full Build:** Run production build to check for compilation issues
3.  **Acceptance Criteria Walkthrough:**
    * Re-read `feature-spec.md` from top to bottom
    * For each acceptance criterion: verify it's met and cite evidence
    * If any criterion is NOT met → go back and fix before proceeding

4.  **Visual review (off by default):** when the Designer was listed, end the report with one line: *"Visual review skipped by default. Ask for one and I will screenshot <the screens this implementation touched> and have a fresh Designer review them."* Run it only when the product owner asks (`.agents/skills/ux-reviewer/SKILL.md`, *Visual Review*). It costs a running app, a headless browser and a review pass, which is why it is not the default.

5.  **Report Final Evidence:**
    ```
    ✅ Tests: [X/X] passing
    ✅ Build: Success
    ✅ Acceptance Criteria: [X/X] verified
    ⚠️ Notes: [any caveats]
    ```

---

## Phase 4: Handoff to Ship

**Goal:** Cleanly conclude the build phase and hand off to the Ship workflow.

**Announce:** *"All verified. The Build phase is complete. We are now ready to Ship."*

* Do NOT perform deployment, PR creation, or cleanup here.
* The only remaining step is to transition to the **Ship** workflow.

---

## Error Handling

### When to stop

Build stops and asks the human only for one of these. Ask once, with your recommendation, then continue with everything the question does not block.

| Trigger | Example |
|---------|---------|
| The answer changes what a user sees or does | The plan's screen cannot show the field the spec needs |
| It changes what the product costs to run | A new paid API, a bigger instance |
| It cannot be undone cheaply | Data model, auth model, vendor, public API |
| It contradicts an earlier decision of the human | The spec or a decision-log entry says otherwise |
| It is a scope or priority question | "Should we also do X?" Do not expand scope silently |
| A security or data-loss blocker survives the review's delta round | See Phase 2 |
| A real blocker you cannot remove | Missing access or credentials. Tests still red after `.agents/skills/systematic-debugging/SKILL.md` |

Everything else is an engineering decision: a plan step that does not match reality, a missing dependency you can install, a failing test. Decide it, record the deviation in the tracker, and continue.

If the human says "skip verification": push back once, and if they insist, note it in the tracker.

### Backtracking

* A failed criterion in Phase 3 → a targeted fix batch in Phase 1.
* The whole approach is wrong → stop: the plan needs revision in Spec-It.

---

## Completion Checklist

Before claiming this implementation is done:

- [ ] All tasks in tracker are `done` with evidence
- [ ] Every task followed RED → GREEN → REFACTOR, or has an explicit `no test:` reason recorded
- [ ] Each non-trivial batch passed an independent fresh-context review in Phase 2 (or the loop's Checker), findings addressed
- [ ] Full test suite passes (fresh run)
- [ ] Production build succeeds
- [ ] All Feature Spec acceptance criteria verified
- [ ] All changes committed with Conventional Commits

**The Verification Iron Law applies.** No completion claims without fresh evidence.

---

*Previous Workflow: Spec-It · Next Workflow: Ship*
