// Release gate: every templates/ tree that ships has a passing (or waived)
// longitudinal benchmark run in test/evals/longitudinal/releases.jsonl.
// Run one with `npm run eval:release` (docs/roadmap/Outcome-Eval.md).
import { test } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { THRESHOLDS, summarise, verdict, baselineFor, treeHash, readHistory, covered } from "./evals/longitudinal/gate-lib.mjs";

const REPO = join(dirname(fileURLToPath(import.meta.url)), "..");
const HISTORY = join(REPO, "test/evals/longitudinal/releases.jsonl");

const chain = (final, costUsd, kept = 1) => ({ chain: "c", final, kept, costUsd, wallMs: 0, reviewed: 0, capped: 0 });
const five = (final, cost) => Array.from({ length: 5 }, () => chain(final, cost));
const base = { version: "7.3.0", verdict: "pass", model: "m", fixture: "f", meanCost: 4 };

test("the current templates/ have a passing or waived benchmark run", () => {
  const templates = treeHash(REPO, "templates");
  const row = covered(readHistory(HISTORY), templates);
  assert.ok(row, `templates/ ${templates.slice(0, 12)} has no release-gate row. Commit, then run: npm run eval:release`);
});

test("quality at the 7.3 level passes, with a cost inside the noise", () => {
  const v = verdict(five(1, 4.5), base);
  assert.equal(v.verdict, "pass");
  assert.match(v.notes.join(), /1\.13x/);
});

test("one chain that missed a convention fails the gate", () => {
  const c = five(1, 4); c[0] = chain(0.904, 4);
  const v = verdict(c, base);
  assert.equal(v.verdict, "fail");
  assert.match(v.reasons.join(), /one chain at 90\.4%/);
});

test("broken earlier features fail the gate", () => {
  const v = verdict(Array.from({ length: 5 }, () => chain(1, 4, 0.9)), base);
  assert.equal(v.verdict, "fail");
  assert.match(v.reasons.join(), /earlier features kept/);
});

test("a cost rise beyond the noise fails the gate", () => {
  const v = verdict(five(1, 4 * 1.3), base);
  assert.equal(v.verdict, "fail");
  assert.match(v.reasons.join(), /cost: 1\.30x/);
});

test("fewer complete chains than required is never a pass", () => {
  assert.equal(verdict(five(1, 4).slice(0, 4), base).verdict, "incomplete");
});

test("the baseline is the last pass on the same model and material", () => {
  const h = [{ ...base, version: "a" }, { ...base, version: "b", verdict: "fail" }, { ...base, version: "c", model: "other" }, { ...base, version: "d", fixture: "g" }];
  assert.equal(baselineFor(h, { model: "m", fixture: "f" }).version, "a");
  assert.equal(baselineFor(h, { model: "x", fixture: "f" }), null);
});

test("summarise keeps only complete carja chains and reads the last step", () => {
  const rows = [];
  for (let k = 1; k <= THRESHOLDS.steps; k++) {
    rows.push({ arm: "carja", chain: "carja-1", step: k, cumulative: k === 8 ? 0.95 : 1, previous: k > 1 ? 1 : null, costUsd: 0.5, wallMs: 1, subagents: k % 2, capped: false });
    rows.push({ arm: "bare", chain: "bare-1", step: k, cumulative: 0.5, previous: 0.5, costUsd: 0.1, wallMs: 1, subagents: 0 });
  }
  rows.push({ arm: "carja", chain: "carja-2", step: 1, cumulative: 1, previous: null, costUsd: 1 });
  const s = summarise(rows);
  assert.equal(s.length, 1);
  assert.deepEqual([s[0].final, s[0].kept, s[0].costUsd, s[0].reviewed], [0.95, 1, 4, 4]);
});

test("a waived or failed row covers only what it says", () => {
  assert.ok(covered([{ templates: "t", verdict: "waived" }], "t"));
  assert.equal(covered([{ templates: "t", verdict: "fail" }], "t"), null);
  assert.equal(covered([{ templates: "u", verdict: "pass" }], "t"), null);
});
