// src/loop/writeback.js
//
// Fleet Bridge FB-2 (claim) + FB-3 (write-back). Pure string transforms over the
// human's `./carja/` files so the autonomous fleet reflects its progress into
// the SAME source of truth the interactive agent reads: a claimed item shows as
// "🤖 in progress" (so a human in VS Code doesn't double-book it), and a shipped
// item is ticked done. IO (reading/writing the files) lives in the command shell.
//
// Matching is on the item's TITLE text, tolerant of an existing 🤖 claim
// annotation, so claim → done is idempotent and a re-harvest never double-marks.

const CLAIM = "🤖";

/** Escape a title for use inside a RegExp. */
function esc(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Mark a backlog checkbox item as claimed by the fleet: `- [ ] X` →
 * `- [ ] 🤖 X (in progress: <taskId>)`. No-op if already claimed or absent.
 */
export function claimBacklogItem(md, title, taskId) {
  const t = esc(title);
  // Only an unchecked, unclaimed line matching this title.
  const re = new RegExp(`^([ \\t]*[-*]\\s+\\[ \\]\\s+)(?!${esc(CLAIM)})(${t})[ \\t]*$`, "m");
  if (!re.test(md)) return md;
  return md.replace(re, `$1${CLAIM} $2 (in progress: ${taskId})`);
}

/**
 * Mark a backlog item done: any checkbox line whose title matches (claimed or
 * not) becomes `- [x] X`, dropping the claim annotation. Idempotent.
 */
export function markBacklogItemDone(md, title) {
  const t = esc(title);
  const re = new RegExp(`^([ \\t]*[-*]\\s+)\\[( |x|X)\\]\\s+(?:${esc(CLAIM)}\\s+)?(${t})(?:\\s+\\(in progress:[^)]*\\))?[ \\t]*$`, "m");
  if (!re.test(md)) return md;
  return md.replace(re, `$1[x] $3`);
}

/**
 * Remove a processed inbox thought (it has been triaged into its real home).
 * Matches the bullet by title, claimed or not. Idempotent (no-op if absent).
 */
export function removeInboxItem(md, title) {
  const t = esc(title);
  const re = new RegExp(`^[ \\t]*[-*]\\s+(?:${esc(CLAIM)}\\s+)?${t}[ \\t]*$\\n?`, "m");
  return md.replace(re, "");
}

/**
 * Apply the right claim transform for a task's source kind. Returns the possibly
 * unchanged text; the caller writes it back only if it differs.
 */
export function applyClaim(md, task) {
  if (task?.source?.kind === "backlog") return claimBacklogItem(md, task.source.title, task.id);
  return md; // inbox items are removed on completion, not claimed mid-flight
}

/** Apply the right completion transform for a task's source kind. */
export function applyDone(md, task) {
  if (task?.source?.kind === "backlog") return markBacklogItemDone(md, task.source.title);
  if (task?.source?.kind === "inbox") return removeInboxItem(md, task.source.title);
  return md;
}
