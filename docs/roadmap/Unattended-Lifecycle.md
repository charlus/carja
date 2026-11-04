# Unattended Lifecycle — the loop runs Conductor's own workflows, stage by stage

> **Status:** signed off 2026-10-19. Step 1 (the Ship beat) shipped in 6.23.0, step 2 (claims from git, cleanup on pull) in 6.24.0, both verified live. `conductor status` reports and does not delete: cleanup runs on `git pull` and at the start of a run. Step 3 (the slice pipeline) in 6.26.0, verified live on a scratch product. Step 4 (question rounds and the overrule measurement) in 6.27.0. Step 5 (the Blueprint pipeline, one MR as the sign-off) in 6.28.0, opt-in with `loop.blueprint`. Step 6 (the conformance test) in 6.29.0: the stage map lives in `src/loop/stages.js`, the driver reads its routes from it, and `test/loop-stage-conformance.test.js` drives the real CLI through every stage with a stub engine. The Retrospective stage is not built. Step 7 (the nested code repository, `loop.code_dir`, two MRs per item, code first) in 6.31.0, verified live on a scratch outer layout, then on autopportunity (innovation/Autopportunity!259 with its state MR, 2026-10-21), after the fixes of 6.34.0–6.36.0 recorded in `Unattended-Crossing.md`. Next: the live monitor ([`Loop-Monitor.md`](Loop-Monitor.md), M1–M4). 6.50.0: `conductor loop <project>` builds one project per terminal from the same folder, each run with its own state and lock in `.git`, cleaning its worktrees at the end; the cleanup no longer removes a live run's worktree and the driver never commits outside its worktree (`halted_isolation`), after two loops collided on autopportunity (2026-10-22). Proven through the real CLI with the stub engine (two runs at once, the incident's two-checkout layout reproduced on 6.49.0 and passing on 6.50.0, Ctrl+C) and one real claude run on a scratch outer layout. 6.51.0: the stacked run (owner decisions D6–D8 of 2026-10-22 below). `conductor loop <project>` starts after the owner's approved Technical Vision and builds the Carve and every slice in one run, each item on the branch of the item below it, MRs targeting that branch; the owner merges the stack in order at the end; a closed MR is rebuilt with everything above it, a changed one kept and everything above it rebuilt. Proven through the real CLI in the outer layout with the stub engine and a stub forge (`test/loop-stacked-run.test.js`); not yet run on a real project or against GitLab. Also in 6.51.0, the interactive side of the same rule (owner, 2026-10-22: the owner's folder stays on its default branch): interactive Spec-It, Build, Ship and Quick-Path work in the item's hidden worktree (`conductor work <item>`, branch `conductor/work/<slug>`), `pre-commit` refuses code on the default branch, and merged interactive worktrees are removed by the same prune as the loop's. 6.52.0, after the two overnight runs on autopportunity (CoP availability 5 slices, KM relief slices 02–08): the merge guide (`/merge-stack`, Owner actions per MR), the wait for the usage limit, the dependency gate for every ecosystem, document-only conflicts merged with both sides kept and checked against the stack target, leftover folders moved aside, the owner's folder kept clean, and `watch` showing the place in the stack and the expected end. Proven through the real CLI with the stub engine and canned registry answers (`test/loop-run-lessons.test.js`), the registry check once against the real deps.dev and OSV; not yet on a real product. A run also fast-forwards its folder to the default branch before it reads the backlog, so after a merge the same command takes the next item (`test/loop-catch-up.test.js`, not live-verified).
> **Why:** two real crossings (`Unattended-Crossing.md`) showed that the loop follows Conductor up to Build and then leaves it. It skips Ship (bookkeeping, the report, the archive), never runs the Blueprint, and keeps its own claim and done markers. Unattended work was held to a lower standard than interactive work, on the steps that let the owner trust work they did not watch.

## The principle

Unattended means the loop does the owner's job while they are away, the way they do it: one stage at a time, **the same workflow and skills as an interactive session**, a fresh context for each stage, files as the only handoff. A loop beat is the owner typing `/spec-it slice 1`, `/clear`, `/build slice 1`, `/clear`, `/ship slice 1`.

Every stage runs unattended except Discovery, which needs the owner. State that depends on a merge is carried by the MR or derived from git, never written after the merge.

## Owner decisions (2026-10-19)

| | Decision |
|---|---|
| D1 | **Stop only for one-way doors.** Grilling's product-decision test, split by reversibility. *One-way* (cannot be undone cheaply, contradicts an earlier decision, changes what the product costs to run): the stage stops and asks. *Two-way* (changes what a user sees or does, a small scope call, reversible in the MR): the agent applies its recommendation, logs a `high` ruling ("decided for you; overrule in the MR") and continues. Reason: the owner rubber-stamped stops they had no context for; a stop that adds no judgment only adds delay. |
| D2 | **A fresh Checker reviews each spec** against the slice and the PRD before any Build beat. |
| D3 | **One MR per slice**, carrying its spec, code and bookkeeping. |
| D4 | **One owner sign-off per project:** the Blueprint and the Carve arrive as one MR. Merging it is the approval; no slice is built before. After it, each slice runs from Spec-It to its MR alone. |
| D5 | **One-way questions arrive as one round.** A stage collects every one-way question, writes them to the inbox as one numbered round, each with a recommendation, and pauses that stage only. The owner answers by number; the next run reads the answers from the file. |

