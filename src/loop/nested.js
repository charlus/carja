// src/loop/nested.js
//
// Unattended Lifecycle step 7 (docs/roadmap/Unattended-Lifecycle.md): the outer
// layout. `carja/` and `.agents/` live in a private outer repository; the
// team's code is a nested, gitignored repository (`loop.code_dir`, e.g. "repo").
// Each beat gets the same layout an interactive session has: an outer worktree,
// and inside it, at `<code_dir>/`, a worktree of the code repository on the same
// branch name, made from the code repository's default branch (never from the
// branch the owner has checked out). A slice then opens two MRs (owner decision
// 2026-10-20): the code MR to the team's forge first, then the state MR to the
// outer repository, naming the code MR. If the code MR fails, no state MR is
// opened; if the state MR fails, the code MR is named in the inbox. Never a
// direct push. `git(args)` runners are injected; nothing here reads config.

import { join } from "node:path";
import { defaultBranchRef } from "./reconcile.js";
import { isLiveWorktree, freeWorktreePath } from "./worktree.js";

/** Where the code repository and the beat's code worktree are. */
export function codePaths({ root, codeDir, outerWorktree }) {
  return { codeRoot: join(root, codeDir), codeWorktree: join(outerWorktree, codeDir) };
}

/**
 * Create (or reuse) the code worktree for a beat. The base is the code
 * repository's default branch (origin/HEAD), fetched first: the owner's own
 * checkout may sit on a feature branch, which must never become the base.
 * @returns {Promise<{ok: boolean, path?: string, base?: string, reason?: string}>}
 */
export async function ensureCodeWorktree({ codeGit, path, branch, base: stackBase = null }) {
  if (await isLiveWorktree({ git: codeGit, path })) return { ok: true, path, reused: true };
  // I5: a leftover folder at the path is moved aside, never deleted.
  const freed = await freeWorktreePath({ git: codeGit, path });
  await codeGit(["fetch", "-q", "origin"]);
  // A stacked item starts from the code branch of the item below it.
  const base = stackBase ?? (await defaultBranchRef(codeGit));
  if (!base) return { ok: false, reason: "the code repository has no default branch to start from (origin/HEAD, main or master)" };
  let exists = (await codeGit(["rev-parse", "--verify", "-q", `refs/heads/${branch}`])).ok;
  // A stacked item rebuilt on a new base: its old local branch is not reused.
  if (exists && stackBase && !(await codeGit(["merge-base", "--is-ancestor", stackBase, branch])).ok) {
    exists = !(await codeGit(["branch", "-q", "-D", branch])).ok;
  }
  const add = exists ? await codeGit(["worktree", "add", path, branch]) : await codeGit(["worktree", "add", "-b", branch, path, base]);
  if (!add.ok) return { ok: false, reason: `git worktree add failed in the code repository${add.stderr ? `: ${add.stderr.split("\n")[0]}` : ""}` };
  if (!(await isLiveWorktree({ git: codeGit, path }))) return { ok: false, reason: `git worktree add reported success, but ${path} is not a worktree of the code repository` };
  return { ok: true, path, base, ...(freed.moved ? { movedAside: freed.moved } : {}) };
}

/** Does the code branch carry commits its base does not have? */
export async function codeHasWork({ codeGit, branch, base: stackBase = null }) {
  const base = stackBase ?? (await defaultBranchRef(codeGit));
  if (!base) return false;
  const r = await codeGit(["rev-list", "--count", `${base}..${branch}`]);
  return r.ok && Number(r.stdout) > 0;
}

/**
 * A stacked item's code becomes one commit on top of its base before the push,
 * so the team's history gets one commit per item although the MR is not
 * squashed on merge. The commit runs the repository's hooks. If it fails, the
 * branch is put back as it was and pushed with its beat commits.
 * @returns {Promise<{squashed: boolean, reason?: string}>}
 */
