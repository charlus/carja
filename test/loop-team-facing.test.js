// test/loop-team-facing.test.js
//
// A1 (C3-F21, autopportunity 2026-10-21): what the team sees of the loop. The
// code MR was titled "Carja task task:kb-retire…", and auto-capture commits
// named the internal task id. A2 (F8): `loop doctor` ran the tests in the
// owner's checkout and left __pycache__/ there.

import { test } from "node:test";
import assert from "node:assert/strict";
import { prCommand } from "../src/loop/merge.js";
import { autoCommitMessage } from "../src/loop/autocommit.js";
import { mrTitles, readOnlyEnv } from "../src/loop/team-facing.js";

test("A1: the code MR carries the item's own title; the outer state MR says what it is", () => {
  const t = { id: "task:kb-retire-the-use-case-without-customer-", title: '**KB: retire the "Use case without customer" KM queue (decision 2026-10-20).** Always empty once … (loop-ready)' };
  const m = mrTitles(t);
  assert.equal(m.code, 'KB: retire the "Use case without customer" KM queue (decision 2026-10-20)');
  assert.equal(m.state, 'Carja state: KB: retire the "Use case without customer" KM queue (decision 2026-10-20)');
  assert.doesNotMatch(m.code, /Carja task|task:/);
  assert.equal(mrTitles({ id: "slice:p/01-a", title: "", type: "slice" }).code, "slice:p/01-a", "no title: the id, never empty");
});

test("A1: a GitLab MR opened by the loop is squashed on merge, so the team's history gets one commit", () => {
  const [, glab] = prCommand("glab", { branch: "b", title: "T", body: "x" });
  assert.ok(glab.includes("--squash-before-merge"));
  const [, gh] = prCommand("gh", { branch: "b", title: "T", body: "x" });
  assert.ok(!gh.includes("--squash-before-merge"), "gh has no such flag");
});

test("A1: an auto-capture commit names the work, not the loop's internal task id", () => {
  const msg = autoCommitMessage({ role: "maker", goal: "KB: retire the KM queue — task task:kb-retire-the-use-case-without-customer-" });
  assert.doesNotMatch(msg, /task task:|task:kb-/);
  assert.match(msg, /^chore: capture uncommitted work: KB: retire the KM queue/);
});

test("A2: the doctor's run in the owner's checkout writes no Python bytecode and no pytest cache", () => {
  const env = readOnlyEnv("pytest tests");
  assert.match(env, /PYTHONDONTWRITEBYTECODE=1/);
  assert.match(env, /PYTEST_ADDOPTS=.*-p no:cacheprovider/);
  assert.match(env, /pytest tests$/);
});
