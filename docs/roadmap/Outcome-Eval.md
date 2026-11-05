# Outcome eval (Q3): does Carja make the code come out better?

> **Status (2026-11-05):** step 1, pre-registration. Draft for the owner's approval. Nothing has been run. Once approved, this file is frozen at its commit hash; any later change to the hypothesis, the tasks, the metric or the analysis is a new section with its own date, never an edit.

Every measurement Carja has is a process measure: a test exists, an assertion changed, the agent named the affected files. ECC measured the outcome of one such mechanism and found none ([Peer-Framework-Harvest](Peer-Framework-Harvest.md), A9). This eval measures the outcome of the whole install.

## Decisions

| | Decision | By |
|---|---|---|
| D1 | Tasks come from the real history of one of the owner's private internal projects: a fast suite (about 600 tests in about 10 s), about 90 feat/fix commits that change code and tests | owner, 2026-11-05 |
| D2 | Budget: the pilot only (about 60 sessions). The confirmatory run is decided on the pilot's numbers | owner, 2026-11-05 |
| D3 | Models: Sonnet and Opus. The pilot uses Sonnet | owner, 2026-11-05 |
| D4 | The task list, hidden tests and per-trial results stay private, in the project's own repository. This file holds the method and the overall results, and cites the private list by its SHA-256 | owner, 2026-11-05 |

## Question and scope

**H1.** On the same written task, Claude Code with the Carja install produces a change that passes the hidden acceptance tests and keeps the existing suite green more often than bare Claude Code.

In scope: building from a written task, unattended. Out of scope: the interview workflows (Discovery, Spec-It, the brief check with a human), which a headless run cannot exercise. The task text in both arms is the real spec text, which Carja's own workflows wrote: this eval does not credit Carja for the spec.

Generalisation limit: one project, one stack (a Python web service with LLM tools), one owner's style. A positive result says "on work like this project's".

## Arms

| Arm | The repository at the task's base commit, plus |
|---|---|
| **bare** | nothing: `.agents/`, `carja/`, `AGENTS.md`, `carja.config.json` removed, no git hooks |
| **carja** | the Carja 7.1.0 install (`carja init` + `carja upgrade` onto that commit), its `carja/` knowledge as it was at that commit, git hooks wired |

Same prompt, model, tools, permission mode, time cap and turn cap in both. The prompt: the task text, then "Implement this in the repository. Commit when done." No mention of Carja. A third arm (carja with hooks off) is added only if bare and carja differ.

## Tasks

A task is one feature at its real granularity: one commit, or a run of consecutive commits that deliver one spec item. Its base is the parent of its first commit. Its hidden tests are the tests those commits added, **plus the tests of the fix commits that later repaired that feature**: those encode the defects the real build shipped, so they test whether an arm avoids them.

The task list is private (D4): twelve candidates, each a feature with its commits and the later fix commits that repaired it. It covers credential storage, a startup configuration check, provider unlinking, payload classification, context budgeting, query escalation, document routing, log redaction, data retention, dashboard figures and token refresh. Eight of the twelve have a later fix, so eight carry hidden tests for a defect the real build shipped.

Private list: `carja/4-context/meta/outcome-eval-tasks.md` in the project's repository, SHA-256 `c65a6b0d2cdf6e4c5fc8859087689ca1537b7a604bccc646321ef7b6f146a97e` at pre-registration.

**Task check** (each task, before any trial): at the base commit the hidden tests fail; on the real final commit they pass; they call the public interface (a function, route or CLI named in the spec), not a private name the real code happened to choose. A hidden test coupled to a private name is rewritten at the interface, before any trial, and the rewrite is committed with the private list. Tasks that fail the check are dropped and the drop is recorded. Ten tasks go into the pilot.

## Metrics

- **Primary (per trial, binary):** the hidden acceptance tests pass **and** the existing suite at the base commit stays green, on the final working tree (committed or not).
- **Secondary:** hidden tests passed as a fraction; turns, input and output tokens, wall time (from `claude -p --output-format json`); whether the session ended by itself or hit a cap; lines changed outside the task's area.
- **Exploratory (not tested for significance):** defects a reviewer finds in the diff. The reviewer sees the code diff only, with `.agents/`, `carja/` and `AGENTS.md` stripped, and does not know the arm.

## Analysis

- Pairing: one bare and one carja trial on the same task and run index form a pair. **McNemar's exact test** on the discordant pairs, two-sided, α = 0.05.
- Effect: difference in pass rate with a 95% interval; cost ratio (carja/bare) of turns, tokens and wall time with bootstrap intervals.
- **Noise floor first:** before the pilot, 2 tasks × 3 runs with two identical bare arms. The difference between identical arms is the noise floor. An effect below it is reported as "not distinguishable".

## Pilot (step 2, approved) and stop rules

10 tasks × 3 runs × 2 arms = 60 sessions, Sonnet, plus 12 sessions of noise floor. Caps per session: 45 minutes, 200 turns.

