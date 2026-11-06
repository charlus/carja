// src/review-verdict.js
//
// The record the review gate reads at push (7.2.0): which commits an
// independent reviewer approved. One line per approval, in the pushed
// repository's own git folder, so it works the same in the outer layout (the
// code repository's folder), in a `carja work` worktree and in a loop worktree
// (worktrees share the common folder), and nothing is committed:
//
//   <full sha>\tAPPROVE\t<ISO time>\t<source>
//
// `pre-push` reads it with grep: keep the format a plain tab-separated line.
// The limit, stated: a line written by hand passes the gate as well as one the
// reviewer earned. The gate makes the review the default path; it does not
// prove a reviewer ran. The transcript and the review-log findings do.

import { appendFile } from "node:fs/promises";
import { isAbsolute, join, resolve } from "node:path";

export const VERDICTS_FILE = "carja-review-verdicts";

/** The line recorded for one approval. Pure, for tests. */
export function verdictLine({ sha, source, now = () => Date.now() }) {
  if (!/^[0-9a-f]{40}$/.test(String(sha))) throw new Error(`not a full commit sha: ${sha}`);
  const src = String(source || "manual").replace(/[\t\n]/g, " ").slice(0, 80);
  return `${sha}\tAPPROVE\t${new Date(now()).toISOString()}\t${src}\n`;
}

/**
 * Record that HEAD of the repository `git` runs in was approved.
 * `git(args)` resolves to {ok, stdout}; `cwd` resolves a relative common dir.
 * @returns {Promise<{ok:boolean, sha?:string, file?:string, reason?:string}>}
 */
export async function recordApproval({ git, cwd = process.cwd(), source = "manual", now }) {
  const head = await git(["rev-parse", "HEAD"]);
  if (!head.ok) return { ok: false, reason: "not a git repository with a commit" };
  let common = await git(["rev-parse", "--path-format=absolute", "--git-common-dir"]);
  if (!common.ok) common = await git(["rev-parse", "--git-common-dir"]); // git < 2.31
  if (!common.ok) return { ok: false, reason: "no git folder found" };
  const sha = head.stdout.trim();
  const dir = common.stdout.trim();
  const file = join(isAbsolute(dir) ? dir : resolve(cwd, dir), VERDICTS_FILE);
  try {
    await appendFile(file, verdictLine({ sha, source, now }));
  } catch (e) {
    return { ok: false, reason: `could not write ${file} (${e.message})` };
  }
  return { ok: true, sha, file };
}
