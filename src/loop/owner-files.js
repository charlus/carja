// src/loop/owner-files.js
//
// I6 (owner, 2026-10-23): the loop writes for the owner, never into git. Its
// messages, its run reports, the question rounds waiting for an answer and its
// improvement proposals stay where the owner and an agent find them, under
// carja/1-workbench/, and git's local exclude file hides them, so
// `git status` in the owner's folder stays clean and nothing reaches a commit.
// Before 6.52.0 the loop appended its escalations to the tracked inbox.md.

import { appendFile, readFile, writeFile, rename, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { ensureWorktreesExcluded } from "./worktree.js";
import { REPORT_REL, RUN_DONE_LINE } from "./stack.js";

/** The loop's messages to the owner: escalations, stops, decisions taken alone. */
export const MESSAGES_REL = "carja/1-workbench/loop-messages.md";

/** Where `carja merge-stack` moves a done run's report and messages. Never deleted: git does not track them. */
export const ARCHIVE_REL = "carja/6-archive/loop";

/** Paths in the owner's checkout the loop writes and git must not see. */
export const OWNER_EXCLUDES = Object.freeze([
  ".agents/.worktrees/",
  MESSAGES_REL,
  "carja/1-workbench/loop-report-*.md",
  // Only the rounds waiting at the top level: answered rounds ride the item's branch.
  "carja/1-workbench/questions/*.md",
  "carja/1-workbench/loop-improvements.md",
  `${ARCHIVE_REL}/`,
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

/** The hidden tag after a message title: the project that wrote it and when. */
export const messageTag = ({ project, at }) => `<!-- carja-loop project=${project} at=${at} -->`;
const TAG_RE = /\s*<!-- carja-loop project=(\S+) at=(\S+) -->\s*$/;

/** The file's header and its messages as raw blocks, each from its heading to the next: [{raw, title, text, project, at}]. */
function splitMessages(md) {
  const [header, ...parts] = String(md ?? "").split(/^(?=## \[loop\])/m);
  return {
    header,
    blocks: parts.map((raw) => {
      const [head, ...body] = raw.split("\n");
      const title = head.replace(/^## \[loop\]\s*/, "");
      const tag = title.match(TAG_RE);
      return { raw, title: title.replace(TAG_RE, "").trim(), text: body.find((l) => l.trim())?.trim() ?? "", project: tag?.[1] ?? null, at: tag?.[2] ?? null };
    }),
  };
}

/** The messages, newest last: [{title, text, project, at}]. project and at are null before 7.11.5. */
export function parseLoopMessages(md) {
  return splitMessages(md).blocks.map(({ title, text, project, at }) => ({ title, text, project, at }));
}

/** The messages in a checkout, or [] when there are none. */
export async function readLoopMessages(root) {
  return parseLoopMessages(await readFile(join(root, MESSAGES_REL), "utf8").catch(() => ""));
}

/** A path in the archive that does not exist yet: name-date.md, then name-date-2.md. */
function freeArchivePath(root, name, day) {
  for (let n = 1; ; n++) {
    const rel = `${ARCHIVE_REL}/${name}-${day}${n === 1 ? "" : `-${n}`}.md`;
    if (!existsSync(join(root, rel))) return rel;
  }
}

/**
 * Retire a project's loop report and messages once its run is done and every MR
 * is merged: the report moves to the archive, and so do the messages the
 * project wrote and the untagged ones written before 7.11.5. A report of a run
 * that stopped stays, with all messages: its escalation is still open.
 * `messages: false` (another loop is live and may append) moves the report only.
 * @returns {Promise<{report: string|null, messages: number, messagesArchive: string|null}>}
 */
export async function retireLoopFiles(root, project, { now = new Date(), messages = true } = {}) {
  const none = { report: null, messages: 0, messagesArchive: null };
  const reportPath = join(root, REPORT_REL(project));
  const report = await readFile(reportPath, "utf8").catch(() => null);
  if (report === null || !report.includes(RUN_DONE_LINE)) return none;
  const day = now.toISOString().slice(0, 10);
  await ensureOwnerFilesExcluded(root);
  await mkdir(join(root, ARCHIVE_REL), { recursive: true });
  const reportRel = freeArchivePath(root, `loop-report-${project}`, day);
  await rename(reportPath, join(root, reportRel));
  if (!messages) return { ...none, report: reportRel };

  const path = join(root, MESSAGES_REL);
  const md = await readFile(path, "utf8").catch(() => null);
  if (md === null) return { ...none, report: reportRel };
  const { header, blocks } = splitMessages(md);
  const goes = (b) => b.project === project || b.project === null;
  const moved = blocks.filter(goes);
  if (!moved.length) return { ...none, report: reportRel };
  const messagesRel = freeArchivePath(root, `loop-messages-${project}`, day);
  await writeFile(join(root, messagesRel), header + moved.map((b) => b.raw).join(""), "utf8");
  const kept = blocks.filter((b) => !goes(b));
  const tmp = `${path}.tmp-${process.pid}`;
  await writeFile(tmp, header + kept.map((b) => b.raw).join(""), "utf8");
  await rename(tmp, path);
  return { report: reportRel, messages: moved.length, messagesArchive: messagesRel };
}
