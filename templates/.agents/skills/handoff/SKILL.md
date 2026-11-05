---
name: handoff
description: "Compact the current conversation into a handoff document a fresh agent (or a later session) can pick up cleanly. Use when context is getting long, before reasoning quality degrades, or when passing work between loop iterations or sessions."
---

# Handoff — Pass the Baton Cleanly

A long conversation degrades: the more tokens in context, the worse the reasoning near the end. The fix is to **hand off before that happens** — write down what matters, then let a fresh agent continue with a clean context.

## The smart zone

Effective reasoning lives in a **smart zone** — roughly the first ~120k tokens of a context window. Past it, recall and judgement fall off even when the window technically has room. So:

- **Hand off *before* you leave the smart zone**, not after quality has already dropped.
- **One workflow per session.** Each Carja workflow writes its result to documents, and the next one reads them from disk. The documents are the contract; the conversation that produced them is noise. See *Between workflows* below.
- Prefer **many short, focused sessions** over one sprawling one.

## When to hand off

- Context is long and you're mid-task (approaching the smart zone).
- You're moving from *planning* to *doing* (the planning transcript is dead weight for the doer).
- The loop is starting a new iteration/implementation that doesn't need the last one's transcript.
- A human or another agent will take over.

## Between workflows

The planning chain is Genesis → Storyboard → Grand PRD → UX/UI Design Brief → Technical Vision → Carve → Spec-It → Build. Run each step in a fresh session. A model given requirements across many conversation turns does worse than the same model given the same content at once (Laban et al., 2025: −39% on average; joining the same fragments into one prompt recovered ~95%). A fresh session that reads the documents gets the second case.

1. **The next command carries the path.** At completion, give the human the exact command with the real folder: `/clear`, then `/carve carja/2-backlog/project-backlog/Billing`. For Spec-It and Build the path is the Implementation folder. Do not keep a "current project" pointer file: it goes stale, and it breaks when several projects are active.
2. **The receiving workflow reads that path and does not ask.** With no path, it lists the Projects by last change and recommends the most recent unfinished one.
3. **`handoff.md` only for what no document holds.** If the session leaves open questions or decisions that no document records, write them to `handoff.md` in the folder the next command names, using the structure below. If everything is in the documents, write nothing. The receiving workflow reads `handoff.md` first. When it finishes, it deletes the file it read, and writes a new one only for its own open items.

## Writing the handoff

Write a self-contained handoff document — the reader has **none** of your context. Save it to the workbench (`carja/1-workbench/handoff-[topic].md`) so it survives the session; for a throwaway fork, a temp path is fine.

Include:
1. **Goal** — what we're ultimately trying to achieve (one paragraph).
2. **State** — what's done, what's in progress, what's left. Be concrete.
3. **Key decisions** — what was decided and *why*, so the next agent doesn't relitigate. Link the relevant `carja/` docs, ADRs, and files **by path — do not paste their contents**; the next agent reads them fresh.
4. **Next action** — the single most important thing to do next, stated so precisely the reader could start without asking a question.
5. **Suggested skills/workflows** — which Carja workflow or skill fits the next step (e.g. "run `build.md` on implementation 03").
6. **Traps** — anything that already burned time; what not to retry.

Rules:
- **Reference, don't duplicate.** Point at artifacts by path/URL; never copy large content into the handoff.
- **Redact secrets** — no tokens, keys, or credentials in the document.
- **The next action must be unambiguous** — if a fresh reader would have to ask "what did you mean?", it isn't done.
- **Prefer portable anchors over local paths when the receiver may be on a different checkout** (a human pasting into a fresh agent, another machine, a later CI run). Anchor on things that survive relocation — repo owner/name, issue/PR URLs, branch names, command and config names — and tell the receiver to *find the repo from the current or a parent directory and read the local agent/repo instructions* rather than trusting an absolute path. Keep `carja/`-relative paths for a same-tree loop handoff; add the portable anchors when it might leave the tree.

## Brief the receiver as a peer, not an executor

A fresh agent with clean context is your independent-review advantage (`skills/independent-review/SKILL.md`), not just a pair of hands. Don't hand it a work order — hand it a well-framed problem and let it think:

- **License it to challenge the task.** Say explicitly: *decide whether this task is still real, whether the proposed direction is sound, and whether a smaller or better fix exists before proceeding.* The precise next action (above) is the starting hypothesis, not a command to execute blind.
- **Tell it to re-check live state, not trust the snapshot.** By the time the handoff is picked up, branch/CI/issue state may have moved — instruct the receiver to re-verify MR/CI/deploy/working-tree status for itself (`carja status --live`, `.agents/rules/live-state-law.md`). Your snapshot is a lead, not ground truth.
- **Set output boundaries.** The receiver does **not** push, merge, label, or post public comments unless the handoff explicitly authorizes it — same report-don't-act discipline as the review gate.

## In the autonomous loop

The unattended loop (`.agents/workflows/unattended-loop.md`) should hand off between iterations rather than carry an ever-growing transcript: persist the durable state (see `loop-state.json`), write a handoff for anything not captured there, and let the next iteration start in the smart zone. This keeps long headless runs reasoning at full strength instead of degrading over time.
