# Verification cost

> **Status (2026-11-19):** P1 built in 6.47.0 (the loop driver reuses a green verify on unchanged content). P4 built in 6.49.0 (beats run with provider keys empty). P3 done by 7.3.0 (`Slimming.md`: Build runs the full suite once, through the ledger). P5 and P6 built in 7.10.0. P2 not started: since P3, Build runs targeted tests between tasks and the full suite once, so the measured gain (104 s to 16–23 s per full run) no longer applies. D1: affected-only runs (P2) are opt-in through `conductor.config.json`, with the full suite when the selector is absent.

## Problem

On a real project (Python, about 7,000 unit tests, 104 s per full run) the owner waited on verification far more than the suites justify. Conductor ran the same suites again and again on the same or almost the same code:

- Interactive sessions ran the full unit suite a median of 13 times, and the integration suite a median of 10 times (13 sessions, one week). `build.md` asks for the full suite after every task, and no gate other than `pre-push` reads the evidence ledger.
- In the loop, the driver ran verify twice on an unchanged code tree. Measured after 6.43.0 (2026-10-22): a 12-minute run, of which 545 s was the two verify runs and 174 s the four agent beats.
- In the sandbox, tests whose app code calls a provider API with a placeholder key wait on a blocked network until a 600 s client deadline.

The full suite stays the final gate. Reuse is allowed only as the verdict of a real run on identical content with the exact command.

## Steps

| Step | What | Status |
|---|---|---|
| P1 | The loop driver runs verify through the ledger (label `verify`, content, command, root `.env` files) | Built, 6.47.0 |
| P4 | Beats run with the provider keys empty (`loop.blank_env`), never the engine's own. The per-test stall timeout was not built: it needs a plugin (pytest-timeout) the project may not have | Built, 6.49.0 |
| P5 | A progress line during a long verify: label, elapsed, last duration | Built, 7.10.0 |
| P2 | Affected-only runs for inner steps (pytest-testmon, `vitest related`), opt-in, full run at the gate. Measured: 16–23 s instead of 104 s | Not started |
| P3 | `build.md` Step 3 uses P2 and runs the full suite once per batch. Interactive workflow: its own PR, proven by an agent-layer eval | Full suite once: done by 7.3.0. Use of P2: not started |
| P6 | Eval verdicts in the ledger, keyed on the evalset, its prompts and the model | Built, 7.10.0: keyed on the whole tree (evalsets, prompts, code), the root `.env` files and every `*MODEL*` variable |

## Limits of P1

- The ledger is per branch, so a verdict from `main` (or from `conductor loop doctor`) never serves a loop item branch. P1 removes the re-run inside one item's run, not the first run.
- Ignored files other than the root `.env*` (a virtual environment, `node_modules`) are not in the key. A dependency change between two verifies of one item is not seen. The same limit already applies to `pre-push`.
