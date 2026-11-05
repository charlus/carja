// src/loop/ready-queue.js
//
// C4-F4: the backlog items the owner gave the loop (`carja loop take`).
// A `(loop-ready)` tag is an edit to the tracked backlog, left uncommitted, and
// the state MR changes the same file, so the owner's next `git pull` refused.
// The queue lives in the git dir (`.git/carja-loop-ready.json`): never
// committed, never in a worktree, untouched by `carja upgrade`. With
// `loop.require_ready`, a queued item is harvested like a tagged one. An item
// leaves the queue when it is no longer open in the backlog (ticked or renamed).

import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { parseBacklog, workItemId } from "./harvester.js";

export const READY_FILE = "carja-loop-ready.json";

const norm = (s) => String(s ?? "").toLowerCase().replace(/\s+/g, " ").trim();

/**
 * The one open backlog item `text` names: its exact title, else the only title
 * that contains it. Pure.
 * @returns {{item?: {id: string, title: string}, candidates: Array<{id: string, title: string}>}}
 */
export function resolveTake(backlogMd, text) {
  const open = parseBacklog(backlogMd).map((it) => ({ id: workItemId(it.type, it.title), title: it.title }));
  const want = norm(text);
  const exact = open.filter((it) => norm(it.title) === want);
  const found = exact.length ? exact : open.filter((it) => want && norm(it.title).includes(want));
  return found.length === 1 ? { item: found[0], candidates: found } : { candidates: found };
}

/** The queued items, `[{id, title, at}]`; [] when there is none or it cannot be read. */
export async function readReady(gitDir) {
  try {
    const list = JSON.parse(await readFile(join(gitDir, READY_FILE), "utf8"));
    return Array.isArray(list) ? list.filter((e) => e && typeof e.id === "string") : [];
  } catch {
    return [];
  }
}

export async function writeReady(gitDir, list) {
  await writeFile(join(gitDir, READY_FILE), `${JSON.stringify(list, null, 2)}\n`, "utf8");
}

/** Keep only the queued items still open in the backlog. Pure. */
export function openOnly(list, backlogMd) {
  const open = new Set(parseBacklog(backlogMd).map((it) => workItemId(it.type, it.title)));
  return list.filter((e) => open.has(e.id));
}
