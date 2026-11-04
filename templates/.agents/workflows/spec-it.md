---
description: Spec-It (Detailed Implementation Specs)
---

# Workflow: Spec-It

> **System Instruction:** Upon triggering this workflow, you MUST read the entire content of this file again to load the latest protocols into your active context. Do not rely on previous memory.

**Trigger:** "Spec it", "Spec this implementation", "Write the spec"
**Goal:** Create a detailed Feature Spec ("what") and Implementation Plan ("how") for one implementation.
**Output:**
- `implementations/[NN-Name]/feature-spec.md` — the detailed "what"
- `implementations/[NN-Name]/implementation-plan.md` — the detailed "how"

**Prerequisites:** Carve workflow completed (Implementation folders exist with blank templates). With no Implementation folder from Carve, this is a Quick-Path: say so in one line and run `.agents/workflows/quick-path.md`. Do not ask which one.
**Next Workflow:** Build (execute the implementation)

**Technique — synthesize, don't re-interview:** By the time Spec-It runs, the Blueprint chain (Grand PRD, UX/UI Brief, Technical Vision) has already interviewed the user at length and written it all down. **Your job is to synthesize that context into specs, not to re-run the interview.** Load `.agents/skills/collaborative-drafting/SKILL.md`: read the upstream docs, draft the full spec, and let the user correct it. Only reach for `.agents/skills/grilling/SKILL.md` on a *genuine gap* — a decision the blueprint left open. Never ask the user for something the upstream documents already answer.

---

## The Prime Directive

**You are the Architect — translating locked high-level direction into buildable specs**, one implementation at a time. The Feature Spec defines the "what" (product); the Implementation Plan defines the "how" (engineering).

