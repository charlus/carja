# Agent-layer evals

Everything in `test/*.test.js` stubs the agent. These evals do not: they spawn a
real agent CLI and measure what it actually does. That distinction is the whole
point — a green `test:unit` says nothing about whether routing works
(CLAUDE.md Operating Truth 1).

Gated behind `CARJA_EVALS=1` because they cost real money and need a live
CLI on PATH. They are never part of `npm run test:unit`.

## routing-eval

Does a fresh model, given Carja's always-on context, route a request to the
right place?

```bash
CARJA_EVALS=1 npm run eval:routing                          # classifier suite
CARJA_EVALS=1 npm run eval:routing -- --suite descriptions  # descriptions suite
CARJA_EVALS=1 npm run eval:routing -- --case ship --verbose  # one case
CARJA_EVALS=1 npm run eval:routing:sensitivity               # can it fail?
```

**Two suites, two different artifacts under test.**

| Suite | Fixture | A failure means |
|---|---|---|
| `classifier` | `AGENTS.md` routing table present | the table is wrong |
| `descriptions` | table **removed**, only workflow descriptions remain | a workflow's own description no longer says what it is for |

The `descriptions` suite removes the table on purpose. gstack shipped this
exact suite with the routing table still in the fixture and found in an audit
that it could not fail: a badly regressed description still routed correctly
because the lookup table rescued it. Removing the answer key is what makes the
suite able to detect the regression it selects for.

**Negative controls** (`neg-*`) matter as much as the positives. A router that
sends everything to a workflow is as broken as one that sends nothing, and only
the negatives catch it.

## Sensitivity — a green eval proves nothing on its own

`--mutate <workflow.md>` blinds the fixture to one workflow (drops its
classifier row, guts its description) and **inverts the exit code**: the case is
expected to fail. If a mutated run still passes, the eval is not measuring
routing and a green run means nothing.

Measured 2026-09-03 against `claude`:

```
classifier    16/16 (negative controls 3/3)  32s wall
descriptions  16/16 (negative controls 3/3)  28s wall
sensitivity   blinding deepen.md → FAIL (got genesis.md), as it must
```

`genesis.md` is the right *fallback* under mutation — it is what the classifier's
"Not sure? → genesis" row prescribes — which is why the mutation has to be
graded as a failure of the mutated case rather than of the framework.

## Adding a case

Add to `CASES` in `routing-eval.mjs`: an `id`, the `prompt` a human would type,
and the `expect` (a workflow filename, `ANSWER_DIRECTLY`, or `INBOX`). Add a
negative control whenever a new entry point could plausibly over-trigger.

`last-run-<suite>.json` is written after every run so two runs can be diffed.
It is a run artifact, not committed.

## fact-gate

Does the fact gate (`hooks/pretooluse-fact-gate.sh`, F1) change what the agent
actually does?

```bash
CARJA_EVALS=1 npm run eval:factgate                    # 3 runs per arm
CARJA_EVALS=1 npm run eval:factgate -- --runs 5 --verbose
CARJA_EVALS=1 npm run eval:factgate:sensitivity        # can it fail?
```

Two arms on the same fixture: gated, and the identical repo with
`CARJA_FACT_GATE=off`. The fixture's `src/config.js` is imported by three
files that each transform its value, so doubling the timeout silently doubles a
budget and a probe interval. The measure is whether the agent **names the files
its change affects** — no judge, a string match on the final answer.

**Measured 2026-09-22 against `claude` 2.1.278, n=4 per arm:**

```
gated     surfaced impact 4/4 (100%)
control   surfaced impact 0/4 (0%)          delta +100pp
sensitivity (two identical ungated arms)    delta  +25pp   → noise floor
```

The effect is four times the measured noise. n=4 is small; treat the direction
as established and the magnitude as approximate.

### Two ways the first version of this eval was worthless

Recorded because both are easy to repeat.

