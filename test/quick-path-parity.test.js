// test/quick-path-parity.test.js
//
// F3 — Quick-Path keeps the gates that Build and Ship add.
//
// Real usage (evalapp-v2, 2026-10): both features built after 6.8 went through
// Quick-Path. Quick-Path said only "follow the Build workflow". The agent read
// the first 80 lines of build.md and never reached the persona step or the
// reviewer.md handover. No persona was loaded (the Designer was needed), the
// review used an improvised prompt, nothing reached review-log, and the agent
// opened the MRs itself, so Ship never ran and no ship-log entry was written.
// In autopportunity the spec Quick-Path saved had no `## Brief check`, which the
// pre-commit hook then blocked at ship time.
//
// Pinned here: the steps that were skipped are written in Quick-Path itself,
// and the spec it saves passes the hook.

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = new URL("..", import.meta.url).pathname;
const QUICK = readFileSync(join(ROOT, "templates", ".agents", "workflows", "quick-path.md"), "utf8");
const section = (from, to) => QUICK.slice(QUICK.indexOf(from), to ? QUICK.indexOf(to) : undefined);

describe("F3 — Quick-Path keeps Build's and Ship's gates", () => {
  test("the spec template carries the section the pre-commit hook requires", () => {
    const spec = section("## Phase 2", "## Phase 3");
    assert.match(spec, /^## Brief check$/m, "the Quick-Path spec template has no '## Brief check' heading");
  });

  test("the build step loads the personas from the files it changes", () => {
    const build = section("## Phase 4", "## Completion");
    assert.match(build, /carja personas/);
  });

  test("the build step hands the reviewer reviewer.md and logs each finding", () => {
    const build = section("## Phase 4", "## Completion");
    assert.match(build, /independent-review\/reviewer\.md/);
    assert.match(build, /carja review-log append/);
  });

  test("the build step reads build.md whole, not its first lines", () => {
    assert.match(section("## Phase 4", "## Completion"), /whole|entire|every line/i);
  });

  test("Quick-Path ends in Ship: no PR outside Ship, and Ship writes the ship-log", () => {
    const done = section("## Completion");
    assert.doesNotMatch(done, /if applicable/i, "the ship-log is still optional");
    assert.match(done, /workflows\/ship\.md/);
    assert.match(done, /(PR|MR|merge request|pull request)[^.]*only (in|through) Ship|never open (a|the) (PR|MR)/i);
  });

  test("the plan is not a stop: it is an engineering artefact", () => {
    assert.doesNotMatch(QUICK, /shall I start building\?/i);
  });
});