Principles: **Feature Spec first** (lock the "what" before planning the "how") · **reference the source** (pull from Grand PRD, UX/UI Brief, Technical Vision — don't re-derive) · **be specific** (vague specs → vague implementations) · **stay in scope** (only this implementation) · **one approval per document, saved immediately**.

---

## Phase 0: Setup — pick the implementation and load context

1. **Which implementation:** **Target (fact — look it up):** If this workflow was started with a path (`/<workflow> <path>`), that folder is the Implementation: read from it and do not ask. If the path is a Project folder, list its `implementations/` and recommend the next unspecced one. With no path, find the Project first (list `carja/2-backlog/project-backlog/` by last change, recommend the most recent unfinished one), then do the same. If that folder holds a `handoff.md`, read it first: it lists what the previous session left open. The Project folder is two levels above the Implementation folder; the upstream docs below live there.
   - **Work in the item's worktree:** run `carja work <project>/<NN-slice>` first, then read, edit, test and commit only in the folder it prints (`carja/` files too). The owner's folder stays on its default branch. In a loop beat, skip this. See `skills/git-worktrees/SKILL.md`.
2. **Load context (fact — look it up):** Read, in order — `project-documentation.md` (this implementation's definition + acceptance criteria — critical), `blueprint/grand-prd.md`, `blueprint/ux-ui-design-brief.md`, `blueprint/technical-vision.md`, `blueprint/implementation-overview.md` (sequence + dependencies).
   - **Domain personas:** once the scout below has listed the files this implementation touches, run `carja personas <those files>`. It names the personas this spec needs (Architect, Designer, Security Auditor, Database Architect, Performance Optimizer).
   - **Codebase-inventory scout (`.agents/skills/subagent-isolation/SKILL.md`):** the blueprint says *what* to build; the plan needs to know *what already exists*. Send a scout to inventory the code surface this implementation touches — the files/modules it will change, existing utilities and patterns to reuse, naming conventions — and return a short summary. This grounds the spec's "Dependencies" and the plan's "Files & Components Affected" in reality (not guesses) while keeping the raw code out of the speccing context. Skip for a greenfield area with nothing to inventory.
3. **Probe the live system (fact, not assumption):** The blueprint records what was *believed* about the outside world when it was written. Before the spec exists, name every external thing this implementation builds against and check each one against the live system or its config, read-only: the **API** contracts it calls and their real field values and type codes (a label is not a value); the **auth** path real consumers actually use, and what the IdP can and cannot do; the **CI** test command and what it silently skips; the **test harness** (`conftest.py`, jest/vitest config, fixtures — they decide what is verifiable, so read them now, not during Build); the schema fields and endpoints the plan assumes already exist. Record the result in the Feature Spec's **External Assumptions** section, one line each: `Verified:` with how, or `Assumed:` with what would prove it and when. An `Assumed:` line is honest. A spec with neither is a guess dressed as a plan — four retrospectives paid for that: a type code trusted from its label, a source mapping wrong for four months, consumers authenticating differently than assumed, a CI that skipped the whole unit suite.
4. **Confirm understanding (not an interview):** Present a tight synthesis — Implementation, what it delivers, acceptance criteria, key screens/interactions, key entities, dependencies — and ask only "anything the blueprint didn't capture before I draft?" If genuine gaps surface, grill *those* one at a time; otherwise proceed.

---

## Phase 1: Feature Spec (the "what")

1. **Draft the full spec** from loaded context: Summary · **User Stories, each with its own Acceptance Criteria attached directly beneath it** (not a separate section) · UI/UX Details (reference specific screens) · Edge Cases · Out of Scope · Dependencies.
   - **Turn each listed persona's Review Lens into acceptance criteria** on the user stories it concerns: empty, loading and error states for a new screen, authorisation per resource for a new endpoint, a rollback for a migration. Build then writes a failing test for each, so the point is built in, not found at review.
   - Then run Grilling's **Lens Pass** (`.agents/skills/grilling/SKILL.md`) with the same personas, and add the **Lens decisions** section to the spec.
2. **Present & iterate:** brief summary (3–5 bullets, with justification) first, then the full document. Invite correction; revise until the user signs off.
3. **Brief check (Grilling's C1–C4):** before converging, check the brief against the four conditions using this project's `carja/` docs and current behaviour. State any hit in two sentences with the source, or say **"Brief check: none found."** Non-blocking — the human answers in one line, you continue.
4. **Converge & save:** one confirmation ("Feature Spec locked?"), then immediately write `implementations/[NN-Name]/feature-spec.md`, including the **Brief check** section and the **shared understanding** paragraph. A `feature-spec.md` with no Brief check section is rejected by the pre-commit hook.

---

## Phase 2: Implementation Plan (the "how")

1. **Draft the full plan** from the Feature Spec + Technical Vision: Technical Approach · Technical Considerations (checklist) · Files & Components Affected · Data Model Changes · API Changes · **Testing Decisions** · Technical Risks · Trade-offs · Execution Phases with Verification.
   - **Phase headers carry checkboxes:** `### - [ ] Phase 1: [Name]`.
   - **Testing Decisions:** name the **seams** Build's TDD loop will test at — prefer the highest useful seam, ideal count one (see `.agents/workflows/tdd-cycle.md`). Deciding seams here lands Build's test effort on the critical paths.
2. **Present & iterate:** summary (3–5 bullets) then full document. The human signs off on what the implementation **delivers** — scope, acceptance criteria, sequence. The **engineering decisions** in the plan (approach, seams, data-model internals, trade-offs) are yours: state each in one line and move on. Escalate one only when it changes what a user sees, changes what the product costs to run, cannot be undone cheaply, or contradicts an earlier decision (Grilling's *Whose Decision Is It*).
3. **Independent review (fresh-context gate):** Run `.agents/skills/independent-review/SKILL.md` with the **Feature Spec + Plan** lens across *both* documents — a reviewer that did not write them confirms every acceptance criterion is testable and unambiguous, the plan implements exactly the spec (nothing missing, nothing extra), the TDD seams are the highest useful ones, and the work is sliced into thin vertical increments. Address every `CHANGES REQUESTED` finding first.
4. **Converge & save:** one confirmation ("Implementation Plan locked?"), then immediately write `implementations/[NN-Name]/implementation-plan.md`.

---

## Completion Protocol

1. **Update status:** set this implementation to "Specced" in `project-documentation.md` (confirm first).
2. **Recap:** key deliverables, number of phases, notable decisions.
3. **Next step:** ready for **Build**. **Fresh session (`.agents/skills/handoff/SKILL.md`, *Between workflows*):** delete any `handoff.md` you read at the start. Write a new `handoff.md` into the folder the next command names only if this session leaves open questions or decisions that no document records. Then give the human the exact next command with the real path: *"Start a fresh session (Claude Code: `/clear`), then run `/build carja/2-backlog/project-backlog/[ProjectName]/implementations/[NN-Name]`."* If the human prefers to spec the next Implementation first, give `/spec-it` with that folder instead.
```
implementations/[NN-Name]/
├── feature-spec.md        ← COMPLETE
└── implementation-plan.md ← COMPLETE
```
