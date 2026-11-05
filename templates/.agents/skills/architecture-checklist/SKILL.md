---
name: architecture-checklist
description: "Turn 'follow the architecture' into explicit, checkable items. Technical-Vision/Carve write a machine-readable compliance checklist from the architecture decisions; the Checker (loop + independent-review) verifies each item against the diff instead of vibing 'looks right'. Items are deterministic (carry a `check:` shell command) or semantic (the Checker judges them). This is the semantic half of the ship-contract; the Eval-Driven Law is the deterministic half."
category: core
---

# Architecture Checklist (the ship-contract)

> "Follow the architecture" is unverifiable — a reviewer can't check a vibe. An architecture decision only has teeth if it becomes a **checkable item**: a statement a fresh reviewer (or a shell command) can mark pass/fail against the actual diff. This is agentctl's `ARCHITECTURE_CHECKLIST.md` insight, made to fit Carja's Maker/Checker split: the architecture author writes the contract; the Checker enforces it.

## The ship-contract, in two halves

A change ships only if it satisfies the project's ship-contract. Two complementary halves, two enforcement paths:

| Half | What it covers | Enforced by |
|---|---|---|
| **Deterministic** | Facts a command can decide: a test exists, an eval exists, a grep is clean, a layer boundary holds | git hooks / CI — the **Test-Driven Law**, the **Eval-Driven Law**, and any checklist item with a `check:` command |
| **Semantic** | Judgments only a reader can make: does this honor the intended architecture, are the boundaries respected in spirit, is the trade-off the one we chose | the **Checker** (`workflows/loop-checker.md`) and `independent-review` |

The architecture checklist spans both: each item is either deterministic (has a `check:`) or semantic (the Checker reads the diff and decides). Prefer a `check:` whenever the rule is grep-able — a command that can't be argued with beats a reviewer who might miss it (the same reason Carja backs its laws with hooks, not just prose).

## Where it lives

`carja/0-compass/architecture-checklist.md` — alongside the compass, because it's a durable, project-level contract, not per-feature scratch. One per project; it grows as architecture decisions accrue.

## The format

A flat list. Each item: a one-line **compliance statement** (assertable as pass/fail), an optional `check:` shell command (exit 0 = pass), and an optional `why:` (the decision it enforces, so a reviewer understands intent).

```markdown
# Architecture Checklist

- [ ] Monetary values use a Decimal type, never float.
      why: float rounding silently corrupts financial totals (ADR-004).
      check: ! grep -rnE '\b(float|Number\()' src/billing/

- [ ] No raw SQL outside the repositories/ layer.
      why: keeps persistence swappable and injection-auditable.
      check: ! grep -rn 'SELECT ' src/ --include='*.ts' | grep -v '/repositories/'

- [ ] Every outbound HTTP call sets a timeout and a retry policy.
      why: an un-timed call is an outage waiting to happen. (semantic — no clean grep)

- [ ] New endpoints require auth middleware unless explicitly public.
      why: fail-closed on access control.
```

Rules of a good item:
- **One assertable claim per item.** "The code is clean" is not checkable; "no function exceeds 60 lines" is.
- **Deterministic beats semantic.** If you can write a `check:`, do — reserve semantic items for genuine judgments.
- **Carry the *why*.** A checklist without rationale rots into cargo-cult; the reviewer needs to know what decision each item defends.
- **Keep it project-invariant.** Items are architectural rules that hold across features, not one feature's acceptance criteria (those belong in the spec).

## Who writes it

`technical-vision` and `carve` — the workflows where architecture is decided. When a decision is worth enforcing on every future change (a layer boundary, a type discipline, a security invariant), record it here as an item, not just as prose in the vision doc. The deletion-test and seam-rule decisions (`workflows/technical-vision.md`) are prime candidates.

## Who enforces it

- **The Checker** (`workflows/loop-checker.md`) and **`independent-review`** load this file and verify the diff against **every** item — running each `check:` command and reading the diff for the semantic ones. An unsatisfied item is a rejection, cited by item.
- **Deterministic items** can additionally run in CI or the user's verify command — a `check:` is just a shell command; wiring the whole checklist into `carja.config.json`'s `verify` makes the deterministic half a push-blocker too.

## Composition

- The **Eval-Driven Law** (`skills/writing-evals`) is the canonical deterministic ship-contract item for LLM features — already enforced by the `pre-commit`/`pre-push` hooks, so it needs no checklist entry.
- The **Test-Driven Law** is the other always-on deterministic item.
- This checklist is where *project-specific* architecture rules live — the ones no generic hook can know.