Stop, and report, without a confirmatory run when:
- **Ceiling or floor:** both arms pass at least 90%, or both at most 10%. The tasks cannot separate the arms; harder or easier tasks are a new pre-registration.
- **Noise:** the pilot's difference is below the noise floor.

Otherwise the confirmatory run's size is set from the pilot's discordant-pair rate for 80% power, capped at 200 sessions per model, and brought to the owner as D4 with its quota estimate.

## Execution

- Each trial in its own clone under `~/.cache/carja-q3/runs/<task>-<arm>-<run>/`, never under `/tmp/claude-*`. Dependencies installed from that commit's lock file, once per task.
- No provider credentials in either arm. Tests mock the LLM; a session that needs a live key fails in both arms alike.
- Headless `claude -p`, same flags in both arms, three trials in parallel, waits on the usage limit as the loop does (`src/loop/quota.js`). Arm order is interleaved, so a model or quota change hits both arms.
- Grading copies the hidden tests in after the session ends, so no arm can see them.
- Quota is measured on the first 10 sessions and reported before the rest run.
- Raw results (one JSON line per trial) go to the project's repository beside the task list, transcripts stay in `~/.cache/carja-q3/`. The analysis script and the overall results are committed here.

## Threats

- **Familiarity:** these features were built with Carja, and the carja arm's `carja/` holds that history (ship-log, decisions). It also holds what any team's docs would hold. Reported, not removed: it is how Carja is used.
- **Model memory of the repository:** private repository, low risk, same for both arms.
- **Public result, private data:** a reader cannot rerun the eval. The hash shows the task list was fixed before the runs; the data is available to whoever has access to the project.
- **Grader bias:** the hidden tests are fixed before any trial; the exploratory reviewer is blind to the arm.
- **Small n:** the pilot can show a large effect or none. A small real effect needs the confirmatory run.

## 2026-11-05 — Step 2, before any pilot trial

Recorded before the first pilot session. The specifics are in the private record (pushed to the project's repository the same day).

**Task check.** All twelve candidates pass the mechanical check (`test/evals/outcome/task-check.mjs`). The reference is the base plus the task's commits, cherry-picked. Where a conflict touched only Carja's own state files, the base side was kept. Where other commits of the same area sit between the task's commits, the task's files are taken as they are at its last commit ("range mode", recorded per task). Hidden tests are the tests that fail on the base with the hidden files and pass on the reference. Three tasks are dropped: two whose range-mode reference was not clean (an existing test broken, or tests failing on the reference), and one whose hidden tests assert an output vocabulary the real fix invented, which no task text could state without giving the solution.

**Deviations from the pre-registration:**

1. **Nine tasks, not ten.** No clean tenth candidate without new spec work. The pilot is 9 × 3 × 2 = 54 sessions.
2. **Interface lines instead of rewritten tests.** 254 of the 307 hidden test ids need only names that exist at the base or appear in the task's documents. For the rest, the task text names the module, the name and the signature the tests call (12 names across 7 tasks), never the behaviour. This fixes the names, which is what "rewrite at the interface" was for, without rewriting tests by hand. Both arms get the same lines.
3. **Run settings.** Claude Code 2.1.317, `claude-sonnet-5-5`, the loop's sandbox profile, no MCP servers, a 45-minute wall cap and no turn cap (this CLI has no `--max-turns`). The operator's user-level instructions load in both arms alike. One virtual environment, built from the lock file every task base shares.

**Arms as built.** The bare arm is the task base with every Carja file removed (`.agents/`, `.claude/`, the state folder, the root instruction files, the config) and no git hooks. The carja arm is the same base upgraded to 7.1.0 from the install it had then (6.1 to 6.8), with the git hooks wired. The prompt is the same text in both.

**Grader controls.** 36 of 36 correct: every untouched tree fails, and every tree with the reference implementation copied in passes, in both arms.

**Noise floor.** Two tasks drawn with seed 20261105 (`mulberry32`), 3 runs × two identical bare arms = 12 sessions, run before the pilot. The pilot order is drawn with the same generator, and which arm of a pair starts first is random.

**Smoke trial.** One bare session on the smallest task passed in 44 s, 6 turns, about $0.14 at list price. It is not part of the results.

## 2026-11-05 — Deviation 4, after 10 noise-floor sessions, before any carja-arm session

The noise floor caught a fault in deviation 2. On one task, all six bare runs scored exactly the same fraction of the hidden tests. Cause: the tests call a function whose name the plan gives, but with a signature the real build chose. The interface check compared names only. The interface lines now give the full signature (decorators, enum members, dataclass fields, the new fields of an existing class) of every name the hidden tests reference that is new or changed since the base, including the private helpers the tests call. Still names and signatures, never behaviour.

The 10 noise-floor sessions run under the old prompts are discarded and the noise floor is run again. No carja-arm session had run, so no comparison between the arms had been seen. Quota on those 10 sessions: $5.27 at list price, 24 minutes of session time.
