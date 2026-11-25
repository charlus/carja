// test/loop-run-state.test.js
//
// The tracked loop-state.json holds the owner's settings only; the run's state
// lives in the git common dir (src/loop/run-state.js). The pure half here; the
// real CLI half (a run leaves the tracked file unchanged) is in
// test/loop-run-state-cli.test.js.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { mergeRunState, ownerSettings, hasRunState, recordTriggerSeed } from "../src/loop/run-state.js";
import { applyTrigger } from "../src/loop/trigger.js";

const TEMPLATE = JSON.parse(readFileSync(new URL("../templates/carja/1-workbench/loop-state.json", import.meta.url), "utf8"));

test("the shipped template holds settings only", () => {
  assert.deepEqual(TEMPLATE, ownerSettings(TEMPLATE));
  assert.equal(hasRunState(TEMPLATE), false);
  for (const k of ["status", "history", "tasks", "stall", "merge", "current_worker"]) assert.ok(!(k in TEMPLATE), `${k} is run state`);
});

test("ownerSettings drops the run's state and keeps every setting", () => {
  const raw = {
    goal_description: "g", phase: "execution", autonomy_level: "L3", platform: "claude", sandbox: "cli-native",
    status: "completed", iterations: { current: 7, max_allowed: 30 }, budget: { max_beats: 30, max_wall_clock_min: 60, tokens_spent: 99, started_at: "x" },
    verification: { command: "npm test", last_exit_code: 0 }, history: [{ a: 1 }], tasks: [{ id: "t" }],
  };
  const s = ownerSettings(raw);
  assert.equal(s.goal_description, "g");
  assert.equal(s.autonomy_level, "L3");
  assert.deepEqual(s.iterations, { max_allowed: 30 });
  assert.deepEqual(s.budget, { max_beats: 30, max_wall_clock_min: 60 });
  assert.deepEqual(s.verification, { command: "npm test" });
  assert.ok(!("status" in s) && !("history" in s) && !("tasks" in s));
  assert.equal(hasRunState(raw), true);
});

test("without a run file, everything comes from the tracked file (an install from before the split)", () => {
  const s = mergeRunState({ status: "stalled", iterations: { current: 4 } }, null);
  assert.equal(s.status, "stalled");
  assert.equal(s.iterations.current, 4);
});

test("settings come from the tracked file, the run's state from the run file", () => {
  const settings = { goal_description: "owner goal", autonomy_level: "L3", sandbox: "cli-native", budget: { max_beats: 40 }, verification: { command: "make test" } };
  const run = { goal_description: "old", autonomy_level: "L1", sandbox: "none", status: "running", iterations: { current: 5, max_allowed: 2 }, budget: { max_beats: 1, tokens_spent: 12 }, verification: { command: "x", last_exit_code: 1 }, tasks: [{ id: "a" }] };
  const s = mergeRunState(settings, run);
  assert.equal(s.goal_description, "owner goal");
  assert.equal(s.autonomy_level, "L3");
  assert.equal(s.sandbox, "cli-native");
  assert.equal(s.budget.max_beats, 40);
  assert.equal(s.verification.command, "make test");
  assert.equal(s.status, "running");
  assert.equal(s.iterations.current, 5);
  assert.equal(s.iterations.max_allowed, 20, "the owner's default, not the run file's");
  assert.equal(s.budget.tokens_spent, 12);
  assert.equal(s.verification.last_exit_code, 1);
  assert.deepEqual(s.tasks, [{ id: "a" }]);
});

test("a trigger's seed holds for its run, survives a resume, and ends with the run", () => {
  const settings = { goal_description: "owner goal", autonomy_level: "L3", phase: "execution" };
  const state = mergeRunState(settings, { status: "idle" });
  applyTrigger(state, { goal: "fix the login", source: "slack", author_association: "NONE" });
  recordTriggerSeed(state);
  assert.equal(state.autonomy_level, "L1", "an untrusted trigger is floored");
  state.status = "running";
  const resumed = mergeRunState(settings, JSON.parse(JSON.stringify(state)));
  assert.equal(resumed.goal_description, "fix the login");
  assert.equal(resumed.autonomy_level, "L1", "a resume keeps the lower autonomy");
  assert.equal(resumed.trigger_trust, "untrusted");
  const ended = mergeRunState(settings, { ...JSON.parse(JSON.stringify(state)), status: "completed" });
  assert.equal(ended.goal_description, "owner goal");
  assert.equal(ended.autonomy_level, "L3");
});

test("a seed in the run file never raises autonomy above the owner's ceiling", () => {
  const s = mergeRunState({ autonomy_level: "L1" }, { status: "running", trigger_seed: { autonomy_level: "L3" } });
  assert.equal(s.autonomy_level, "L1");
});
