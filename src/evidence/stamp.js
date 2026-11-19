// src/evidence/stamp.js
//
// F25 (docs/roadmap/Risk-Tiered-Merge.md): every commit says how it was
// verified, "none" included, so code merged without the owner can be audited
// from `git log` alone. The prepare-commit-msg hook calls `carja evidence
// stamp`, which reads this branch's evidence ledger: a green run recorded on
// exactly the tree being committed (the index, so `git commit -a` and partial
// commits are judged on what they commit) is a stamp line, anything else is
// `none`. A run that changed files while it ran does not count. Machine-local
// like the ledger: the stamp says what ran here, never what CI did.

import { execFile } from "node:child_process";
import { promisify } from "node:util";

import { readLedgerRecords } from "./ledger.js";

const execFileAsync = promisify(execFile);
const MAX_CMD = 60;

const minute = (ts) => String(ts ?? "").replace(/:\d\d(\.\d+)?Z$/, "Z");
const short = (cmd) => (String(cmd).length > MAX_CMD ? `${String(cmd).slice(0, MAX_CMD - 3)}...` : String(cmd));

/** The trailer values for a commit of `tree`: one per label that ran green on it (latest run), or ["none"]. Pure. */
export function stampLines(records, tree) {
  if (!tree) return ["none"];
  const latest = new Map();
  for (const r of records ?? []) {
    if (r?.wtree !== tree || r.exit !== 0 || r.tree_changed) continue;
    const prev = latest.get(r.label);
    if (!prev || String(r.ts) >= String(prev.ts)) latest.set(r.label, r);
  }
  if (!latest.size) return ["none"];
  return [...latest.values()].map((r) => `${r.label}: ${short(r.command)}, exit 0, ${minute(r.ts)}`);
}

/** The tree the next commit records: the index git commits from (GIT_INDEX_FILE included). */
async function indexTree(cwd) {
  try {
    const { stdout } = await execFileAsync("git", ["write-tree"], { cwd });
    return /^[0-9a-f]{40}$/.test(stdout.trim()) ? stdout.trim() : null;
  } catch {
    return null;
  }
}

/** Never throws: any doubt is `none`. */
export async function commitStamp({ cwd = process.cwd(), home = null } = {}) {
  const [tree, records] = await Promise.all([indexTree(cwd), readLedgerRecords({ cwd, home })]);
  return stampLines(records, tree);
}
