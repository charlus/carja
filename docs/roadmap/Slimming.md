# Slimming

> **Status (2026-11-06):** O1–O5 built in 7.3.0 (branch `feat/slimming`), full local suite green. Not yet validated: the re-run of the longitudinal benchmark, Carja arm only, has not run.

## Why

The longitudinal benchmark (an original CLI product built over 8 dependent feature requests, 5 chains per arm, one fresh session per request) measured Carja at 3.3× the cost and 6.6× the wall time of a bare session, for +4.6 points of hidden-test share. A zero-token breakdown of its 80 transcripts shows where the extra goes.

Per session: bare $0.15 and 46 s, Carja $0.50 and 303 s.

| Extra wall time (257 s) | Share |
|---|---|
| Test runs: the full suite about 6 times per session (Build asks for it after every task), 24 s each | 51% |
| Idle wait: a reviewer run in the background, finished, not noticed (2 sessions, about 1,100 s each) | 22% |
| Model generation: 13.4 API calls per session against 6.2 | 26% |

| Extra cost ($0.35) | Share |
|---|---|
| Independent review subagent | 21% |
| Reading and writing `carja/` state | 17% |
| Test runs (each run is one more turn that re-reads the context) | 16% |
| Reading Spec-It and Build (26 KB per run) | 15% |
| Extra code reading | 14% |
| Extra test reading and writing | 10% |

Kept on purpose: the number of tests written (the robustness check found +15 points of injected bugs caught, from those tests) and the reviewer's model.

Method notes: activity tags come from regex matching on Bash commands. The stream records each message's usage at message start, so output tokens were estimated from content length and calibrated on the 69 sessions with no subagent (residual under $0.01 per session).

## What changes

**O1. Run tests when they prove something.**
- Per behaviour: the targeted test runs once RED and once GREEN. RED must fail on an assertion. An import error, a missing name or a syntax error is not a RED.
- REFACTOR re-runs the targeted tests only.
- The full suite runs once, at the end of the change, as `carja evidence run --label verify -- <verify command>`. It runs again only when code changed after it. The push gate's evidence fast path then skips its own run for the same tree.
- CI still runs the suite on every MR and after merge.

**O2. The reviewer runs in the foreground.** The author agent waits for the verdict. Independence is unchanged: a separate subagent, fresh context, given only `reviewer.md`, the definition of done and the artifact.

**O3. Shorter Spec-It and Build.** Each keeps its steps, gates, outputs and stop rules. Explanations, examples and interactive-only material are cut or moved to an on-demand file. Ceilings in `test/fixtures/context-budget.json`: `build.md` at most 8,000 bytes (was 16,187), `spec-it.md` at most 6,000 bytes (was 10,057).

**O4. Less state traffic, shorter documents.**
- Build reads `feature-spec.md`, `implementation-plan.md` and `carja/4-context/technical/coding-patterns.md`. Other files only when the plan names them.
- `task-tracker.md` is written once, at the end. During the run the state is the per-task commits: after a context reset, `git log` since the branch base shows what is done.
- Every document a workflow writes is as short as it can be: decisions, conventions, acceptance criteria. Never a record of the discussion.

**O5. One review per change, scaled to its size.**
- Build: one Diff review for the whole change, not one per batch. The 50-line and risk-path skip rule stays.
- Spec-It: the Feature Spec + Plan review runs when the plan has more than 3 tasks or touches a risk path. About half of the blockers in a production project's review records were spec errors caught before code, all on large slices: the threshold keeps that review where it found them.

## Not changed

The TDD and Eval gates at commit, the review gate and the verify gate at push, `reviewer.md`, the loop (`src/loop/`, `unattended-loop.md`). Ship is out of scope: its review may repeat Build's final review, and no benchmark has run Ship.

## Proof

- `test/fixtures/context-budget.json`: the lowered ceilings fail on the current text, then pass.
- The full local suite.
- Re-run of the longitudinal benchmark on the Carja arm only (about $20), compared with the stored bare results. Pass: hidden-test share at or above 99.6%. Expected: about 150 s and $0.39 per session.
