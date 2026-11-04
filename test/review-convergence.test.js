// test/review-convergence.test.js
//
// E1 — the review gate must CONVERGE. Guards the contract that stops the
// review loop from running forever:
//
//   1. One reviewer brief exists and is SHORT (agentctl measured loop count
//      tracking the size of the instruction corpus: steps with 0-118 lines of
//      rules closed in one loop, steps with 1,662-4,830 lines took 15-21).
//   2. A BLOCKER needs EVIDENCE (a quoted line + confidence >= 7), so an
//      unsure reviewer downgrades instead of rejecting.
//   3. The reviewer judges against a STATED definition of done, so "is this
//      finished?" is a bounded question with a reachable answer.
//   4. The unbounded-review phrasings that caused the loop are GONE.
//   5. The fix cycle is CAPPED at one delta round, then a human decides.
//
// These are DRIFT GUARDS on prose, not behavior tests — prose cannot be
// executed. The behavior proof for the verdict schema is E3
// (parseCheckerVerdict red->green) and the routing eval; the proof that the
// loop got shorter is E2's review ledger measured over real ships. Stated
// plainly here so a green run is not mistaken for a working review gate
// (CLAUDE.md Operating Truth 1).

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

const ROOT = new URL("..", import.meta.url).pathname;
const AGENTS = join(ROOT, "templates", ".agents");

const REVIEWER = join(AGENTS, "skills", "independent-review", "reviewer.md");
const CALIBRATION = join(AGENTS, "skills", "independent-review", "calibration.md");
const GATE = join(AGENTS, "skills", "independent-review", "SKILL.md");
const CODE_REVIEW = join(AGENTS, "skills", "code-review", "SKILL.md");
const SHIP = join(AGENTS, "workflows", "ship.md");
const BUILD = join(AGENTS, "workflows", "build.md");
const LOOP_CHECKER = join(AGENTS, "workflows", "loop-checker.md");
const CHECKER = join(AGENTS, "personas", "checker.md");

const read = (p) => readFileSync(p, "utf8");
const lines = (p) => read(p).split("\n").length;

// The reviewer brief is handed to a fresh reviewer verbatim. Every line in it
// competes with the diff for that reviewer's attention.
const REVIEWER_MAX_LINES = 130;

describe("E1 — the reviewer brief is one short file", () => {
  test("reviewer.md exists", () => {
    assert.ok(existsSync(REVIEWER), `missing ${REVIEWER} — the single reviewer brief`);
  });

  test(`reviewer.md is at most ${REVIEWER_MAX_LINES} lines`, () => {
    const n = lines(REVIEWER);
    assert.ok(
      n <= REVIEWER_MAX_LINES,
      `reviewer.md is ${n} lines (max ${REVIEWER_MAX_LINES}). ` +
        `Loop count tracks brief size — cut it, don't raise the ceiling.`,
    );
  });

  test("reviewer.md does not chain other skills into the reviewer's context", () => {
    const body = read(REVIEWER);
    // The brief may NAME an artifact the reviewer reads (the checklist file);
    // it must not tell the reviewer to load more prompt files.
    const chained = ["skills/code-review", "skills/behavior-validator", "skills/judge-panel"];
    for (const ref of chained) {
      assert.ok(
        !body.includes(ref),
        `reviewer.md loads ${ref} — the brief must be self-contained (E1: one file, not a chain)`,
      );
    }
  });
});

describe("E1 — a BLOCKER requires evidence", () => {
  test("reviewer.md defines the three severities", () => {
    const body = read(REVIEWER);
    for (const sev of ["BLOCKER", "IMPORTANT", "NIT"]) {
      assert.match(body, new RegExp(`\\b${sev}\\b`), `reviewer.md never mentions ${sev}`);
    }
  });

  test("reviewer.md requires a quoted line and confidence >= 7 for a BLOCKER", () => {
    const body = read(REVIEWER);
    assert.match(body, /confidence/i, "reviewer.md has no confidence score");
    assert.match(body, /\bquote\b/i, "reviewer.md never requires a quoted line");
    assert.match(
      body,
      /confidence[^.\n]*(>=|≥)\s*7|(>=|≥)\s*7[^.\n]*confidence/i,
      "reviewer.md does not gate BLOCKER on confidence >= 7",
    );
  });

  test("reviewer.md downgrades an unquotable finding instead of blocking", () => {
    const body = read(REVIEWER);
    assert.match(
      body,
      /cannot quote|can't quote|no quote/i,
      "reviewer.md has no rule for a finding whose motivating line cannot be quoted",
    );
  });

  test("the verdict is APPROVE when there are no blockers", () => {
    const body = read(REVIEWER);
    assert.match(
      body,
      /APPROVE[\s\S]{0,200}zero blockers|no blockers[\s\S]{0,200}APPROVE/i,
      "reviewer.md does not state that zero blockers means APPROVE",
    );
  });
});

