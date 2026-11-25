// src/loop/run-state.js
//
// loop-state.json held two kinds of data: the owner's settings (goal, autonomy
// ceiling, sandbox, budget limits, platform, verify) and the run's state (status,
// counters, stall, history, tasks). The template tracked it, so every run left it
// modified in git, and two bugs came from that (the loop committed it onto main,
// and upgrade refused to commit). Now:
//   - carja/1-workbench/loop-state.json holds the settings only. It is tracked,
//     and only the owner, `carja loop on` and `carja upgrade` write it.
//   - <git common dir>/carja-loop-logs/loop-state.json holds the run's state,
//     out of git, one per repository. A project's run keeps its own under runs/.
// The driver works on one object, `mergeRunState(settings, run)`, and writes it
// whole to the run file only.
//
// A trigger (--goal, --event) seeds goal, phase and a lower autonomy for one run.
// That seed lives in the run file (`trigger_seed`) and ends with the run: a run
// that ended goes back to the owner's settings. The seed can only lower the
// owner's autonomy ceiling, never raise it.

import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { normalizeState, isTerminal, levelRank } from "./driver.js";
import { BEAT_LOG_DIR } from "./beat-log.js";

export const RUN_STATE_FILE = "loop-state.json";

/** Top-level settings: the owner's, never the run's. */
const TOP = ["goal_description", "phase", "autonomy_level", "platform", "sandbox", "roles", "concurrency", "tdd_split", "checker_votes"];
/** Nested settings, as [object, key]. */
const NESTED = [
  ["iterations", "max_allowed"],
  ["budget", "max_beats"],
  ["budget", "max_wall_clock_min"],
  ["budget", "max_cost_usd"],
  ["verification", "command"],
];
/** What a trigger may set for one run. */
const SEEDED = ["goal_description", "phase", "autonomy_level", "trigger_trust"];

/** The run's state file of a repository whose git common dir is `commonDir`. */
export function runStatePath(commonDir) {
  return join(commonDir, BEAT_LOG_DIR, RUN_STATE_FILE);
}

/** Absolute git common dir of `root`, or null outside git. Reads git. */
export function commonDirOf(root) {
  const r = spawnSync("git", ["rev-parse", "--path-format=absolute", "--git-common-dir"], { cwd: root, encoding: "utf8" });
  return r.status === 0 && r.stdout.trim() ? r.stdout.trim() : null;
}

/** The run's state file of `root`, or null outside git. Reads git. */
export function runStatePathOf(root) {
  const c = commonDirOf(root);
  return c ? runStatePath(c) : null;
}

/** The owner's settings in `raw` (any loop-state shape), without the run's state. */
export function ownerSettings(raw) {
  const s = normalizeState(raw);
  const out = { schema_version: 2 };
  for (const k of TOP) out[k] = s[k];
  if (!out.tdd_split) delete out.tdd_split;
  for (const [o, k] of NESTED) {
    if (s[o][k] === null && k === "max_cost_usd") continue;
    (out[o] ??= {})[k] = s[o][k];
  }
  return out;
}

/** True when `raw` holds run state beyond the settings, other than defaults. */
export function hasRunState(raw) {
  const s = normalizeState(raw);
  const blank = normalizeState(ownerSettings(raw));
  return JSON.stringify(s) !== JSON.stringify(blank);
}

/**
 * The state the driver works on: the run's fields from `runRaw`, the owner's
 * settings from `settingsRaw`, a live trigger seed on top. Without a run file,
 * everything comes from `settingsRaw` (an install from before the split, whose
 * tracked file still holds run state). Pure.
 */
export function mergeRunState(settingsRaw, runRaw) {
  if (!runRaw || typeof runRaw !== "object") return normalizeState(settingsRaw);
  const settings = normalizeState(settingsRaw);
  const s = normalizeState(runRaw);
  for (const k of TOP) s[k] = settings[k];
  for (const [o, k] of NESTED) s[o][k] = settings[o][k];
  // A run that ended takes the owner's settings again: the seed was for that run only.
  const seed = !isTerminal(s.status) && runRaw.trigger_seed && typeof runRaw.trigger_seed === "object" ? runRaw.trigger_seed : null;
  if (seed) {
    if (typeof seed.goal_description === "string") s.goal_description = seed.goal_description;
    if (typeof seed.phase === "string") s.phase = seed.phase;
    if (typeof seed.trigger_trust === "string") s.trigger_trust = seed.trigger_trust;
    // Never above the owner's ceiling, whatever the file says.
    if (typeof seed.autonomy_level === "string" && levelRank(seed.autonomy_level) < levelRank(settings.autonomy_level)) s.autonomy_level = seed.autonomy_level;
    s.trigger_seed = seed;
  }
  return s;
}

/** Record what a trigger set on `state` as this run's seed (mutates `state`). */
export function recordTriggerSeed(state) {
  const seed = {};
  for (const k of SEEDED) if (state[k] !== undefined) seed[k] = state[k];
  state.trigger_seed = seed;
  return state;
}

/**
 * Before the tracked file is cut to settings: an install from before the split
 * keeps its run there (an interrupted run, its tasks). Move that run to the run
 * file when there is none yet, so nothing is lost. Returns the path written, or
 * null. Reads git and writes the disk.
 */
export async function moveRunStateOut(root, raw) {
  if (!raw || !hasRunState(raw)) return null;
  const p = runStatePathOf(root);
  if (!p || existsSync(p)) return null;
  await mkdir(dirname(p), { recursive: true });
  await writeFile(p, `${JSON.stringify(normalizeState(raw), null, 2)}\n`, "utf8");
  return p;
}
