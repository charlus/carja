---
name: model-routing
description: "Use when deciding which model tier to run a task, subagent, or loop role on — match model capability and reasoning effort to task difficulty instead of defaulting to one model for everything. Reach for it when spinning up scouts/Checkers, configuring the autonomous loop, or when a task is either trivially mechanical or unusually hard."
category: core
---

# Model Routing (Right Model for the Job)

> Running every task on the top model wastes budget; running everything on a cheap model fails the hard ones. The lever is **match capability to task difficulty** — and, on a chosen model, tune reasoning **effort**. This is Karpathy's autonomy-slider thinking applied to model choice.

## The routing principle

1. **Hard reasoning / open-ended / high-stakes → the strongest tier.** Architecture, gnarly debugging, security review, ambiguous specs, long-horizon autonomous runs. A wrong answer here is expensive; pay for capability.
2. **Balanced build work → the mid tier.** Most implementation tasks, code review, spec-writing — where you want strong quality at sustainable cost. This is the sensible **default**.
3. **Mechanical / well-specified / high-volume → the fast tier.** Bulk edits, formatting, simple scouts, classification, boilerplate, renaming. The task is fully specified; you're paying for throughput, not judgment.
4. **Escalate on failure, don't start high.** Try the cheaper tier first for anything routine; if it stalls or the output is weak, escalate a tier. The loop's stall detection (`rules/loop-guardrails.md`) is a natural escalation trigger.

## Claude model tiers (as of 2026)

Carja targets **Claude Code first**. Current lineup, strongest → cheapest:

| Tier | Model (exact ID) | Best at | Rough cost (in/out per M) |
|---|---|---|---|
| Frontier | `claude-fable-5` | The most demanding reasoning and longest-horizon agentic work; reserve for genuinely hard problems | $10 / $50 |
| Top Opus | `claude-opus-4-8` | Highly autonomous long-horizon agentic work, knowledge work, memory, hardest debugging/architecture | $5 / $25 |
| Balanced | `claude-sonnet-5` | Near-Opus quality on coding and agentic work at lower cost — the everyday build default | $3 / $15 |
| Fast | `claude-haiku-4-5` | Fastest and cheapest — mechanical, well-scoped, high-volume subtasks | $1 / $5 |

Use the exact ID strings verbatim — never append date suffixes. Prices guide relative choice, not billing precision; re-check if cost-critical.

## Effort is the second dial

On current Claude models, reasoning **effort** (`low` → `medium` → `high` → `xhigh` → `max`) trades thoroughness for tokens/latency independently of the model:

- **`low`** — simple subagents, mechanical tasks, latency-sensitive lookups.
- **`high`** — the sweet spot for most intelligence-sensitive work (the usual default).
- **`xhigh`** — the best setting for hard coding and agentic tasks on the top tiers.
- **`max`** — when correctness matters more than cost; expect diminishing returns and occasional overthinking.

A capable model at low effort can be cheaper *and* better than a weak model straining at a hard task — tune both dials, don't just downgrade the model.

## In the autonomous loop / swarm

When the driver dispatches roles (see `workflows/unattended-loop.md`, ADR-0001 D4), route by role and task-type:

- **Makers** on the balanced tier by default; the top/frontier tier for tasks the Carve graph flags as complex (architecture, tricky algorithms).
- **TDD split roles** (when `tdd_split` is on): the **test-author** needs strong spec comprehension to encode the contract correctly — don't cheap out on it, a weak contract mis-specifies the whole task; the **implementer** can run on the balanced tier since the tests now define "done".
- **Checkers** verifying high-stakes diffs (security, auth, data migrations) on a strong tier — a weak verifier is a false safety signal. Simple "did the tests pass" mechanical checks can run cheap.
- **Scouts** (see `subagent-isolation`) doing plain searches/reads on the fast tier.
- Record the model used for each autonomous action in `0-compass/ship-log.md` so cost and routing stay auditable.

## Anti-patterns

- Defaulting everything to the most expensive model "to be safe" — burns budget with no quality gain on easy tasks.
- Defaulting everything to the cheapest model — silent quality loss on the tasks that matter.
- Downgrading the model when the real fix is lowering effort (or vice versa).
- Verifying a high-stakes change with a weaker model than the one that wrote it.
