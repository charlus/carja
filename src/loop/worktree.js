// src/loop/worktree.js
//
// Deterministic git-worktree lifecycle for the loop's Maker (ADR-0001 / Phase 3).
// The Maker runs in an isolated worktree so an unattended run never mutates the
// user's checkout directly; verification and the Checker run against that same
// isolated tree. Merging the branch back is Phase 4's PR-gated merge queue —
// this module deliberately does NOT merge. On teardown it removes the worktree
// only when it holds no unique commits; otherwise it is kept for the human /
// the merge queue and the caller is told.
//
// All git IO is injected as `git(argsArray) -> {ok, stdout}` so the pure naming
// logic and the lifecycle branching are unit-testable without a real repo.

import { join, basename } from "node:path";
import { existsSync, mkdirSync, renameSync, cpSync, rmSync } from "node:fs";
import { defaultBranchRef } from "./reconcile.js";

const WORKTREES_DIR = ".agents/.worktrees";

/** kebab-slug of a goal, bounded, safe for a branch/dir name. Deterministic. */
export function slugify(text, fallback = "loop", max = 40) {
  const slug = String(text ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, max);
  return slug || fallback;
}

/** Stable worktree branch + path for a run. No randomness (driver constraint). */
export function worktreePlan(root, goalDescription) {
  const slug = slugify(goalDescription);
  const branch = `carja/loop/${slug}`;
  const path = join(root, WORKTREES_DIR, slug);
  return { branch, path, slug };
}

/**
 * Pure: the worktree/branch for one swarm task. The goal part is capped at 20
 * characters and the task id is never cut, so two tasks never share a branch.
 */
export function taskWorktreePlan(root, goalDescription, taskId) {
  const goal = slugify(goalDescription, "loop", 20).replace(/-+$/, "");
  const slug = `${goal}-${slugify(taskId, "task", Infinity)}`;
  return { branch: `carja/loop/${slug}`, path: join(root, WORKTREES_DIR, slug), slug };
}

/** Is `path` a live worktree of this repository: registered, and on disk? */
export async function isLiveWorktree({ git, path }) {
  const list = await git(["worktree", "list", "--porcelain"]);
  return Boolean(list.ok && list.stdout.split("\n").includes(`worktree ${path}`) && existsSync(join(path, ".git")));
}

/**
 * I5 (autopportunity, 2026-10-22): a run that died left a plain folder at a
 * worktree's path. `git worktree add` then failed, the loop did not notice, and
 * a beat ran in a folder git did not know. Before an add, a folder at the path
 * that is not a live worktree is moved aside to
 * `<git dir>/carja-loop-logs/leftovers/<name>-<time>`, never deleted, and
 * stale registrations are pruned. The leftover stays there for the owner.
 * @returns {Promise<{moved: string|null}>}
 */
export async function freeWorktreePath({ git, path, now = () => new Date() }) {
  if (await isLiveWorktree({ git, path })) return { moved: null };
  await git(["worktree", "prune"]);
  if (!existsSync(path)) return { moved: null };
  const common = await git(["rev-parse", "--path-format=absolute", "--git-common-dir"]);
  if (!common.ok) return { moved: null };
  const dir = join(common.stdout.trim(), "carja-loop-logs", "leftovers");
  mkdirSync(dir, { recursive: true });
  const dest = join(dir, `${basename(path)}-${now().toISOString().replace(/[:.]/g, "-")}`);
  try {
    renameSync(path, dest);
  } catch {
    cpSync(path, dest, { recursive: true });
    rmSync(path, { recursive: true, force: true });
  }
  await git(["worktree", "prune"]);
  return { moved: dest };
}

/**
 * Create (or reuse) the Maker's worktree on a dedicated branch.
 * @returns {Promise<{path:string, branch:string, created:boolean}>}
 */
export async function createWorktree({ root, goalDescription, git }) {
  const { branch, path } = worktreePlan(root, goalDescription);

  // Already registered? Reuse it (idempotent across resumes).
  const list = await git(["worktree", "list", "--porcelain"]);
  if (list.ok && list.stdout.includes(path)) {
    return { path, branch, created: false };
  }

  // Prefer a new branch; fall back to attaching if the branch already exists.
  // F14: from the default branch, never from the branch the owner has checked out.
  const base = (await defaultBranchRef(git)) ?? "HEAD";
  let add = await git(["worktree", "add", "-b", branch, path, base]);
  if (!add.ok) add = await git(["worktree", "add", path, branch]);
  if (!add.ok) {
    throw new Error(`Failed to create worktree at ${path} (branch ${branch}).`);
  }
  return { path, branch, created: true };
}

