// test/slimming.test.js
//
// 7.3.0 Slimming (docs/roadmap/Slimming.md, O1-O5). The longitudinal benchmark
// found Carja at 3.3x the cost and 6.6x the wall time of a bare session. Half
// the extra wall time was the full suite, run about 6 times per session because
// Build asked for it after every task. A fifth was a reviewer started in the
// background and never noticed. These tests pin the instructions that remove
// that cost without removing a gate.
//
// Structural, and honest about it: they prove the instructions say so. Whether
// an agent follows them is proven by the benchmark re-run, not here.

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const AGENTS = new URL("../templates/.agents/", import.meta.url).pathname;
const read = (...p) => readFileSync(join(AGENTS, ...p), "utf8");

const BUILD = read("workflows", "build.md");
const SPEC = read("workflows", "spec-it.md");
const LAW = read("rules", "test-driven-law.md");
const TDD = read("workflows", "tdd-cycle.md");
const QUICK = read("workflows", "quick-path.md");
const REVIEW = read("skills", "independent-review", "SKILL.md");

const section = (text, from, to) => {
  const a = text.indexOf(from);
  assert.ok(a >= 0, `no section ${from}`);
  const b = to ? text.indexOf(to, a + from.length) : -1;
  return b < 0 ? text.slice(a) : text.slice(a, b);
};

const VERIFY = /carja evidence run --label verify -- /;
const SUITE_AGAIN = /run the (whole |full |test )?suite again|full test suite, not just|run all tests, not just/i;

describe("O1 — tests run when they prove something", () => {
  for (const [name, text] of [["test-driven-law.md", LAW], ["tdd-cycle.md", TDD], ["build.md", BUILD]]) {
    test(`${name}: RED fails on an assertion, not on an import or a missing name`, () => {
      assert.match(text, /assertion/i);
      assert.match(text, /import error|missing name|syntax error/i);
    });

    test(`${name}: REFACTOR re-runs the targeted tests, never the whole suite`, () => {
      assert.doesNotMatch(text, SUITE_AGAIN);
      assert.match(text, /targeted tests?/i);
    });
  }

  test("Build runs the full suite once, at the end, through the evidence ledger", () => {
    assert.match(BUILD, VERIFY);
    assert.match(BUILD, /only (when|if) code changed after it|again only when code changed/i);
    const perTask = section(BUILD, "## Phase 1", "## Phase 2");
    assert.doesNotMatch(perTask, /full (test )?suite|full verification/i, "the per-task loop still runs the full suite");
  });

  test("the rule names the end-of-change verify run", () => {
    assert.match(LAW, VERIFY);
  });

  test("Quick-Path's build step no longer asks for full verification per task", () => {
    const build = section(QUICK, "## Phase 4", "## Completion");
    assert.doesNotMatch(build, /full verification/i);
  });
});

describe("O2 — the reviewer runs in the foreground", () => {
  test("the caller waits for the verdict and never starts the reviewer in the background", () => {
    const gate = section(REVIEW, "## The gate", "## Disposing of the findings");
    assert.match(gate, /foreground/i);
    assert.match(gate, /wait/i);
    assert.match(gate, /run_in_background/);
  });
});

describe("O4 — less state traffic", () => {
  test("Build reads the spec, the plan and coding-patterns.md, other files only when the plan names them", () => {
    const setup = section(BUILD, "## Phase 0", "## Phase 1");
    assert.match(setup, /feature-spec\.md/);
    assert.match(setup, /implementation-plan\.md/);
    assert.match(setup, /carja\/4-context\/technical\/coding-patterns\.md/);
    assert.match(setup, /only when the plan names/i);
    assert.doesNotMatch(setup, /blueprint\/grand-prd\.md/, "Build still reads the Grand PRD on every run");
  });

  test("task-tracker.md is written once, at the end; the commits carry the state", () => {
    assert.match(BUILD, /task-tracker\.md[^.]*once/i);
    assert.match(BUILD, /git log/);
    assert.doesNotMatch(BUILD, /after every task[^.]*tracker|tracker[^.]*after every task/i);
  });
});

describe("O5 — one review per change, scaled to its size", () => {
  test("Build runs one Diff review for the whole change, before final verification", () => {
    assert.doesNotMatch(BUILD, /one per batch|per batch/i);
    const review = section(BUILD, "## Phase 2", "## Phase 3");
    assert.match(review, /whole change/i);
    assert.match(review, /50/);
    assert.match(review, /risk path/i);
    assert.match(section(BUILD, "## Phase 3", "## Phase 4"), VERIFY, "the verify run must come after the review");
  });

  test("Spec-It reviews spec and plan only above 3 tasks or on a risk path", () => {
    const phase2 = section(SPEC, "## Phase 2", "## Completion Protocol");
    assert.match(phase2, /more than 3 tasks/i);
    assert.match(phase2, /risk path/i);
  });

  test("the review skill says the same as the workflows", () => {
    assert.match(REVIEW, /more than 3 tasks/i);
    assert.doesNotMatch(REVIEW, /per batch/i);
  });
});

describe("O4 everywhere: nothing else asks for a tracker update after every task", () => {
  test("the loop's slice brief makes the commits the memory across beats", async () => {
    const { ROUTING } = await import("../src/loop/harvester.js");
    const brief = ROUTING.slice.brief;
    assert.doesNotMatch(brief, /current after every task/i);
    assert.match(brief, /git log/);
    assert.match(brief, /task number/i);
  });

  test("the task-tracker skill and its registry entry say: written once, at the end", () => {
    const skill = read("skills", "task-tracker", "SKILL.md");
    const entry = JSON.parse(read("registry.json")).skills.find((s) => s.dir === "task-tracker");
    for (const text of [skill, entry.description]) {
      assert.doesNotMatch(text, /every state change/i);
      assert.match(text, /once/i);
    }
  });
});
