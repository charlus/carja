// test/auto-merge-breaker.test.js
//
// A3 / F23 (docs/roadmap/Risk-Tiered-Merge.md): the code review post's planned
// "circuit breakers that tighten approval when revert numbers move". Every item
// Carja merges without the owner is recorded in a ledger. When enough of them
// were reverted on the default branch recently, medium goes back to the owner.
// Derived from git history each time: nothing to reset.

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";

import { revertedItems, tightenedRisk, breakerConfig } from "../src/loop/breaker.js";
import { parseRiskConfig } from "../src/loop/risk.js";

const DAY = 86400000;
const NOW = Date.parse("2026-11-18T12:00:00Z");
const ledger = [
  { at: "2026-11-10T10:00:00Z", project: "p", title: "slice 01", repos: { outer: { base: "b1", head: "h1" } } },
  { at: "2026-11-11T10:00:00Z", project: "p", title: "slice 02", repos: { outer: { base: "h1", head: "h2" }, code: { base: "c0", head: "c2" } } },
  { at: "2026-11-12T10:00:00Z", project: "p", title: "slice 03", repos: { outer: { base: "h2", head: "h3" } } },
];
// A revert names a commit; `inRange(repo, sha, base, head)` says whether that commit belongs to an item.
const inRange = (repo, sha, base, head) => ({ "outer:x1:b1:h1": true, "code:y2:c0:c2": true })[`${repo}:${sha}:${base}:${head}`] ?? false;

test("a revert of any commit of an auto-merged item counts once per item, in either repository", () => {
  const reverts = [
    { repo: "outer", at: NOW - 2 * DAY, reverted: "x1" },
    { repo: "outer", at: NOW - 2 * DAY, reverted: "h1" },
    { repo: "code", at: NOW - 1 * DAY, reverted: "y2" },
    { repo: "outer", at: NOW - 1 * DAY, reverted: "unrelated" },
  ];
  assert.deepEqual(revertedItems(ledger, reverts, { inRange }).map((i) => i.title), ["slice 01", "slice 02"]);
});

test("a revert of the merge commit itself counts: its second parent is the item's head", () => {
  const reverts = [{ repo: "outer", at: NOW, reverted: "m3", mergedHead: "h3" }];
  assert.deepEqual(revertedItems(ledger, reverts, { inRange }).map((i) => i.title), ["slice 03"]);
});

test("two reverted items in the window tighten the setting: medium goes back to the owner", () => {
  const risk = parseRiskConfig({ risk: { owner_review: ["high"] } });
  const two = [{ title: "slice 01" }, { title: "slice 02" }];
  const t = tightenedRisk(risk, two);
  assert.deepEqual(t.ownerReview, ["medium", "high"]);
  assert.match(t.breaker, /2 items Carja merged without you were reverted in the last 30 days \(slice 01, slice 02\)/);
  assert.equal(tightenedRisk(risk, [{ title: "slice 01" }]).ownerReview.join(), "high", "one revert is not enough");
  assert.equal(tightenedRisk(parseRiskConfig({ risk: { owner_review: ["high"], breaker_reverts: 0 } }), two).ownerReview.join(), "high", "0 turns it off");
});

test("the breaker settings parse, with defaults", () => {
  assert.deepEqual(breakerConfig(parseRiskConfig({ risk: {} })), { reverts: 2, days: 30 });
  assert.deepEqual(breakerConfig(parseRiskConfig({ risk: { breaker_reverts: 3, breaker_days: 14 } })), { reverts: 3, days: 14 });
  assert.equal(parseRiskConfig({ risk: { breaker_reverts: -1 } }).errors.length, 1);
});

test("a GitLab merge request revert counts by its number", () => {
  const l = [{ title: "slice 09", repos: { outer: { base: "a", head: "b", url: "https://h/g/p/-/merge_requests/85" } } }];
  assert.equal(revertedItems(l, [{ repo: "outer", at: NOW, mr: "85" }], { inRange: () => false }).length, 1);
  assert.equal(revertedItems(l, [{ repo: "outer", at: NOW, mr: "8" }], { inRange: () => false }).length, 0);
});
