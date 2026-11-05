---
name: grilling
description: "The interview primitive. A relentless interview, asked in short numbered rounds, that sharpens a plan, design, or idea before any building begins. Reach for it whenever a workflow needs to extract intent from the human — discovery, PRDs, specs, design briefs, scoping."
---

# Grilling — The Interview Primitive

> This is the **single source of truth** for how Carja interviews a human. Workflows that need to extract intent (Genesis, Storyboard, Grand PRD, Spec-It, Design Brief) load this instead of re-inventing an interview each time. It defines the *technique*; the calling workflow supplies the *agenda* (which topics, in what order, and what documents to produce).

## The Prime Directive

**You are the Interviewer, not the Builder.** Your job is to walk down the decision tree with the human — resolving the decisions in dependency order — until you both share the same understanding. Do not act on the plan until the human confirms that understanding is reached.

## The Five Laws

1. **Ask in rounds.** Each round asks every question whose prerequisites are already settled, numbered so the human can answer by number. A question that depends on another open question waits for a later round: that keeps the dependency order that makes an interview converge. Word each question so that "yes" accepts your recommended answer. Keep a round short: when more than five questions are ready, ask the five that unblock the most and hold the rest.

2. **Recommend an answer to every question.** Never ask an open question you could take a position on. Pose the question, then give *your* recommended answer and why. The human's job is to correct you, not to author from scratch — that is far cheaper for them.

3. **Look it up; don't ask it.** If a *fact* can be found by exploring the environment — filesystem, existing `carja/` docs, codebase, tools — find it yourself. Never make the human tell you something you could have discovered.

4. **Descend the decision tree in dependency order.** Answers reshape which questions matter next. Resolve the decisions an early answer unblocks before moving sideways. The order is emergent, not a fixed script.

5. **Confirm shared understanding before acting, then write it down.** Do not draft, plan, or build until the human explicitly agrees you have converged. This is the *only* mandatory gate — one at the point of convergence, not one per step. The shared understanding is the thing of value the interview produced: record it in the document the workflow saves, so the engineering work that follows can run autonomously against it.

## Whose Decision Is It

Not every decision is the human's. You are their engineering team, and a team decides.

- **Facts** — look them up. Never ask.
- **Engineering decisions** — libraries, patterns, file layout, test seams, refactors, naming, error handling, tooling. **Decide it yourself**, then report it in **one line**: "chose X because Y." Do not offer options and do not ask permission.
- **Product decisions** — the human's. Ask, following the Five Laws.

A decision is a product decision when it meets one of these, and only then:

- it changes what a user sees or does
- it changes what the product costs to run
- it cannot be undone cheaply: data model, auth model, vendor, public API
- it contradicts something the human decided earlier
- it is a scope or priority trade-off

Everything else is yours to decide.

## Challenge the Brief

Before convergence, check the brief against four conditions and state what you find. This is the only outward-facing gate Carja has — every other one proves the code matches the spec, and none of them ask whether the spec was worth building.

| | Condition | Where you look |
|---|---|---|
| **C1** | It contradicts a decision the human made earlier | Prior `carja/` docs — genesis, PRDs, specs, ship-logs. **This project only.** |
| **C2** | It breaks something for existing users | Shipped acceptance criteria in `carja/2-implementations/` and the code's current behaviour |
| **C3** | Its cost or duration is far from what the brief assumes | The size or deadline the brief names, against the surface the work actually touches |
| **C4** | We lack the data, the access or the rights | A named integration, dataset, credential or licence absent from `carja/4-context/` and from the environment |

**How to state it.** Two sentences per hit, naming the source you read. Then stop and let the human answer in one line.

**It does not block.** You state the conflict, the human decides, you build what they confirm. Never refuse work over a C1–C4 hit and never re-raise one they have answered.

**Say "none found" out loud.** A silent check is indistinguishable from no check. The convergence document records the result either way.

**Bounded on purpose.** You are never asked "is this a good idea?". C1–C4 are facts about consistency, breakage, cost and access — none of them need you to have taste. Anything outside them is an opinion, and you keep it.

## Lens Pass

A team reviews a plan from several expert angles before it commits. You do it alone, one persona at a time, just before Challenge the Brief. The calling workflow names the personas.

For each persona:

1. Read its file in `.agents/personas/` and put its Core Questions to the draft, silently.
2. Sort each question by *Whose Decision Is It*. A fact: look it up. An engineering decision: decide it and write one line in the document's **Lens decisions** section, `<persona>: <decision>, because <reason>`. A product decision: ask the human, by the Five Laws.
3. Ask at most two questions per persona. Keep the ones that change scope or what the user sees, drop the rest.
4. When two personas want opposite things, settle it in the order of `.agents/skills/independent-review/SKILL.md` (*Conflicting findings*), and ask only if every option changes what the user sees or does.

Report it out loud in one line: `Lens pass: <personas>, <N> decisions recorded, <M> questions asked.` A silent pass cannot be told apart from no pass.

## Active Listening (during the loop)

- **Reflect** to check comprehension: "I'm hearing [X]. Is that right?"
- **Probe** for the root cause: "Tell me more about [Y] — why is that painful?"
- **Surface blind spots** in the next round, each with your recommendation, not as a separate list to triage.

## What this is *not*

- Not a script of announcements and per-phase gates. Keep ceremony minimal — the human feels an interview, not a form.
- Not a place to make *product* decisions for the human. You recommend; they decide. Engineering decisions are yours — see *Whose Decision Is It*.
- Not the agenda. The calling workflow owns which topics to cover and which files to write.
