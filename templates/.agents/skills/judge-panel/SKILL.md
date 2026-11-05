---
name: judge-panel
description: "The divergent-then-convergent decision primitive. When a decision has a wide solution space and getting it wrong is expensive — an architecture, a hard design choice, a tricky algorithm — generate N candidates from deliberately different angles, score them with independent judges, then synthesize the winner while grafting the best of the runners-up. Reach for it in Technical Vision (architecture) and any high-stakes fork; skip it when the answer is obvious."
category: core
---

# Judge Panel (Generate → Judge → Synthesize)

> A single agent iterating on *one* idea explores a narrow slice of the solution space and anchors on its first instinct. When the space is wide and the choice is hard to reverse, the win comes from **breadth first, then selection**: several genuinely different candidates, judged independently, then merged. This is the multi-agent pattern that actually beats single-agent — not more effort on one answer, but structured divergence then convergence.

## When to run it

Run the panel only when **both** are true: the decision has **real forks** (more than one viable approach a competent engineer would defend) **and** getting it wrong is **expensive to undo** (architecture, data model, a public interface, a core algorithm). That's the whole value — it's wasteful anywhere else.

- **Run it for:** system architecture with competing shapes, a data model that later code will depend on, an algorithm with real performance/complexity trade-offs, a framework/pattern choice you'll be stuck with.
- **Skip it for:** an architecture with one obvious shape (CRUD over a boring stack), a decision that's cheap to change later, anything where you'd struggle to name a *second* serious candidate. Forcing a panel on an obvious call manufactures fake alternatives and wastes budget.
- **Proportionality:** the panel is opt-in, not a default phase. If you can't articulate why the space is wide, don't run it.

## The panel (three moves)

### 1. Generate N candidates from different angles

Spawn candidate authors in **isolated contexts** (`skills/subagent-isolation/SKILL.md`) so they don't converge on the same idea — blind spots are the point. Default **N = 3**, each given a distinct optimization bias:

| Angle | Optimizes for |
|---|---|
| **Simplest-that-works** | Fewest moving parts; boring, proven tech; monolith-first. The MVP shape. |
| **Risk-first** | The hardest non-functional requirement / biggest identified risk, even at more upfront complexity. |
| **Leverage-first** | Maximum reuse of what already exists in the codebase/stack; minimum new dependencies. |

(A fourth *evolvability-first* angle — optimize the parts most likely to change — is worth adding when the roadmap is volatile.) Give every author the **same brief** (the goal, the Epics/requirements, the constraints) and its **one bias**. Each returns a complete candidate with its trade-offs stated.

**Graceful degradation (retro-compatible):** no sub-agent primitive → generate the candidates *sequentially in one context*, but genuinely inhabit each bias before moving on (write candidate A fully, clear the slate, write B). The floor is: never fewer than two real candidates with stated trade-offs. Parallel isolation is better because the authors can't anchor on each other — but the divergent thinking is the irreducible part.

### 2. Judge them independently

Spawn **2–3 judges**, each in a fresh context, each scoring **every** candidate against explicit criteria (1–5). Judges are Checkers (`skills/independent-review/SKILL.md`) — adversarial, not cheerleaders. Route them to a strong model tier (`skills/model-routing/SKILL.md`); a weak judge is a false signal on a high-stakes call.

> **Rubric v1** — these criteria are the judge's rubric. A rubric is *config*: changing it changes every verdict, so bump this version when you edit the criteria, and calibrate per the section below.

Default criteria (adapt per decision):
- **Fit** — does it satisfy *every* requirement (each Epic, each screen/flow)? A candidate that drops a requirement loses regardless of elegance.
- **Simplicity** — fewest parts for the required capability; passes the **deletion test** (no shallow pass-through modules — `skills/architecture-patterns`). **Ties break toward the simplest candidate**, always. Removing complexity later is far harder than adding it.
- **Risk posture** — how well it absorbs the top technical risks and non-functional requirements.
- **Evolvability** — the cost of the *likely next* changes, not hypothetical ones.
- **Team/stack fit** — matches the team's expertise and existing conventions.

Each judge returns a score per candidate per criterion **with a one-line justification** — a bare number is not a verdict.

### 3. Synthesize

Aggregate the scores (mean per candidate; note where judges *disagree* — divergence flags a real trade-off worth surfacing to the human). Then:
1. **Pick the winner** — highest aggregate, simplicity breaking ties.
2. **Graft the runners-up** — pull in specific superior ideas from the losing candidates where they compose cleanly (e.g. the simplest winner + one risk-first candidate's isolation boundary).
3. **Re-apply the deletion test to the merged result.** Synthesis bloats — grafting adds parts. Collapse any module the merge introduced that doesn't hide real, otherwise-duplicated complexity. The output must be *simpler* than the sum of its parents, not a union of everyone's ideas.
4. **Record the decision** — winner, why, and what was rejected and why. This is exactly the Phase 4 "Key Decisions & Trade-offs" input; promote to an ADR only if it passes the 3-test gate.

## Calibration — who watches the watchers

Carja leans on LLM judges — this panel, the loop **Checker** (`workflows/loop-checker.md`), `independent-review`, `behavior-validator`. An LLM judge is itself fallible, and *"an eval without a clear rubric measures nothing"* cuts both ways: a rubric can be miscalibrated, and a judge that rubber-stamps is a false safety signal. So the same eval discipline Carja demands of the apps it builds (`skills/writing-evals`) applies to Carja's own judges:

- **Version the rubric.** Every judge surface carries a `Rubric vN` stamp. Changing the criteria bumps it — a rubric change is a config change that alters every downstream verdict, and should be reviewed as one, not slipped in.
- **Spot-check against human judgment.** On a handful of cases, compare the judge's verdict to what a human reviewer concludes. Persistent divergence means the rubric is miscalibrated — fix the rubric, don't trust the judge. A judge that *never* rejects is broken; look for the case it should have caught.
- **Diverse lenses over redundant ones.** When it matters, give each judge a distinct angle (correctness / security / does-it-reproduce) rather than N identical scorers — diversity catches failure modes redundancy can't.

This is the Level-C honesty pass: the gates that check everything else are themselves checkable, versioned, and calibrated.

## The panel does not replace the review gate

The panel *produces* the artifact; the `independent-review` gate later *checks* it. They compose — a judged-and-synthesized architecture still faces the fresh-context reviewer at save time. Don't skip the gate because "judges already looked at it": the judges scored candidates against each other; the gate asks whether the final thing is actually ready.

## In the autonomous loop

At **L2 (blueprint)** the Architect Maker can run the panel to produce the architecture before the driver accepts it. Candidate authors on the balanced tier, judges on a strong tier (`skills/model-routing/SKILL.md`); record the models and the winning rationale in `0-compass/ship-log.md` so the choice stays auditable. In the **swarm**, the candidate authors are just N concurrent scoped Makers with different biases and the judges a Checker fan-out — no new machinery.

## Anti-patterns

- **Manufacturing alternatives** to justify a panel when the answer is obvious — theatre that burns budget.
- **Candidates that aren't actually different** — three flavors of the same idea. If the authors weren't isolated and biased, you get consensus, not divergence.
- **Rewarding cleverness** — divergent generation tempts complex, impressive candidates. Simplicity breaks ties; the deletion test is mandatory on the synthesis.
- **Union-synthesis** — merging every candidate's ideas into one bloated design. Graft selectively, then delete.
- **Skipping the independent-review gate** because the panel ran — different jobs.
