// src/loop/resume.js
//
// Resume discipline (P1.4). A `carja loop` process can die mid-run — a kill,
// a wall-clock timeout, a crash. The Spine is persisted atomically after every
// beat, so state survives; the problem is that a task/run left in a *working*
// status is never re-entered:
//   - Swarm: `computeFrontier` only dispatches `pending` tasks, so a task frozen
//     at `in_progress`/`passed`/`rejected` is neither runnable nor terminal — the
//     resumed run deadlocks (`stalled`).
//   - Pair: `runLoop` switches on `state.status`; a mid-beat sub-status re-enters
//     the cycle half-finished.
// `reviveForResume` rewinds those working statuses to a clean entry point so a
// fresh invocation picks up cleanly. It NEVER touches terminal work (`merged`/
// `failed` tasks, terminal run status) — already-shipped work is not redone.
//
// Safe because re-running a revived task is idempotent: the maker re-verifies,
// the P0.1 auto-commit no-ops if already committed, and the merge step reuses an
// already-open PR (merge.js). The one-loop lock (lock.js) guarantees no OTHER
// process is mid-run, so reviving on load can't race a live worker.

import { isTerminal } from "./driver.js";
import { isTaskTerminal } from "./swarm.js";

/**
 * Rewind mid-run working statuses to a clean entry point, in place.
 * @returns {{ tasks: number, run: boolean }} how much was revived (for logging)
 */
export function reviveForResume(state) {
  let tasks = 0;
  if (Array.isArray(state?.tasks)) {
    for (const t of state.tasks) {
      if (t && typeof t.status === "string" && !isTaskTerminal(t) && t.status !== "pending") {
        t.status = "pending";
        // Drop the half-beat's stall bookkeeping so the resumed beat starts fresh.
        t.stall = { consecutive: 0, last_beat_hash: null };
        tasks++;
      }
    }
  }

  let run = false;
  if (state && !isTerminal(state.status) && state.status !== "idle") {
    // F20 (autopportunity, 2026-10-21): the wall clock limits a run while it
    // runs. The hours a stopped run spent stopped (a laptop closed overnight)
    // are not run time; the beats it spent still count against max_beats.
    if (state.budget) state.budget.started_at = null;
    state.status = "idle";
    state.current_worker = null;
    state.maker_reported_done = false;
    run = true;
  }
  return { tasks, run };
}

/**
 * F17: a run that starts after a FINISHED run (terminal status) is a new run.
 * Reset what belongs to one run: status, beat counter, wall-clock start, token
 * count, stall bookkeeping, the done claim and the last PR. Before, the clock
 * started at the very first run and never reset, so every run more than
 * max_wall_clock_min later halted at once with budget_exceeded. An interrupted
 * run (non-terminal) is a resume and keeps all of it. Mutates in place.
 * @returns {{ reset: boolean, from: string }}
 */
export function startNewRun(state) {
  const from = state.status;
  if (!isTerminal(from)) return { reset: false, from };
  state.status = "idle";
  state.current_worker = null;
  state.maker_reported_done = false;
  state.iterations.current = 0;
  state.budget.started_at = null;
  state.budget.tokens_spent = 0;
  state.budget.cost_usd_spent = 0;
  state.budget.usage = {};
  state.budget.cost_warned = false;
  state.attempts = [];
  state.rejected_beats = 0;
  state.rulings = [];
  state.stall = { consecutive: 0, last_beat_hash: null };
  state.merge = null;
  state.ship = null;
  // Step 4: an item paused on a question round is read again; still unanswered,
  // it pauses again without a beat.
  for (const t of state.tasks ?? []) if (t?.status === "awaiting_answers") t.status = "pending";
  return { reset: true, from };
}
