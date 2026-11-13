# Model Roles

> **Status (2026-11-13):** D1–D5 built in 7.4.0 (branch `feat/model-roles`). Unit suite green. Not live-proven: no loop run has planned on one model and built on another yet, and the `codex` and `agy` flags are tested on the argument list only.

## Why

The owner asked whether Carja supports planning on Fable 5.2 and building on Opus 5.5. The loop could do it on Claude only, through `loop.models`. Four places hardcoded model names, strengths or prices, and each went stale with the next model release:

- the doctor's ranking `haiku < sonnet < opus` (`src/loop/doctor.js`), which skipped Fable without a warning;
- the two profiles and their help texts;
- the `model-routing` skill's table (it listed Fable 5, Opus 4.8, Sonnet 5 and Haiku 4.5 with prices);
- the reviewer's model, taken from that table.

The codex adapter ignored the model, no engine received an effort, and interactive sessions read no model setting at all.

## Decisions (owner, 2026-11-13)

**D1. One `models` block, roles not models.** `plan`, `build`, `review`, `bookkeeping`, `escalate`, each a model id or `{ "model": …, "effort": … }`. The interactive workflows and the loop read the same block. A role left unset runs on the engine's default. The loop's beat kinds map to roles: maker → build, maker_escalation → escalate, checker → review, spec and blueprint → plan, ship → bookkeeping.

**D2. Presets in the project config.** `models.preset` names one, `models.presets` holds the project's own. `quality` and `balanced` stay built in, written with the engine's aliases (`opus`, `sonnet`), which resolve to the latest version and so do not go stale. A role set directly wins over the preset. Order for each loop beat kind: `models.<role>`, `loop.models.<kind>` (7.x), `models.preset`, `loop.profile` (7.x).

**D3. The project ranks its own models.** `models.rank`, strongest first; a preset may carry one. The doctor warns when the reviewer ranks below the builder, and, with two different models and no rank, says it cannot tell and how to fix it.

**D4. Interactive use through files.** The main session runs one model at a time. Spec-It's last line names `/model <build model>` before `/build`; `carja models` prints the `/model` command for each step. The reviewer runs on the `review` model. The `model-routing` skill keeps the roles and the principles and sends the reader to the provider's model list.

**D5. Every engine takes the model and the effort.** `claude`: `--model`, `--effort`. `agy`: `--model`, `--effort`. `codex`: `-m`, `-c model_reasoning_effort="…"`. Each adapter declares `takesModel`; an engine without it gets a warning, never a silent default.

## What Carja still names

The two built-in presets, on aliases. Nothing else: no ids, no ranking, no prices. Costs come from the engine's own report, as before.

## Proof

- `test/model-roles.test.js`: resolution and precedence, invalid values, presets, the 7.x settings, the loop's beat kinds with effort, the three engines' arguments, the doctor with a family Carja does not know, and `carja models` through the real CLI.
- Outstanding: a live loop run with `plan` on Fable and `build` on Opus, and one beat each on `codex` and `agy` with a model and an effort.

## Not done

- Whether planning on a stronger model improves the result is not measured. The longitudinal benchmark is at its ceiling (7.3.0 passes 100%), so it cannot show it. The Autopportunity replay (estimated €150–300) can.
- Anthropic's migration notes say prompts written for earlier models are often too prescriptive for Fable 5.2. Spec-It was not adapted.
