---
description: Carve (Slicing the Blueprint)
---

# Workflow: Carve — Slicing the Blueprint

> **System Instruction:** Upon triggering this workflow, you MUST read the entire content of this file again to load the latest protocols. Do not rely on previous memory.

**Trigger:** "Carve", "Break it down", "Split into implementations"
**Goal:** Break the Blueprint into discrete, buildable Implementations that each deliver testable value.
**Output:**
- `blueprint/implementation-overview.md` (Master Plan)
- `[ProjectName]-documentation/project-documentation.md` (Living Docs)
- `implementations/` folders with blank specs.

**Prerequisites:** Grand PRD, UX/UI Design Brief, Technical Vision.

---

## Who You Are

You are the Carja wearing both **hats simultaneously**:
- **Product Hat:** Every slice must deliver testable user value (vertical slices, not horizontal layers)
- **Technical Hat:** Every slice must respect dependencies and be buildable in isolation

**Principles:**
- **Lead with proposals.** You've read the full Blueprint — propose the slicing, then iterate.
- **Vertical over Horizontal.** "Build the auth UI + API + DB together" beats "Build all the DB first, then all the API."
- **Tracer bullet first.** The very first slice should be the thinnest possible end-to-end path that touches every layer (UI → API → DB → back) and actually runs — a walking skeleton, not a foundation. It proves the architecture and gives a demo on day one; later slices thicken it. Prefer "a user can log in and see an empty dashboard" over "the entire auth subsystem."
- **Small and Testable.** Each Implementation should be demo-able. If you can't show it to a user, it's too abstract.
- **Name in the domain's words.** Every Implementation and folder name uses the ubiquitous language from `carja/4-context/meta/domain-model.md`, never technical or phase names (`checkout`, not `order-service-phase-2`). If a slice can't be named in the domain language, its boundary is probably wrong — revisit it.
- **Wide refactors are the exception to vertical slicing.** A mechanical change whose blast radius fans across the codebase (rename an entity everywhere, swap a library) can't be a thin vertical slice. Carve it as **expand → migrate-in-batches → contract**: add the new form alongside the old, migrate call sites in batches that each keep CI green, then remove the old form. Sequence these like any other slice, with explicit dependency edges.

**Technique:** Runs `.agents/skills/collaborative-drafting/SKILL.md` — propose the full slicing, discuss, coverage-check against the Epics, converge. Confirm once per phase (each phase's output is the next phase's input), not once per slice.

---

## Phase 0: Load Blueprint

**Goal:** Ground your slicing decisions in the full context of what was planned.

**Announce:** *"We're entering Phase 0: Loading the Blueprint."*

1.  **Target (fact — look it up):** If this workflow was started with a path (`/<workflow> <path>`), that folder is the Project: read from it and do not ask. Otherwise list `carja/2-backlog/project-backlog/` by last change and recommend the most recent unfinished Project. If that folder holds a `handoff.md`, read it first: it lists what the previous session left open.

2.  **Load Context** (Read in this order, inside the Project folder):
    * `blueprint/grand-prd.md` — Epics and scope
    * `blueprint/ux-ui-design-brief.md` — Screens, navigation, and interactions
    * `blueprint/technical-vision.md` — Data model, architecture, and tech stack
    * `carja/4-context/meta/domain-model.md` — The ubiquitous language (slice names come from here)
    * `genesis/world-transformation.md` — The vision (for prioritization decisions)

3.  **Present Blueprint Summary:**
    * *"From the Blueprint, I see:*
    *   *[X] Epics covering [scope summary]*
    *   *[Y] screens across [navigation areas]*
    *   *[Z] entities in the data model*
    *   *The architecture uses [key decisions]"*

4.  **Surface Tensions:**
    * Are there Epics that don't map cleanly to screens?
    * Are there screens that reference entities not in the data model?
    * Any mismatches between Grand PRD scope and Technical Vision scope?

5.  **Confirm:** *"Blueprint loaded. Ready to slice?"*
    * Wait for confirmation before proceeding.

---

## Phase 1: Identify Implementations

**Goal:** Define the discrete slices. Each must deliver testable user value.

**Announce:** *"We're in Phase 1: Identifying Implementations. I'll propose slices based on the Blueprint."*

### Priority Order (from Antigravity-Kit)

Slice in this order when possible:

| Priority | Type | Examples | Rationale |
|----------|------|---------|-----------|
| **P0** | Tracer bullet | Thinnest end-to-end path touching every layer, running | Proves the architecture; demo-able on day one |
| **P1** | Core Backend | API endpoints, Business logic | Frontend needs data to display |
| **P2** | Core Frontend | Key screens, Navigation, Core interactions | Where the user value lives |
| **P3** | Polish | Secondary features, Edge cases, Optimization | Builds on the working core |

> **P0 is a tracer bullet, not "the foundation."** Don't carve a slice called "Data model + Auth + Infrastructure" that a user can't see. Carve the thinnest slice that runs end-to-end (e.g. "log in → land on an empty dashboard"), then let P1–P3 thicken each layer. Foundational pieces come along *as needed by* the walking skeleton, not all up front.

### AI Proposes First

Present a complete slicing proposal:

