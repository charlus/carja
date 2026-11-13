---
name: independent-review
description: "The fresh-context review gate. When a workflow produces a consequential artifact — a PRD, an architecture, a spec, a carved plan, a diff — spawn a separate reviewer that did NOT produce it to decide whether it's ready, before it's saved or handed off. This is the Maker/Checker split applied to any artifact. Ship's Phase 4 is its reference implementation; blueprint workflows load it too."
category: core
---

# Independent Review (Fresh-Context Gate)

> The author cannot be their own last reviewer. A mind that just produced an artifact is anchored on the reasoning that produced it — it sees what it *meant*, not what it *wrote*. A reviewer in a **separate, clean context** reads only what's actually there, which is the whole point. This is Carja's Maker/Checker split (`personas/checker.md`, `skills/subagent-isolation/SKILL.md`) applied to any consequential output, not just code.

**This skill is the caller's half of the gate: when to run it, what to hand the reviewer, and how the cycle terminates.** The reviewer's own instructions are one self-contained file — `reviewer.md` — handed over verbatim. Do not append other skills to it.

## When to run it

Run this gate **once, when a consequential artifact is complete and about to be saved or handed to the next phase** — not per paragraph, not per step.

- **Run it for:** a Grand PRD, a Technical Vision, a Feature Spec + Implementation Plan whose plan has more than 3 tasks or touches a risk path, a Carve slicing, a shippable diff (once for the whole change, not per task) — anything a later phase will *build on* or a reader will *trust without re-deriving*.
- **Skip it for a diff** that is under **50 changed non-test lines** *and* touches no risk path (auth/session, payments, migrations or schema, API contracts, security, secrets, CI or hooks). The author's two-stage self-review plus a green suite plus the human's own PR read is the gate. Say you skipped it and why.
- **Skip it entirely for** trivial or fully-reversible artifacts (a one-line copy fix, a scratch note).
- **Proportionality is a measured effect, not a preference.** For work comfortably inside the model's capability an independent reviewer is overhead; it earns its cost at the edge — a risky diff, an unfamiliar subsystem, a high-stakes artifact. Run the reviewer on the project's `review` model (`carja models`; `skills/model-routing/SKILL.md`): a verifier weaker than the author is a false safety signal.

## The gate

**1. Spawn the reviewer in isolation.** Per `skills/subagent-isolation/SKILL.md`, it runs in a separate, clean context so it isn't biased by the reasoning that produced the artifact:
- **Claude Code:** launch a subagent (Task tool) in the foreground: wait for its verdict, never `run_in_background`.
- **Antigravity / others:** use the platform's sub-agent primitive.
- **No sub-agent primitive (graceful degradation):** do a deliberate fresh-context pass yourself — re-read **only** the artifact and its source-of-truth inputs, not the conversation that produced it. The gate always runs; only its isolation strength scales with the platform.

**2. Hand it exactly three things.**
- **`skills/independent-review/reviewer.md`** — verbatim, its whole brief.
- **`skills/independent-review/calibration.md`** — when the artifact is consequential (a shippable diff, a loop beat). Skip for a cheap pass.
- **The definition of done + the artifact.** The acceptance criteria (or `goal_description` for a loop beat) plus the review lens below, and the artifact itself — the specific file(s), or `git diff <merge-base>...HEAD` for a diff. Not the whole repo.

**3. It returns findings and one verdict line.** `APPROVE` when there are zero blockers; otherwise `CHANGES REQUESTED`. A BLOCKER carries a quoted line and confidence ≥ 7, per the brief. The report opens with `SCOPE: complete` or `SCOPE: partial — <gap>`.

**3b. A review that did not happen is not a round.** Output with no `VERDICT:` line — empty, truncated, a refusal, a tool or API failure — means the reviewer never reached a verdict. Re-spawn **once**. If the second run also returns no verdict, stop and tell the human the gate did not run, with the raw output. Never proceed as if it passed, and never count the failed spawn against the delta-round cap: the cap counts verdicts. `SCOPE: partial` together with `APPROVE` is self-contradicting; read it as `CHANGES REQUESTED` and either re-spawn on the unexamined part or record that part as unreviewed where the merger sees it. The autonomous loop enforces the same rule in code (`src/loop/checker.js` fails safe on a missing or malformed verdict); this is the interactive path's copy.

**4. It only reports.** The reviewer does not save, merge, push, or edit — the accountable agent fixes and re-verifies (`.agents/rules/verification-iron-law.md`). A subagent's "it's fine" is never the proof.

## Disposing of the findings

Freeze a baseline before the first cycle: the original request, the artifact's intended scope, and its size (changed non-test LOC for a diff; section/Epic/slice count for a blueprint).

| Finding | What you do |
|---|---|
| **BLOCKER** | Fix it now, in this cycle. Fix the **class** the reviewer named — including the `also:` list — and verify with the reviewer's own detection method, not a weaker one. Keep the suite GREEN. |
| **IMPORTANT** | Fix it now if it is cheap and in-scope. Otherwise record it in the PR/MR description under **Known gaps**, where the person merging sees it. |
| **NIT** | Author's discretion. Never blocks, never escalates. |
| **`SCOPE:`** | Surface to the human. Do not absorb it, and do not fix around it. |

**No follow-up backlog from review.** A proven in-scope defect is fixed in this cycle or written into the PR body. Deferral lists rot and are never acted on — recording a gap where the merger reads it is honest; filing it into a backlog nobody re-reads is not.

**Dismissing a finding is a valid outcome.** For each one you decide *"deliberate trade-off → dismiss with a one-line reason"* or *"I only told myself it was deliberate — the reviewer is right."* Record the disposition either way with `carja review-log append '{…}'`, the reviewer's `class` as `category` and its `lens` as `persona` (omit it for `spec`) — one line per finding into `carja/1-workbench/review-log.jsonl` (Ship 4.4 shows the record): a class dismissed most of the time is a rubric defect to fix in `calibration.md`, not an author defect.