describe("E1 — the reviewer has a reachable definition of done", () => {
  test("reviewer.md takes the acceptance criteria / goal as its first input", () => {
    const body = read(REVIEWER);
    assert.match(
      body,
      /acceptance criteri|goal_description/i,
      "reviewer.md never names the definition of done it judges against",
    );
  });

  test("reviewer.md carries the SCOPE: escape valve, used once", () => {
    const body = read(REVIEWER);
    assert.match(body, /SCOPE:/, "reviewer.md has no SCOPE: escape valve");
    assert.match(
      body,
      /SCOPE:[\s\S]{0,400}\bonce\b/i,
      "reviewer.md does not bound the SCOPE: finding to once",
    );
  });

  test("reviewer.md excludes process artefacts and tooling-enforced items", () => {
    const body = read(REVIEWER);
    assert.match(body, /Not a finding|Never a finding|Do not flag/i, "reviewer.md has no exclusion list");
    for (const excluded of ["carja/", "linter"]) {
      assert.ok(
        body.includes(excluded),
        `reviewer.md exclusion list does not cover ${excluded}`,
      );
    }
  });
});

describe("E1 — the unbounded-review phrasings are gone", () => {
  // Each of these produced the always-reject behavior. They must not survive
  // anywhere a reviewer reads.
  const BANNED = [
    { re: /look for the reason this is \*\*not\*\* done/i, why: "adversarial unbounded brief" },
    { re: /look for the reason this is \*\*not\*\* ready/i, why: "adversarial unbounded brief" },
    { re: /Reviewer found issues = not done/i, why: "any finding blocks, no severity floor" },
    { re: /zero warnings/i, why: "unbounded quality floor" },
  ];
  const SURFACES = [REVIEWER, GATE, CODE_REVIEW, SHIP, BUILD, LOOP_CHECKER, CHECKER];

  for (const path of SURFACES) {
    test(`${path.replace(ROOT, "")} carries no unbounded-review phrasing`, () => {
      const body = read(path);
      for (const { re, why } of BANNED) {
        assert.ok(!re.test(body), `${path.replace(ROOT, "")} still has: ${re} (${why})`);
      }
    });
  }

  test("code-review no longer loops until approved", () => {
    const body = read(CODE_REVIEW);
    assert.ok(
      !/Repeat until approved/i.test(body),
      "code-review still says to repeat until approved — that is the loop E1 removes",
    );
  });
});

describe("E1 — the fix cycle is capped", () => {
  test("the gate caps the re-review at ONE delta round", () => {
    const body = read(GATE);
    assert.match(body, /delta/i, "the gate has no delta re-review");
    assert.match(
      body,
      /one delta|single delta|delta[\s\S]{0,200}\bcapped\b|cap[\s\S]{0,120}one delta/i,
      "the gate does not cap the delta re-review at one round",
    );
  });

  test("remaining blockers are batched into ONE question to the human", () => {
    const body = read(GATE);
    assert.match(
      body,
      /one question|single question|batch/i,
      "the gate never batches the remaining blockers into one question",
    );
  });

  test("a fix round is never escalated without being reviewed", () => {
    const body = read(GATE);
    assert.match(
      body,
      /never escalate[\s\S]{0,200}unreviewed|unreviewed[\s\S]{0,200}never escalate|without a verdict on it/i,
      "the gate can escalate a fix round that was never reviewed (agentctl 2c0b146)",
    );
  });
});

describe("E1 — the gate is proportional", () => {
  test("ship skips the subagent for a small, low-risk diff", () => {
    const body = read(SHIP);
    assert.match(body, /50/, "ship Phase 4 has no changed-LOC threshold");
    assert.match(
      body,
      /risk path|risk-path/i,
      "ship Phase 4 has no risk-path list — LOC alone is not a risk proxy",
    );
  });

  test("the risk-path list covers the paths a small diff can still break", () => {
    const body = read(SHIP);
    for (const p of ["auth", "migration", "payment"]) {
      assert.match(body, new RegExp(p, "i"), `ship risk-path list omits ${p}`);
    }
  });
});

describe("E1 — the reviewer is calibrated", () => {
  test("calibration.md exists", () => {
    assert.ok(existsSync(CALIBRATION), `missing ${CALIBRATION}`);
  });

  test("calibration.md carries at least 5 graded cases", () => {
    const body = read(CALIBRATION);
    const cases = body.match(/^###\s+C\d+/gm) ?? [];
    assert.ok(cases.length >= 5, `calibration.md has ${cases.length} cases, need >= 5`);
  });

  test("calibration covers both failure directions and the SCOPE case", () => {
    const body = read(CALIBRATION);
    assert.match(body, /\bBLOCKER\b/, "no worked BLOCKER case — under-rejection goes uncalibrated");
    assert.match(body, /false positive/i, "no worked false-positive case — over-rejection goes uncalibrated");
    assert.match(body, /SCOPE:/, "no worked SCOPE: case");
  });
});

describe("E1 — the loop's safety envelope is untouched", () => {
  test("loop-checker still fails safe on a missing or malformed verdict", () => {
    const body = read(LOOP_CHECKER);
    assert.match(
      body,
      /fails safe|fail safe|fail-safe/i,
      "loop-checker lost its fail-safe wording — a missing verdict must never approve",
    );
    assert.match(
      body,
      /approved.{0,4}:\s*false/i,
      "loop-checker no longer tells an unsure Checker to write approved: false",
    );
  });

  test("the reviewer still only reports — it does not merge, push, or edit", () => {
    for (const path of [REVIEWER, GATE]) {
      const body = read(path);
      assert.match(
        body,
        /only reports?|do(es)? not (merge|push|edit)|never merge/i,
        `${path.replace(ROOT, "")} dropped the reviewer's report-only boundary`,
      );
    }
  });
});
