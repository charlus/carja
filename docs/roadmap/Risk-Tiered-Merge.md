# Risk-tiered merge, and the verification backlog from Anthropic's articles

> **Status:** 2026-11-18. Step 1 (the `risk` block, F17 and F21) built in 7.6.0, proven through the real CLI with the stub engine and stub `gh`. Not yet run on a live project or against GitLab. F7, F8, F9/F10 and F12 are planned, not built. F18 is dropped.

## Why

The owner works alone and was answering for every item of a stacked run, and for each dependency the Technical Vision did not name ("version dependency decisions I couldn't care less about"). Anthropic's code review post (claude.dev, "Solving code review at Anthropic") merges low-risk changes with no human approval once review and security checks are green. The owner's rule: low and medium merge without them, high waits.

## Decisions

- **D1 The owner defines high.** `risk.high_means` replaces the built-in rule ("anything a user would notice or that is hard to undo") in the beat prompt and the Checker brief. The built-in rule made the Maker rate too much as high or medium for this owner. Other owners keep it.
- **D2 Tier = the highest signal.** Paths (`high_paths`, `low_paths`), the Maker's rulings, owner actions and the driver's hints (migration, new environment variable, deployment change: high; a dependency that passed the gate: medium), documents merged from both sides (medium). Default: medium.
- **D3 The loop merges (owner, Q1: "your pick").** At the end of `carja loop <project>`, the items below `risk.owner_review` are merged bottom first by the same walk as `carja merge-stack`, through the MR API, no squash, at the checked head, on a green pipeline. It waits up to 60 minutes per MR: autopportunity pipelines run 40 to 50 minutes.
- **D4 Fixed, whatever the config says.** `high` always waits. The gates (`.agents/**`, `.claude/**`, CI files, `.husky/**`, `.pre-commit-config.yaml`) and `carja.config.json` are always high, so a change never merges an edit to its own checks or to this policy. An item adopted from an earlier run, or with no record of its files, is high.
- **D5 Opt-in.** Without a `risk` block the loop merges nothing and `merge-stack` stops as in 7.5.0.
- **D6 Dependencies (F21).** With medium not reviewed, a dependency that passed every check (exists, pinned, old enough, not yanked, no OSV advisory) is installed without a question round and logged as a medium ruling. A failed check still asks; an unreachable registry still stops.

## Safety envelope

PR-gated merge holds: merges go through the forge's MR API, never a push. Fail-safe holds: an item without a recorded review or file list is high. Only items whose task reached `merged` (Checker APPROVE, MR opened) enter the stack.

## Backlog (owner approved 2026-11-18)

- **F7 A `/verify` skill that starts, drives and inspects the running app** before a change is called done. Anthropic's top lever.
- **F8 Observe mode for gates** (off, observe, enforce): log what would have been blocked before enforcing.
- **F9/F10 Turn misses into rules, and measure the reviewer** on past incidents and reverts, with clean merged changes as a control.
- **F12 A Pre-existing finding tag.** Anthropic found 59% of repeated findings predated the change.
- **F22 merge-stack retries a red pipeline once and resolves a code conflict itself** before it stops.
- **F18 dropped** (owner): rerunning the checks on the combined result would cost 40 to 50 minutes per item on autopportunity.
