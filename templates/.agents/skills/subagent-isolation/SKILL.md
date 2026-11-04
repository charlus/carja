---
name: subagent-isolation
description: "Use when a task needs reading across many files, several independent investigations, or long unbounded exploration — delegate to scout subagents so the main context stays clean and under budget. Also the pattern for parallel work that must not collide. Isolation is the default, not an optimization."
category: core
---

# Subagent Isolation (The Scout Pattern)

> The field consensus names *single-agent-for-complex-work* an anti-pattern and *isolation by default* an invariant (2026 rubric). Context is finite; every file an agent reads to answer a question is context it can't use to do the work. Scouts fix both problems: they read in a **separate** context and hand back only the conclusion.

## The core move: scout, don't slurp

When answering a question means sweeping many files, directories, or naming conventions, **delegate the search to a subagent** and keep only its answer. The orchestrator never sees the file dumps — just "the auth check lives in `middleware/auth.ts:42`, and here's how it's called."

- **Read-heavy discovery** ("where is X handled?", "what conventions does this repo use?", "which files touch the payment flow?") → a scout.
- **One-off fact you already know the location of** → just read it inline; a scout is overhead.
- **Rule of thumb:** if finding the answer costs more context than the answer itself, scout it.

## Parallelize independent questions

Independent investigations run concurrently, each in its own context, results merged by the orchestrator:

- "Audit these 5 modules for the same bug class" → 5 scouts, one per module.
- "How do auth, billing, and notifications each handle retries?" → 3 scouts in parallel.

Blind spots are a feature here: each scout is uncontaminated by the others' findings, so they don't anchor on the same wrong idea. A final **completeness pass** ("what did we not look at?") turns gaps into the next round.

## Isolation by default (not just for speed)

Isolation is also a **safety** property:

1. **Mutating work in parallel → isolated git worktrees.** Two agents editing the same tree collide. Give each its own worktree (see the `git-worktrees` skill) and serialize the merge. This is mandatory for the unattended swarm (see `workflows/unattended-loop.md`).
2. **Scoped context.** Give a subagent the narrowest brief that lets it succeed — the files/dirs in scope, the one question to answer. A subagent with the whole project as context is just the monolith again.
3. **Scoped credentials & atomic commits.** Unattended or risky steps get least-privilege access and commit in small, revertible units — so a bad step is contained and easy to back out. Pair with the enforcement hooks (`.agents/hooks/`) which keep each commit test-backed and each push verified.
4. **A time budget, in the foreground.** Every subagent brief states a time budget (a review: 15 minutes) and what to return when it runs out: what it finished and what it did not. A subagent runs commands in the foreground under `timeout`, never starts background work, and never waits on it: no human is watching its context, so a hung wait can only end with a killed session.
5. **Verification stays with the orchestrator.** A scout reports; the accountable agent (and the human) still verifies. Never let a subagent's "it's fine" be the proof — that's the Verification Iron Law.

## The Checker is a scout too

Carja's Maker/Checker split (see `personas/checker.md`) is this pattern applied to review: the Checker runs in a **fresh, separate context** precisely so it isn't biased by the Maker's reasoning. When you spawn a Checker, spawn it isolated — not as an in-context continuation of the work it's supposed to audit.

## Platform notes

- **Claude Code:** use the Task tool / subagents; launch independent scouts in a single batch so they run concurrently.
- **Antigravity / others:** use the platform's sub-agent or parallel-task primitive; if none exists, fall back to sequential scouts but still keep their raw output out of the main thread — summarize and drop.

## Anti-patterns

- Reading 20 files into the main context "to be safe" before starting — that's the context-poisoning the scout pattern exists to prevent.
- Spawning a scout for a single known file (overhead with no benefit).
- Parallel agents writing to the same worktree (data race; use worktrees).
- Trusting a subagent's unverified success claim.
