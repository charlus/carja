---
description: Survey (Onboarding a Codebase Somebody Else Wrote)
---

# Workflow: Survey — Onboarding a Codebase Somebody Else Wrote

> **System Instruction:** Upon triggering this workflow, you MUST read the entire content of this file again to load the latest protocols. Do not rely on previous memory.

**Trigger:** "I inherited this codebase", "Onboard this existing product", "What is this thing", "Set up Carja on an existing project"
**Goal:** Turn a running product nobody documented into the `carja/` knowledge base the rest of the methodology needs.
**Output:** `carja/3-product-areas/<area>/` for each real area, plus `4-context/technical/` and a populated `0-compass/`.
**Prerequisites:** A checkout of the codebase. Nothing else.

**Technique:** The interview uses `.agents/skills/grilling/SKILL.md`; the documents use `.agents/skills/collaborative-drafting/SKILL.md`.

---

## When to Use

Genesis assumes a blank page. This is the opposite situation: the product
exists, it has users, and the people who built it are gone. The code is the
only honest record of what it does — and it still cannot tell you what any of
it is *for*.

Use Survey when the human says some version of "here's the repo, help me
understand what I own". Use **Genesis** instead when they are starting
something new, and **Deepen** when they already understand the product and
want the architecture reshaped.

---

## The split this workflow runs on

**A script collects the facts. You judge them. The human supplies the why.**

Never substitute your reading of the code for the command's output. You will
skim 300 files and remember 20; the command counts all of them. Run it, read
what it printed, and reason from that.

---

## Phase 1: Collect the facts

```bash
carja survey --out carja/1-workbench/survey.md
```

Read the file it wrote. It gives you, for the whole tree: file and language
counts, coverage by area with the untested areas first, entry points from the
manifest, HTTP routes, configuration keys, and dependencies.

Two things it deliberately does not do. It does not say what the product is
for — that is the interview. And its coverage attribution is by import where
resolvable and by name otherwise, so an area marked untested is **a place to
check, not a proven gap**. Check two or three before you repeat the claim to
the human.

**Gate:** Before going on, state in one paragraph what the product appears to
be, from facts only, and name the single thing you are least sure of.

---

## Phase 2: Map the areas

The survey's coverage table is a map of *the code's* structure. Product areas
are a map of *the product's*. They are usually not the same shape, and the
difference is the interesting part.

Propose a product-area list — 3 to 7 areas, named the way a user would name
them, not the way the folders are named. For each, say which directories and
routes you believe belong to it, and flag anything that fits nowhere.

Then run the interview with the human. Per the grilling skill: one question at
a time, recommend an answer, and never ask what you can look up. The questions
only they can answer:

- Who uses this, and what do they use it for?
- Which behaviour must never break — the thing that gets you called at night?
- What was the last team in the middle of?
- Which parts are known-bad and tolerated, versus bad and not yet noticed?
- Is anything here dead? Shipped, forgotten, still running?

**Gate:** One convergence check on the area list before anything is written.

---

## Phase 3: Write the knowledge base

For each confirmed area, create `carja/3-product-areas/<area>/` from
`carja/5-templates/new-product-area/`, and fill in only what you can
source:

- **What it does** — from the interview, in the human's words.
- **Where it lives** — directories, entry points and routes from the survey.
- **What it depends on** — from the survey's dependency list.
- **What is risky** — untested areas you verified, plus whatever the human
  named as fragile.

Mark anything you could not establish as `TBD — needs <the specific way to
find out>`. Never write a plausible-sounding sentence to fill a gap: this
document becomes the ground truth every later workflow reads, and an invented
fact here is repeated forever.

Then write `carja/4-context/technical/tech-stack.md` from the language and
dependency counts, and open `carja/0-compass/` with the product's current
state as the human described it.

---

## Phase 4: Set the gates up

An inherited codebase usually has no verification command Carja knows
about, so every later gate is inert:

```bash
carja verify --detect     # derive it, or --set "…" / --none
carja install-hooks
```

If the survey found substantial untested areas, say so plainly and let the
human decide whether that is the first piece of work. Do not start fixing it —
that is a product decision, and it is theirs.

---

## Completion

- `carja/3-product-areas/` has a folder per confirmed area
- Every unestablished claim is marked `TBD` with how to resolve it
- The verification command is set or explicitly declared `none`
- `carja/1-workbench/survey.md` is kept — it is the evidence for
  everything above, and re-running it later shows what moved

**Next:** `workflows/grand-prd.md` for new work on this product, or
`workflows/deepen.md` if the human's first concern is the architecture.
