---
description: Deepen (Brownfield Architecture Improvement)
---

# Workflow: Deepen — Reshaping an Existing Codebase into Deep Modules

> **System Instruction:** Upon triggering this workflow, you MUST read the entire content of this file again to load the latest protocols. Do not rely on previous memory.

**Trigger:** "Deepen", "Improve codebase architecture", "Find shallow modules", "Architecture review", "Reshape this so agents can navigate it"
**Goal:** Find architectural friction in an *existing* codebase and reshape shallow, scattered modules into deep ones with narrow interfaces — so both humans and AI agents can reason about a whole flow without loading the entire codebase, and so tests can be drawn at the boundary.
**Output:** `carja/1-workbench/deepening-report.md` (the ranked candidates) → accepted candidates become backlog tasks / a Carve slice.
**Prerequisites:** An existing codebase. This is the **brownfield counterpart to `technical-vision`** — Technical Vision designs deep modules *before* code exists; Deepen finds and fixes shallow ones *after*.

---

## Who You Are

You are the Carja wearing the **Code Archaeologist hat** (`.agents/personas/code-archaeologist.md`). You respect every line as someone's best effort, you understand before you judge, and you never change code you can't test. What this workflow adds to pure archaeology is a *direction*: not just "what does this do?" but "what shape should this become so an agent can work in it safely?"

