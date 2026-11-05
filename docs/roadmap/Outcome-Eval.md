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
