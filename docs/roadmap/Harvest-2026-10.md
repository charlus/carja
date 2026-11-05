# Harvest 2026-10 — peers, harness changes and research

> **Status:** first batch shipped in 6.14.0 (2026-10-16, branch `fix/harvest-gates-2026-10`): R1 sandbox credentials, R3 skill names, A8 AGENTS.md shadow warning, Q5 interview rounds, Q4 `loop.models`. Q3 (one outcome eval): pre-registered in [`Outcome-Eval.md`](Outcome-Eval.md) (2026-11-05), pilot approved. Gate batch A3, A4, A5, A9 shipped in 7.1.0 (2026-11-05, branch `feat/gate-batch-a3-a9`); limits measured on 9,662 commits of eurassistant, evalapp-v2, website and autopportunity (D1: A4 counts a changed assertion; D2: line-level lint suppressions with a rule code stay allowed). Everything else below is open or parked.
>
> **Sources:** eight research passes on 2026-10-16 — Superpowers, Pocock skills and gstack, AG Kit / Antigravity Superpowers / Test in Prod / Ralph, ECC / AI-DLC / AGENTS.md / Stitch, 16 unaudited peers (Spec Kit, OpenSpec, Kiro, BMAD, Compound Engineering, GSD, Google Conductor and others), harness-engineering practice June–October 2026, research papers April–October 2026, and the Claude Code / Codex / agy changelogs. Third-party code was read, never run. Most peer measurements are author-run on small samples.

## What the field did

It subtracts. Superpowers, Pocock, gstack, AG Kit and Agent OS cut skills and prose. Cursor cut 66% of its system prompt, and the ETH context-file study and Huntley agree. A harness component encodes an assumption about the model and expires with the next generation, so remove one at a time and measure. Conductor stays ahead on enforcement in code, the PR-gated merge and evidence tied to the tested tree.

## Owner decisions (2026-10-16)

| | Decision |
|---|---|
| Q1 | Claude Code only for now: no Antigravity redirect skills before its 2026-10-19 workflow cut-off |
| Q2 | The Google Conductor name clash is handled in a separate session |
| Q3 | Run one outcome eval: Build against the bare harness, on two models. It also answers whether the TDD ritual and the skills pay (Böckeler, TDAD, SWE-Skills-Bench) |
| Q4 | No Pi / OpenCode adapters until one is used. Build only `loop.models` (shipped). A Checker from another vendor waits for a second account and Q3 |
| Q5 | Interview in rounds (shipped) |

## Shipped in 6.14.0

- **R1** sandbox withholds forge credentials (live-verified). The SSH push path itself was not probed: the auto-mode classifier blocked the probe, and the fix does not depend on it.
- **R3** skill `name:` equals folder (`test/skill-spec.test.js`).
- **A8** AGENTS.md shadow warning walks up the folders.
- **Q4** `loop.models`, live-verified for the Maker.
- **Q5** `grilling` rounds. Not measured.

## Open, ranked

- **A3** fail a green verify that ran zero tests (gstack `5b9b837`). **Shipped in 7.1.0**: `pre-push`, `CARJA_NO_TESTS_RAN`. 0 false positives on the five real verify suites.
- **A4** TDD presence gate passes a test change with no assertion. Require a net assertion gain (Banik et al., 80% weak oracles in 86k agent patches). **Shipped in 7.1.0** as "touch an assertion" (D1): a strict net gain would have blocked 97 past commits, including fixes that change an expected value; the chosen rule blocks 81 of 1,353.
- **A5** block gate-weakening edits: suppression pragmas, `continue-on-error`, `[skip ci]`, `--no-verify`, new TODO without an issue (gstack `review/gate-integrity.md`, GSD). **Shipped in 7.1.0** (D2): every pragma would have blocked 363 past commits, almost all `# noqa: E402/F401`; the narrow set blocks 24 of 9,662. `CARJA_NO_INTEGRITY`.
- **A6** Maker `escalate` signal. Strongest measured result: an abort option cut test-cheating 54% → 9% (ImpossibleBench, arXiv 2510.20270; Gomez, arXiv 2608.29460). **Shipped in 6.15.0** as the `escalate` signal, confirmed by the first real crossing (nine wasted beats) and verified live.
- **A7** Checker verdict as schema-checked stdout (`--json-schema`), read-only Checker. Deletes the verdict file and its retry.
- **A9** Correct the fact-gate docs to what was measured: ECC's pre-registered 336-trial study found no benefit and +35–45% cost. **Done in 7.1.0**: README, hooks README, how-it-works, evals README, Peer-Framework-Harvest.
- Antigravity loads `.agents/AGENTS.md` itself, so the framework block loads twice there. Low while Q1 stands.
- `claude -p` will default to `--bare` in a future release (no date). The adapter depends on CLAUDE.md, skills and hooks: watch the changelog.

## Superlite (added 2026-10-19)

