// test/ship-tail.test.js
//
// The Ship workflow's tail was being dropped. Measured 2026-09-15 across the
// maintainer's four live projects: the last ship-log entry was dated
// 2026-07-16 / 07-31 / 07-31 while 103 / 8 / 18 merges landed on main after
// it, and retrospectives existed for 12 of 47 logged ships. The cause is
// structural, not laziness: the MR was created in Phase 5 and the ship-log,
// product-area update and archive move sat in Phase 6, after the visible
// deliverable, with the Retrospective an optional Next Step. An agent treats
// the MR as the finish line and stops.
//
// Two decisions this test pins:
//   O1  bookkeeping is a PRECONDITION of the MR step, not an afterthought —
//       it must appear before `glab mr create` / `gh pr create`, in the
//       phases and in the completion checklist alike.
//   O3  a minimal retrospective lives INSIDE the ship-log entry (three
//       fields), so a ship with no separate Retrospective still leaves a
//       lesson behind, and one grep across every project finds what the
//       framework itself should learn.
//
// Structural on prose, and honest about it: this proves the order and the
// fields are in the instructions, not that an agent obeys them. Whether the
// ship-logs resume is measured the same way the gap was found — by diffing
// the last entry date against merges on main.

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = new URL("..", import.meta.url).pathname;
const SHIP = readFileSync(join(ROOT, "templates", ".agents", "workflows", "ship.md"), "utf8");
const SHIP_LOG = readFileSync(
  join(ROOT, "templates", "carja", "0-compass", "ship-log.md"),
  "utf8",
);

const RETRO_FIELDS = ["**Surprised:**", "**Next time:**", "**Framework lesson:**"];

/** First index of any of the given needles, or -1. */
const firstIndex = (text, needles) =>
  needles.map((n) => text.indexOf(n)).filter((i) => i >= 0).sort((a, b) => a - b)[0] ?? -1;

const MR_CREATE = firstIndex(SHIP, ["glab mr create", "gh pr create"]);

describe("O1 — Ship's bookkeeping precedes the MR step", () => {
  test("the MR-creation instruction exists", () => {
    assert.ok(MR_CREATE >= 0, "ship.md no longer tells the agent how to create the MR/PR");
  });

  test("the ship-log entry is written before the MR is created", () => {
    const shipLog = SHIP.indexOf("carja/0-compass/ship-log.md");
    assert.ok(shipLog >= 0, "ship.md never mentions the ship-log");
    assert.ok(
      shipLog < MR_CREATE,
      `ship-log update (offset ${shipLog}) comes after MR creation (offset ${MR_CREATE}) — the tail will be dropped`,
    );
  });

  test("the product-area update and the archive move are before the MR is created", () => {
    const productArea = SHIP.indexOf("carja/3-product-areas/");
    const archive = SHIP.indexOf("carja/6-archive/completed-implementations/");
    assert.ok(productArea >= 0 && archive >= 0, "product-area or archive step is missing");
    assert.ok(productArea < MR_CREATE, "product-area update sits after MR creation");
    assert.ok(archive < MR_CREATE, "archive move sits after MR creation");
  });

  test("the completion checklist lists bookkeeping before the MR", () => {
    const checklist = SHIP.slice(SHIP.indexOf("## Completion Checklist"));
    const log = checklist.indexOf("Ship-Log");
    const mr = checklist.indexOf("MR/PR created");
    assert.ok(log >= 0 && mr >= 0, "checklist lost the Ship-Log or the MR item");
    assert.ok(log < mr, "checklist still puts the MR before the Ship-Log");
  });

  test("after creating the MR, the entry already written gets the MR link", () => {
    // The one thing that cannot be known before the MR exists is its URL.
    // That backfill is the whole remaining tail, and it must be named.
    const afterMr = SHIP.slice(MR_CREATE);
    assert.match(
      afterMr,
      /ship-log/i,
      "nothing after MR creation says to add the MR link to the ship-log entry",
    );
  });
});

describe("O3 — a minimal retrospective lives in the ship-log entry", () => {
  test("ship.md's entry template carries the three retro fields", () => {
    for (const f of RETRO_FIELDS) {
      assert.ok(SHIP.includes(f), `ship.md entry template lacks ${f}`);
    }
  });

  test("the fields are inside the entry template, not scattered prose", () => {
    const fence = SHIP.indexOf("## [Date] —");
    assert.ok(fence >= 0, "ship.md lost the `## [Date] — [Name]` entry heading");
    const block = SHIP.slice(fence, SHIP.indexOf("```", fence));
    for (const f of RETRO_FIELDS) {
      assert.ok(block.includes(f), `${f} is not inside the entry template block`);
    }
  });

  test("the entry template licenses an honest `none` so fields are never invented", () => {
    const fence = SHIP.indexOf("## [Date] —");
    const around = SHIP.slice(fence, fence + 2500);
    assert.match(around, /`none`/, "no instruction that `none` is an acceptable value");
  });

  test("the ship-log template documents the same entry format as the workflow", () => {
    assert.ok(SHIP_LOG.includes("## [Date] —") || /^## \d{4}-\d{2}-\d{2} —/m.test(SHIP_LOG),
      "ship-log.md does not show the `## [Date] — [Name]` entry format Ship writes");
    for (const f of RETRO_FIELDS) {
      assert.ok(SHIP_LOG.includes(f), `ship-log.md's How-to-Use lacks ${f}`);
    }
  });
});