export async function squashOnto({ codeGit, base, message }) {
  const count = await codeGit(["rev-list", "--count", `${base}..HEAD`]);
  if (!count.ok || Number(count.stdout) <= 1) return { squashed: false, reason: "one commit or none" };
  const head = await codeGit(["rev-parse", "HEAD"]);
  if (!head.ok) return { squashed: false, reason: "no HEAD" };
  if (!(await codeGit(["reset", "-q", "--soft", base])).ok) return { squashed: false, reason: "reset failed" };
  const c = await codeGit(["commit", "-q", "-m", message]);
  if (c.ok) return { squashed: true };
  await codeGit(["reset", "-q", "--soft", head.stdout.trim()]);
  return { squashed: false, reason: `the commit hook refused the squashed commit${c.stderr ? `: ${c.stderr.split("\n")[0]}` : ""}` };
}

/**
 * The two MRs, in order, fail-safe. `openCode` and `openState` open one MR each
 * and return {ok, prUrl, reason}. A Blueprint or a spec-only item has no code:
 * only the state MR.
 */
export async function mergeNested({ hasCode, openCode, openState }) {
  let codeUrl = null;
  if (hasCode) {
    const c = await openCode();
    if (!c?.ok) return { ok: false, reason: `the code MR could not be opened: ${c?.reason ?? "unknown"}. No state MR was opened.` };
    codeUrl = c.prUrl ?? null;
  }
  const s = await openState({ codeUrl });
  if (!s?.ok) {
    return {
      ok: false,
      codeUrl,
      reason: `the state MR could not be opened: ${s?.reason ?? "unknown"}${codeUrl ? `. The code MR is open: ${codeUrl}. Do not merge it until the state MR exists.` : ""}`,
    };
  }
  return { ok: true, prUrl: s.prUrl ?? null, codeUrl, branch: s.branch };
}

/** The state MR's body: what it carries, and the code MR to merge first. */
export function stateMrBody({ codeUrl, body }) {
  const head = codeUrl
    ? `> **Merge the code MR first:** ${codeUrl}\n> This MR carries the Carja state for it: spec, tracker, ship-log, archive.\n\n`
    : "> No code change: this MR carries Carja documents only.\n\n";
  return `${head}${body ?? ""}`;
}

/** The code MR's body: the change, and the state MR that follows it. */
export function codeMrBody({ body }) {
  return `${body ?? ""}\n\n> A second MR in the Carja repository records this work (spec, tracker, ship-log). Merge this one first.\n`;
}

/**
 * F15 (autopportunity, 2026-10-20): the sandbox makes the working directory's
 * own git store writable, not the nested code repository's, so a beat could not
 * commit there. These are exactly what a commit writes. `config` and `hooks`
 * stay read-only, so a beat cannot switch the commit gates off. Proven by a
 * sandboxed commit outside Claude Code's temporary folder (/tmp/claude-<uid>),
 * which the sandbox lets a beat write.
 */
export function nestedSandboxWrites(codeGitDir) {
  return ["objects", "refs", "logs", "worktrees"].map((d) => join(codeGitDir, d));
}

/** Claims from git, both repositories: an item is taken when its branch is on either remote. */
export function unionBranches(outer, code) {
  if (outer === null && code === null) return null;
  return new Set([...(outer ?? []), ...(code ?? [])]);
}

/** The ignored nested repositories the loop refuses: all of them, except the declared code repository. */
export function refusedNestedRepos(found, codeDir) {
  const want = codeDir ? `${String(codeDir).replace(/\/+$/, "")}/` : null;
  return found.filter((d) => d !== want);
}

/** The note every Checker prompt gets in this layout: the code diff is in another repository. */
export function checkerNestedNote(codeDir) {
  return (
    `\n\n---\n\n# This layout: the code is a separate repository\n\n` +
    `\`${codeDir}/\` is its own git repository, on the same branch name as this one. \`git diff\` here shows only the Carja documents. ` +
    `Review the code change with \`git -C ${codeDir} log --oneline origin/HEAD..HEAD\` and \`git -C ${codeDir} diff origin/HEAD...HEAD\`, and run verification inside \`${codeDir}/\`.\n`
  );
}
