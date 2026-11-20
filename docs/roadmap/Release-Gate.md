# Release gate

> **Status (2026-11-20):** no longer a gate (7.11.1). A sensitivity check showed it cannot see the method removed (below). `test/release-gate.test.js` and the `status` and `waive` commands are removed. The benchmark stays as a manual measurement, `npm run eval:longitudinal`. Built on `feat/release-gate` (7.4.2).

A change to `templates/` ships only when the longitudinal benchmark holds quality and does not cost clearly more than the last release that passed. Before this, only 7.3.0 was measured, and its planned saving turned into a cost rise of 14%.

## What runs

The longitudinal benchmark of the outcome eval: Roombook, an original CLI product built over 8 dependent feature requests, one fresh headless session per request, the repository the only thing carried between sessions. Hidden black-box tests grade every feature after every session. The gate runs the carja arm only, 5 chains, on Sonnet (`claude-sonnet-5-5`), with Spec-It then Build. The bare arm is not rerun: its 7.1.0 results stay the reference.

The material is in `test/evals/longitudinal/fixture/`, identical (SHA-256 manifest) to the 7.1.0 and 7.3.0 runs. Cost per run: about $20–25 list price and 1–2 hours.

```bash
npm run eval:longitudinal             # run on HEAD (committed), record the verdict
```

## The verdict

| | Threshold | Why |
|---|---|---|
| Quality | mean final share ≥ 98%, every chain ≥ 95%, earlier features kept ≥ 98% | 7.1.0 scored 99.6%, 7.3.0 100%, bare 95.0%. One unwritten convention costs a chain about 10 points |
| Cost | fail above 1.25× the baseline's mean cost per chain, note above 1.10× | the cost of one chain varies by about ±20%, so 5 chains cannot detect less |
| Complete | 5 chains × 8 steps | an infrastructure failure is retried, never graded |

The baseline is the last passing row on the same model and the same material. A new model or new material starts a new baseline: quality is judged, cost is recorded.

Until 7.11.1, `test/release-gate.test.js` failed while the `templates/` tree on disk had no passing or waived row. That test is removed.

## Limits

- The benchmark is at its ceiling (100% on 7.3.0). It detects regressions, not improvements.
- It measures Spec-It and Build on a small product. It does not measure the loop, other engines, or changes in `src/` that the agent calls through `carja`.
- Cost below +25% is inside the noise. 7.3.0's +14% would pass with a note.

## Sensitivity check (2026-11-20)

A gate is worth its cost only if it fails on a real defect. Five runs (7.1.0 to 7.11.0) all passed, with mean final shares between 99.2% and 100%. To test whether it can fail, the candidate was `master` (7.11.0) with `rules/test-driven-law.md`, `rules/verification-iron-law.md`, `skills/independent-review/` and `skills/code-review/` deleted.

| | Graded steps | Lowest cumulative share | Lowest earlier-features kept | Cost per step |
|---|---|---|---|---|
| 7.11.0 (full) | 40 of 40 | 100% | 100% | about $0.62 |
| Degraded | 19 of 40 | 100% | 100% | about $0.43 |

The degraded run stopped at the usage limit, which the gate runs had helped to reach, and was not resumed: the remaining steps would have had to fall sharply for a fail, and nothing in the run suggested it. The benchmark does not need these rules to score 100%. Either the fixture is too easy or these rules do not change results on a small, well-specified product. The data cannot separate the two.

Decision (owner, 2026-11-20): no model eval blocks a change. The benchmark becomes a gate again only with a fixture on which a normal run scores clearly below 100% and a degraded candidate fails.
