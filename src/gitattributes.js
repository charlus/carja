// src/gitattributes.js
//
// F10: parallel sessions each add an entry to the same append-only logs on
// their own branch, and the merge request then conflicts. Git's built-in union
// merge driver keeps both sides' lines, which is exactly right for a log that
// is only ever added to. Not for the task backlog: its lines are edited, and
// union would keep both versions of an edited line.

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export const UNION_PATHS = [
  "carja/0-compass/ship-log.md",
  "carja/1-workbench/inbox.md",
  "carja/1-workbench/review-log.jsonl",
  "carja/1-workbench/rulings.md",
];

/** Add `<path> merge=union` for each log missing from .gitattributes. Returns true if it wrote. */
export function ensureUnionMerge(targetDir) {
  const p = join(targetDir, ".gitattributes");
  let content = existsSync(p) ? readFileSync(p, "utf8") : "";
  const present = new Set(content.split(/\r?\n/).map((l) => l.trim().split(/\s+/)[0]));
  const missing = UNION_PATHS.filter((path) => !present.has(path));
  if (!missing.length) return false;
  if (content && !content.endsWith("\n")) content += "\n";
  const header = content.includes("# Carja: append-only logs") ? "" : "# Carja: append-only logs keep both sides on merge\n";
  writeFileSync(p, content + header + missing.map((path) => `${path} merge=union\n`).join(""));
  return true;
}
