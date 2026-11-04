// src/work.js
//
// Interactive work is branch-safe (owner, 2026-10-22): the owner's folder, and
// its nested code repository, stay on the default branch. Interactive Spec-It,
// Build and Ship work in one hidden worktree per item, made here:
//   - outer: `.agents/.worktrees/work-<slug>` on `carja/work/<slug>`, from
//     the default branch (never from the branch the owner has checked out);
//   - each nested code repository (`loop.code_dir`, or a gitignored top-level
//     repository) gets a worktree inside it, at the same relative path, on the
//     same branch name, from its own default branch; loop.setup runs there once.
// The same item again reuses what exists. Merged items are removed by the
// loop's prune (src/loop/reconcile.js, prefix `carja/work/`): on `git pull`
// (post-merge hook), at a loop run, or by `carja work clean`.
// `git(cwd)(args)` and `sh(cmd, cwd)` are injected.

import { join, resolve, basename } from "node:path";
import { readFile, writeFile, access } from "node:fs/promises";
import { slugify, ensureWorktreesExcluded } from "./loop/worktree.js";
import { defaultBranchRef, pruneMergedLoopWorktrees, mergedLoopWorktrees, LOOP_PREFIX, WORK_PREFIX } from "./loop/reconcile.js";
import { ensureCodeWorktree } from "./loop/nested.js";
import { untrackedPaths, hideSetupArtifacts } from "./loop/state-sync.js";
import { ignoredNestedRepos } from "./nested-repos.js";
import { parseLoopConfig } from "./loop/config.js";
import { configPath as configPathOf } from "./names.js";

const exists = (p) => access(p).then(() => true, () => false);

/** The item's branch and worktree path. Deterministic. */
export function workPlan(root, item) {
  const slug = slugify(item, "item", 60);
  return { slug, branch: `${WORK_PREFIX}${slug}`, path: join(root, ".agents/.worktrees", `work-${slug}`) };
}

/**
 * Where we are: the project root (the folder that holds carja/ and .agents/),
 * or, when `cwd` is already an item's or a loop beat's worktree, that worktree.
 */
export async function locate(cwd, git) {
  const top = await git(cwd)(["rev-parse", "--show-toplevel"]);
  if (!top.ok) return { root: null };
  const branch = (await git(top.stdout)(["rev-parse", "--abbrev-ref", "HEAD"])).stdout;
  const linked = (await git(top.stdout)(["rev-parse", "--git-dir"])).stdout !== (await git(top.stdout)(["rev-parse", "--git-common-dir"])).stdout;
  if (linked && (branch.startsWith(WORK_PREFIX) || branch.startsWith(LOOP_PREFIX))) return { inside: top.stdout, branch };
  // A nested code repository of the outer layout: the project is its parent.
  let root = top.stdout;
  if (!(await exists(join(root, "carja"))) && (await exists(join(root, "..", "carja"))) && (await exists(join(root, "..", ".agents")))) root = resolve(root, "..");
  return { root };
}

/** The nested code repositories: loop.code_dir, plus gitignored top-level repositories. */
export async function codeDirs(root) {
  let cfg = { codeDir: null, setup: null };
  try {
    cfg = parseLoopConfig(JSON.parse(await readFile(configPathOf(root), "utf8")));
  } catch {
    /* no config: no loop.code_dir, no setup */
  }
  const dirs = new Set(cfg.codeDir ? [cfg.codeDir] : []);
  for (const d of await ignoredNestedRepos(root)) dirs.add(d.replace(/\/$/, ""));
  return { dirs: [...dirs], codeDir: cfg.codeDir, setup: cfg.setup };
}

/**
 * Create or reuse the item's worktree, and one per code repository inside it.
 * @returns {Promise<{ok: boolean, path?: string, branch?: string, base?: string, reused?: boolean, code: object[], setup?: object, reason?: string}>}
 */
