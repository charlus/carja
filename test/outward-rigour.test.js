// test/outward-rigour.test.js
//
// A5 — the framework challenges the brief, not only the code.
//
// Every gate Carja owns is inward: TDD, the Eval-Driven Law, the evidence
// ledger, independent-review, the Checker. All prove the code does what the
// spec says; none check whether the spec was worth building. A PO running
// several products against an agent fleet gets no challenge from anyone with a
// stake in the outcome.
//
// Bounded to four detectable conditions (C1 contradicts an earlier decision,
// C2 breaks existing users, C3 cost/duration mismatch, C4 missing data, access
// or rights) rather than an open "is this a good idea" — an unbounded question
// is what stopped the review gate converging (memory/review-loop-root-cause).
//
// Maintainer decisions, PR #28: D1 enforce presence, D2 extend grilling rather
// than add a skill, D3 non-blocking to the human, D4 current project only.
// D2 carried an addition: the shared understanding reached at convergence is
// the artifact worth keeping, so it gets written down, not just agreed.

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = new URL("..", import.meta.url).pathname;
const agents = (...p) => readFileSync(join(ROOT, "templates", ".agents", ...p), "utf8");

const GRILLING = agents("skills", "grilling", "SKILL.md");
const QUICK = agents("workflows", "quick-path.md");
const SPEC = agents("workflows", "spec-it.md");
const GENESIS = agents("workflows", "genesis.md");
const SPEC_TPL = readFileSync(
  join(ROOT, "templates", "carja", "5-templates", "carve-workflow", "feature-spec.md"), "utf8");
const LIB = agents("hooks", "lib.sh");
const PRECOMMIT = agents("hooks", "pre-commit");

describe("A5 — Grilling carries the four bounded conditions", () => {
  test("all four conditions are named", () => {
    for (const c of [
      /contradicts (a|an|something)/i,
      /breaks? something for existing users|existing users/i,
      /cost or duration|duration|far longer/i,
      /data, (the )?access or (the )?rights|access or rights/i,
    ]) assert.match(GRILLING, c, `Grilling lacks a condition matching ${c}`);
  });

  test("the challenge is bounded, not an open judgement of the idea", () => {
    assert.match(GRILLING, /never asked "?is this a good idea|not a (product-)?strategy opinion|opinion, and (you|the agent) keeps? it/i,
      "nothing bounds the challenge away from open opinion");
  });

  test("D3 — a challenge states and continues, it does not block", () => {
    assert.match(GRILLING, /does not block|do not refuse|build what the human confirms|continue/i,
      "the challenge is not marked non-blocking");
  });

  test("D4 — detection is scoped to the current project", () => {
    assert.match(GRILLING, /current project|this project only|within the project/i,
      "contradiction detection is not scoped to the current project");
  });

  test("D2 — the shared understanding is written down, not just agreed", () => {
    assert.match(GRILLING, /shared understanding/i, "lost the shared-understanding language");
    assert.match(GRILLING, /write it down|record it|written down/i,
      "the shared understanding is never recorded anywhere");
  });
});

describe("A5 — entry-point workflows run the brief check", () => {
  for (const [name, doc] of [["quick-path", QUICK], ["spec-it", SPEC], ["genesis", GENESIS]]) {
    test(`${name} states the brief check before converging`, () => {
      assert.match(doc, /brief check/i, `${name}.md never runs a brief check`);
      assert.match(doc, /none found/i, `${name}.md does not require an explicit "none found"`);
    });
  }

  test("the feature-spec template carries the section the gate looks for", () => {
    assert.match(SPEC_TPL, /## Brief check/i, "feature-spec template has no Brief check section");
    assert.match(SPEC_TPL, /shared understanding/i, "feature-spec template does not record the shared understanding");
  });
});

describe("A5 — D1: presence is enforced in code, not prose", () => {
  test("lib.sh can identify a brief doc and detect the section", () => {
    assert.match(LIB, /carja_is_brief_doc\(\)/, "no carja_is_brief_doc helper");
    assert.match(LIB, /carja_has_brief_check\(\)/, "no carja_has_brief_check helper");
  });

  test("pre-commit gates on it and offers a logged waiver", () => {
    assert.match(PRECOMMIT, /carja_is_brief_doc/, "pre-commit does not use the brief-doc helper");
    assert.match(PRECOMMIT, /CARJA_NO_BRIEF/, "no waiver escape hatch for the brief gate");
    assert.match(PRECOMMIT, /carja_log_waiver "\$(PROJECT_)?ROOT" "Brief"/, "the brief waiver is not logged");
  });
});
