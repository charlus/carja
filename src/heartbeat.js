// src/heartbeat.js
//
// Which local commits and pushes skipped the Carja hooks.
//
// "Gates on" only says git is configured to run the hooks. A commit made with
// --no-verify or CARJA_HOOKS=off, or by a git client that ignores hooks,
// leaves no trace there. So each hook appends `<epoch> <hook>` to a heartbeat
// file in the git directory, and `carja install-hooks` appends
// `<epoch> installed`, the floor before which nothing is judged. The reflog
// records every local commit and push with its time. A commit or push with no
// heartbeat of its hook shortly before it skipped the hooks.
//
// Idea from AI-DLC (awslabs/aidlc-workflows), whose engine refuses to advance
// when its hooks' heartbeat files show they stopped firing.
//
// Errs towards silence: no heartbeat file, an unreadable reflog or a git error
// gives null ("cannot tell"), never a false report.

import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { appendFile, readFile } from "node:fs/promises";
import { isAbsolute, join } from "node:path";

const execFileP = promisify(execFile);

export const HEARTBEAT_FILE = "carja-heartbeat";
// How long before a commit or push its hook may have started. pre-push runs
// the verify command, so it gets the longer window.
const WINDOW_S = { "pre-commit": 1800, "pre-push": 7200 };
// git fixes a commit's time before it runs pre-commit, so a heartbeat can be
// a second or two later than the commit it vouches for. Seen under load.
const SLACK_S = 3;

async function gitCommonDir(dir) {
  try {
    const { stdout } = await execFileP("git", ["rev-parse", "--git-common-dir"], { cwd: dir });
    const p = stdout.trim();
    return p ? (isAbsolute(p) ? p : join(dir, p)) : null;
  } catch {
    return null;
  }
}

/** Append the `installed` floor. Never throws: a missing floor only silences the report. */
export async function writeInstalledHeartbeat(dir, now = Date.now()) {
  const common = await gitCommonDir(dir);
  if (!common) return;
  await appendFile(join(common, HEARTBEAT_FILE), `${Math.floor(now / 1000)} installed\n`).catch(() => {});
}

/**
 * Local commits and pushes in the last `days` that have no heartbeat.
 * @returns {Promise<{commits: string[], pushes: number, days: number}|null>}
 *   null when there is no heartbeat file yet or git cannot be read.
 */
export async function skippedHooks(dir, { now = Date.now(), days = 14 } = {}) {
  const common = await gitCommonDir(dir);
  if (!common) return null;
  let raw;
  try {
    raw = await readFile(join(common, HEARTBEAT_FILE), "utf8");
  } catch {
    return null;
  }
  const beats = { "pre-commit": [], "pre-push": [] };
  let floor = Infinity;
  for (const line of raw.split("\n")) {
    const [t, hook] = line.trim().split(/\s+/);
    if (!/^\d+$/.test(t)) continue; // a blank or torn line, never time 0
    const s = Number(t);
    floor = Math.min(floor, s);
    if (beats[hook]) beats[hook].push(s);
  }
  if (!Number.isFinite(floor)) return null;

  let log;
  try {
    ({ stdout: log } = await execFileP(
      "git",
      ["log", "-g", "--all", "--date=unix", "--format=%h%x09%gd%x09%gs"],
      { cwd: dir, maxBuffer: 16 * 1024 * 1024 },
    ));
  } catch {
    return null;
  }

  const since = Math.max(floor, Math.floor(now / 1000) - days * 86400);
  // Unique events, oldest first. A commit sits in the HEAD reflog and in its
  // branch's: keyed by hash. One push can update several refs: keyed by its
  // second. Same-second ties keep reflog order (newest first within a ref).
  const commits = new Map();
  const pushes = new Map();
  log.split("\n").forEach((line, pos) => {
    const [sha, selector, subject = ""] = line.split("\t");
    const t = Number(/@\{(\d+)\}$/.exec(selector ?? "")?.[1]);
    // Same second as the floor counts: a gated commit right after the install
    // has its heartbeat, and git records times only to the second.
    if (!Number.isFinite(t) || t < since) return;
    if (/^commit( \((amend|merge)\))?:/.test(subject)) {
      if (!commits.has(sha)) commits.set(sha, { sha, t, pos });
    } else if (subject === "update by push") {
      if (!pushes.has(t)) pushes.set(t, { t, pos });
    }
  });

  // Each heartbeat vouches for one event at most: the earliest unused one in
  // the hook's window before the event. A shared heartbeat would let a
  // --no-verify commit hide behind the gated commit just before it.
  const unvouched = (events, hook) => {
    const free = [...beats[hook]].sort((a, b) => a - b);
    const out = [];
    for (const e of [...events].sort((a, b) => a.t - b.t || b.pos - a.pos)) {
      const i = free.findIndex((h) => h <= e.t + SLACK_S && h >= e.t - WINDOW_S[hook]);
      if (i === -1) out.push(e);
      else free.splice(i, 1);
    }
    return out;
  };
  const ordered = unvouched(commits.values(), "pre-commit").map((e) => e.sha);
  const skippedPushes = unvouched(pushes.values(), "pre-push").length;
  return { commits: ordered, pushes: skippedPushes, days };
}
