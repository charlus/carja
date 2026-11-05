---
description: UX/UI Design Brief (Translating Epics into Interface)
---

# Workflow: UX/UI Design Brief

> **System Instruction:** Upon triggering this workflow, you MUST read the entire content of this file again to load the latest protocols into your active context. Do not rely on previous memory.

**Trigger:** "UX/UI Design Brief", "Design the interface", "Define the screens"
**Goal:** Translate the Grand PRD's Epics into interface design — screens, navigation, and interactions.
**Output:** `carja/2-backlog/project-backlog/[ProjectName]/blueprint/ux-ui-design-brief.md`

**Template:** Use `carja/5-templates/blueprint-workflows/ux-ui-design-brief.md` for consistent output structure.

**Prerequisites:** Grand PRD (required)
**Next Workflow:** Technical Vision

**Drafting technique:** Load `.agents/skills/collaborative-drafting/SKILL.md` — you've read the PRD and Storyboard, so lead each phase with a complete draft (the screen table, the nav map, the flows) the user corrects, not a blank-page question. Load `.agents/skills/grilling/SKILL.md` for genuine decisions. Recommend an answer to everything, look facts up, and **gate once — a single approval before the file is saved**, not per phase.

---

## The Prime Directive

**You are the Designer — translating Problem Space into Interface.** The brief answers "What will the user actually see and do?" It makes the abstract Epics concrete: screens, navigation, interactions, flows. It is the second of three Blueprint documents: Grand PRD (done) → **UX/UI Design Brief** (this) → Technical Vision.

**Design Principles:**
- **No modals unless absolutely necessary.** Prefer full pages, inline editing, panels, sub-routes.
- **Fit into the existing app.** Understand existing navigation and patterns first — don't design in a vacuum.
- **Don't over-detail.** This is a brief, not a spec. Nail the key decisions; implementation comes later.

---

## Phase 0: Setup — determine project and load context

1. **Which project:** **Target (fact — look it up):** If this workflow was started with a path (`/<workflow> <path>`), that folder is the Project: read from it and do not ask. If that folder holds a `handoff.md`, read it first: it lists what the previous session left open. Otherwise ask which project (or fresh). Then check for the Grand PRD at `…/[ProjectName]/blueprint/grand-prd.md` yourself.
   - **If missing:** recommend running the Grand PRD workflow first (without it there are no Epics to design for). Proceed only if the user directs otherwise.
2. **Load context (fact — look it up):** Read the Grand PRD (Epics, problems, outcomes), the Storyboard scenes, and Main Character.
3. **Review the existing app (fact — look it up):** If there's a codebase, inspect current navigation, screens/routes, and patterns (lists, detail views, editing) yourself. Present where new screens fit into existing navigation and confirm patterns to follow. If greenfield, say so.
4. **Synthesize:** Briefly state what you're designing for (Epics, key scenes, the main character's core goal, where new screens fit) and confirm before designing.

---

## The Design Agenda

Work these phases in order. For **each**, apply Collaborative-Drafting's four moves — *propose a complete draft → discuss → coverage-check → iterate* — with **no per-phase approval gate**. Save happens once, in Assembly.

**Phase 1 — Screens Inventory.** Propose every distinct screen as a table: name, purpose, which Epic(s) it serves. Discuss missing/combine/split.

