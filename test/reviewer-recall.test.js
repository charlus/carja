// test/reviewer-recall.test.js
//
// F9/F10 (docs/roadmap/Risk-Tiered-Merge.md), after the Claude Code team:
// "grade [the reviewer] against the bugs that mattered to you" and "turn misses
// into rules". F10: incidents are harvested from a repository's history
// (reverts, and fixes that name the commit they fix), clean commits are the
// control, and a finding counts only when it lands where the fix changed the
// code. F9: a class of fixed findings that recurs in two or more slices is a
// candidate rule. Pure functions; the eval that calls a model is
// test/evals/reviewer-recall/run.mjs (CARJA_EVALS=1), not run here.

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";

import { incidentsFromLog, parseHunks, findingHits, scoreRun, parseReviewerReport, harvestCases } from "../src/reviewer-recall.js";
import { ruleCandidates } from "../src/review-rules.js";

const LOG = [
  { sha: "r1", subject: 'Revert "feat: cache sessions"', body: "This reverts commit aaa111.\n\nLogins broke.", files: ["src/session.js"] },
  { sha: "f1", subject: "fix: totals rounding", body: "Fixes: bbb222", files: ["src/total.js"] },
  { sha: "c1", subject: "feat: add page", body: "", files: ["src/page.js"] },
];

test("reverts and Fixes: trailers become incidents; the key is the fixing commit", () => {
  assert.deepEqual(incidentsFromLog(LOG), [
    { bad: "aaa111", fix: "r1", key: 'Revert "feat: cache sessions"', kind: "revert" },
    { bad: "bbb222", fix: "f1", key: "fix: totals rounding", kind: "fix" },
  ]);
});

test("hunks: the changed line ranges of the fix, per file", () => {
  const diff = ["diff --git a/src/a.js b/src/a.js", "--- a/src/a.js", "+++ b/src/a.js", "@@ -10,3 +10,4 @@ x", "@@ -40 +41,0 @@ y"].join("\n");
  assert.deepEqual(parseHunks(diff), { "src/a.js": [[10, 12], [40, 40]] });
});

test("a finding hits when it names a fixed file within 3 lines of a fixed hunk", () => {
  const hunks = { "src/a.js": [[10, 12]] };
  assert.equal(findingHits({ file: "src/a.js", line: 14 }, hunks), true);
  assert.equal(findingHits({ file: "src/a.js", line: 20 }, hunks), false);
  assert.equal(findingHits({ file: "src/b.js", line: 11 }, hunks), false);
  assert.equal(findingHits({ file: "./src/a.js", line: 9 }, hunks), true);
});

test("the score keeps raw recall, blocker recall and the false positives on clean controls apart", () => {
  const s = scoreRun([
    { kind: "incident", hunks: { "a.js": [[1, 2]] }, findings: [{ severity: "IMPORTANT", file: "a.js", line: 1 }] },
    { kind: "incident", hunks: { "b.js": [[5, 5]] }, findings: [{ severity: "BLOCKER", file: "b.js", line: 5 }] },
    { kind: "incident", hunks: { "c.js": [[5, 5]] }, findings: [] },
    { kind: "control", findings: [{ severity: "BLOCKER", file: "x.js", line: 1 }] },
    { kind: "control", findings: [{ severity: "NIT", file: "y.js", line: 1 }] },
  ]);
  assert.deepEqual(s, { incidents: 3, controls: 2, recall_any: 2 / 3, recall_blocker: 1 / 3, control_blocked: 1 / 2 });
});

test("the reviewer's report is read in the reviewer.md shape", () => {
  const text = "SCOPE: complete\n[BLOCKER] (confidence 9) src/auth/session.ts:42\n  quote: x\n[NIT] (confidence 3) README.md:1\nVERDICT: CHANGES REQUESTED";
  assert.deepEqual(parseReviewerReport(text), [
    { severity: "BLOCKER", confidence: 9, file: "src/auth/session.ts", line: 42 },
    { severity: "NIT", confidence: 3, file: "README.md", line: 1 },
  ]);
});