// The carja scaffold a Maker needs to be carja-enabled + product-aware.
// `git worktree add` only checks out TRACKED files, so in a repo that gitignores
// these (a real, legitimate setup) the worktree would be blind. We fill them in
// from the main working tree; ignored files stay ignored in the worktree, so they
// never pollute the feature branch / PR.
// AGENTS.md is the instruction file; CLAUDE.md / GEMINI.md stay listed for installs
// that still carry them (a copy is made only when the root has one).
export const CONTEXT_ANCHORS = Object.freeze(["AGENTS.md", "CLAUDE.md", "GEMINI.md", ".agents", "carja"]);

/** Pure: which anchors exist at the root but are MISSING from the worktree. */
export function anchorsToMaterialize({ anchors = CONTEXT_ANCHORS, existsAtRoot, existsInWorktree }) {
  return anchors.filter((a) => existsAtRoot(a) && !existsInWorktree(a));
}

/**
 * Fill an isolated worktree with any carja scaffold git didn't check out
 * (untracked / gitignored), so the Maker is carja-enabled + product-aware
 * regardless of whether the scaffold is committed. Tracked anchors are already
 * present → skipped. IO injected: existsAtRoot/existsInWorktree(anchor)->bool,
 * copy(anchor)->void (the caller's copy MUST exclude `.agents/.worktrees` or it
 * recurses into the worktrees dir). @returns anchors actually materialized.
 */
export async function materializeCarjaContext({ anchors = CONTEXT_ANCHORS, existsAtRoot, existsInWorktree, copy }) {
  const todo = anchorsToMaterialize({ anchors, existsAtRoot, existsInWorktree });
  for (const a of todo) await copy(a);
  return todo;
}

/** True if `branch` has commits not reachable from `baseBranch` (unmerged work). */
export async function hasUniqueCommits({ git, branch, baseBranch = "HEAD" }) {
  const res = await git(["rev-list", "--count", `${baseBranch}..${branch}`]);
  if (!res.ok) return true; // unknown → err on the side of keeping it
  return Number.parseInt(res.stdout.trim() || "0", 10) > 0;
}

/**
 * Tear down the worktree — but ONLY if it has no unique commits. If it does, the
 * work is preserved for the human / Phase 4 merge queue.
 * @returns {Promise<{removed:boolean, reason:string}>}
 */
export async function teardownWorktree({ root, goalDescription, git, baseBranch = "HEAD" }) {
  const { branch, path } = worktreePlan(root, goalDescription);

  const list = await git(["worktree", "list", "--porcelain"]);
  if (!list.ok || !list.stdout.includes(path)) {
    return { removed: false, reason: "no worktree registered" };
  }

  // P0.2 (Loop-Robustness): never `--force`-drop uncommitted work. A dirty tree
  // is kept for the human regardless of commit count — a Maker that created files
  // but never committed them would otherwise have them destroyed here. If the
  // status probe itself fails we also keep, erring on the side of no data loss.
  const dirty = await git(["-C", path, "status", "--porcelain"]);
  if (!dirty.ok) {
    return { removed: false, reason: `could not check ${path} status — kept to avoid data loss` };
  }
  if (dirty.stdout.trim() !== "") {
    return { removed: false, reason: `worktree ${path} has uncommitted changes — kept (not force-removed)` };
  }

  if (await hasUniqueCommits({ git, branch, baseBranch })) {
    return {
      removed: false,
      reason: `worktree ${path} (branch ${branch}) has unmerged commits — kept for merge`,
    };
  }

  const rm = await git(["worktree", "remove", path, "--force"]);
  return rm.ok
    ? { removed: true, reason: `removed clean worktree ${path}` }
    : { removed: false, reason: `git worktree remove failed for ${path}` };
}

/**
 * F12: keep the loop's worktrees out of `git status`. evalapp-v2 did not
 * ignore `.agents/.worktrees/`, so a `git add -A` would have swept the loop's
 * worktrees into a commit. The entry goes in git's local exclude file, so it
 * holds for every existing install and commits nothing. Idempotent; never throws.
 */
export async function ensureWorktreesExcluded(root, entry = ".agents/.worktrees/") {
  const { spawnSync } = await import("node:child_process");
  const { readFileSync, writeFileSync, mkdirSync, existsSync } = await import("node:fs");
  const { dirname, resolve } = await import("node:path");
  try {
    const r = spawnSync("git", ["rev-parse", "--git-path", "info/exclude"], { cwd: root, encoding: "utf8" });
    if (r.status !== 0) return false;
    const path = resolve(root, r.stdout.trim());
    const text = existsSync(path) ? readFileSync(path, "utf8") : "";
    if (text.split(/\r?\n/).some((l) => l.trim() === entry || l.trim() === entry.replace(/\/$/, ""))) return false;
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, `${text}${text && !text.endsWith("\n") ? "\n" : ""}${entry}\n`);
    return true;
  } catch {
    return false;
  }
}
