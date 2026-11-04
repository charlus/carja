---
name: collaborative-drafting
description: "The drafting primitive. When a workflow must produce a structured document (Epics, screens, implementation slices, an architecture), lead with a complete draft the human corrects — never a blank-page questionnaire. Reach for it in Grand PRD, UX/UI Brief, Technical Vision, Carve, and any 'propose then refine' phase."
---

# Collaborative-Drafting — The Drafting Primitive

> The document-scale counterpart to [Grilling](../grilling/SKILL.md). Grilling extracts *decisions* in short rounds of questions; Collaborative-Drafting produces a *structured artifact* by proposing it whole and letting the human correct it. Workflows that assemble Epics, screens, implementation slices, or an architecture load this instead of re-inventing a propose/refine loop. It defines the *technique*; the calling workflow supplies the *agenda* (which sections, in what order) and the *template*.

## The Prime Directive

**You have read all the context — so lead with a draft, not a blank page.** The human's job is to react and correct, which is far cheaper for them than authoring from scratch. Never open a section by asking "what should this contain?" when you could propose what it contains and ask "what's wrong with this?"

## The Four Moves

Run these per section of the document — not per workflow, and never as a gate ritual:

1. **Propose first.** From the loaded context, present a complete first draft of the section — named items, concrete pictures, the actual table. "Based on everything I've read, here's how I'd organize this…" Paint scenarios, don't just list labels.

2. **Discuss.** Invite correction with sharp prompts, not open ones: "Too big? Too small? Boundaries in the right place? What's missing, what doesn't belong?" Iterate one thread at a time (see Grilling's one-at-a-time law).

3. **Coverage check.** Before locking the section, verify nothing upstream was dropped: does every Problem / Scene / Outcome / Epic have a home here? Name any gap and propose where it goes. This is the completeness pass that keeps documents honest.

4. **Confirm once, then write.** A single approval per saved document — not one gate per section. When the human signs off, write the file using the workflow's template.

## Laws

- **Recommend, don't ask.** Every choice you surface carries your recommended answer. (Shared with Grilling.)
- **Look facts up.** Read the upstream `carja/` docs and existing code yourself; never ask the human for something the context already holds. (Shared with Grilling.)
- **Engineering decisions are yours.** Never draft two options for a library, a pattern, a schema shape or a test seam and ask which one. Decide, draft with it, and note the choice in one line. Only a **product decision** goes to the human — see Grilling's *Whose Decision Is It*.
- **One gate per document, at convergence.** No per-phase "X locked?" checkpoints. Do maximal drafting, then ask once — the human is involved late, with everything prepared.
- **Stay at the workflow's altitude.** Respect the calling workflow's persona and bans (e.g. no tech in a product-discovery draft, no implementation detail in a design brief).

## What this is *not*

- Not the interview primitive — if you're extracting decisions rather than producing an artifact, that's [Grilling](../grilling/SKILL.md).
- Not a script of per-phase announcements and gates. Keep ceremony minimal: a one-line phase marker, then draft.
- Not the agenda or the template — those belong to the calling workflow.
