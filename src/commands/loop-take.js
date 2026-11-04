// src/commands/loop-take.js — `conductor loop take ["<item>"] [dir] [--drop]`.
//
// C4-F4: give the loop a backlog item without editing a tracked file. The queue
// is in the git dir (src/loop/ready-queue.js), so the owner's checkout stays clean.

import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { readReady, writeReady, resolveTake, openOnly } from "../loop/ready-queue.js";
import { parseLoopConfig } from "../loop/config.js";
import { configPath as configPathOf } from "../names.js";

const BACKLOG_REL = "conductor/2-backlog/task-backlog.md";

/** The main repository's git dir, shared by every worktree; null outside git. */
export function gitCommonDir(root) {
  const r = spawnSync("git", ["rev-parse", "--git-common-dir"], { cwd: root, encoding: "utf8" });
  return r.status === 0 ? resolve(root, r.stdout.trim()) : null;
}

export async function loopTakeCommand(root, text, { drop = false, stdout, stderr }) {
  const gitDir = gitCommonDir(root);
  if (!gitDir) {
    stderr.write(`⛔  ${root} is not a git repository.\n`);
    return 1;
  }
  const backlogMd = await readFile(join(root, BACKLOG_REL), "utf8").catch(() => "");
  // Items ticked or renamed since they were taken leave the queue.
  const list = openOnly(await readReady(gitDir), backlogMd);

  if (text) {
    if (drop) {
      const want = text.toLowerCase();
      const keep = list.filter((e) => !e.title.toLowerCase().includes(want));
      if (keep.length === list.length) {
        stderr.write(`⛔  Nothing queued matches "${text}".\n`);
        return 1;
      }
      await writeReady(gitDir, keep);
      for (const e of list.filter((x) => !keep.includes(x))) stdout.write(`  Removed from the loop's queue: ${e.title}\n`);
      return 0;
    }
    const { item, candidates } = resolveTake(backlogMd, text);
    if (!item) {
      stderr.write(
        candidates.length
          ? `⛔  "${text}" matches ${candidates.length} open backlog items. Give more of the title:\n${candidates.map((c) => `    - ${c.title}`).join("\n")}\n`
          : `⛔  No open item in ${BACKLOG_REL} matches "${text}". Add it to the backlog first.\n`
      );
      return 1;
    }
    if (!list.some((e) => e.id === item.id)) list.push({ ...item, at: new Date().toISOString() });
    await writeReady(gitDir, list);
    stdout.write(`  Queued for the loop: ${item.title}\n`);
  } else {
    await writeReady(gitDir, list);
  }

  stdout.write(list.length ? `\n  The loop's queue (${list.length}):\n${list.map((e) => `    - ${e.title}`).join("\n")}\n` : "\n  The loop's queue is empty.\n");
  let requireReady = false;
  try {
    requireReady = parseLoopConfig(JSON.parse(await readFile(configPathOf(root), "utf8"))).requireReady;
  } catch {
    /* no config: the loop takes every open item */
  }
  if (!requireReady) stdout.write("  Note: loop.require_ready is off, so the loop takes every open backlog item, queued or not. `conductor loop on --backlog` turns it on.\n");
  if (list.length) stdout.write("\n  Next: `conductor loop . --from-conductor` runs them. `conductor loop take --drop \"<item>\"` removes one.\n");
  return 0;
}
