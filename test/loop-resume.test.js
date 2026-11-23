// test/loop-resume.test.js
//
// Resume discipline (P1.4): reviveForResume rewinds mid-run working statuses to a
// clean entry point so a killed run resumes instead of deadlocking, WITHOUT
// redoing terminal (merged/failed) work. Pure — exercised directly.

import { test } from "node:test";
import assert from "node:assert/strict";
import { reviveForResume, startNewRun } from "../src/loop/resume.js";
import { normalizeState } from "../src/loop/driver.js";
import { computeFrontier, normalizeTask } from "../src/loop/swarm.js";

test("revives in-flight swarm tasks (in_progress/passed/rejected → pending)", () => {
  const state = normalizeState({
    tasks: [
      { id: "a", status: "in_progress" },
      { id: "b", status: "passed" },
      { id: "c", status: "rejected" },
    ],
  });
  const r = reviveForResume(state);
  assert.equal(r.tasks, 3);
  assert.deepEqual(state.tasks.map((t) => t.status), ["pending", "pending", "pending"]);
  // …and the revived tasks are now re-selectable by the scheduler (the swarm
  // normalizes tasks before computing the frontier).
  assert.equal(computeFrontier(state.tasks.map((t) => normalizeTask(t))).length, 3);
});

test("never touches terminal task work (merged/failed preserved)", () => {
  const state = normalizeState({
    tasks: [
      { id: "done", status: "merged" },
      { id: "dead", status: "failed" },
      { id: "stuck", status: "in_progress" },
      { id: "fresh", status: "pending" },
    ],
  });
  const r = reviveForResume(state);
  assert.equal(r.tasks, 1); // only "stuck"
  assert.deepEqual(
    state.tasks.map((t) => t.status),
    ["merged", "failed", "pending", "pending"]
  );
});

test("clears the revived task's half-beat stall bookkeeping", () => {
  const state = normalizeState({
    tasks: [{ id: "a", status: "in_progress", stall: { consecutive: 2, last_beat_hash: "abc" } }],
  });
  reviveForResume(state);
  assert.deepEqual(state.tasks[0].stall, { consecutive: 0, last_beat_hash: null });
});

test("rewinds a mid-beat pair run status to a clean idle entry point", () => {
  const state = normalizeState({ status: "checking", current_worker: "checker", maker_reported_done: true });
  const r = reviveForResume(state);
  assert.equal(r.run, true);
  assert.equal(state.status, "idle");
  assert.equal(state.current_worker, null);
  assert.equal(state.maker_reported_done, false);
});

test("no-op on a clean idle state and on terminal run statuses", () => {
  const idle = normalizeState({ status: "idle" });
  assert.deepEqual(reviveForResume(idle), { tasks: 0, run: false });

  const done = normalizeState({ status: "completed" });
  const r = reviveForResume(done);
  assert.equal(r.run, false);
  assert.equal(done.status, "completed"); // terminal preserved
});

// ---- F17: a new run after a finished one starts with a fresh budget ---------
//
// budget.started_at was set at the first run and never reset, so any run that
// started more than max_wall_clock_min after the first one halted at once with
// budget_exceeded. The beat counter and the terminal status carried over too.

test("F17: a terminal run is reset for the next run: status, clock, beats, stall, merge", () => {
  const state = normalizeState({
    status: "awaiting_review",
    iterations: { current: 7, max_allowed: 20 },
    budget: { started_at: "2026-10-01T08:00:00.000Z", tokens_spent: 900, max_wall_clock_min: 120 },
    stall: { consecutive: 2, last_beat_hash: "abc" },
    maker_reported_done: true,
    merge: { branch: "b", pr_url: "u" },
  });
  const r = startNewRun(state);
  assert.deepEqual(r, { reset: true, from: "awaiting_review" });
  assert.equal(state.status, "idle");
  assert.equal(state.iterations.current, 0);
  assert.equal(state.budget.started_at, null);
  assert.equal(state.budget.tokens_spent, 0);
  assert.deepEqual(state.stall, { consecutive: 0, last_beat_hash: null });
  assert.equal(state.maker_reported_done, false);
  assert.equal(state.merge, null);
  assert.equal(state.budget.max_wall_clock_min, 120);
  assert.equal(state.iterations.max_allowed, 20);
});

test("F17: an interrupted run keeps its clock and beats (resume, not a new run)", () => {
  const state = normalizeState({
    status: "ready_for_check",
    iterations: { current: 3, max_allowed: 20 },
    budget: { started_at: "2026-10-05T08:00:00.000Z" },
  });
  assert.deepEqual(startNewRun(state), { reset: false, from: "ready_for_check" });
  assert.equal(state.iterations.current, 3);
  assert.equal(state.budget.started_at, "2026-10-05T08:00:00.000Z");
});

test("F17: a fresh idle state is left alone", () => {
  const state = normalizeState({ status: "idle", iterations: { current: 0 } });
  assert.equal(startNewRun(state).reset, false);
});

// ---- An idle state with an old clock (agentic-content-os, 2026-11-23) --------
//
// A hand-rebuilt state with status 'idle' kept budget.started_at from an old run.
// startNewRun resets only terminal statuses and reviveForResume skipped 'idle', so
// the next run halted at its first guardrail check with budget_exceeded.

test("an idle state starts with a fresh wall clock, beats kept", () => {
  const state = normalizeState({
    status: "idle",
    iterations: { current: 4, max_allowed: 20 },
    budget: { started_at: "2026-10-01T08:00:00.000Z", max_wall_clock_min: 120 },
  });
  startNewRun(state);
  const r = reviveForResume(state);
  assert.deepEqual(r, { tasks: 0, run: false }); // nothing to revive, no resume message
  assert.equal(state.budget.started_at, null);
  assert.equal(state.iterations.current, 4);
  assert.equal(state.status, "idle");
});
