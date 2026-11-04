// src/evidence/wtree.js
//
// The working-tree CONTENT fingerprint (E2) — a git tree hash of the tree as it
// is right now, staged or not, committed or not.
//
// SOURCE. The technique — hash the working tree's CONTENT, staged or not — is
// gstack's `bin/gstack-wtree` (Garry Tan, MIT), reimplemented here in JavaScript
// with the same three-property argument. Credited in README.md.
//
// WHY THIS SHAPE. Carja's Evidence Rule verifies an exit code and then
// trusts that result forever, because nothing can tell whether the code under
// test still matches the code that WAS tested. A fingerprint fixes that, but
// only if it has three properties — each of which rules out an obvious
// cheaper alternative:
//
//   * `git rev-parse HEAD^{tree}` — WRONG: ignores uncommitted work entirely,
//     so a dirty tree looks identical to its last commit.
//   * hash of `git diff` — WRONG: an untracked new file produces no diff, so a
//     whole new module can appear without moving the fingerprint.
//   * hash of `git status --porcelain` — WRONG: content-blind. Two different
//     edits to the same file give the same status line.
//
// The temp-index + `write-tree` approach gets all three right:
//   - Committing identical content does NOT change it (a record made on a dirty
//     tree stays valid after exactly that content is committed — the
//     Ship "test at Phase 2, gate at Phase 4" case).
//   - Untracked, non-ignored files DO change it (`git add -A`).
//   - .gitignored scratch does not (also `git add -A`), so a test run that
//     writes its own log cannot invalidate itself.
//   - Amend / rebase / squash that preserve content do not change it.
//
// PERFORMANCE. The temp index is seeded by COPYING the real index, which
// preserves git's stat cache, so `git add -A` only re-hashes files whose stat
// actually changed. Seeding with `read-tree HEAD` instead zeroes the stat data
// and forces a full re-hash of every tracked file. Both produce the identical
// hash; the copy is dramatically faster on a large repo.
//
// THE RACY-GIT SUBTLETY (this is the part that is easy to get wrong). Git
// re-hashes any index entry whose cached mtime is not strictly older than the
// index file itself — its protection against a write that lands in the same
// second as the index. `cp` stamps the copy "now", which marks every entry
// non-racy and lets a same-size rewrite in the same second keep its stale
// stat-cache entry: the content change would vanish from the fingerprint. So
// the copy's mtime is restored to the original's. If that restore fails we do
// NOT proceed with the copy (that silently reopens the exact hole) — we fall
// back to the slower `read-tree HEAD` seed, which re-hashes everything and
// therefore stays honest.
//
// The real repo index is never touched: all work happens in a temp index via
// GIT_INDEX_FILE. Staged blobs land in the object store as unreachable objects
// and are gc'd like stash churn — the same property `git stash -u` has.

import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { copyFile, mkdtemp, rm, stat, utimes } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, isAbsolute } from "node:path";

const execFileAsync = promisify(execFile);

async function git(args, cwd, env = undefined) {
  try {
    const { stdout } = await execFileAsync("git", args, {
      cwd,
      env: env ? { ...process.env, ...env } : process.env,
      timeout: 60_000,
      maxBuffer: 16 * 1024 * 1024,
    });
    return { ok: true, out: stdout.trim() };
  } catch (error) {
    return { ok: false, out: "", error };
  }
}

/**
 * Content fingerprint of the working tree at `cwd`.
 * @param {string} cwd
 * @returns {Promise<string|null>} 40-hex git tree hash, or null when there is
 *   no fingerprint to take (not a git repo, repo with no commits, git failure).
 *   Callers treat null as "no evidence binding available" — never as a match.
 */
export async function workingTreeFingerprint(cwd) {
  const top = await git(["rev-parse", "--show-toplevel"], cwd);
  if (!top.ok || !top.out) return null;
  const root = top.out;

  // Resolve the REAL index path BEFORE GIT_INDEX_FILE is set: with the env var
  // in place, `--git-path index` reports the temp index itself and the
  // stat-cache seed silently self-copies into a dead fast path.
  const idx = await git(["rev-parse", "--git-path", "index"], root);
  let realIndex = idx.ok ? idx.out : "";
  if (realIndex && !isAbsolute(realIndex)) realIndex = join(root, realIndex);

  const dir = await mkdtemp(join(tmpdir(), "carja-wtree-"));
  const tmpIndex = join(dir, "index");
  const env = { GIT_INDEX_FILE: tmpIndex };

  try {
    let seeded = false;
    if (realIndex) {
      try {
        const st = await stat(realIndex);
        await copyFile(realIndex, tmpIndex);
        // Restore the original mtime so git's racy-git protection still applies
        // to the copy. A FAILED restore must not fall through to the fast path.
        await utimes(tmpIndex, st.atime, st.mtime);
        seeded = true;
      } catch {
        await rm(tmpIndex, { force: true }).catch(() => {});
        seeded = false;
      }
    }
    if (!seeded) {
      const rt = await git(["read-tree", "HEAD"], root, env);
      if (!rt.ok) return null; // no commits yet → no fingerprint
    }

    const add = await git(["add", "-A"], root, env);
    if (!add.ok) return null;
    const wt = await git(["write-tree"], root, env);
    if (!wt.ok) return null;
    return /^[0-9a-f]{40}$/.test(wt.out) ? wt.out : null;
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}

/** Repo root for `cwd`, or null when not in a git work tree. */
export async function repoRoot(cwd) {
  const r = await git(["rev-parse", "--show-toplevel"], cwd);
  return r.ok && r.out ? r.out : null;
}

/** Current HEAD sha (short), or null. Recorded for human diagnosis only. */
export async function headSha(cwd) {
  const r = await git(["rev-parse", "--short", "HEAD"], cwd);
  return r.ok && r.out ? r.out : null;
}
