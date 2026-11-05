---
description: Grand PRD (Organizing the Problem Space)
---

# Workflow: Grand PRD

> **System Instruction:** Upon triggering this workflow, you MUST read the entire content of this file again to load the latest protocols into your active context. Do not rely on previous memory.

**Trigger:** "Grand PRD", "Blueprint PRD", "Create PRD", "Define the epics"
**Goal:** Transform Genesis and Storyboard content into a Grand PRD that organizes the problem space into Epics.
**Output:** `carja/2-backlog/project-backlog/[ProjectName]/blueprint/grand-prd.md`

**Template:** Use `carja/5-templates/blueprint-workflows/grand-prd.md` for consistent output structure.

**Prerequisites:** Genesis (required), Storyboard (recommended)
**Next Workflow:** UX/UI Design Brief

**Drafting technique:** Load `.agents/skills/collaborative-drafting/SKILL.md` — you've read all the context, so lead with a complete draft of the Epics and let the user correct it, rather than asking what they should be. Load `.agents/skills/grilling/SKILL.md` for any genuine decision points. Recommend an answer to everything, look facts up, and gate once at convergence — a single approval before the file is saved.

---

## The Prime Directive

**You are the Architect — organizing the Problem Space.** The Grand PRD answers "What are we building and why?" It organizes the messy problem space into coherent Epics — logical groupings that tell complete "problem → solution → outcome" stories.

It is the first of three Blueprint documents: **Grand PRD** (this) → **UX/UI Design Brief** → **Technical Vision**.

---

## Phase 0: Setup — determine project and load context

1. **Which project:** **Target (fact — look it up):** If this workflow was started with a path (`/<workflow> <path>`), that folder is the Project: read from it and do not ask. If that folder holds a `handoff.md`, read it first: it lists what the previous session left open. Otherwise ask which existing project, or whether we're starting fresh. Then check `carja/2-backlog/project-backlog/[ProjectName]/` yourself and branch:
   - **Path A — Genesis + Storyboard both exist:** Read all of them carefully (the three `genesis/` docs, Main-Character, Storyboard). Present a brief synthesis (the core problem, the before and after, the main character + outcomes, the scenes, the functional jobs) and confirm it captures the essence.
   - **Path B — Genesis only:** Recommend running Storyboard first (it adds user perspective). If the user proceeds anyway, load Genesis and continue.
   - **Path C — neither:** Recommend running Genesis first. If the user prefers, do condensed context-gathering (grill the problem, transformation, main character, capabilities) and continue.

---

## Phase 1: Epic Discovery
**Goal:** Identify and right-size the Epics.

**What an Epic is:** a coherent chunk of the problem space that addresses a cluster of problems, delivers related outcomes, and contains related scenes/functionality — could become one or more Implementations. **Not** technical components, not prioritized, not implementation detail.

1. **Draft the Epics (recommend, don't ask):** Propose 4–8 initial Epics. For each: a name, a concrete picture of what it covers (paint the scenario), and the scenes/functional jobs it encompasses.
2. **Discuss sizing:** Too big (split)? Too small (combine)? Boundaries right? Iterate one thread at a time.
3. **Coverage check:** Every functional job (Genesis), every scene (Storyboard), every outcome (Main Character) should have a home. Name any gap and propose where it goes.
4. **Scope:** Propose what's explicitly OUT of scope; capture non-goals and deferrals.
5. **Converge:** Reflect the final set — "So we have [N] Epics: [list]." One confirmation, no per-item gate.

---

## Phase 2: Epic Definition
**Goal:** Define each Epic fully.

1. **Draft each Epic (lead with the definition):** For each, propose the full story and let the user adjust:
   - **Problem it solves** — which symptoms from `genesis/problem-solar-system.md`; what pain it eliminates.
   - **Why it matters** — how it connects to the transformation; which part of the "after" world it enables.
   - **What the user experiences** — which Storyboard scenes; concrete scenarios, not just features.
   - **Outcomes delivered** — which Main Character outcomes; framed "After this Epic, the main character can…"
2. **Completeness check:** Do the Epics collectively deliver the full transformation? Any outcome unaddressed, any scene lost?

---

## Phase 3: Grand PRD Assembly

1. **Draft the document** into the template structure: Project Overview · The Problem (core problem + symptoms) · Before and After (with the target outcome) · The Main Character · The Epics (problem/why/what/outcomes) · Non-Goals.
2. **Lens Pass:** Run Grilling's Lens Pass with `.agents/personas/product-manager.md` only, on the Epics: expected value, the smallest version of each, and the order they should ship in. Technical personas join at Technical Vision, not here.
3. **Independent review (fresh-context gate):** Before saving, run `.agents/skills/independent-review/SKILL.md` with the **Grand PRD** lens — a reviewer that did not draft the PRD checks the Epics are MECE, right-sized, and collectively deliver the full transformation (no Storyboard scene lost, no outcome unaddressed, no smuggled scope). Address every `CHANGES REQUESTED` finding before continuing.
4. **Converge & save:** Present it, absorb final adjustments, then — one approval — create `blueprint/` if needed and write `blueprint/grand-prd.md`. Confirm saved.

---

## Completion Protocol

- **Recap:** "Grand PRD complete for `[ProjectName]` — [N] Epics covering [key areas]." It captures the WHAT and WHY.
- **Fresh session (`.agents/skills/handoff/SKILL.md`, *Between workflows*):** delete any `handoff.md` you read at the start. Write a new `handoff.md` into the folder the next command names only if this session leaves open questions or decisions that no document records. Then give the human the exact next command with the real path: *"Start a fresh session (Claude Code: `/clear`), then run `/ux-ui-design-brief carja/2-backlog/project-backlog/[ProjectName]`."*
- **Next step:** The **UX/UI Design Brief** — translate these Epics into screens, navigation, and interactions.
- **Project state:**
  ```
  project-backlog/[ProjectName]/
  ├── genesis/
  ├── storyboard/
  └── blueprint/
      └── grand-prd.md  ← We are here
  ```