test("harvest from a real repository: one revert incident and a size-matched clean control", () => {
  const d = mkdtempSync(join(tmpdir(), "recall-"));
  const G = (...a) => execFileSync("git", a, { cwd: d, stdio: "pipe" }).toString().trim();
  try {
    G("init", "-q");
    G("config", "user.email", "t@t");
    G("config", "user.name", "t");
    writeFileSync(join(d, "a.js"), "1\n");
    G("add", "-A");
    G("commit", "-qm", "init");
    writeFileSync(join(d, "b.js"), "clean\n");
    G("add", "-A");
    G("commit", "-qm", "feat: clean change");
    writeFileSync(join(d, "a.js"), "1\nbug\n");
    G("commit", "-qam", "feat: buggy change");
    G("revert", "--no-edit", "HEAD");
    const cases = harvestCases(d, { controlMinAgeDays: 0 });
    const inc = cases.filter((c) => c.kind === "incident");
    const ctl = cases.filter((c) => c.kind === "control");
    assert.equal(inc.length, 1);
    assert.equal(inc[0].key, 'Revert "feat: buggy change"');
    assert.deepEqual(Object.keys(inc[0].hunks), ["a.js"]);
    assert.equal(ctl.length, 1);
    assert.equal(G("log", "-1", "--format=%s", ctl[0].bad), "feat: clean change");
  } finally {
    rmSync(d, { recursive: true, force: true });
  }
});

test("F9: a fixed class that recurs in two slices is a candidate rule; one slice is not", () => {
  const rec = (slice, o = {}) => ({ severity: "BLOCKER", category: "error-handling", detail: "swallowed exception", slice, action: "fixed", file: "src/x.js", line: 3, quote: "catch {}", ...o });
  const c = ruleCandidates([rec("01"), rec("02", { file: "src/y.js" }), rec("02"), rec("03", { category: "security", detail: "sql" }), rec("04", { action: "dismissed", detail: "noise" }), rec("05", { action: "dismissed", detail: "noise" })]);
  assert.equal(c.length, 1);
  assert.equal(c[0].category, "error-handling");
  assert.deepEqual(c[0].slices, ["01", "02"]);
  assert.equal(c[0].count, 3);
  assert.equal(c[0].examples.length, 2);
});

test("carja review-log rules prints the candidates and the next step", async () => {
  const { mkdtempSync: mk, mkdirSync, writeFileSync: wf, rmSync: rm } = await import("node:fs");
  const { spawnSync } = await import("node:child_process");
  const d = mk(join(tmpdir(), "rules-"));
  try {
    mkdirSync(join(d, "carja/1-workbench"), { recursive: true });
    const line = (slice) => JSON.stringify({ ts: "2026-11-18T00:00:00Z", severity: "IMPORTANT", category: "error-handling", detail: "swallowed exception", slice, action: "fixed", file: "src/x.js", line: 3 });
    wf(join(d, "carja/1-workbench/review-log.jsonl"), `${line("01")}\n${line("02")}\n`);
    const r = spawnSync("node", [new URL("../bin/carja.js", import.meta.url).pathname, "review-log", "rules"], { cwd: d, encoding: "utf8" });
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /error-handling: swallowed exception — 2 fixed, slices 01, 02/);
    assert.match(r.stdout, /architecture-checklist\.md/);
  } finally {
    rm(d, { recursive: true, force: true });
  }
});

test("SZZ: a fix: commit is traced by blame to the commit that introduced the lines it changed", () => {
  const d = mkdtempSync(join(tmpdir(), "szz-"));
  const G = (...a) => execFileSync("git", a, { cwd: d, stdio: "pipe" }).toString().trim();
  try {
    G("init", "-q");
    G("config", "user.email", "t@t");
    G("config", "user.name", "t");
    writeFileSync(join(d, "a.js"), "one\ntwo\n");
    G("add", "-A");
    G("commit", "-qm", "init");
    writeFileSync(join(d, "a.js"), "one\ntwo\nbad line\nfour\n");
    mkdirSync(join(d, "test"), { recursive: true });
    writeFileSync(join(d, "test/a.test.js"), "expect(bad)\n");
    G("add", "-A");
    G("commit", "-qm", "feat: totals");
    const bad = G("rev-parse", "HEAD");
    writeFileSync(join(d, "b.js"), "clean\nclean\n");
    G("add", "-A");
    G("commit", "-qm", "feat: other");
    writeFileSync(join(d, "a.js"), "one\ntwo\ngood line\nfour\n");
    writeFileSync(join(d, "NOTES.md"), "why\n");
    writeFileSync(join(d, "test/a.test.js"), "expect(good)\n");
    G("add", "-A");
    G("commit", "-qm", "fix(totals): rounding");
    writeFileSync(join(d, "b.js"), "clean\nfixed in review\n");
    G("commit", "-qam", "fix(other): independent review round 1 fixes");
    const cases = harvestCases(d, { controlMinAgeDays: 0 });
    const inc = cases.filter((c) => c.kind === "incident");
    assert.equal(inc.length, 1, "a review-round fix is not an incident");
    assert.equal(inc[0].bad, bad);
    assert.equal(inc[0].key, "fix(totals): rounding");
    assert.deepEqual(inc[0].hunks, { "a.js": [[3, 3]] }, "documentation and tests the fix touched are not part of the key");
  } finally {
    rmSync(d, { recursive: true, force: true });
  }
});
