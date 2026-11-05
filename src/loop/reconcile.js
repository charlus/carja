// src/loop/reconcile.js
//
// Unattended Lifecycle step 2 (docs/roadmap/Unattended-Lifecycle.md). State
// that depends on a merge is carried by the MR or derived from git, never
// written after the merge:
//   - claims come from git: a work item whose loop branch exists on the remote
//     is in progress or in review. Nothing is committed to mark it.
//   - cleanup on the next git touch: a loop worktree whose branch is merged
//     into the default branch is removed, with its local branch.
// Removal is conservative: only a branch provably contained in the default
// branch (`merge-base --is-ancestor`), only a worktree with no uncommitted
// change. F22: a squash-merged branch is not contained in the default branch,
// and the forge deletes it. It counts as merged only when the forge reports a
// merged MR whose head is the local branch head (`forgeMerged(branch) -> sha`),
// never because the remote branch is gone. `git(args) -> {ok, stdout}` is
// injected; nothing here fetches.
// 2026-10-22: worktrees are shared by every checkout of a repository, so one
// loop's cleanup sees another loop's worktrees. A branch with no commit of its
// own (it sits on the default branch's first-parent line) is fresh, not merged,
// and a worktree whose holder (a live run's pid, in the worktree's own git
// directory) is alive is never removed.

import { readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";

const WORKTREES = "/.agents/.worktrees/";
export const LOOP_PREFIX = "carja/loop/";
/** The 6.x prefix, read through 7.x. */
export const OLD_LOOP_PREFIX = "conductor/loop/";
// Interactive work (`carja work <item>`): its own prefix, so a loop item and
// an interactive item never share a branch. Cleaned by the same prune.
export const WORK_PREFIX = "carja/work/";
export const HOLDER_FILE = "carja-holder";

/** Is `pid` a live process? EPERM means alive but not ours. */
export function isPidAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return e?.code === "EPERM";
  }
}

/** Record that run `pid` holds the worktree `git` runs in. Best-effort. */
export async function markWorktreeHeld({ git, pid = process.pid, now = () => new Date().toISOString() }) {
  const dir = await git(["rev-parse", "--path-format=absolute", "--git-dir"]);
  if (!dir.ok) return false;
  try {
    await writeFile(join(resolve(dir.stdout), HOLDER_FILE), `${JSON.stringify({ pid, at: now() })}\n`, "utf8");
    return true;
  } catch {
    return false;
  }
}

/** The live pid holding the worktree at `path`, or null. `git` runs in the main checkout. */
export async function liveHolder({ git, path, isAlive = isPidAlive }) {
  const dir = await git(["-C", path, "rev-parse", "--path-format=absolute", "--git-dir"]);
  if (!dir.ok) return null;
  try {
    const pid = Number(JSON.parse(await readFile(join(resolve(path, dir.stdout), HOLDER_FILE), "utf8"))?.pid);
    return Number.isInteger(pid) && pid > 0 && isAlive(pid) ? pid : null;
  } catch {
    return null;
  }
}

/** The default branch to compare with: origin/HEAD, else origin/main|master, else main|master. */
export async function defaultBranchRef(git) {
  const head = await git(["rev-parse", "--abbrev-ref", "origin/HEAD"]);
  if (head.ok && head.stdout && head.stdout !== "origin/HEAD") return head.stdout;
  for (const ref of ["origin/main", "origin/master", "main", "master"]) {
    if ((await git(["rev-parse", "--verify", "-q", ref])).ok) return ref;
  }
  return null;
}

/**
 * After the owner merges a loop MR, bring the checkout the loop reads its
 * backlog from up to the default branch. A fast-forward only, and only when the
 * checked-out branch tracks the default branch: never a rebase, never a stash.
 * Git keeps uncommitted changes to files the merge does not touch, and refuses
 * the rest. Call after a fetch.
 * @returns {Promise<{status:"updated"|"current"|"skipped"|"failed", ref?:string, count?:number, reason?:string}>}
 */
