# Release gate

> **Status (2026-11-13):** built on `feat/release-gate` (7.4.2). 7.1.0 and 7.3.0 recorded from their stored runs. The 7.4.1 run is the first one made by the gate itself.

A change to `templates/` ships only when the longitudinal benchmark holds quality and does not cost clearly more than the last release that passed. Before this, only 7.3.0 was measured, and its planned saving turned into a cost rise of 14%.

## What runs

The longitudinal benchmark of the outcome eval: Roombook, an original CLI product built over 8 dependent feature requests, one fresh headless session per request, the repository the only thing carried between sessions. Hidden black-box tests grade every feature after every session. The gate runs the carja arm only, 5 chains, on Sonnet (`claude-sonnet-5-5`), with Spec-It then Build. The bare arm is not rerun: its 7.1.0 results stay the reference.

The material is in `test/evals/longitudinal/fixture/`, identical (SHA-256 manifest) to the 7.1.0 and 7.3.0 runs. Cost per run: about $20–25 list price and 1–2 hours.

```bash
npm run eval:release                  # run on HEAD (committed), record the verdict
npm run eval:release -- status        # is templates/ on disk covered?
npm run eval:release -- waive --reason "<why this change cannot move the result>"
```

## The rule

| | Threshold | Why |
|---|---|---|
| Quality | mean final share ≥ 98%, every chain ≥ 95%, earlier features kept ≥ 98% | 7.1.0 scored 99.6%, 7.3.0 100%, bare 95.0%. One unwritten convention costs a chain about 10 points |
| Cost | fail above 1.25× the baseline's mean cost per chain, note above 1.10× | the cost of one chain varies by about ±20%, so 5 chains cannot detect less |
| Complete | 5 chains × 8 steps | an infrastructure failure is retried, never graded |

The baseline is the last passing row on the same model and the same material. A new model or new material starts a new baseline: quality is judged, cost is recorded.

`test/release-gate.test.js` fails while the `templates/` tree on disk has no passing or waived row in `test/evals/longitudinal/releases.jsonl`. A change outside `templates/` needs no run. A waiver is a row in the same file, so it is visible in the PR.

## Limits

- The benchmark is at its ceiling (100% on 7.3.0). It detects regressions, not improvements.
- It measures Spec-It and Build on a small product. It does not measure the loop, other engines, or changes in `src/` that the agent calls through `carja`.
- Cost below +25% is inside the noise. 7.3.0's +14% would pass with a note.