## Owner decisions (2026-10-22): the stacked run

| | Decision |
|---|---|
| D6 | **Discovery is the owner's up to the Technical Vision.** Genesis, Storyboard, Grand PRD, UX/UI Brief and Technical Vision are the owner's; their approval (written on the default branch) is the loop's start signal. `conductor loop <project>` builds nothing before it and names the missing document. Reason: the one-way doors (data model, auth, vendor, public API, running cost) are settled there. |
| D7 | **The owner approves at the end, in merge order.** The Carve and every slice are built in one run, each item on the branch of the item below it, its MRs targeting that branch. This replaces D4 for `conductor loop <project>` and the wait for a merge between slices. Reason: one slice per merge kept the owner steering five products through merges instead of prompts. Merging stays human. |
| D8 | **One-way doors stay the owner's.** D1 and D5 are unchanged: an item that meets a one-way door stops the run, nothing is built above it, and the owner answers the round. An MR the owner closes is built again with everything above it; an MR the owner changes is kept and everything above it is built again on top. |

## Owner lessons (2026-10-23), after the two overnight runs

| | Lesson | Built in 6.52.0 |
|---|---|---|
| L1 | "Asking Claude to read the loop report to guide me through the merge order and all manual steps (like cmd, backup, migration) is very helpful." | `workflows/merge-stack.md` (`/merge-stack <project>`); each MR body's `## Owner actions`, plus the driver's own hints from the diff (`src/loop/owner-hints.js`), listed under each MR in the report. |
| L2 | "When the loop reached the quota, it just stops, it would be nice to wait." | `src/loop/quota.js`: wait for the reset the CLI announces, up to `loop.quota_max_wait_min`, then the same beat again. |
| L3 | KM relief stopped at slice 08 of 17 on two Conductor documents another project had changed. | Conflicts checked against what the MR merges into; a conflict only in `conductor/` merged with both sides kept (`mergeKeepingDocs` in `src/loop/conflict.js`), verify again; code conflicts still stop. |
| L4 | "How worried should I be of a hallucinated package name or a package with vulnerabilities? Not only PyPI, any package repo." | `src/loop/deps.js`: no registry for the agent; the driver checks a dependency the Technical Vision names (exists, pinned, age, not yanked, OSV) and installs it with `loop.install`; any other is a question round; fail closed. |
| L5 | A leftover folder at a worktree path made a beat run outside git, twice. | `freeWorktreePath` in `src/loop/worktree.js`: moved aside to `.git/conductor-loop-logs/leftovers/`, every add checked. |
| L6 | The owner's folder showed a changed `inbox.md` and untracked reports after each run. | `src/loop/owner-files.js`: `loop-messages.md`, reports and waiting rounds hidden by the local exclude file. |
| L7 | "Seems either stuck or still running." | `conductor watch`: item N of M, step and since when, minutes per item, expected end, quota wait, last stop in words. |

Not built: L8, merging a long stack in batches so a rejection near the bottom rebuilds less (a product decision, left to the owner).

## Stage map

The driver decides each project's and each slice's stage from files, never from memory. Each stage is a fresh beat running the named workflow, then the named review.

| Stage | Workflow (unchanged) | Input | Output (evidence) | Gate before the next stage |
|---|---|---|---|---|
| Discovery | `genesis.md`, `storyboard.md` | the owner | `genesis/`, storyboard | **human only**: the loop starts a project only after Discovery |
| Grand PRD | `grand-prd.md` | Discovery outputs | `blueprint/grand-prd.md` | `independent-review` of the PRD; one-way questions answered |
| UX/UI Brief | `ux-ui-design-brief.md` | PRD | `blueprint/ux-ui-design-brief.md`, `DESIGN.md` | `independent-review` |
| Technical Vision | `technical-vision.md` | PRD, Brief, code | `4-context/technical/`, `architecture-checklist.md` | `independent-review` |
| Carve | `carve.md` | Blueprint | `implementations/NN-<slice>/` folders | `independent-review` of the plan, then **D4: the Blueprint MR merged** (`--from-conductor`); with `conductor loop <project>` (D7) the first slice starts from the Carve's branch, no merge |
| Spec-It | `spec-it.md` | the slice folder | `feature-spec.md`, `implementation-plan.md` | **D2: Checker reviews the spec** |
| Build | `build.md` | spec, plan, `task-tracker.md` | code, tests, tracker | verify green (Evidence Rule) + Checker, per task |
| Ship | `ship.md` Phases 1–5 | the built slice | ship-log entry with **For you**, product area, archive, backlog tick, `pr-body.md` | the bookkeeping exists; the driver runs Phase 6's mechanics: push, open the MR (PR gate in code) |
| Retrospective | `retrospective.md` | ship-log, tracker | lessons | **not built**: planned as optional `loop.retrospective`, off by default (one beat per slice) |