## Conflicting findings

The reviewer reads the Review Lens of every persona `carja personas` listed, so two findings can pull opposite ways: the Security Auditor wants a re-authentication step, the Designer wants no extra step. You are the accountable engineer of a team, and the human is its product owner. Settle the conflict yourself, in this order: **security and data integrity, then acceptance criteria, then architecture, then performance, then design**. The higher one wins. Record the losing finding as dismissed with `persona` and `overridden_by`; the ledger refuses an override that reverses the order.

Ask the product owner only when **every option changes what the user sees or does** (an extra step, a slower screen, a dropped behaviour). Then it is a product decision: one question, both options in one line each, your recommendation first. Record their answer with `po_decision: true`. A conflict whose resolution the user cannot see is never theirs.

## The delta round — capped at one

If the verdict was `CHANGES REQUESTED` and you fixed blockers, re-review **once**, with a **fresh** reviewer and a narrowed brief:

- Round-1 findings **plus your disposition of each one** (`fixed@<sha>` / `dismissed: <reason>` / `known gap`). The reviewer never re-litigates a dismissal it can see the reason for.
- `git diff` of the **fix commits only** — not the whole artifact again.
- Its job, and only this: *are the named classes closed, and did the fix introduce any new blocker?*

**Then it terminates.** One delta round is the cap.

- Delta round returns `APPROVE` → proceed.
- Blockers remain → only security and data-loss blockers go to the human: accepting that risk is a business decision. Batch them into a **single question** with each finding, its quote, your recommendation per item, and an overall recommendation. Every other remaining blocker is yours: fix it, or write it under **Known gaps** in the PR description, where the merger sees it. Do not spawn a third reviewer.

**Never escalate an unreviewed fix round.** If the budget or the cap is reached immediately after a fix round, the delta review still runs before you report failure — otherwise you hand back work that may well be complete, having never looked at it. A round that ends without a verdict on its own fixes is not a result.

**Other convergence brakes** (stop, surface the state, let the human decide):
- The fix has grown the artifact past **~2× its frozen scope** without approval.
- The best fix requires **defining a canonical contract first**, or leaves the original boundary.

Hitting a brake is a successful outcome of the gate: it has found that the work is bigger than the request.

## Review lenses (what "ready" means per artifact)

> **Rubric v2** — the reviewer's rubric lives in `reviewer.md` and `calibration.md`; these lenses say what the *definition of done* is for each artifact. Editing either bumps the version; calibrate per `skills/judge-panel/SKILL.md`.

| Artifact | The definition of done the reviewer checks |
|---|---|
| **Grand PRD** (`grand-prd`) | Are the Epics MECE and right-sized? Do they collectively deliver the full transformation — any Storyboard scene lost, any Main-Character outcome unaddressed? Any scope smuggled in that no Genesis symptom justifies? |
| **Technical Vision** (`technical-vision`) | Does the architecture support **every** Epic and serve **every** screen? Is any complexity unjustified (deep-module / deletion test)? Are the ADRs sound and the data model internally consistent? Are the named risks the real ones? |
| **Feature Spec + Plan** (`spec-it`) | Is every acceptance criterion **testable** and unambiguous? Does the plan implement exactly the spec — nothing missing, nothing extra? Is it sliced into thin vertical increments? |
| **Carve slicing** (`carve`) | Does each Implementation deliver testable value on its own? Is the dependency order a valid DAG with no cycles or orphans? Is anything from the Blueprint uncarved, or any slice too big to build safely? |
| **Diff** (`ship`, loop execution) | The spec's acceptance criteria (or `goal_description`), walked as a checklist, plus every item of `carja/0-compass/architecture-checklist.md` if it exists, plus the **Review Lens** lines `carja personas` prints for the diff. For a runtime surface, pair the static read with a source-blind behavior check of the running artifact (`skills/behavior-validator/SKILL.md`) — run by the **author**, its output handed to the reviewer as evidence. |

## In the autonomous loop

- This gate is the natural **blueprint (L2) review step**: when a Maker beat produces a spec or architecture, run the gate before the driver accepts the artifact.
- For **diffs in execution (L3)**, the same split is enforced out-of-process by the independent Checker (`workflows/loop-checker.md`, verdict via `checker-verdict.json`) above the driver's green-verify floor — same rubric, deterministic wiring, and the driver's fail-safe on a missing or malformed verdict is unchanged.
- Run the reviewer on the `review` model (`carja models`); record the model in `0-compass/ship-log.md` so the gate stays auditable.

## Anti-patterns

- The author "reviewing" their own artifact in the same context they wrote it — that's proofreading, not an independent gate.
- A gate per step instead of one gate per artifact — turns review into ceremony and trains the team to rubber-stamp.
- **Withholding APPROVE because more could be built.** The reviewer judges the delivered scope against a stated definition of done; anything else is an unbounded question with no terminating answer.
- **An unbounded reviewer brief.** Loop count tracks the size of the instruction corpus, not the size of the change. One short self-contained brief, not a chain of skills.
- **Blocking on a finding with no quoted evidence** — that is how a nit becomes a round.
- Letting the reviewer edit the artifact — it reports; the accountable agent fixes and re-verifies.
- **Fixing every finding reflexively instead of disposing of it by severity** — a real-but-out-of-scope finding fixed inline is how a narrow change balloons into a rewrite.
- **Absorbing a `SCOPE:` finding silently to keep the loop green** — that is how scope creep hides.
- **Looping the fix cycle without the cap** — one delta round, then a human decides.
