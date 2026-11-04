// test/loop-watch-progress.test.js
//
// I7 (owner, 2026-10-23): the KM relief loop "seems either stuck or still
// running". `carja watch` now says, per project: item N of M, the step in
// progress and since when, the average time per item in this run, when the run
// should end, a wait for the usage limit, and why it last stopped, in words.

import { test } from "node:test";
import assert from "node:assert/strict";
import { watchModels, renderWatchAll, stopInWords } from "../src/loop/events.js";

const T = (hhmm) => new Date(`2026-10-22T${hhmm}:00`).toISOString();
const PID = 4242;

function kmRun({ ended = false, quota = false } = {}) {
  const ev = [{ run: "S#4242:stack", at: T("16:40"), type: "stack_start", project: "km-workload-relief", pid: PID, total: 17 }];
  const items = ["slice 04", "slice 05", "slice 06", "slice 07", "slice 08"];
  const starts = ["16:40", "17:29", "18:11", "19:07", "20:13"];
  items.forEach((item, i) => {
    ev.push({ run: "S#4242:stack", at: T(starts[i]), type: "stack_item", project: "km-workload-relief", item, n: 4 + i, of: 17 });
    ev.push({ run: `R${i}`, at: T(starts[i]), type: "run_start", pid: PID, project: "km-workload-relief", items: [item] });
    if (i < items.length - 1) ev.push({ run: `R${i}`, at: T(starts[i + 1]), type: "run_end", status: "completed" });
  });
  ev.push({ run: "R4", at: T("22:25"), type: "beat_start", task: "slice:km/08", kind: "maker" });
  if (quota) ev.push({ run: "R4", at: T("22:30"), type: "quota_wait", task: "slice:km/08", until: T("22:41") });
  if (ended) {
    ev.push({ run: "R4", at: T("23:13"), type: "run_end", status: "awaiting_review" });
    ev.push({ run: "S#4242:stack", at: T("23:13"), type: "stack_end", project: "km-workload-relief", status: "awaiting_review", item: "slice 08" });
  }
  return ev;
}

test("a running stack: item 8 of 17, the step and since when, minutes per item, the expected end", () => {
  const models = watchModels(kmRun(), { isAlive: () => true });
  assert.equal(models.length, 1);
  const st = models[0].stack;
  assert.equal(st.n, 8);
  assert.equal(st.of, 17);
  assert.equal(st.avgMin, 53, "(49 + 42 + 56 + 66) / 4 minutes");
  const screen = renderWatchAll(models, Date.parse(T("22:40")));
  assert.match(screen, /km-workload-relief: slice 08 — 8 of 17 · now: Build since 22:25 · about 53 min per item · should end about \d\d:\d\d/);
  // 10 items left from 20:13, at 53.25 minutes each.
  assert.match(screen, /should end about 05:05/);
});

test("a wait for the usage limit is shown", () => {
  const screen = renderWatchAll(watchModels(kmRun({ quota: true }), { isAlive: () => true }), Date.parse(T("22:35")));
  assert.match(screen, /⏸ {2}Usage limit reached: waiting until 22:41, then the same beat runs again\./);
});

test("a stopped stack says why, in words", () => {
  const screen = renderWatchAll(watchModels(kmRun({ ended: true }), { isAlive: () => false }), Date.parse(T("23:30")));
  assert.match(screen, /Last stop 23:13: slice 08: an item would conflict on merge, or its MR could not be opened\./);
  assert.doesNotMatch(screen, /should end about/);
  assert.equal(stopInWords("done"), "every item is built: merge the MRs in the order of the loop report");
  assert.equal(stopInWords("weird"), "stopped (weird)");
});