**Phase 2 — Navigation Structure.** Propose the home base, the primary nav pattern (tabs / sidebar / hub-and-spoke — consider platform), and a text nav map. Note global/floating elements (quick-capture, global search).
> **When the nav pattern is genuinely contested** (more than one viable shape for this app — it's a hard-to-reverse choice that shapes every screen), lead with **2–3 divergent options** and their trade-offs rather than a single proposal, and let the human pick — on design, *they* are the judge (this is the judge-panel instinct with a human scorer, not an automated one). When one pattern is clearly right for the platform and app, just propose it.
```
[Home Screen]
    ├── [Screen A] via [action]
    │   └── [Sub-screen] via [action]
    ├── [Screen B] via [action]
    └── [Screen C] via [action]
```

**Phase 3 — Screen-by-Screen Breakdown.** For each screen, propose: purpose, what they see, what they can do, where they go from here. Then specify the experience, because Build implements what is written and nothing more:
- **Layout & hierarchy:** the page frame and columns, and what the user sees first, second and third. The primary action is named.
- **States:** read and edit (an editable page opens in its read state, with an Edit action), empty, loading, error, by permission, and by status (what a viewer who has requested, been approved or already holds sees). A form opens on an action unless it is the page's only job.
- **Unknown and empty values:** how a missing value is shown. An unknown is shown as unknown, never as a default answer ("No", "0", "Does not expire").
- **Matches:** the existing screen this one should look like, when the app has one.

**Phase 4 — Key Interactions.** Propose the recurring patterns and where each appears: drag-and-drop, create/edit (modal vs inline vs page), filtering/sorting, selection (single/multi), modals vs panels vs pages, anything product-specific. Consistency check: same action behaves the same way everywhere.

**Phase 5 — Component Inventory.** Propose reusable elements grouped by type (cards, badges/tags, controls, list items, calendar elements, buttons) — for each: what it shows/does and where it's used.

**Phase 6 — Key User Flows.** Propose 3–5 critical flows that exercise core functionality across multiple screens. For each: name (what they're trying to do), start, numbered steps (action → result), end state. Coverage-check against Storyboard scenes and Epics.

**Phase 7 — Platform Considerations.** Primary platform (web/mobile/desktop/all), responsive behavior (mobile- vs desktop-first), and any constraints or platform-specific patterns.

---

## Phase 8: Assembly

1. **Draft the document** into the template structure: Overview · Screens Inventory · Navigation Structure · Screen-by-Screen Breakdown · Key Interactions · Component Inventory · Key User Flows · Platform Considerations.
2. **Completeness check:** every Epic has screens that deliver it; every Scene is represented in a flow.
3. **Lens Pass:** run Grilling's Lens Pass with `.agents/personas/designer.md` on every screen: hierarchy, states, unknown values, consistency with `DESIGN.md` and with the screens it matches. Its engineering answers go into the brief, its product questions to the human.
4. **DESIGN.md:** run `.agents/skills/design-system/SKILL.md`. No `DESIGN.md` at the code repository root yet: draft it (greenfield, or extracted from the existing code). One exists: check that every screen of this brief uses its colour roles and components, and draft the additions a new pattern needs. The draft is presented and approved together with the brief in the last step: look and feel is what the user sees.
5. **Independent review (fresh-context design gate):** Run `.agents/skills/independent-review/SKILL.md` before saving, with a **UX/design lens** — the reviewer adopts `.agents/skills/ux-reviewer/SKILL.md` and audits the brief against `DESIGN.md` and UX heuristics (consistent interaction patterns, no gratuitous modals, navigation legibility, every Epic/Scene covered). This is the design-flavored sibling of the review gate the other blueprint workflows run; address `CHANGES REQUESTED` findings before save. (Taste calls stay with the human from the phases above; the gate checks craft and coverage, not aesthetics.)
6. **Converge & save:** Present the complete brief and the `DESIGN.md` draft, absorb final adjustments, then — one approval — write `…/[ProjectName]/blueprint/ux-ui-design-brief.md` and `DESIGN.md`. Confirm saved.

---

## Completion Protocol

- **Recap:** "UX/UI Design Brief complete for `[ProjectName]` — [N] screens, [key navigation], [key interactions]." We now have the WHAT (PRD) and the INTERFACE (UX/UI).
- **Fresh session (`.agents/skills/handoff/SKILL.md`, *Between workflows*):** delete any `handoff.md` you read at the start. Write a new `handoff.md` into the folder the next command names only if this session leaves open questions or decisions that no document records. Then give the human the exact next command with the real path: *"Start a fresh session (Claude Code: `/clear`), then run `/technical-vision carja/2-backlog/project-backlog/[ProjectName]`."*
- **Next step:** The **Technical Vision** workflow — how to build this interface.
- **Project state:**
  ```
  project-backlog/[ProjectName]/
  ├── genesis/
  ├── storyboard/
  └── blueprint/
      ├── grand-prd.md
      └── ux-ui-design-brief.md  ← We are here
  ```
