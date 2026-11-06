---
description: Spec-It (Detailed Implementation Specs)
---

# Workflow: Spec-It

> **System Instruction:** Upon triggering this workflow, you MUST read the entire content of this file again to load the latest protocols into your active context. Do not rely on previous memory.

**Trigger:** "Spec it", "Spec this implementation", "Write the spec"
**Output:** `implementations/[NN-Name]/feature-spec.md` (the "what") and `implementations/[NN-Name]/implementation-plan.md` (the "how").
**Prerequisites:** Carve made the Implementation folders. With no Implementation folder from Carve, this is a Quick-Path: say so in one line and run `.agents/workflows/quick-path.md`. Do not ask which one.

**Synthesize, don't re-interview.** The Blueprint chain already interviewed the user. Load `.agents/skills/collaborative-drafting/SKILL.md`: draft from the upstream documents and let the user correct. Use `.agents/skills/grilling/SKILL.md` only for a decision the Blueprint left open. Every document you write holds decisions, conventions and acceptance criteria, never a record of the discussion.

## Phase 0: Setup

1. **Target (fact — look it up):** if this workflow was started with a path (`/<workflow> <path>`), that folder is the Implementation: read from it and do not ask. A Project folder: recommend its next unspecced Implementation. No path: list `carja/2-backlog/project-backlog/` by last change and do the same for the most recent unfinished Project. If the folder holds a `handoff.md`, read it first.
   - **Work in the item's worktree:** `carja work <project>/<NN-slice>`, then work only in the folder it prints. In a loop beat, skip this (`skills/git-worktrees/SKILL.md`).
2. **Load context:** `project-documentation.md` (this Implementation's definition and acceptance criteria), then in `blueprint/` (Project folder, two levels up): `grand-prd.md`, `ux-ui-design-brief.md`, `technical-vision.md`, `implementation-overview.md`.
   - **Codebase scout** (`.agents/skills/subagent-isolation/SKILL.md`): a subagent returns the files this Implementation touches, the patterns to reuse and the naming conventions. Skip it for a greenfield area.
   - **Domain personas:** `carja personas <the files the scout listed>`.
3. **Probe the live system (fact, not assumption):** check, read-only, every external thing this Implementation builds against: the **API** contracts and their real field values and type codes (a label is not a value), the **auth** path real consumers use, the **CI** test command and what it skips, the **test harness** (`conftest.py`, jest or vitest config, fixtures), and the schema fields and endpoints the plan assumes exist. One line each in the spec's **External Assumptions** section: `Verified:` with how, or `Assumed:` with what would prove it and when.
4. **Confirm understanding (not an interview):** a short synthesis, then only "anything the blueprint didn't capture before I draft?"

## Phase 1: Feature Spec (the "what")

1. **Draft** from the loaded context: Summary · User Stories, each with its Acceptance Criteria directly beneath · UI/UX Details (named screens) · Edge Cases · Out of Scope · Dependencies.
   - **Turn each listed persona's Review Lens into acceptance criteria** on the stories it concerns: empty, loading and error states for a new screen, authorisation per resource for a new endpoint, a rollback for a migration.
   - Run Grilling's **Lens Pass** with the same personas and add the **Lens decisions** section.
2. **Present:** 3 to 5 bullets, then the document. Revise until sign-off.
3. **Brief check (Grilling's C1–C4):** check the brief against this project's `carja/` docs and current behaviour. State any hit in two sentences with its source, or say **"Brief check: none found."** It does not block.
4. **Save:** ask "Feature Spec locked?", then write `feature-spec.md` with the **Brief check** section and the **shared understanding** paragraph. The pre-commit hook rejects a `feature-spec.md` with no Brief check section.

## Phase 2: Implementation Plan (the "how")

1. **Draft** from the spec and the Technical Vision: Technical Approach · Technical Considerations · Files & Components Affected · Data Model Changes · API Changes · **Testing Decisions** · Technical Risks · Trade-offs · numbered tasks in phases (`### - [ ] Phase 1: [Name]`), each phase with its verification.
   - **Testing Decisions:** the **seams** Build tests at. Prefer the highest useful seam, ideally one (`.agents/workflows/tdd-cycle.md`).
2. **Present:** the user signs off on what it **delivers**: scope, acceptance criteria, sequence. Each **engineering decision** (approach, seams, data-model internals, trade-offs) is yours: state it in one line. Escalate one only when it changes what a user sees, the running cost, cannot be undone cheaply, or contradicts an earlier decision.
3. **Independent review**, only when the plan has more than 3 tasks or touches a risk path (auth, payments, migrations, API contracts, security, CI, hooks): run `.agents/skills/independent-review/SKILL.md` with the **Feature Spec + Plan** lens on both documents, and address every `CHANGES REQUESTED` finding. Otherwise record `review: skipped (3 tasks or fewer, no risk path)`.
4. **Save:** ask "Implementation Plan locked?", then write `implementation-plan.md`.

## Completion Protocol

1. **Status:** set this Implementation to "Specced" in `project-documentation.md` (confirm first).
2. **Next step:** delete any `handoff.md` you read at the start. Write a new one into the folder the next command names only for open questions no document records (`.agents/skills/handoff/SKILL.md`, *Between workflows*). Then: *"Start a fresh session (Claude Code: `/clear`), then run `/build carja/2-backlog/project-backlog/[ProjectName]/implementations/[NN-Name]`."* To spec the next Implementation first, give `/spec-it` with that folder instead.
