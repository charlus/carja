// src/loop/owner-files.js
//
// I6 (owner, 2026-10-23): the loop writes for the owner, never into git. Its
// messages, its run reports, the question rounds waiting for an answer and its
// improvement proposals stay where the owner and an agent find them, under
// carja/1-workbench/, and git's local exclude file hides them, so
// `git status` in the owner's folder stays clean and nothing reaches a commit.
// Before 6.52.0 the loop appended its escalations to the tracked inbox.md.

import { appendFile, readFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { ensureWorktreesExcluded } from "./worktree.js";

/** The loop's messages to the owner: escalations, stops, decisions taken alone. */
export const MESSAGES_REL = "carja/1-workbench/loop-messages.md";

/** Paths in the owner's checkout the loop writes and git must not see. */
export const OWNER_EXCLUDES = Object.freeze([
  ".agents/.worktrees/",
  MESSAGES_REL,
  "carja/1-workbench/loop-report-*.md",
  // Only the rounds waiting at the top level: answered rounds ride the item's branch.
  "carja/1-workbench/questions/*.md",
  "carja/1-workbench/loop-improvements.md",
]);

/** Add every owner-file entry to git's local exclude file. Idempotent; never throws. */
export async function ensureOwnerFilesExcluded(root) {
  for (const entry of OWNER_EXCLUDES) await ensureWorktreesExcluded(root, entry);
}

const HEADER = "# Loop messages\n\nWhat the loop needs you to know: why a run stopped, what it decided alone. Newest at the bottom. Git does not track this file.\n";

/** Append one message; creates the file with its header. Never throws. */
export async function appendLoopMessage(root, text) {
  const path = join(root, MESSAGES_REL);
  try {
    await mkdir(join(root, "carja/1-workbench"), { recursive: true });
    const existing = await readFile(path, "utf8").catch(() => null);
    await appendFile(path, `${existing === null ? HEADER : ""}${text}`, "utf8");
  } catch {
    /* best-effort: the run's own output says the same */
  }
}

/** The messages, newest last: [{title, text}]. */
export function parseLoopMessages(md) {
  const out = [];
  let cur = null;
  for (const line of String(md ?? "").split("\n")) {
    const h = line.match(/^## \[loop\]\s*(.*)$/);
    if (h) {
      cur = { title: h[1].trim(), text: "" };
      out.push(cur);
      continue;
    }
    if (cur && line.trim() && !cur.text) cur.text = line.trim();
  }
  return out;
}

/** The messages in a checkout, or [] when there are none. */
export async function readLoopMessages(root) {
  return parseLoopMessages(await readFile(join(root, MESSAGES_REL), "utf8").catch(() => ""));
}
