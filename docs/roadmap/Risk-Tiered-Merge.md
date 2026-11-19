# Risk-tiered merge, and the verification backlog from Anthropic's articles

> **Status:** 2026-11-18. Step 1 (the `risk` block, F17 and F21) built in 7.6.0, proven through the real CLI with the stub engine and stub `gh`. Not yet run on a live project or against GitLab. F7, F8, F9/F10, F12 and F22 built in 7.6.0. Reviewer-recall eval run twice on autopportunity (20 cases, `test/evals/README.md`). F23, the auto-merge breaker, built in 7.7.0. F24, checklist triggers, built in 7.8.0. F25, the `Verified:` stamp, built in 7.9.0. F18 is dropped.

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

- **F7 A `/verify` skill that starts, drives and inspects the running app** before a change is called done. Anthropic's top lever. Built as `carja app up|check|down` (`src/commands/app.js`) from the `app` block; the driving method stays in `behavior-validator`, which Ship already runs. Not built: the loop starting the app after verify, which needs a sandbox that lets a beat reach a local port.
- **F8 Observe mode for gates.** Built: `gates.<name>: "observe"` for the pre-commit policy gates (`carja_gate_blocks` in `lib.sh`), read from `HEAD`, counted by `carja status`. No "off" mode: observe logs everything off would hide. The gates that protect the gates, and the push gates, always enforce.
- **F9/F10 Turn misses into rules, and measure the reviewer** on past incidents and reverts, with clean merged changes as a control. Built: `src/reviewer-recall.js` (reverts, `Fixes:` trailers, SZZ; location key; separate recall and control scores), `test/evals/reviewer-recall/run.mjs`, and `carja review-log rules` (`src/review-rules.js`). Not built: the three agents that try to disprove a candidate rule; the owner approves it in the MR instead.
- **F12 A Pre-existing finding tag.** Built: `reviewer.md` defines it, `src/loop/checker.js` (`preExistingFindings`) keeps it out of the Maker's next prompt, the loop records it in its messages.
- **F22 merge-stack retries a red pipeline once and resolves a code conflict itself** before it stops. Built: `retryPipeline` in both forges (`src/loop/merge-stack.js`); the conflict is resolved by the agent in `workflows/merge-stack.md`, since a code merge needs judgement and a verify run.
- **F18 dropped** (owner): rerunning the checks on the combined result would cost 40 to 50 minutes per item on autopportunity.

## Step 2: the auto-merge breaker (F23, 7.7.0)

The code review post plans "circuit breakers that tighten approval when revert or incident numbers move". Each item merged without the owner goes into `.git/carja-auto-merges.jsonl` (base and head per repository, MR URL). Before the next such merge, the default branch of each repository is read for the last `risk.breaker_days`; a revert counts when it names a commit of base..head, the merge commit (second parent = head) or the MR. At `risk.breaker_reverts` reverted items, medium goes back to the owner. Stateless: no reset command, the window closes it. Low stays automatic: it is only what `risk.low_paths` names.

## Step 3: checklist items triggered by the diff (F24, 7.8.0)

A held-out check (`test/evals/README.md`) showed a checklist rule turning a missed bug class into a found one, so the checklist will grow with each miss. `trigger:` keeps that cheap: the driver gives the Checker only the items whose globs match the changed files, plus every item without a trigger, read from the base branch. `carja checklist` does the same for interactive reviews. Globs only, no content patterns: a path says enough for the rules seen so far.

## Step 4: a verification stamp on every commit (F25, 7.9.0)

The `prepare-commit-msg` hook adds `Verified: <label>: <command>, exit 0, <time>` for each green `carja evidence run` recorded on exactly the tree being committed (the index), or `Verified: none`. It runs under `--no-verify` too and never blocks. The stamp is machine-local, like the ledger: it says what ran on this machine, not what CI did. Not built: reading the stamps in the breaker or the stack report.
