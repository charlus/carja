# Slimming

> **Status (2026-11-10):** O1–O5 shipped in 7.3.0 (PR #125). Benchmark re-run on 2026-11-10: quality passed (100%), cost per session rose 14% instead of falling, because the review and Build now run as intended. Accepted by the owner. Next levers: whole-suite runs and commits per session (see Result).

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

## Result (2026-11-10)

Re-run of the longitudinal benchmark: Carja 7.3.0 (`a1ffbca`), 5 chains × 8 steps, the same material (manifest `a10d9251365b913a`), compared with the stored 7.1.0 and bare results. Spend $22.96.

| Per session, 40 sessions | bare | 7.1.0 | 7.3.0 |
|---|---|---|---|
| Final hidden-test share | 95.0% | 99.6% | 100% (5/5 chains) |
| Cost | $0.15 | $0.50 | $0.57 |
| Sessions with an independent review | 0 | 11 | 24 |
| Sessions that read Build | 0 | 31 | 38 |
| API calls (main thread) | 6.2 | 13.4 | 18.6 |

- Quality: pass. Every chain passed every hidden test at every step. Against bare: +5.0 points, exact permutation p = 0.008.
- Cost: +14%, not the expected −22%. The mix changed: 7.1.0 skipped the review in 29 of 40 sessions. Within one kind of session 7.3.0 is cheaper: reviewed $0.71 against $0.80, unreviewed $0.37 against $0.39. At 7.1.0's review rate, 7.3.0 costs about $0.47 (−8%).
- The review subagent itself costs $0.07 per session, as in 7.1.0. A reviewed session is expensive because its change is larger, not because of the reviewer.
- Main-thread cost grew in two activities, from the zero-token breakdown of the transcripts:

  | Per session | 7.1.0 | 7.3.0 |
  |---|---|---|
  | Test commands, targeted | 1.9 | 5.6 |
  | Test commands, whole suite | 4.0 | 3.5 |
  | Of which through `carja evidence run` | 0 | 0.75 |
  | `git commit` | 1.9 | 4.7 |
  | Cost of test runs | $0.073 | $0.081 |
  | Cost of git commands | $0.028 | $0.058 |

  Targeted runs and per-task commits rose as O1 and O4 intend. The whole suite still runs 3.5 times, not once: the benchmark sets no `verify` command, so `carja evidence run` has nothing to run and the agent runs `pytest` itself. The counts come from pattern matching on commands and are approximate.
- Wall time: 456 s against 303 s, not reliable. Plain file edits took 40 to 120 s, a sign of load on the machine with 5 chains in parallel.