export async function ensureWorkWorktree({ root, item, git, sh }) {
  const { branch, path } = workPlan(root, item);
  const g = git(root);
  await ensureWorktreesExcluded(root);
  const listed = await g(["worktree", "list", "--porcelain"]);
  const reused = listed.ok && listed.stdout.split("\n").includes(`worktree ${path}`);
  let base = null;
  if (!reused) {
    await g(["worktree", "prune"]);
    await g(["fetch", "-q", "origin"]);
    base = await defaultBranchRef(g);
    if (!base) return { ok: false, code: [], reason: "this repository has no default branch to start from (origin/HEAD, main or master)" };
    const local = (await g(["rev-parse", "--verify", "-q", `refs/heads/${branch}`])).ok;
    const remote = !local && (await g(["rev-parse", "--verify", "-q", `refs/remotes/origin/${branch}`])).ok;
    const add = local
      ? await g(["worktree", "add", "-q", path, branch])
      : await g(["worktree", "add", "-q", "-b", branch, path, remote ? `origin/${branch}` : base]);
    if (!add.ok) return { ok: false, code: [], reason: `git worktree add failed${add.stderr ? `: ${add.stderr.split("\n")[0]}` : ""}` };
  }
  const { dirs, codeDir, setup } = await codeDirs(root);
  const code = [];
  for (const d of dirs) {
    const codeRoot = join(root, d);
    const r = await ensureCodeWorktree({ codeGit: git(codeRoot), path: join(path, d), branch });
    code.push({ dir: d, ...r });
  }
  let setupResult = null;
  const setupDir = codeDir ? join(path, codeDir) : path;
  if (setup && (await exists(setupDir))) setupResult = await runSetupOnce({ dir: setupDir, setup, root, codeRoot: codeDir ? join(root, codeDir) : null, git, sh });
  return { ok: true, path, branch, base, reused, code, setup: setupResult };
}

/** loop.setup, once per worktree; what it makes is hidden from git, as the loop does. */
async function runSetupOnce({ dir, setup, root, codeRoot, git, sh }) {
  const g = git(dir);
  const markerRel = await g(["rev-parse", "--git-path", "carja-setup.done"]);
  const marker = markerRel.ok ? resolve(dir, markerRel.stdout) : null;
  if (marker && (await exists(marker))) return { ok: true, skipped: true };
  const before = await untrackedPaths({ git: g });
  const env = `export CARJA_ROOT=${JSON.stringify(root)}${codeRoot ? ` CARJA_CODE_ROOT=${JSON.stringify(codeRoot)}` : ""}; `;
  const res = await sh(`${env}${setup}`, dir);
  await hideSetupArtifacts({ before, cwd: dir, git: g });
  if (res.exitCode !== 0) return { ok: false, reason: `exit ${res.exitCode}: ${res.output.trim().split("\n").slice(-3).join(" | ") || "(no output)"}` };
  if (marker) await writeFile(marker, `${new Date().toISOString()}\n`, "utf8");
  return { ok: true };
}

/**
 * Remove merged item and loop worktrees: the code repositories' first, then the
 * outer ones that no longer hold a code worktree. Same protections as the loop:
 * uncommitted work, a live run, a fresh branch, or an open code MR keep it.
 */
export async function cleanMerged({ root, git, forgeMerged = () => async () => null }) {
  const prefixes = [LOOP_PREFIX, WORK_PREFIX];
  const { dirs } = await codeDirs(root);
  const removed = [];
  const kept = [];
  for (const d of dirs) {
    const r = await pruneMergedLoopWorktrees({ git: git(join(root, d)), forgeMerged: forgeMerged(join(root, d)), prefixes });
    removed.push(...r.removed);
    kept.push(...r.kept);
  }
  const r = await pruneMergedLoopWorktrees({
    git: git(root),
    forgeMerged: forgeMerged(root),
    prefixes,
    skip: async (w) => {
      for (const d of dirs) if (await exists(join(w.path, d, ".git"))) return `its code worktree ${d}/ is still open (its MR is not merged yet)`;
      return null;
    },
  });
  return { removed: [...removed, ...r.removed], kept: [...kept, ...r.kept] };
}

/**
 * What `carja status` warns about: a checkout off its default branch, and
 * merged worktrees still on disk. Never throws, never deletes.
 */
export async function branchSafety({ root, git }) {
  const off = [];
  const leftovers = [];
  const { dirs } = await codeDirs(root).catch(() => ({ dirs: [] }));
  for (const [label, dir] of [[".", root], ...dirs.map((d) => [`${d}/`, join(root, d)])]) {
    const g = git(dir);
    if (!(await g(["remote"])).stdout) continue; // no remote: no MR flow
    const base = await defaultBranchRef(g);
    const head = (await g(["rev-parse", "--abbrev-ref", "HEAD"])).stdout;
    const want = base?.replace(/^origin\//, "");
    if (want && head && head !== want) off.push({ label, branch: head, want });
    for (const w of await mergedLoopWorktrees({ git: g, prefixes: [LOOP_PREFIX, WORK_PREFIX] })) leftovers.push({ label, branch: w.branch, path: w.path, name: basename(w.path) });
  }
  return { off, leftovers };
}
