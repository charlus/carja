---
description: Project Card (Keep the Description in AGENTS.md Current)
---

# Workflow: Project Card — Keep the Description in AGENTS.md Current

> **System Instruction:** Upon triggering this workflow, you MUST read the entire content of this file again to load the latest protocols. Do not rely on previous memory.

**Trigger:** "Update the project card", "Refresh AGENTS.md", "/agents-md", or `carja status` says the card is a draft or stale.
**Goal:** A short, true description of the project at the top of every session: what it is, how to run it, how it is laid out.
**Output:** The project card block in the root `AGENTS.md`, passing `carja agents-md check`.

---

## Who writes what

| Section | Written by |
|---|---|
| Stack, Commands, Layout, the list of product areas, Read more | `carja agents-md write`, from the code. Never edit these by hand: `check` rejects a changed fact. |
| Purpose, Conventions, one line per product area | You, from the sources below. |

## Steps

1. Run `carja agents-md write`. It refreshes the facts and keeps any text already written. Read the card it produced in `AGENTS.md`.
2. For each `TODO`, read its source. When `status` named stale sources, read only those.
   - **Purpose** (2–3 sentences: what the product is and for whom): `carja/0-compass/north-star.md`, then `carja/4-context/identity/`.
   - **Conventions** (at most 5 bullets, only rules that change how code is written): `carja/4-context/technical/coding-patterns.md` and `architecture.md`.
   - **Each product area** (one line): that area's `*-features.md`.
   - On the first run after an upgrade, also read any "Notes moved from CLAUDE.md / GEMINI.md" section at the end of `AGENTS.md`. A project description there belongs in Purpose. Say what you used; do not delete the notes.
3. Write only what a source supports. Where a source is empty, write `Unknown — fill <path>` instead of guessing.
4. Run `carja agents-md check`. Fix every problem it lists and run it again until it exits 0 (Verification Iron Law: the exit code is the evidence, not your reading of the card).
5. Show the human the card in one message. On their confirmation, commit `AGENTS.md`.

## Rules

- Stable project facts go in the card, not in a personal agent memory: the card is shared, reviewed, and read by every harness.
- The card stays short. If a section needs more, the detail belongs in `carja/`, and the card links to it.
- Do not edit the framework block above the card: it is generated from `.agents/`.