Design for A10–A14: [`Superlite-Imports.md`](Superlite-Imports.md). A15 is already covered by our per-commit waivers, and A16 stays parked.

Source: [iha2/superlite](https://github.com/iha2/superlite) at `eea16ee` (1.1.0), read and not run, and the author's article on contextfirst.blog. It is a Claude Code plugin derived from Superpowers. One coordinator schedules a Markdown task graph over a pool of Haiku and Sonnet agents. All agents work in one shared working tree. There are no worktrees and no merge step.

**The claim does not hold.** The headline "16.1 min against 33.6, 52% faster" compares one superlite run (`k1`) against three superpowers runs made days earlier, which shared the rate limit with the other arm. In the six combo runs where both arms ran at the same time, superlite was faster in 3 of 6: 157 against 171 minutes in total (8%), at $47.78 against $45.70. One superpowers run (13.3 min) beat `k1`. Every arm passed 177/177 hidden tests, so the benchmark compares wall time only. The planning skill uses the benchmark task as its worked example, and the predictor was fitted on the benchmark runs. Leakage of hidden tests cannot be audited, because the run transcripts are not committed.

**Take, ranked:**

- **A10** declared file scope, enforced when the work is committed. Each task lists the files it owns. `commit_task` stages only those files and refuses any other change. This answers the objection in F8 option A (`Swarm-Collision-Admission.md`), which is that a declared scope is a self-report. The declaration becomes a contract that code checks. For us: `carve` or `spec-it` emits a scope per slice, the swarm admits a wave only when the scopes do not overlap, and the Checker fails a diff that goes outside its scope. A wrong scope then fails one task and does not cause a collision. Superlite's own overlap check compares exact paths only and misses a directory against a file inside it (`plan_tools.py:1110`). Compare by prefix and glob.
- **A11** interface contracts with examples. A `Produces` line carries 2–3 `e.g.` lines with concrete inputs and outputs. The consumer's fake returns exactly those values and the producer's tests assert them. A consumer then needs no graph edge to its producer and builds in parallel. Once both sides are committed, the consumer's tests run again against the real producer (`SUPERLITE_REAL=1`). Applies to `spec-it` and to the swarm's `deps`.
- **A12** a ruling log for unattended decisions. When the AI decides alone, it writes `Ruling: <decision> - <why> - <cost if wrong>`, and the closing message lists every ruling. Superlite only collects these lines and does not parse the cost field. Ours should be machine-readable and shown by `conductor inbox`. Input to `Unattended-Crossing.md`.
- **A13** fix notes between retry rounds. Each finding has a note of at most 1,500 characters (goal, where, changed, tried and failed, evidence, next). Each round starts a fresh agent that reads only that note, never the earlier transcript. After 2 failed rounds the fix moves up one model tier. This bounds context per round to roughly 10–20k tokens. It fits the loop's Maker retry and the `handoff` skill.
- **A14** measured cost per agent. A PostToolUse hook on `Agent` and a SubagentStop hook record each subagent's transcript path. A script then reads tokens, cost and time per task and projects the cost of the run. Our context-bill measures instruction size, not the cost of a run. It is an input to Q3 and to `loop.models`.
- **A15** a waiver that quotes what it waives. A `CHAIN` waiver must cite an id hashed from the exact chain that lint printed, so a waiver written in advance does not match. This applies to our waiver lines in the hooks.
- **A16** robustness probes that shrink to a regression test. Generic probes per category (deep nesting, numeric, encoding, protocol, file, state) run in the background after each commit. A failure is shrunk by bisection and written as a test. Python only. It is the least proven item.

**Evidence, not decisions.** On well-specified tasks Haiku matched Opus at about 1/20 of the cost (E5, ladder10, mechanical A/B). Every test hit the ceiling at n=1, so none of them shows where Haiku stops being enough. A single-pass Sonnet review found 6/6 planted bugs at half the cost of Opus. That test was too easy to rank reviewers. A shared, byte-identical context prefix was read from cache by sibling agents. After a 400 s gap, the Haiku agent's cache entry had expired.

**Do not take.** Each of these is weaker than what we have now:
- One shared working tree.
- Verdicts from self-report: `verified` incidents close review categories, and the first-time pass rate is read from the agent's own `DONE` text.
- A test verdict from parsed counts and not from the exit code: a green run with no parsed output counts as 1 passed (`testcmd.py`).
- A commit gate that runs no tests.
- Approval read from keywords: any "yes" counts as approval of the plan.
- A human gate that the model can switch off itself: `sl orchestrator set ai` is not blocked and writes `approved: true` (`orchestrator.py:152`).

## Parked, with the evidence

- Self-evolution: no source meets the bar (memory `harness-rsi-paper-declined`). Watch Meta-Harness for an independent rerun.
- Held-out eval fixtures and staged upgrade rollout: declined 2026-10-16.
- Swarm admission (F8), model overlays, the per-host compiler: no new evidence.
