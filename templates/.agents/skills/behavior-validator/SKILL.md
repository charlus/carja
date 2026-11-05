---
name: behavior-validator
description: "Source-blind, black-box validation of the RUNNING artifact. When a change claims to work, a validator that has NOT read the implementation exercises the live app/CLI/API as a real operator would — with adversarial anti-cheat probes — and reports observed behavior against a contract. The dynamic complement to verification-gate (author-run) and independent-review (static review of the diff)."
category: core
---

# Behavior Validator (Black-Box, Source-Blind)

> Reading the code tells you what it was *meant* to do. Exercising the running thing tells you what it *actually* does. A validator that can see the implementation is tempted to confirm the code "looks right" instead of observing behavior — the same anchoring bias that makes an author a poor reviewer of their own work. So this gate runs **source-blind**: it never reads the diff, tests, or source while validating. It only drives the live artifact and reports what it sees.

This is Carja's third verification leg, and the three are distinct — don't collapse them:

| Gate | Vantage | Question |
|---|---|---|
| `verification-gate` | Author, runs the command | "Did I run it and read a clean exit code, this message?" |
| `independent-review` | Fresh context, reads the artifact | "Given the spec, is what's *written* ready?" |
| **`behavior-validator`** (this) | Source-blind, drives the running thing | "As an operator, does it *actually behave* per contract — and not just fake success?" |

## When to run it

Run it when a change has an **observable runtime surface** and the claim "it works" is consequential — a user-facing flow, a CLI, an API endpoint, a stateful operation, a generated artifact a human will use. Scale to stakes (`skills/model-routing/SKILL.md`).

- **Run it for:** anything where a passing test suite is not the same as the feature working (state that must persist, a button that must trigger a real effect, an endpoint that must reject bad input, a migration that must actually move data).
- **Skip it for:** changes with no runtime surface to drive — docs, comments, pure refactors already covered green by the suite, config with no observable effect. There's nothing to observe; forcing the gate is theater.
- It **complements, never replaces**, the suite. Green tests + author-run verification remain the floor (`.agents/rules/verification-iron-law.md`); this gate catches what green tests miss because the tests themselves can be wrong or reward-hacked.

## The behavior contract

> **Rubric v1** — the contract clauses + anti-cheat probes are this gate's rubric; versioned and calibrated (see Calibration in `skills/judge-panel/SKILL.md`). Spot-check verdicts against a human's; a validator that always PASSes isn't validating.

Validate against a contract, not a vibe. **Read the contract first; if none exists, write a short one from the acceptance criteria / goal before testing.** A contract states:

1. **User tasks** — the workflows a real operator performs, in their words.
2. **Expected observable behavior** — what should be visible/returned/persisted for each, phrased as an outcome, not an implementation detail.
3. **Anti-tampering probes** — the specific adversarial checks that separate real behavior from cosmetic success (see below).
4. **Setup / runtime access** — URLs, commands, endpoints, fixtures, credentials needed to exercise it.
5. **Evidence spec** — what to capture as proof (which outputs, screenshots, responses), and what to redact.

For most Carja work the spec's acceptance criteria (`skills/spec-it` output) *are* the first three; this gate turns them from prose into an executed check.

## The procedure

1. **Parse the contract** into individually testable clauses.
2. **Get runtime access** — start/reach the artifact the way an operator would (`skills/run` / the project's run recipe). If you cannot reach it, **block** — do not infer behavior from the code.
3. **Stay source-blind.** Do **not** open the diff, source, or tests during validation. If you catch yourself reasoning "the code does X so it must…", stop — go observe X instead.
4. **Exercise each user task** as an operator, capturing what actually happens.
5. **Run the anti-cheat probes** (below) — this is the part that earns the gate its keep.
6. **Capture redacted evidence** — real outputs/responses/screenshots proving each clause; strip credentials, tokens, and secrets.
7. **Emit a structured verdict** clause-by-clause: `PASS` / `FAIL` / `BLOCKED` / `OUT-OF-SCOPE`, each backed by captured evidence, each `FAIL` located and reproducible.

## Anti-cheat probes (the point of the gate)

Cosmetic compliance passes a naive check; these probes defeat it:

- **Vary the inputs.** Don't reuse the happy-path fixture the author used. Different data, boundary values, empty and oversized inputs.
- **Feed invalid input.** It must reject/handle it, not crash or silently accept.
- **Check persistence for real.** After a "saved!" message, re-fetch / reload / re-query from a cold path and confirm the state actually changed — a success toast is not proof.
- **Confirm effects, not messages.** A button that shows "Done" must produce the downstream effect; an endpoint that returns 200 must have done the thing.
- **Retry / idempotency.** Repeat the operation — does it double-apply, error, or behave sanely?
- **Static-state smell.** If the "result" is identical regardless of input, suspect a hardcoded/fabricated response.

This is the runtime sibling of the reward-hacking check in `independent-review` (assertions weakened, failing tests deleted, mocks hardcoded to pass): that lens reads the tests, this one refuses to trust them and goes to the source of truth — observed behavior.

## Boundaries (non-negotiable)

- **Report only.** The validator does not fix, edit, push, or merge — it produces the verdict; the accountable agent fixes and re-verifies (`.agents/rules/verification-iron-law.md`). A validator's "looks fine" is never the completion proof.
- **Block, don't fake.** No runtime access / missing credentials / no tool → verdict `BLOCKED`, not an inferred `PASS`. Explicitly declared exclusions → `OUT-OF-SCOPE`. Never invent evidence.
- **Source-blindness is the discipline.** The moment it reads the implementation to explain a result, it has become a code review, not a behavior validation — and lost the independence that made it worth running.

## In the autonomous loop

- The independent Checker (`workflows/loop-checker.md`) can run this gate over the running artifact after the green-verify floor — a black-box pass on top of the exit-code floor, catching reward-hacked greens the static review might rationalize.
- Record the contract, the probes run, and the evidence location in `0-compass/ship-log.md` so autonomous validation stays auditable.
- Degrade gracefully: no runtime/sandbox to exercise the artifact → the gate is `BLOCKED`, which is itself a signal (an L3 execution beat that can't be behavior-validated shouldn't claim done), not something to skip silently.

## Anti-patterns

- Reading the diff "just to know where to look" — that reintroduces the anchoring bias the gate exists to remove.
- Reusing the author's happy-path fixture as the only input — proves the demo, not the behavior.
- Accepting a success message as proof of a state change — always re-read state from a cold path.
- Turning `BLOCKED` into `PASS` because "the code clearly does it" — that's the exact failure the gate prevents.
