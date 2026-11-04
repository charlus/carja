// src/nested-repos.js
//
// Top-level gitignored directories that are git repositories themselves: the
// outer layout, where carja/ and .agents/ sit in a private outer repo and
// the team's code is a nested repository. The loop refuses that layout (D1); the
// project card reads its facts from the nested code repository instead.

import { execFile } from "node:child_process";
import { access } from "node:fs/promises";
import { join } from "node:path";

function gitOut(args, cwd) {
  return new Promise((res) => execFile("git", args, { cwd }, (err, stdout) => res(err ? null : stdout)));
}

/** e.g. ["repo/"]; [] when none, or when `root` is not a git repository. */
export async function ignoredNestedRepos(root) {
  const out = await gitOut(["ls-files", "--others", "--ignored", "--exclude-standard", "--directory"], root);
  if (out == null) return [];
  const found = [];
  for (const entry of out.split("\n")) {
    if (!/^[^/]+\/$/.test(entry)) continue; // top-level directories only
    try {
      await access(join(root, entry, ".git"));
      found.push(entry);
    } catch {
      /* an ignored directory that is not a repository */
    }
  }
  return found;
}
