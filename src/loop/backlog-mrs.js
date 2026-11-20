// src/loop/backlog-mrs.js
//
// `carja merge-stack` for a backlog run (owner, 2026-11-20): "merge stack only
// work on project, not on a loop that close unrelated tasks from the backlog".
// A plain `carja loop` run opens one MR per backlog item (two in the outer
// layout: code, then state) and records no stack. This finds them on the forge,
// the only source that is current: loop-state.json can lag behind an MR the run
// opened just before it was stopped (autopportunity, 2026-11-20).
//
// An item here is an open MR whose source branch is a loop branch and whose
// target is the default branch, paired with the code MR of the same branch, and
// not part of any project's stack. The items are independent: each targets the
// default branch. Their state MRs all edit the task backlog and the ship-log,
// so after the first merge the others conflict on those files; the walk merges
// the default branch into the state branch, keeping both sides of each Carja
// document (src/loop/conflict.js), and stops on any other conflict.
// Pure except where a function takes injected IO, and takeDefaultKeepingDocs,
// which writes a throwaway worktree under .agents/.worktrees/.

import { readFile, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";

import { MARKER_NAMES } from "../names.js";
import { mergeKeepingDocs } from "./conflict.js";
import { mrTitles } from "./team-facing.js";
import { ownerActionsFromBody } from "./stack.js";

const LOOP_PREFIXES = MARKER_NAMES.map((n) => `${n}/loop/`);

/** True for a branch the loop pushes. */
export const isLoopBranch = (branch) => LOOP_PREFIXES.some((p) => String(branch ?? "").startsWith(p));

/** The MR number in a forge URL, for ordering; Infinity when there is none. */
export function mrNumber(url) {
  const m = String(url ?? "").match(/\/(?:merge_requests|pull)\/(\d+)/);
  return m ? Number(m[1]) : Infinity;
}

const plainTitle = (title) => String(title ?? "").replace(/^Carja state:\s*/i, "").trim();

/**
 * The backlog items waiting for a merge, oldest MR first.
 * @param {{outer: {url: string, branch: string, title?: string}[], code: {url: string, branch: string, title?: string}[]|null,
 *   stackBranches?: Set<string>, tasks?: object[]}} input
 *   `outer`/`code`: the open MRs to the default branch, from each repository's forge
 *   (`code` null without a code repository). `stackBranches`: branches recorded in a
 *   project's stack. `tasks`: loop-state.json's tasks, for the owner actions and rulings.
 * @returns {{entries: object[], orphans: string[]}} `orphans`: code MRs with no state MR, never merged here.
 */
export function backlogEntries({ outer, code = null, stackBranches = new Set(), tasks = [] }) {
  const keep = (mr) => isLoopBranch(mr.branch) && !stackBranches.has(mr.branch);
  const codeBy = new Map((code ?? []).filter(keep).map((mr) => [mr.branch, mr]));
  const entries = [];
  for (const mr of [...outer].filter(keep).sort((a, b) => mrNumber(a.url) - mrNumber(b.url))) {
    const c = codeBy.get(mr.branch) ?? null;
    codeBy.delete(mr.branch);
    const task = tasks.find((t) => t?.worktree?.branch === mr.branch || t?.merge?.pr_url === mr.url || (c && t?.merge?.code_pr_url === c.url)) ?? null;
    const body = task?.ship?.body ?? null;
    entries.push({
      id: task?.id ?? mr.branch,
      title: task ? mrTitles(task).code : plainTitle(c?.title ?? mr.title) || mr.branch,
      outer: { branch: mr.branch, url: mr.url },
      code: c ? { branch: c.branch, url: c.url } : null,
      ownerActions: ownerActionsFromBody(body),
      detected: task?.owner_hints ?? [],
      docsMerged: task?.docs_merged ?? [],
      rulings: task?.rulings ?? [],
    });
  }
  return { entries, orphans: [...codeBy.values()].map((mr) => mr.url) };
}

/** Every branch a project's stack records, from the stack files' contents. */
export function branchesOfStacks(stacks) {
  const out = new Set();
  for (const entries of stacks) for (const e of Array.isArray(entries) ? entries : []) for (const s of [e?.outer, e?.code]) if (s?.branch) out.add(s.branch);
  return out;
}

/** The files `branch` adds to `base`, both on origin, or null. `git(argv)` runs in the repository. */
export async function branchFiles(git, base, branch) {
  const r = await git(["diff", "--name-only", `origin/${base}...origin/${branch}`]);
  return r.ok ? r.stdout.split("\n").map((x) => x.trim()).filter(Boolean) : null;
}

/**
 * Merge `origin/<base>` into the loop branch `branch`, in a throwaway detached
 * worktree, keeping both sides of each conflicted Carja document, and push the
 * result to the branch. The push runs the repository's hooks; nothing is
 * recorded as reviewed. Any other conflict, or a refused push, changes nothing
 * on the remote. `git(argv, cwd?)` runs in `root` unless told otherwise.
 * @returns {Promise<{merged: boolean, files: string[], reason?: string}>}
 */
export async function takeDefaultKeepingDocs({ root, git, branch, base }) {
  await git(["fetch", "-q", "origin"]);
  const dir = join(root, ".agents/.worktrees", `merge-stack-${branch.replace(/[^A-Za-z0-9._-]+/g, "-")}`);
  await git(["worktree", "remove", "--force", dir]);
  await rm(dir, { recursive: true, force: true });
  const add = await git(["worktree", "add", "-q", "--detach", dir, `origin/${branch}`]);
  if (!add.ok) return { merged: false, files: [], reason: `could not check out ${branch}: ${String(add.stderr || add.stdout || "").split("\n")[0]}` };
  try {
    const r = await mergeKeepingDocs({
      git: (argv) => git(argv, dir),
      base: `origin/${base}`,
      read: (rel) => readFile(join(dir, rel), "utf8").catch(() => null),
      write: (rel, text) => writeFile(join(dir, rel), text, "utf8"),
      message: `chore(carja): take ${base} into ${branch}, both sides of each Carja document kept`,
    });
    if (!r.merged) return r;
    const push = await git(["push", "origin", `HEAD:refs/heads/${branch}`], dir);
    if (!push.ok) return { merged: false, files: r.files, reason: `the push of the merge was refused: ${String(push.stderr || push.stdout || "").trim().split("\n").slice(-1)[0]}` };
    return r;
  } finally {
    await git(["worktree", "remove", "--force", dir]);
  }
}