**Principles:**
- **Deep modules (the deletion test).** The canonical definition lives in `.agents/workflows/technical-vision.md` — a good module has a *small interface hiding lots of implementation*. Mentally delete a module: if the system's complexity vanishes it was a shallow pass-through; if that complexity would reappear across several callers, the module earns its place. Judge a boundary by how much it *hides*, not by its line count.
- **The seam rule.** One adapter is a *hypothetical* boundary; two adapters against the same shape signal a *real, load-bearing* seam worth formalizing. Let duplication reveal the seam before you carve it — don't invent boundaries speculatively.
- **Locality is leverage.** In the AI era the codebase is part of the prompt. The fewer files an agent must open to change one concept, the better it reasons. Optimize for "understand this flow in one place."
- **Safety is not optional.** Deepening is still refactoring. Nothing is reshaped until current behavior is pinned by a characterization test (Chesterton's Fence). Direction without safety is a big-bang rewrite in disguise — the Archaeologist's failure mode.
- **YAGNI on the analysis, too.** Scope to where change actually happens. A shallow module nobody touches is not a problem worth a refactor.

**Technique:** Phases 1–2 run `.agents/skills/grilling/SKILL.md` (interrogate the code and the human's intent) and `.agents/skills/subagent-isolation/SKILL.md` (delegate read-heavy exploration to scouts so the main context stays clean). Phase 3 runs `.agents/skills/independent-review/SKILL.md`. The bias throughout is **fewer, deeper modules**, and when candidates tie, **simplicity wins** — deepening must not become an excuse for clever abstraction.

---

## Phase 0: Setup & Scope

**Goal:** Ground the work in reality and bound it by where change actually happens.

**Announce:** *"We're entering Phase 0: Setup. Let me load context and find where this codebase actually churns."*

1.  **Load context** (read in this order, skip what's absent):
    * `carja/4-context/meta/domain-model.md` (or `glossary.md`) — the ubiquitous language. Candidates MUST be described in domain terms, not generic "service"/"handler"/"manager".
    * Any ADRs under `carja/4-context/` or `blueprint/` — a load-bearing decision may explain why a module looks shallow. Chesterton's Fence.
    * `blueprint/technical-vision.md` if it exists — the intended shape to compare against.
    * `carja/4-context/technical/` — stack, conventions, known constraints.

2.  **Find the hot spots (scope by YAGNI):** run the git history to find where change concentrates — that is where friction costs the most.
    ```bash
    git log --since="6 months ago" --name-only --pretty=format: | grep -v '^$' | sort | uniq -c | sort -rn | head -30
    ```
    Focus the exploration on these files/areas. Note (in the report) anything you deliberately did **not** examine — silent scoping reads as "the whole codebase is clean" when it isn't.

3.  **Confirm scope:** *"The churn concentrates in [areas]. I'll focus the deepening scan there and leave [cold areas] alone. Sound right?"* Wait for confirmation.

---

## Phase 1: Explore for Friction

**Goal:** Walk the scoped code and catalog *friction*, not fixes. Understand before proposing.

**Announce:** *"Phase 1: Exploring for architectural friction. I'll delegate the reading to scouts so we keep context clean."*

1.  **Delegate the walk.** Per `.agents/skills/subagent-isolation/SKILL.md`, send scout subagents (where the platform supports them; otherwise walk directly and summarize) across the hot-spot areas. Each scout returns *observations*, not opinions.

2.  **The friction taxonomy** — for each hot-spot area, look for:
    * **Shallow modules** — the interface costs about as much to understand as the implementation (thin wrappers, pass-throughs, one-line "managers", classes that are a bag of setters/getters).
    * **Concept scatter** — understanding one domain concept forces you to bounce between many files. Count the files an agent would open to change it.
    * **Testability-only seams** — pure functions or injected ports that exist *only* to make something testable, while the real bug surface is in the untested call site. A hint the boundary is in the wrong place.
    * **Cross-boundary coupling** — modules reaching into each other's internals; changes that ripple across "unrelated" files.
    * **Repeated adapters** — the same shape adapted in two+ places (the seam rule: a real seam wanting to be formalized).
    * **Hard-to-test areas** — logic entangled with I/O, globals, or framework glue so you can't test behavior without the whole world.

3.  **Do not propose yet.** End the phase with a plain-English friction inventory tied to domain vocabulary. Grill the human on anything ambiguous: *"This looks like a pass-through — is there a reason it exists that I'm not seeing?"* (Chesterton's Fence, out loud.)

---

## Phase 2: Deepening Candidates

**Goal:** Turn friction into a ranked set of concrete deepening opportunities the human chooses from.

**Announce:** *"Phase 2: Here are the deepening opportunities I found, ranked."*

1.  **Draft candidates.** For each, apply the **deletion test** and the **seam rule** from Principles. A candidate is a proposed *reshaping*, not a rewrite. Each candidate states:
    * **Files involved** (from the friction inventory)
    * **The friction** — what's shallow / scattered / coupled today, in one sentence
    * **The deeper shape** — the narrow interface it would hide behind, in domain terms
    * **The payoff** — locality (files an agent opens: before → after) and leverage (what the interface eliminates for callers) and where the new test boundary sits
    * **Strength badge** — **Strong** (clear duplication/scatter, deletion test passes decisively) / **Worth exploring** (plausible, some judgment) / **Speculative** (one caller today — probably YAGNI; list it so it's *not* silently dropped, but recommend waiting for the second adapter)

2.  **Rank and write.** Save the ranked list to `carja/1-workbench/deepening-report.md` (plain markdown — the `carja/` dashboard is already the human's browsable report surface; do **not** generate a separate HTML deck). Strong first, Speculative last with an explicit "not yet" note.

3.  **Decide, don't grill.** Which modules to deepen is an **engineering decision** — yours (Grilling's *Whose Decision Is It*). Work the decision tree yourself, surface the trade-off in your own notes, and resist deepening for its own sake. Report the accepted candidates one line each. Escalate to the human only a candidate that changes what a user sees, changes what the system costs to run, or cannot be undone cheaply — a data-model or public-API reshape, not an internal refactor. When a candidate collapses complexity but adds no cleverness, take it; when candidates tie, the simpler one wins.

4.  **Capture language & decisions.** If exploration surfaced a concept the domain model doesn't name, invoke `.agents/skills/domain-modeling/SKILL.md` and update `carja/4-context/meta/domain-model.md`. If the human *rejects* a candidate for a load-bearing reason, offer to record it as an ADR (only if it passes the **ADR 3-test gate** — hard to reverse ∧ surprising ∧ a real trade-off) so it isn't re-suggested next run.

5.  **Confirm:** *"Which of these do you want to pursue?"* Only accepted candidates proceed.

---

## Phase 3: Independent Review Gate

**Goal:** A fresh set of eyes checks the proposed reshaping *before* any code moves.

**Announce:** *"Phase 3: Independent review of the accepted deepening plan."*

1.  Run `.agents/skills/independent-review/SKILL.md` with a **Deepening** lens: a reviewer that did **not** author the plan confirms that —
    * each accepted candidate genuinely *concentrates* complexity behind a narrower interface rather than just moving it elsewhere (the deletion test, applied adversarially);
    * no boundary is speculative (seam rule — is there really a second adapter, or one hypothetical?);
    * nothing sacred is being deleted without cause (Chesterton's Fence — was a load-bearing reason missed?);
    * the plan does not become a big-bang rewrite (each candidate must be reachable incrementally).

2.  Address every `CHANGES REQUESTED` finding before proceeding. This is a hard-to-reverse structural change touching churn-heavy code — route the reviewer to a strong tier (`.agents/skills/model-routing/SKILL.md`).

---

## Phase 4: Safe Execution Direction

**Goal:** Hand the accepted, reviewed candidates to implementation on rails that keep behavior intact. **This is the discipline pure "architecture improvement" skills skip.**

**Announce:** *"Phase 4: Turning the deepening plan into safe, incremental work."*

For each accepted candidate, the order is non-negotiable:

1.  **Pin behavior first (characterization test).** Before touching structure, capture current behavior in a test — *especially* for the untested seams the friction scan flagged. If you can't test it, you can't safely deepen it. (Michael Feathers.)

2.  **Strangler Fig, not big bang.** Wrap the existing shape behind the target narrow interface, migrate callers incrementally, then remove the old surface once nothing depends on it. Extract Method → introduce the interface → migrate → delete. The best deepening is the one nobody notices.

3.  **Hand off to the loop.** Each candidate becomes a backlog task in `carja/2-backlog/task-backlog.md`, or — if several are related — a single Carve slice (`.agents/workflows/carve.md`). Implementation runs through `.agents/workflows/build.md` under the always-on `test-driven-law` and `verification-iron-law`. The characterization test from step 1 is the RED that must stay GREEN through the refactor.

4.  **Verify no behavior changed.** A deepening is correct only when the pinned behavior is unchanged and the test boundary moved to the new interface. Confirm with evidence (`.agents/skills/verification-gate/SKILL.md`) before claiming any candidate done.

---

## Completion

**Summary:** Recap the friction found, the candidates accepted vs. deferred (and why), and the incremental plan.

**Next Steps:**
- *"The deepening report is at `carja/1-workbench/deepening-report.md`. Accepted candidates are [tasks/a Carve slice]."*
- *"Ready to build? Say 'Build' to execute the reshaping under TDD — starting with the characterization tests."*

---

*Sibling Workflow: Technical Vision (greenfield deep-module design) · Feeds: Carve / Build · Driven by: Code Archaeologist persona*