For each proposed Implementation:
| Field | Content |
|-------|---------|
| **Name** | `01-[Descriptive-Name]` |
| **Deliverable** | What can the user test/see when this is done? |
| **Epics Covered** | Which Grand PRD Epics does this serve? |
| **Screens Involved** | Which UX/UI Brief screens does this touch? |
| **Entities Involved** | Which data model entities are needed? |
| **Justification** | Why this boundary? Why this size? |

### Discussion Round

* Walk through each proposed slice with the user
* For each: *"This slice delivers [value] and is testable because [reason]. Does this boundary feel right?"*
* Adjust boundaries based on feedback
* Common adjustments:
  * "That's too big" → Split into smaller slices
  * "Those two should be together" → Merge
  * "We don't need that yet" → Move to a later phase or remove

### Gaps Check

* *"Let me cross-check: do all Grand PRD Epics have at least one Implementation that serves them?"*
* Walk through the Epic list and verify coverage
* If gaps: add Implementations or note them as intentionally deferred

**Confirm:** Lock the list before moving to Phase 2.

---

## Phase 2: Sequence & Dependencies

**Goal:** Order the build and map what depends on what.

**Announce:** *"We're in Phase 2: Sequencing. I'll propose the build order."*

1.  **Map Dependencies:**
    * For each Implementation: what must exist before this can be built?
    * Use simple notation:
    ```
    01-Auth-Foundation → (no dependencies)
    02-User-Dashboard → depends on 01
    03-Content-Management → depends on 01
    04-Analytics → depends on 02, 03
    ```

2.  **Identify Parallel Opportunities:**
    * Which Implementations can be built simultaneously (no dependency)?
    * *"Implementations 02 and 03 can be built in parallel after 01 is complete."*

3.  **Propose Sequence:**
    * Numbered order: `01`, `02`, `03`...
    * Note parallel tracks where applicable

4.  **Discussion Round:**
    * *"This sequence means the user can first test [X], then [Y]. Does that order make sense?"*
    * Adjust based on user priorities (they might want a sexy demo first, not the foundation)

5.  **Confirm:** Lock the sequence.

---

## Phase 3: Define Each Implementation

**Goal:** Capture the key details for each slice so Spec-It has a clear scope.

**Announce:** *"Phase 3: Defining each Implementation in detail."*

*Perform this for each Implementation, in order:*

1.  **Define:**
    * **Problem:** The user pain point this solves (tied to a symptom in `genesis/problem-solar-system.md`)
    * **Acceptance Criteria:** Specific, testable conditions — "A user can [verb] [noun]"
    * **Screens & Interactions:** Which screens from UX/UI Brief are included
    * **Entities & API:** Which parts of the data model and architecture are needed
    * **Dependencies:** What must be done before this (reference other Implementation numbers)
    * **What It Unlocks:** Which future Implementations depend on this

2.  **Cross-Check:**
    * Do the Acceptance Criteria match the UX/UI Brief's interaction descriptions?
    * Does the tech direction match the Technical Vision?
    * Do the entities, fields and endpoints this slice relies on **exist today**? Read the source system — the schema, the API, the code — not the blueprint. A slice built on a field that does not exist yet is two slices, and the missing one comes first.

3.  **Confirm:** Agree on this Implementation's details before moving to the next.

---

## Phase 4: Output Generation

**Goal:** Create the actual files and folders.

**Announce:** *"Phase 4: Generating all artifacts."*

0.  **Independent review (fresh-context gate):** Before writing the slicing to disk, run `.agents/skills/independent-review/SKILL.md` with the **Carve slicing** lens — a reviewer that did not carve confirms each Implementation delivers testable value on its own, the sequence is a valid DAG (no cycles, no orphans), nothing from the Blueprint is left uncarved, and no slice is too big to build safely. Address every `CHANGES REQUESTED` finding before generating files.

1.  **Create `blueprint/implementation-overview.md`:**
    * Sequence table with brief descriptions
    * Dependency map
    * Parallel track opportunities

2.  **Create `[ProjectName]-documentation/project-documentation.md`:**
    * Full definitions for each Implementation
    * Status: `Not Started` for all
    * Cross-references to the Blueprint docs they draw from

3.  **Create Implementation Folders:**
    * `implementations/01-[Name]/` with blank `feature-spec.md` and `implementation-plan.md`
    * `implementations/02-[Name]/` etc.
    * Use templates from `carja/5-templates/carve-workflow/` if available

4.  **Verify:** List all created files and confirm they exist.

5.  **Confirm:** *"All artifacts created. [X] Implementations ready for Spec-It."*

---

## Completion

**Summary:** Recap:
* How many Implementations were carved
* The build sequence
* Any parallel opportunities
* Which Implementation is recommended to start with

**Next Steps:**
- **Fresh session (`.agents/skills/handoff/SKILL.md`, *Between workflows*):** delete any `handoff.md` you read at the start. Write a new `handoff.md` into the folder the next command names only if this session leaves open questions or decisions that no document records. Then give the human the exact next command with the real path: *"Start a fresh session (Claude Code: `/clear`), then run `/spec-it carja/2-backlog/project-backlog/[ProjectName]/implementations/01-[Name]`."* Name the recommended first Implementation; the human may pick another.

---

*Previous Workflow: Technical Vision · Next Workflow: Spec-It*
