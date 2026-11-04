// src/loop/autocommit.js
//
// Commit-before-teardown backstop (Loop-Robustness P0.1). The single fix that
// closes the observed data-loss chain: a Maker that creates files but skips its
// `git commit` would otherwise (a) let verify pass on the working tree while the
// committed diff stays empty, (b) leave the Checker with no diff to review, and
// (c) have its work destroyed when the worktree is force-removed on teardown.
//
// After every Maker beat the IO shell calls this to capture any uncommitted
// change into a commit, so the rest of the pipeline sees real, durable work. It
// is a no-op when the tree is already clean (the Maker committed properly).
//
// Inspired by agentctl's `ag-merge` auto_commit (stage → conventional message →
// commit). Pure over an injected git runner: `git(args) -> {ok, stdout}`.
//
// 2026-10-22: with `expect: {path}`, it commits only in that worktree, on a loop
// branch. A worktree removed under a live run leaves a plain folder inside the
// owner's checkout, where `git add -A` would commit onto the owner's branch.

import { realpath } from "node:fs/promises";

const LOOP_BRANCH = /^carja\/loop\//;

/** Refusal reason when `git` does not run in the loop worktree at `path`, else null. */
export async function isolationProblem({ git, path }) {
  const top = await git(["rev-parse", "--show-toplevel"]);
  const real = async (p) => realpath(p).catch(() => p);
  if (!top.ok || (await real(top.stdout)) !== (await real(path))) {
    return `${path} is not the loop worktree any more (git sees ${top.ok ? top.stdout : "no repository"}): it was removed under the run`;
  }
  const head = await git(["symbolic-ref", "-q", "--short", "HEAD"]);
  if (!head.ok || !LOOP_BRANCH.test(head.stdout)) {
    return `${path} is not on a loop branch (it is on ${head.ok ? head.stdout : "a detached HEAD"})`;
  }
  return null;
}

/** Build a conventional-commit message for an auto-captured beat. Deterministic. */
export function autoCommitMessage({ role = "maker", beat, goal } = {}) {
  // C3-F21: the message names the work; the loop's internal task id stays out of
  // the team's history. `role` stays in the signature for the callers.
  void role;
  const g = String(goal ?? "")
    .replace(/\s*—\s*(task|ship)\s+\S+$/i, "")
    .replace(/\b(task|slice|blueprint):\S+/g, "")
    .replace(/\(loop-ready\)|\*+/gi, "")
    .trim()
    .replace(/\s+/g, " ");
  const subject = g ? g.slice(0, 60) : "an unattended beat";
  const beatStr = beat != null ? ` (beat ${beat})` : "";
  return `chore: capture uncommitted work: ${subject}${beatStr}`;
}

/**
 * Stage and commit any uncommitted changes reachable by `git`. No-op on a clean
 * tree. If a commit hook (e.g. the TDD pre-commit) rejects the commit, the work
 * is captured anyway with `--no-verify` and the bypass is reported — the backstop
 * exists to prevent LOSS; the Checker + `awaiting_review` remain the quality gate
 * (mirrors the enforcement hooks' own logged-bypass philosophy).
 *
 * @param {{git:(args:string[])=>Promise<{ok:boolean,stdout:string}>, message:string, expect?:{path:string}}} opts
 * @returns {Promise<{committed:boolean, bypassedHooks:boolean, refused?:boolean, reason:string}>}
 */
export async function autoCommit({ git, message, expect = null }) {
  if (expect) {
    const problem = await isolationProblem({ git, path: expect.path });
    if (problem) return { committed: false, bypassedHooks: false, refused: true, reason: problem };
  }
  const status = await git(["status", "--porcelain"]);
  if (!status.ok) return { committed: false, bypassedHooks: false, reason: "git status failed" };
  if (status.stdout.trim() === "") {
    return { committed: false, bypassedHooks: false, reason: "working tree clean — nothing to capture" };
  }
  const add = await git(["add", "-A"]);
  if (!add.ok) return { committed: false, bypassedHooks: false, reason: "git add failed" };

  const commit = await git(["commit", "-m", message]);
  if (commit.ok) {
    return { committed: true, bypassedHooks: false, reason: "captured uncommitted maker changes" };
  }
  // A hook or other pre-commit check rejected it. Losing the work is worse than
  // capturing it for review — commit anyway, flagged, so the bypass is auditable.
  const forced = await git(["commit", "--no-verify", "-m", `${message} [hook-bypassed]`]);
  return forced.ok
    ? { committed: true, bypassedHooks: true, reason: "captured maker changes (commit hook bypassed to avoid work loss)" }
    : { committed: false, bypassedHooks: false, reason: "git commit failed even with --no-verify" };
}

/** Thrown when a beat's worktree is no longer the loop worktree: the run halts. */
export class IsolationLostError extends Error {
  constructor(reason) {
    super(reason);
    this.name = "IsolationLostError";
  }
}

/** autoCommit, but a refusal throws IsolationLostError. */
export async function guardedAutoCommit(opts) {
  const r = await autoCommit(opts);
  if (r.refused) throw new IsolationLostError(r.reason);
  return r;
}
