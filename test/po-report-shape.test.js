// test/po-report-shape.test.js
//
// A4 — the async surfaces report to a PO, not to an engineer.
//
// The maintainer reads the loop's output asynchronously: a ship-log entry, a
// PR body, and `carja status`. All three were engineering-shaped. The
// ship-log's six fields were quality, platform and a three-line retrospective;
// the PR body had no shape at all beyond "link issues, summarise the review";
// and `status` answered "what is on our plate" with counts and freshness, so
// nothing anywhere answered "what is waiting on me" across 4-6 products.
//
// Maintainer decisions, 2026-09-16: restructure the ship-log into two blocks
// (For you / For the record) rather than appending four fields to six, and
// surface unanswered `Decide:` lines at the top of `carja status`.
//
// The `For you` block is gated in pre-commit for the same reason the brief
// check is: a rule that only lives in workflow prose is advisory.

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { openDecisions, buildState } from "../src/carja-state.js";
import { renderStatus } from "../src/view/status.js";

const ROOT = new URL("..", import.meta.url).pathname;
const SHIP = readFileSync(join(ROOT, "templates", ".agents", "workflows", "ship.md"), "utf8");
const LIB = readFileSync(join(ROOT, "templates", ".agents", "hooks", "lib.sh"), "utf8");
const PRECOMMIT = readFileSync(join(ROOT, "templates", ".agents", "hooks", "pre-commit"), "utf8");

// A real-shaped log: two entries, one with an open decision, one without,
// plus the waiver line the hooks append and a legacy entry with neither block.
const LOG = `# Ship Log

## 2026-09-16 — Retry on dropped login

**For you**
- Impact: users stop seeing a blank screen on flaky mobile
- Cost: none, no new service
- Risk: retry storm if the API degrades, not load-tested
- **Decide:** none

**For the record**
- Quality: empathy audit passed, 3 regression tests, review APPROVE
- Platform: branch \`fix/login-retry\` — https://example.invalid/mr/1

- ⚠️ 2026-09-16T10:00 Hook waiver (TDD): generated client

## 2026-09-14 — Search results paging

**For you**
- Impact: results past page 1 are reachable
- Cost: none
- Risk: none
- **Decide:** keep 50k document cap, or fund Elasticsearch this quarter?

**For the record**
- Quality: review APPROVE

## 2026-07-02 — Legacy entry
- **What:** something old
`;

describe("A4 — open decisions are extracted from the ship-log", () => {
  test("only a Decide line that is not `none` counts", () => {
    const open = openDecisions(LOG);
    assert.equal(open.length, 1, `expected 1 open decision, got ${open.length}`);
    assert.equal(open[0].date, "2026-09-14");
    assert.match(open[0].question, /^keep 50k document cap, or fund Elasticsearch this quarter\?$/,
      "the question carries stray bold markers");
    assert.match(open[0].title, /Search results paging/);
  });

  test("`none`, `None.` and a missing field are all closed, however it is bolded", () => {
    // Every bolding the Ship template or a human might produce.
    for (const body of [
      "- **Decide:** none", "- **Decide**: none", "- Decide: none",
      "- **Decide:** None.", "- **Decide:**", "- Decide:", "",
    ]) {
      assert.equal(openDecisions(`## 2026-01-01 — x\n\n**For you**\n${body}\n`).length, 0,
        `"${body}" should not count as an open decision`);
    }
  });

  test("a log with no entries yields none, never a crash", () => {
    assert.deepEqual(openDecisions(""), []);
    assert.deepEqual(openDecisions(undefined), []);
  });

  test("the digest carries them", () => {
    const state = buildState({ root: "/x", projectName: "x", docs: [], shipLogMd: LOG });
    assert.equal(state.digest.shipLog.openDecisions.length, 1);
  });
});

describe("A4 — status leads with what is waiting on the human", () => {
  test("the section renders with the question and its date", () => {
    const state = buildState({ root: "/x", projectName: "x", docs: [], shipLogMd: LOG });
    const out = renderStatus(state, { color: false });
    assert.match(out, /Waiting on you/i, "status has no waiting-on-you section");
    assert.match(out, /Elasticsearch/, "the open question is not shown");
    assert.match(out, /2026-09-14/, "the question's date is not shown");
  });

  test("nothing open means no section at all, not an empty heading", () => {
    const state = buildState({ root: "/x", projectName: "x", docs: [], shipLogMd: "## 2026-01-01 — x\n" });
    assert.doesNotMatch(renderStatus(state, { color: false }), /Waiting on you/i);
  });
});

describe("A4 — the Ship workflow writes both blocks and a PO-shaped PR body", () => {
  test("the ship-log entry is two blocks, with the four For-you fields", () => {
    assert.match(SHIP, /\*\*For you\*\*/, "no For-you block in the ship-log template");
    assert.match(SHIP, /\*\*For the record\*\*/, "no For-the-record block");
    for (const f of [/- \*\*?Impact/i, /- \*\*?Cost/i, /- \*\*?Risk/i, /- \*\*?Decide/i]) {
      assert.match(SHIP, f, `the For-you block lacks ${f}`);
    }
  });

  test("the retrospective lines survive the restructure", () => {
    for (const f of [/Surprised/, /Next time/, /Framework lesson/]) {
      assert.match(SHIP, f, `the restructure dropped ${f}`);
    }
  });

  test("the MR/PR body has a stated shape, not just 'summarise the review'", () => {
    const phase6 = SHIP.slice(SHIP.indexOf("## Phase 6"));
    assert.match(phase6, /What changes for you/i, "the PR body does not lead with product impact");
    assert.match(phase6, /decisions? I took alone|took alone/i, "the PR body does not surface solo decisions");
    assert.match(phase6, /Evidence/i, "the PR body does not carry evidence");
    assert.match(phase6, /need from you|What I need/i, "the PR body does not end with the ask");
  });
});

describe("A4 — the For-you block is enforced, not requested", () => {
  test("lib.sh can spot a ship-log and a newest entry missing the block", () => {
    assert.match(LIB, /carja_is_ship_log\(\)/, "no carja_is_ship_log helper");
    assert.match(LIB, /carja_newest_entry_has_for_you\(\)/, "no newest-entry helper");
  });

  test("pre-commit gates it with a logged waiver", () => {
    assert.match(PRECOMMIT, /carja_is_ship_log/, "pre-commit does not use the helper");
    assert.match(PRECOMMIT, /CARJA_NO_REPORT/, "no waiver for the report gate");
    assert.match(PRECOMMIT, /carja_log_waiver "\$(PROJECT_)?ROOT" "Report"/, "the report waiver is not logged");
  });
});
