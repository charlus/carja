---
description: Storyboard (Shaping the Experience)
---

# Workflow: Storyboard (Shaping the Experience)

> **System Instruction:** Upon triggering this workflow, you MUST read the entire content of this file again to load the latest protocols into your active context. Do not rely on previous memory.

**Trigger:** "Storyboard", "Shape the experience", "Who's the main character?"
**Goal:** Define the main character, their desired outcomes, and the scenes they experience to achieve them.
**Output:**
1. `carja/2-backlog/project-backlog/[ProjectName]/storyboard/main-character.md` (Who they are, what they want)
2. `carja/2-backlog/project-backlog/[ProjectName]/storyboard/storyboard.md` (The scenes they go through)

**Templates:** Use the templates in `carja/5-templates/storyboard-workflow/` for consistent output structure.

**Interview technique:** Load `.agents/skills/grilling/SKILL.md` (to draw out the character) and `.agents/skills/collaborative-drafting/SKILL.md` (to propose scenes and documents). One question at a time, recommend an answer to each, look facts up instead of asking, gate only at convergence — one approval per saved document.

**Relationship to Projects:** Storyboard adds to an existing Project folder. If no Project exists, Genesis should be run first to create one. Storyboard outputs go in the `storyboard/` subfolder within the Project.

---

## The Prime Directive for Storyboard
**You are the Director, not the Engineer.** You're shaping the experience, not building the system. Focus on what the main character sees, feels, and does — not on how it's implemented.

Everything about *how* to interview and draft lives in the two primitives. This file supplies only the agenda and one constraint: **one approval per document** — no separate "ready to draft?" pre-gate.

---

## Phase 0: Setup (Orient and Connect)

1.  **Check for existing Project (fact — look it up):** **Target (fact — look it up):** If this workflow was started with a path (`/<workflow> <path>`), that folder is the Project: read from it and do not ask. If that folder holds a `handoff.md`, read it first: it lists what the previous session left open. Otherwise scan `carja/2-backlog/project-backlog/` for a related Project. If found with Genesis, say so and use it as context. If none, recommend running Genesis first; if the user prefers to proceed, create a new Project (ask only for the name).
2.  **Create the folder (action):** `carja/2-backlog/project-backlog/[ProjectName]/storyboard/`. Confirm.
3.  **Load context (fact — look it up):** Read the three Genesis docs in `genesis/` yourself and summarize the core problem, the before and after, and the main capabilities so the session builds on them.

---

## Phase 1: The Main Character
**Goal:** Define who the main character is, their situation, and the outcomes they want.

1.  **Draft the character (recommend, don't ask):** From Genesis context, propose a first-draft main character — their situation (not demographics), when they show up, their emotional state — and ask the user to correct it. If there's no Genesis to draw from, grill it out (Grilling's active-listening loop: reflect, probe, loop until vivid).
2.  **The outcomes:** Propose the outcomes this character wants, framed as "I want…" statements, each tied to *why* it matters. Confirm they align with the Genesis before and after.
3.  **Draft & approve:** Present `main-character.md` (template structure). **STOP** for approval, then write it.

---

## Phase 2: The Scenes
**Goal:** Walk through the key scenes the main character experiences to achieve their outcomes.

1.  **Check existing functionality (fact — look it up):** Review the codebase/app for related features that already work, so proposed scenes don't describe built functionality as new.
2.  **Draft the scenes (collaborative-drafting):** Propose 4–8 major scenes/moments from the outcomes and Genesis. Run the coverage check — every outcome should have a scene that delivers it; name any gap and propose where it goes.
3.  **Explore each scene:** For each, keep it narrative not technical — what triggers it, what they see, what they do, what happens next. Simplicity check: if a scene bloats, propose the simplest version. Then map how the scenes connect (the major views and movement between them).
4.  **Draft & approve:** Present `storyboard.md` (template structure). Trace each outcome to the scenes that deliver it before finalizing. **STOP** for approval, then write it.

---

## Completion Protocol

1.  **Review:** Read both documents to ensure Main Character and Scenes are consistent, and that the scenes deliver the Genesis transformation (before → after).
2.  **Recap:** Who the main character is, their key outcomes, and the major scenes they experience.
3.  **Confirm:** "Storyboard complete. We've defined the Main Character, their Outcomes, and the Scenes."
4.  **Fresh session (`.agents/skills/handoff/SKILL.md`, *Between workflows*):** delete any `handoff.md` you read at the start. Write a new `handoff.md` into the folder the next command names only if this session leaves open questions or decisions that no document records. Then give the human the exact next command with the real path: *"Start a fresh session (Claude Code: `/clear`), then run `/grand-prd carja/2-backlog/project-backlog/[ProjectName]`."*
5.  **Next step:** **Blueprint** — the Grand PRD that synthesizes everything (adds `grand-prd.md` to this Project), then **Technical Vision** → **Carve**.
6.  **Lifecycle:** The Project folder lives in `carja/2-backlog/project-backlog/`; when all Implementations complete, the whole Project moves to `carja/6-archive/`.
