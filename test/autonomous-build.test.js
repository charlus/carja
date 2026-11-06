// test/autonomous-build.test.js
//
// D1 — Build runs to ship-ready without asking permission to continue.
//
// Real usage (autopportunity, eurassistant, 2026-10) showed the product owner
// answering "Ready for batch 3; GO ahead" again and again, then writing "build
// until the slice is ready to be shipped" and "don't bother me just for me to
// tell you to continue". The fix lived in per-project agent memories instead of
// the workflow. A batch is the unit of independent review, not a stop. Long
// builds survive a context reset through the task tracker, not through a human
// saying "continue".
//
// Pinned here: no confirmation stop is left in Build, the stop conditions are
// the product-decision set, and the tracker is named as the state to resume from.

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = new URL("..", import.meta.url).pathname;
const read = (...p) => readFileSync(join(ROOT, "templates", ".agents", ...p), "utf8");

const BUILD = read("workflows", "build.md");
const QUICK = read("workflows", "quick-path.md");

describe("D1 — Build never stops to ask permission to continue", () => {
  test("no confirmation stop before the first batch or between batches", () => {
    assert.doesNotMatch(BUILD, /wait for (user|human) confirmation/i);
    assert.doesNotMatch(BUILD, /ready (for next batch|to build)\?/i);
    assert.doesNotMatch(BUILD, /checkpoint between batches/i);
    assert.doesNotMatch(QUICK, /ready (for next batch|to build)\?/i);
  });

  test("Build states that it runs to ship-ready on its own", () => {
    assert.match(BUILD, /ship-ready/i);
    assert.match(BUILD, /never ask (permission )?to continue|do not ask (permission )?to continue/i);
  });

  test("the whole change is the unit of independent review, and the review still runs", () => {
    assert.match(BUILD, /unit of (independent )?review/i);
    assert.match(BUILD, /independent-review\/SKILL\.md/);
  });

  test("the stop conditions are product decisions and real blockers only", () => {
    const stops = BUILD.slice(BUILD.indexOf("### When to stop"));
    assert.ok(stops.length > 0 && BUILD.includes("### When to stop"), "no 'When to stop' section");
    for (const trigger of [/what a user sees|user-visible/i, /cost/i, /cannot be undone/i, /contradicts/i, /scope/i, /security|data-loss/i]) {
      assert.match(stops, trigger, `no stop condition matching ${trigger}`);
    }
  });

  test("an engineering mismatch is decided and recorded, not escalated", () => {
    assert.doesNotMatch(BUILD, /Plan step doesn't match reality \| STOP/);
    assert.match(BUILD, /record (the|each) deviation/i);
  });

  test("long builds resume from the tracker, not from a human 'continue'", () => {
    assert.match(BUILD, /task-tracker\.md/);
    assert.match(BUILD, /compact|context (reset|runs low|is summarised)/i);
    assert.match(BUILD, /first task (that is )?not `?done`?/i);
    assert.match(BUILD, /skills\/handoff\/SKILL\.md/);
  });
});

describe("F6 — personas follow the files actually changed", () => {
  test("the batch review re-runs personas on the real diff and loads any new one", () => {
    const review = BUILD.slice(BUILD.indexOf("## Phase 2"), BUILD.indexOf("## Phase 3"));
    assert.match(review, /carja personas/);
    assert.match(review, /not (yet )?in the tracker header|new persona/i);
    assert.match(review, /Designer[^.]*no `?DESIGN\.md`?|no `?DESIGN\.md`?[^.]*Designer/i);
  });
});
