// test/review-ledger-wiring.test.js
//
// O7 — the review ledger is written by the workflow that produces findings.
//
// E2 shipped `carja review-log append|summary` (2026-09-03) so the review
// gate's convergence could be a number: rounds to APPROVE, dismissal rate per
// class, blockers by category. Measured 2026-09-15: zero rows in all five live
// projects. Not a habit problem — `templates/` never told the agent to append;
// only `calibration.md` mentioned the file, as a READER. An instrument nothing
// writes to is decoration, and E1's "good enough" rests on feel until it fills.
//
// Pinned here: Ship's disposition step (4.4) and the review skill's disposition
// rule both name the append command, with the record shape the CLI validates
// (`severity`, `category`, `action`, and for a BLOCKER a `quote` + `confidence`).

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = new URL("..", import.meta.url).pathname;
const SHIP = readFileSync(join(ROOT, "templates", ".agents", "workflows", "ship.md"), "utf8");
const SKILL = readFileSync(
  join(ROOT, "templates", ".agents", "skills", "independent-review", "SKILL.md"),
  "utf8",
);

const APPEND = "carja review-log append";

describe("O7 — the ledger is written where findings are disposed", () => {
  test("Ship Phase 4 tells the agent to append every disposition", () => {
    const phase4 = SHIP.slice(SHIP.indexOf("## Phase 4"), SHIP.indexOf("## Phase 5"));
    assert.ok(phase4.length > 0, "ship.md lost Phase 4");
    assert.ok(phase4.includes(APPEND), `Phase 4 never runs \`${APPEND}\``);
  });

  test("the instruction carries the fields the CLI validates", () => {
    const at = SHIP.indexOf(APPEND);
    const around = SHIP.slice(at, at + 900);
    for (const f of ['"severity"', '"category"', '"action"', '"quote"', '"confidence"']) {
      assert.ok(around.includes(f), `append example lacks ${f}`);
    }
    assert.match(around, /dismissed/, "dismissals are the point of the ledger — they must be logged too");
  });

  test("the independent-review skill's disposition rule names the same command", () => {
    assert.ok(SKILL.includes(APPEND), `independent-review/SKILL.md never mentions \`${APPEND}\``);
  });

  test("Ship says what the ledger is FOR, so the step is not cargo", () => {
    const at = SHIP.indexOf(APPEND);
    const around = SHIP.slice(Math.max(0, at - 600), at + 900);
    assert.match(around, /review-log summary/, "nothing points at the summary that reads the ledger back");
  });
});
