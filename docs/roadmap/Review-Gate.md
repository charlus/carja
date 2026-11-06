# Review Gate

> **Status (2026-11-06):** built in 7.2.0. Proven on the real hook by `test/hooks-review-gate.sh` (17 cases, red on 7.1.0) and `test/review-verdict.test.js`. Not yet run on a real project or through a live loop run.

## Why

Owner decision D1 (2026-11-06), after two measurements:
- In our own evaluations, the independent review ran in few Carja sessions when only the workflow text asked for it.
- An audit of one production project's review records found the review rarely wrong: 1 wrong finding in 142 blockers. About half of the blockers were spec errors caught before any code, and about a third were real defects a user would hit. About 30% were overstated in severity.

So the review is the step worth enforcing, and its severity needed calibrating. The detailed numbers stay with the owner's private records.

## What it does

- `pre-push` computes the review skill's own threshold for each pushed ref: changed non-test lines of code since the default branch (or since the remote tip, for a push to the default branch), and whether a risk path is touched. `carja/`, `.agents/`, Markdown and test files never count.
- At or above the threshold, it needs an APPROVE recorded for the pushed commit, or for an ancestor after which the added code alone is below the threshold.
- The record is one line per approval in `<git common dir>/carja-review-verdicts` (`src/review-verdict.js`). It is the pushed repository's own, so the outer layout, `carja work` worktrees and loop worktrees all read the right one. Nothing is committed.
- Writers: `carja review-log verdict APPROVE [--repo <dir>]` (Ship Phase 4), and the loop's `openPullRequest`, which the driver reaches only after the Checker approved.
- Waiver: `CARJA_NO_REVIEW="why"`, logged to the ship-log.
- Severity: the reviewer brief now says a defect blocks only when normal use reaches it (calibration case C8). `carja review-log` refuses a consistency finding as a BLOCKER.

## Limits

- A line written by hand passes as well as one a reviewer earned. The gate makes the review the default path; it does not prove a reviewer ran.
- The risk-path list is a filename pattern. An API contract change in an ordinary file is caught only by its size.
- Like every client-side hook, `--no-verify` and `CARJA_HOOKS=off` skip it. The heartbeat in `carja status` names such pushes.
