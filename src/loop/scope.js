// src/loop/scope.js
//
// `carja loop <project>` (owner, 2026-10-22): "I open a terminal, go into the
// project folder and run the loop on a project. For the second project I open
// another terminal, same folder, run the loop on another project. I don't want
// to know about worktrees." The project named on the command line is the whole
// scope: its remaining Blueprint stages and its carved slices, never the backlog
// or the inbox, and the owner's carja.config.json is not edited.
//
// Each project's run has its own state and lock in the repository's git
// directory (`carja-loop-logs/runs/<project>/`), invisible in the owner's
// folder. Same project twice is refused by that lock; two projects run side by
// side, each in its own worktrees. The settings (autonomy, sandbox, budget,
// platform, verify) still come from the owner's loop-state.json.
// Pure except where a function says it reads the disk.

import { normalizeState } from "./driver.js";

export const RUNS_DIR = "runs";

/** Options that take a value: their value is not a positional. */
const VALUE_FLAGS = new Set(["--platform", "--goal", "--event", "--priority", "--code-dir"]);

/** The positional arguments of `carja loop`, skipping option values. */
export function positionals(args) {
  const out = [];
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a.startsWith("-")) {
      if (VALUE_FLAGS.has(a)) i += 1;
      continue;
    }
    out.push(a);
  }
  return out;
}

/**
 * Is the first positional a project name rather than a folder? A name never
 * holds a slash, is not "." or "..", and is not an existing folder.
 * @param {string|undefined} token
 * @param {(t: string) => boolean} isDir
 */
export function looksLikeProject(token, isDir) {
  if (!token || token.includes("/") || token === "." || token === "..") return false;
  return !isDir(token);
}

/** Valid file-system name for a project's run directory. */
export function runKey(project) {
  return String(project).replace(/[^A-Za-z0-9._-]+/g, "-");
}

const SETTINGS = ["phase", "autonomy_level", "platform", "sandbox", "roles", "concurrency", "tdd_split", "checker_votes"];

/**
 * A project's run state: its own run fields, the owner's settings. The owner
 * changes autonomy, sandbox, budget or verify in loop-state.json once, for every
 * project.
 */
export function scopedState(rootRaw, projectRaw) {
  const root = normalizeState(rootRaw);
  const s = normalizeState(projectRaw ?? { status: "idle" });
  for (const k of SETTINGS) s[k] = root[k];
  s.iterations.max_allowed = root.iterations.max_allowed;
  s.budget.max_beats = root.budget.max_beats;
  s.budget.max_wall_clock_min = root.budget.max_wall_clock_min;
  s.budget.max_cost_usd = root.budget.max_cost_usd;
  s.verification.command = root.verification.command;
  return s;
}

/** The loop settings narrowed to one project: its Blueprint and slices, no backlog, no inbox. */
export function scopeLoopConfig(loopConfig, project) {
  return { ...loopConfig, slices: [project], blueprint: [project], inbox: false, requireReady: true, priorities: [] };
}