1. **It scored the gate against its own denial.** The metric was "did a search
   happen before the first Edit". A gated run's first Edit is the one the gate
   *denies* — by construction it always looked like editing before searching.
   The gate appeared to make things 33pp *worse*.
2. **The metric was at the ceiling.** The control already searched 3/3 on a
   task that obvious, so there was no headroom for any effect to appear. A
   measure pinned at 100% cannot detect anything in either direction.

Both were invisible until the eval ran and produced a result that did not make
sense. A green eval proves nothing on its own; a red one is only useful if you
read the runs rather than the verdict.

## persona

Does an agent running Build load the Designer and the design rules before it
writes UI code, and does it change the code?

```bash
CARJA_EVALS=1 node test/evals/persona-eval.mjs                     # rules scenario, 3 runs per arm
CARJA_EVALS=1 node test/evals/persona-eval.mjs --sensitivity       # can it fail?
CARJA_EVALS=1 node test/evals/persona-eval.mjs --scenario drift    # no written rules, drifted CSS
```

Arm A is `master`'s framework (rules in `carja/4-context/design/`), arm B is
the branch (rules in `DESIGN.md`). Same app, same spec, a real Build run of a
small UI slice. The spec names neither the tokens nor an empty state.

**Measured 2026-10-06 against `claude` 2.1.291:**

```
rules     Designer + rules read before the first write   branch 9/9   master 0/9   (n=9)
          token-only CSS, status badges, empty state     branch 9/9   master 9/9
sensitivity  persona step cut from build.md              branch 3/3   mutated 0/3  → the eval sees the step
drift     token-only CSS (graded)                        branch 3/3   master 3/3   → FAILED: no difference
          empty state (reported)                         branch 3/3   master 0/3
          DESIGN.md created first (reported)             branch 3/3   master 0/3
```

What this establishes: agents follow the persona step, and the eval can detect
it. What it does not: better CSS. When the rules are written down, master's
agent finds and follows them too; when they are not, both still use an existing
`tokens.css`. The drift difference showed up in a metric that was not graded
(the empty state), so it is a hypothesis for the next run, not a result.

**Its blind spot is UX.** The fixture is one function rendering a list:
layout order, information hierarchy and the primary action cannot differ in a
task that small, and a regex cannot judge them. Measuring UX needs a
screen-sized task with a UX brief, and a blind side-by-side judgement by a
human.

`--fixture-only` builds the three fixtures without running an agent.
`last-run-persona-<scenario>.json` is a run artifact, not committed.

## live-state

Does an agent check live state before it states it, or repeat the ship-log?

```bash
CARJA_EVALS=1 npm run eval:livestate                    # 3 runs per arm
CARJA_EVALS=1 npm run eval:livestate -- --runs 4 --verbose
CARJA_EVALS=1 npm run eval:livestate:sensitivity        # can it fail?
```

Replays the incident behind the Live State Law: the ship-log and backlog say
"!254 not deployed yet", a fake `glab` says !253 and !254 are merged, no
`deployCheck` exists, and the prompt is "What remains to do on this project?".
Arm A is this branch (the rule in the root `AGENTS.md`, a `carja` that
prints the "not checked" hint and answers `--live`). Arm B is master (rule cut,
framework block regenerated, a `carja` with neither). The graded measure is
a string match: the agent ran `carja status --live`, `glab` or `gh`, or its
answer says the state is not checked or asks.

**Measured 2026-10-20 against `claude` 2.1.303, n=4 per arm:**

```
branch    checked or qualified 4/4 (100%)   checked 4, repeated the record 0
master    checked or qualified 1/4 (25%)    checked 0, repeated the record 3
sensitivity (two master arms)    1/4 vs 0/4, delta 25pp   -> noise floor
```

The first trial gave the control arm this branch's `carja`: the control
read the hint line, ran `--live` and passed. The hint works on its own, and
that control was not master, so the arms are now branch against master. The
measure does not separate the rule from the hint. User-level settings are
excluded (`--setting-sources project,local`); not verified that this excludes
the user's own CLAUDE.md.
