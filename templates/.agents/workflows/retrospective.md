---
description: Retrospective (Learning from What We Shipped)
---

# Workflow: Retrospective — Learning from What We Shipped

> **System Instruction:** Upon triggering this workflow, you MUST read the entire content of this file again to load the latest protocols.

**Trigger:** "Retro", "Let's reflect", "What did we learn", or automatically after Build completes
**Goal:** Extract lessons from a completed implementation and update the knowledge base.
**Output:** A retrospective record + updated Product Area and Context files.
**Prerequisites:** A completed Build (or any shipped work).

---

## Who You Are

You are the Carja in **reflection mode**. Your job is to close the feedback loop: turn shipping experience into knowledge that makes the next build better.

---

## Phase 1: Review What Shipped

**Announce:** *"Let's reflect on what we just shipped."*

1.  **Load Context:**
    * Read the latest `carja/0-compass/ship-log.md` entry
    * Read the `task-tracker.md` from the completed Implementation
    * Read the `feature-spec.md` for what was intended
    * **Mine the evidence in parallel (`.agents/skills/subagent-isolation/SKILL.md`):** the concrete lessons in Phase 2 must come from what *actually happened*, not memory. Fan out scouts across the independent evidence sources — the git history/diff for the branch, the tracker's evidence column (where retries/stalls/rework clustered), the ship-log, any `trace.md`, CI logs — each returning a short factual summary. Blind scouts don't anchor on the same story, and a fresh-context read resists the tendency to rationalize one's own work. Merge their findings into the summary below. For a small single-batch implementation, read inline instead.

2.  **Present Summary:**
    * What was the goal?
    * What actually shipped?
    * How long did it take (in batches/tasks)?
    * Were there any scope changes during Build?

---

## Phase 2: Extract Lessons

**Announce:** *"Let's figure out what we learned."*

Per the Grilling primitive (`.agents/skills/grilling/SKILL.md`), ask these as one numbered round — offer your own read of each from the shipped work, then let the human correct it:

1.  **"What went well?"** — What should we do again?
2.  **"What was harder than expected?"** — Where did the plan not match reality?
3.  **"What surprised us?"** — Unexpected issues, dependencies, or discoveries?
4.  **"What would we do differently?"** — Process improvements for next time?
5.  **"Where did the harness get in the way?"** — The four questions above are about the work. This one is about the environment the agent worked in, and it is the only question whose answer can change the framework. Read the evidence gathered in Phase 1 for each category, then propose before asking:
    * **Missing guardrail** — something an agent did that a hook, test or CI check should have blocked, and did not.
    * **Navigation pointer** — something the agent could not find, or found late, because nothing pointed at it.
    * **Tool economy** — a manual step, repeated by a human or an agent, that could be a command.
    * **No-op instruction** — a rule that was read and ignored, or read and did nothing.
    * **Information access** — knowledge that lived in someone's head or a chat and was not written down where the next reader looks.

    A **mechanical** standard (a naming rule, a required file, an ordering) becomes a hook, a lint or a CI check — never another paragraph an agent can skip. A **judgement** standard goes to the relevant workflow, skill or rubric. Either way, write the answer on the ship-log entry's `Framework lesson:` line (Ship Phase 5), which is the one place framework maintenance reads.

For each answer, capture a concrete lesson — not vague feelings.

---

## Phase 3: Update Knowledge Base

**Announce:** *"Let me update our knowledge base with what we learned."*

### Product Area Updates
* **Features file:** Add/update features that were shipped in `carja/3-product-areas/[area]/[area]-features.md`
* **Technical file:** Record architectural decisions and patterns in `carja/3-product-areas/[area]/[area]-technical.md`
* **Epics file:** Mark completed Epics or note scope changes in `carja/3-product-areas/[area]/[area]-epics.md`

### Context Updates
* **Technical context:** Update `carja/4-context/technical/` with new patterns, conventions, or stack decisions
* **Design context:** Update `DESIGN.md` if new design patterns emerged (`.agents/skills/design-system/SKILL.md`)
* **Product context:** Update `carja/4-context/product/` if user insights were gained

### Process Updates
* If a workflow improvement is identified → write it on the ship-log entry's **`Framework lesson:`** line (Ship Phase 5). One grep across every project's `carja/0-compass/ship-log.md` is how such lessons reach the framework; a note anywhere else has no reader.
* If a new pattern emerged → consider creating a new skill or updating an existing one

---

## Phase 4: Record

**Announce:** *"Recording the retrospective."*

1.  **Write Retrospective:** Save to the Implementation folder (before archiving):

    ```markdown
    # Retrospective: [Implementation Name]
    **Date:** [Date]

    ## What Shipped
    [Summary]

    ## What Went Well
    - [Lesson 1]

    ## What Was Hard
    - [Lesson 1]

    ## What We Learned
    - [Lesson 1]

    ## Knowledge Base Updates
    - Updated: [file path] — [what changed]
    ```

2.  **Confirm Updates:** List all files that were updated and verify

---

## Completion

*"Retrospective complete. Knowledge base updated. Ready for the next challenge."*

---

*Previous Workflow: Build · This workflow is optional but recommended after every Build.*