export async function catchUpCheckout({ git }) {
  const upstream = await git(["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{u}"]);
  const ref = await defaultBranchRef(git);
  if (!upstream.ok || !ref || upstream.stdout !== ref) return { status: "skipped" };
  const behind = await git(["rev-list", "--count", `HEAD..${ref}`]);
  const count = Number.parseInt(behind.stdout, 10) || 0;
  if (!behind.ok || count === 0) return { status: "current", ref, count: 0 };
  const merge = await git(["merge", "--ff-only", "-q", ref]);
  if (!merge.ok) {
    const reason = (merge.stderr || "").split("\n").find((l) => /fatal|error/i.test(l)) || "the fast-forward was refused";
    return { status: "failed", ref, reason: reason.replace(/^(fatal|error):\s*/i, "").trim() };
  }
  return { status: "updated", ref, count };
}

/** The loop's worktrees (or those of `prefixes`): path and branch, from `git worktree list --porcelain`. */
export async function loopWorktrees(git, prefixes = [LOOP_PREFIX]) {
  const list = await git(["worktree", "list", "--porcelain"]);
  if (!list.ok) return [];
  const out = [];
  let cur = {};
  for (const line of `${list.stdout}\n`.split("\n")) {
    if (line.startsWith("worktree ")) cur = { path: line.slice(9) };
    else if (line.startsWith("branch ")) cur.branch = line.slice(7).replace(/^refs\/heads\//, "");
    else if (line === "") {
      if (cur.path && prefixes.some((p) => cur.branch?.startsWith(p)) && cur.path.includes(WORKTREES)) out.push(cur);
      cur = {};
    }
  }
  return out;
}

/**
 * Loop worktrees whose branch is contained in the default branch, or (F22) whose
 * MR the forge reports merged. A forge-merged branch with commits after the
 * merged head is returned with `ahead: true`: the caller keeps it.
 * @param {{git: Function, forgeMerged?: (branch: string) => Promise<string|null>}} deps
 */
export async function mergedLoopWorktrees({ git, forgeMerged = async () => null, prefixes = [LOOP_PREFIX] }) {
  const base = await defaultBranchRef(git);
  if (!base) return [];
  const merged = [];
  // The default branch's own line: a branch tip on it has no commit of its own.
  const line = await git(["rev-list", "--first-parent", base]);
  const own = new Set(line.ok ? line.stdout.split("\n").filter(Boolean) : []);
  for (const w of await loopWorktrees(git, prefixes)) {
    const tip = await git(["rev-parse", w.branch]);
    const fresh = !line.ok || !tip.ok || own.has(tip.stdout);
    if (!fresh && (await git(["merge-base", "--is-ancestor", w.branch, base])).ok) {
      merged.push({ ...w, base });
      continue;
    }
    const sha = await forgeMerged(w.branch).catch(() => null);
    if (!sha) continue;
    const head = await git(["rev-parse", w.branch]);
    if (!head.ok) continue;
    merged.push({ ...w, base, via: "forge", ahead: head.stdout !== sha && !(await git(["merge-base", "--is-ancestor", head.stdout, sha])).ok });
  }
  return merged;
}

/**
 * Remove merged loop worktrees and their local branches. A worktree with
 * uncommitted changes is kept, with the reason, and so is one `skip` names. Never throws.
 * @returns {Promise<{removed: object[], kept: object[]}>}
 */
export async function pruneMergedLoopWorktrees({ git, skip = async () => null, forgeMerged, isAlive = isPidAlive, prefixes = [LOOP_PREFIX] }) {
  const removed = [];
  const kept = [];
  for (const w of await mergedLoopWorktrees({ git, forgeMerged, prefixes })) {
    const holder = await liveHolder({ git, path: w.path, isAlive });
    if (holder) {
      kept.push({ ...w, reason: `a live loop run (pid ${holder}) holds it` });
      continue;
    }
    if (w.ahead) {
      kept.push({ ...w, reason: "it has commits after its merged MR" });
      continue;
    }
    // Step 7: an outer worktree that still holds an open code worktree stays.
    const why = await skip(w);
    if (why) {
      kept.push({ ...w, reason: why });
      continue;
    }
    const dirty = await git(["-C", w.path, "status", "--porcelain"]);
    if (!dirty.ok || dirty.stdout) {
      kept.push({ ...w, reason: dirty.ok ? "it has uncommitted changes" : "its status could not be read" });
      continue;
    }
    const rm = await git(["worktree", "remove", "--force", w.path]);
    if (!rm.ok) {
      kept.push({ ...w, reason: `git worktree remove failed${rm.stderr ? `: ${rm.stderr.split("\n")[0]}` : ""}` });
      continue;
    }
    // A squash-merged branch is not contained in the default branch: -d refuses it.
    await git(["branch", "-q", w.via === "forge" ? "-D" : "-d", w.branch]);
    removed.push(w);
  }
  return { removed, kept };
}

/** The loop branches on the remote, from `git ls-remote`; null when it cannot be read. */
export async function remoteLoopBranches(git) {
  // A 6.x run pushed conductor/loop/<item>: through 7.x it still claims <item>.
  const r = await git(["ls-remote", "--heads", "origin", `${LOOP_PREFIX}*`, `${OLD_LOOP_PREFIX}*`]);
  if (!r.ok) return null;
  return new Set(
    r.stdout
      .split("\n")
      .map((l) => l.split("\t")[1])
      .filter(Boolean)
      .map((ref) => ref.replace(/^refs\/heads\//, "").replace(OLD_LOOP_PREFIX, LOOP_PREFIX))
  );
}

/** Of `branches`, the ones contained in the default branch. */
export async function mergedBranches(git, branches) {
  const base = await defaultBranchRef(git);
  const out = new Set();
  if (!base) return out;
  for (const b of branches) {
    if ((await git(["merge-base", "--is-ancestor", `origin/${b}`, base])).ok) out.add(b);
  }
  return out;
}

/**
 * Claims from git. Pure. An item whose loop branch is on the remote is in
 * progress or in review: skip it. If that branch is already merged but the item
 * is still open, its tick was lost (an MR opened by hand, or a ship before 6.23):
 * skip it too, and name it, so the owner can tick it.
 */
export function skipClaimed(queue, { remoteBranches, mergedBranches: merged = new Set(), branchFor }) {
  const out = { queue: [], inReview: [], mergedButOpen: [] };
  for (const t of queue) {
    const b = branchFor(t);
    if (!remoteBranches?.has(b)) out.queue.push(t);
    else if (merged.has(b)) out.mergedButOpen.push(t);
    else out.inReview.push(t);
  }
  return out;
}

/**
 * `carja loop <project>` cleans up after itself: every loop worktree that run
 * `pid` holds is removed when it has no uncommitted change. The commits stay in
 * the branch, so nothing is lost; a branch whose tip is already on the remote is
 * deleted too. The code worktree inside (`codeDir`) goes first. A worktree with
 * uncommitted work is kept, with the reason. Never throws.
 * @param {{git: Function, codeGit?: Function|null, codeDir?: string|null, pid?: number}} deps
 * @returns {Promise<{removed: object[], kept: object[]}>}
 */
export async function removeHeldWorktrees({ git, codeGit = null, codeDir = null, pid = process.pid }) {
  const removed = [];
  const kept = [];
  const heldByMe = async (g, path) => (await liveHolder({ git: g, path, isAlive: (p) => p === pid })) === pid;
  const removeOne = async (g, w) => {
    const dirty = await g(["-C", w.path, "status", "--porcelain"]);
    if (!dirty.ok || dirty.stdout) {
      kept.push({ ...w, reason: dirty.ok ? "it has uncommitted changes" : "its status could not be read" });
      return false;
    }
    const rm = await g(["worktree", "remove", w.path]);
    if (!rm.ok) {
      kept.push({ ...w, reason: `git worktree remove failed${rm.stderr ? `: ${rm.stderr.split("\n")[0]}` : ""}` });
      return false;
    }
    const local = await g(["rev-parse", w.branch]);
    const pushed = await g(["rev-parse", `origin/${w.branch}`]);
    if (local.ok && pushed.ok && local.stdout === pushed.stdout) await g(["branch", "-q", "-D", w.branch]);
    removed.push(w);
    return true;
  };
  for (const w of await loopWorktrees(git)) {
    if (!(await heldByMe(git, w.path))) continue;
    if (codeGit && codeDir) {
      const code = { path: join(w.path, codeDir), branch: w.branch, code: true };
      const listed = await codeGit(["worktree", "list", "--porcelain"]);
      if (listed.ok && listed.stdout.split("\n").includes(`worktree ${code.path}`) && !(await removeOne(codeGit, code))) {
        kept.push({ ...w, reason: "its code worktree is kept" });
        continue;
      }
    }
    await removeOne(git, w);
  }
  return { removed, kept };
}
