---
name: model-routing
description: "Use when deciding which model and reasoning effort a step, subagent or loop role runs on: plan on a strong model, build on a capable one, review on one at least as strong as the builder. Reach for it when spinning up a reviewer or scout, configuring the loop, or when a task is either trivially mechanical or unusually hard."
category: core
---

# Model Routing

> Running every task on the top model wastes budget; running everything on a cheap model fails the hard ones. Match capability and effort to the step.

## The project names the models, Carja names the roles

Carja ships no list of models, strengths or prices: they change every few months. The project sets them once, in the `models` block of `carja.config.json`. `carja models` shows each role, where its model comes from, and the `/model` command for an interactive step.

| Role | Runs | Typical choice |
|---|---|---|
| `plan` | Spec-It, Technical Vision, Carve; the loop's spec and design beats | The strongest model you can afford: a wrong plan costs every task after it |
| `build` | Build; the loop's Maker | A capable coding model; the tests now define "done" |
| `review` | the independent reviewer; the loop's Checker | At least as strong as `build`: a weaker verifier is a false safety signal |
| `bookkeeping` | the loop's Ship beat | A fast model: mechanical, well specified |
| `escalate` | the loop's Maker after two rejections | A stronger model than `build`, where the difficulty is |

A role is a model id (`"claude-opus-5-5"`) or `{ "model": …, "effort": … }`. A role left unset runs on the engine's default. `models.rank` lists your models, strongest first, so the loop doctor can check that `review` is not weaker than `build`. For the current models, their strengths and prices, read your provider's model list (Claude Code: `/model`), never memory.

## The routing principle

1. **Hard reasoning, open-ended or high-stakes → the strongest model.** Architecture, ambiguous specs, security review, hard debugging.
2. **Specified build work → a capable model at a high effort.** The default for most implementation.
3. **Mechanical, fully specified, high-volume → the fast model.** Bulk edits, formatting, plain searches, bookkeeping.
4. **Escalate on failure, do not start high.** Two rejections are the loop's trigger (`escalate`).

## Effort is the second dial

Effort (`low` … `max` on Claude; each engine names its own levels) trades thoroughness for tokens and time on the same model. A strong model at a lower effort is often cheaper *and* better than a weak model straining at a hard task. Tune both dials; measure before raising a default.

## Interactive sessions

The main session runs one model at a time. Switch it between steps: `/model <plan model>` before Spec-It, `/model <build model>` before Build. Spec-It and Build pass state through files, so nothing is lost. Run the reviewer subagent on the `review` model: pass the harness's name for it (for Claude Code's subagent `model`, the family alias of that model).

## Anti-patterns

- Every step on the most expensive model "to be safe": no gain on easy steps.
- Every step on the cheapest model: silent quality loss where it matters.
- Lowering the model when the fix is lowering effort, or the reverse.
- Verifying a change with a weaker model than the one that wrote it.
- Copying a model name, a strength or a price from memory into a document: it goes stale.