A small `task-backlog.md` line keeps its short route: Build, then Ship.

## What the beat sees

- **The prompt is the stage's own workflow file**, as an interactive session reads it, plus the assignment (which project, which slice, which inputs).
- **One preamble**, `unattended-loop.md`, the only workflow that loop work changes. It becomes a preamble instead of a parallel method. It says: nobody is there to answer; read your inputs from the files listed; where the workflow says *ask the human* or *confirm with the human*, apply D1 (one-way: add it to this stage's question round; two-way: decide, log the ruling, go on); synthesize from the upstream documents, never re-interview; signal `done`, `escalate` or `questions` through `maker-signal.json`.
- **The workflows themselves stay byte-identical.** The test that guards the interactive path stays as it is.

## Product questions (D1, D5)

- **The round file.** A stage with one-way questions writes `conductor/1-workbench/questions/<item>.md` (one round per work item, its id made file-safe): each question numbered, in two sentences in user terms, the options with their consequence for a user, the recommendation and why, and what a wrong choice costs. The driver adds one inbox line pointing at it and pauses that stage; other projects and slices go on.
- **The answer.** The owner writes the number of their choice after each question's `Answer:` (or "your pick"). The next run sees the answers, resumes the stage and records each answer as a decision in the stage's document.
- **The quality bar.** The stage's independent reviewer rejects a question that cannot be answered cold in one line, and a two-way door dressed as a one-way door.
- **Measurement.** The ruling log already records each decision. `conductor status` shows how often the owner overrules a ruling and how often the owner takes the recommendation. Near-total acceptance means the loop asks too much.

## Claims and cleanup (from the crossings)

- **Claims come from git.** A slice or backlog item is in progress while its `conductor/loop/<id>` branch exists on the remote. The loop stops committing `🤖` claim markers into the owner's checkout. Two parallel runs read the same remote branches.
- **Done rides in the MR.** The Ship beat ticks the item and archives the slice in the slice's branch, so merging the MR is what marks it done. A closed, unmerged MR leaves the item open, as it should.
- **Reconcile on the next git touch.** A `post-merge` hook (fires on `git pull`), `conductor status` and the start of a loop run prune loop worktrees and local branches already merged, and run the doctor's stale-environment check. The owner never has to say "it is merged".

## Safety envelope

Unchanged and still in code: the PR-gated merge, the L3 sandbox gate, the Evidence Rule (verify by exit code), worktree isolation, the autonomy clamp, fail-safe on a missing verdict. New: a stage never advances on the agent's word; the driver checks the stage's output files and the reviewer's verdict.

## Build plan

Each step is its own PR, proven by a live run on a scratch product before the next.

1. **Ship beat** for today's routes (backlog line, single slice): Ship Phases 1–5 in the task's worktree, `pr-body.md` used by the driver, done carried in the MR. Removes the loop's own ship-log line and stub body.
2. **Claims from git, reconcile on pull** (the `post-merge` hook, `status`, loop start).
3. **Slice pipeline**: harvester reads `implementations/NN-<slice>/`, stage detection from files, Spec-It beat, spec review (D2), Build, Ship, one MR (D3).
4. **Question rounds** (D1, D5): the round file, pause and resume, the reviewer's quality bar, the overrule measurement.
5. **Blueprint pipeline**: Grand PRD, UX/UI Brief, Technical Vision, Carve, each with its independent review, the Blueprint MR as the sign-off (D4).
6. **Conformance test**: a table in code mapping each stage to its workflow file and its gate; a test fails when the loop routes a stage to anything else.
7. **Nested code repository** (`loop.code_dir`, owner decision 2026-10-20, reverses the 2026-10-02 refusal, after step 5): the beat's worktree is made from the nested code repository, `conductor/` stays in the outer one. The code MR goes to the code repository's forge, the state change to the outer repository, and a beat where one of the two fails is fail-safe. The evidence ledger, the merge queue, claims from git and post-merge cleanup read the code repository. The L3 sandbox binds both worktrees. Proven live on autopportunity or website. The opposite option, the scaffold inside the code repository with copy-back, stays declined.

## Risks

- **R1 Cost.** A full project is many beats, each a fresh context reading its inputs. `conductor status` already shows cost by role (6.16.0). `loop.models` can put the Maker on a cheaper model.
- **R2 Workflows written for a conversation.** Some steps say *ask*, *confirm*, *wait*. The preamble maps each one to D1; a workflow step it cannot map stops the stage with `escalate` and is a finding for the workflow.
- **R3 Long documents.** A PRD and a brief can be long inputs for a fresh context. The handoff files and the stage's own reading order keep the input to what the stage needs.
- **R4 The swarm's dependency gap.** In the swarm a dependency counts as merged once its PR is open (A11). Slices of one project depend on each other; until A11, slices run one at a time after the Blueprint MR.

## Not in scope

Discovery (human only). Self-evolving instructions (parked: `harness-rsi-paper-declined` memory). The swarm's file-scope admission (A10) and contracts (A11), still gated by their own condition.
