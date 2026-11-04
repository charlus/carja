---
description: Genesis (The App Origin Story)
---

# Workflow: Genesis (The App Origin Story)

> **System Instruction:** Upon triggering this workflow, you MUST read the entire content of this file again to load the latest protocols into your active context. Do not rely on previous memory.

**Trigger:** "Start a new app", "I have an idea", "Genesis Mode"
**Goal:** Transform a raw idea into three context documents within a new Project.
**Output:**
1. `carja/2-backlog/project-backlog/[ProjectName]/genesis/problem-solar-system.md` (the core problem and its symptoms)
2. `carja/2-backlog/project-backlog/[ProjectName]/genesis/world-transformation.md` (before and after, and the target outcome)
3. `carja/2-backlog/project-backlog/[ProjectName]/genesis/functional-animator.md` (the capabilities)

**Templates:** Use the templates in `carja/5-templates/genesis-workflow/` for consistent output structure.

**Older documents:** Genesis documents written by earlier versions use other names for the same sections: *Sun* = core problem, *Satellites* = symptoms, *North Star* = target outcome, *Problem Solar System*, *World Transformation* and *Functional Animator* = the three documents above. The file names are unchanged. Read them as the same thing and do not rename them.

**Interview technique:** This workflow is one long interview. **Load `.agents/skills/grilling/SKILL.md` and conduct every phase by its Five Laws** — short numbered rounds of questions, recommend an answer to each, look facts up instead of asking, descend in dependency order, and gate only at convergence. Genesis supplies the *agenda* below; Grilling supplies the *how*.

**Relationship to Projects:** Genesis creates a new Project folder in the project-backlog. All subsequent workflows (Storyboard, Blueprint, etc.) add to this same Project folder.

---

## The Prime Directive for Genesis
**You are the Interviewer, not the Builder.**
Do not write code. Do not plan features. Do not discuss tech stacks yet. Your goal is to find out what the product must do for its users, and why.

Everything about *how* to interview lives in the Grilling primitive. This file only adds two Genesis-specific constraints:
- **Altitude:** Stay on problem, vision, and user-facing capability. Technology is out of scope until Blueprint.
- **One approval per document:** Each phase ends with a single draft-and-approve gate on its file — no separate "ready to draft?" pre-gate. Recommend the draft; let the user correct it.

---

## Phase 0: Setup (Create the Project)
**Goal:** Create the Project folder and gather existing context before diving in.

1.  **Scope (decision):** New product, or a new feature within an existing product? Recommend based on anything you already know, then confirm.
2.  **Name (decision):** Propose a `[ProjectName]` and confirm. This is the container for all work — Genesis, Storyboard, PRDs, Implementations.
3.  **Create the folders (fact/action):** `carja/2-backlog/project-backlog/[ProjectName]/` and its `genesis/` subfolder. Confirm creation.
4.  **Context scan (fact — do not ask, look it up):** Read the relevant `carja/3-product-areas/` folders, existing genesis/PRD docs, and codebase yourself. Summarize what already exists so the interview never rediscovers known ground: "Here's what I found that's relevant: [summary]." Do this for features *and* new products — there is almost always prior context to mine.
    * **Fan out when there's real ground to cover (`.agents/skills/subagent-isolation/SKILL.md`):** if the existing codebase/product-areas are large, or the platform can research externally, run the scan as **parallel scouts** — e.g. one over prior `carja/` docs, one over the relevant code, one on existing solutions / prior art in the problem space — each returning only a short summary. This keeps the raw file dumps out of the interview thread (the interview context stays clean) and surfaces known ground faster. Keep scouts at Genesis's altitude: problem, prior art, and user-facing capability — **not** tech-stack evaluation (that's Blueprint). For a greenfield idea with no prior context, skip the scouts and scan inline.

---

## Phase 1: The Problem
**Goal:** Identify the core problem and the symptoms it causes, in order of pain.

1.  **Open:** "Tell me what's broken. Rant to me — what annoys you or your users? Don't hold back."
2.  **Grill:** Reflect and probe toward the root cause (Grilling's active-listening loop). Surface adjacent problems and blind spots in the next round, each with your read on whether it's in scope — not as a batch.
3.  **Name the core problem:** Propose the core problem and its symptoms: "I see [X] as the core problem, with [A, B, C] as its symptoms. Agree?"
4.  **Brief check (Grilling's C1–C4):** against this project's existing `carja/` docs only. State any hit in two sentences with its source, or say **"Brief check: none found."** It does not block — the human answers, you continue.
5.  **Draft & approve:** Present `problem-solar-system.md` (template structure). **STOP** for explicit approval, then write it.

---

## Phase 2: Before and After
**Goal:** Contrast the "Before" and "After" states, anchored to the core problem.

1.  **Prompt:** "Describe the world where this is fixed. What does life look like *before* this exists, and exactly what does it look like *after*?"
2.  **Grill:** Dig for contrast so the "After" directly resolves the core problem from Phase 1. Probe for concrete texture — rituals, workflow changes, stress and time saved. Reflect the delta: "So the shift is from [Manual Pain] to [Automated Joy] — is that the core delta?"
3.  **Draft & approve:** Present `world-transformation.md` (Before vs. After, Target Outcome). **STOP** for approval, then write it.

---

## Phase 3: Capabilities
**Goal:** List ALL the "Jobs" the product must perform for its users.

**Persona Anchor:** You are the Product Owner designing UX capabilities — NOT the System Architect.
**The Technical Ban:** Do not propose technical solutions (APIs, databases, vectors, schemas). Focus ONLY on user capabilities ("Hear my voice," "Show my schedule," "Send context to my IDE").

1.  **Lead with a draft (recommend-per-question at scale):** From the problem and before-and-after documents, synthesize a comprehensive list of functional jobs organized by capability area. Ensure every symptom from Phase 1 maps to a Job, and include the Symptoms → Jobs mapping table. Present it as the starting point, not a questionnaire.
2.  **Refine:** "What's missing? What doesn't belong? What needs to change?" Iterate one thread at a time.
3.  **Non-Goals:** Propose what to explicitly exclude — things that seem related but are out of scope — and confirm. Capture as Non-Goals.
4.  **Lens Pass:** Run Grilling's Lens Pass with `.agents/personas/product-manager.md` only: is each Job worth building, and what is the smallest version that delivers the After? No technical persona here, the Technical Ban holds.
5.  **Draft & approve:** Present the final `functional-animator.md` (template structure). **STOP** for approval, then write it.

---

## Completion Protocol

1.  **Review:** Read all three files in `genesis/` to ensure they're consistent with each other.
2.  **Recap:** The core problem, the change (before → after), and the key capability areas.
3.  **Confirm:** "Genesis complete. We've defined the Problem, the Before and After, and the Capabilities."
4.  **Fresh session (`.agents/skills/handoff/SKILL.md`, *Between workflows*):** write `[ProjectName]/handoff.md` only if this session leaves open questions or decisions that no document records. Then give the human the exact next command with the real path: *"Start a fresh session (Claude Code: `/clear`), then run `/storyboard carja/2-backlog/project-backlog/[ProjectName]`."*
5.  **Next step:** **Storyboard** — define the main character, their outcomes, and the scenes they experience (adds a `storyboard/` folder to this Project). Then **Blueprint** (Grand PRD) → **Technical Vision** → **Carve** into Implementations.
6.  **Lifecycle:** The Project folder lives in `carja/2-backlog/project-backlog/` as workflows add to it; when all Implementations complete, the whole Project moves to `carja/6-archive/`.
