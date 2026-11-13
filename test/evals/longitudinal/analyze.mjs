#!/usr/bin/env node
// Longitudinal eval: the pre-registered analysis (docs/roadmap/Outcome-Eval.md,
// "Longitudinal benchmark pre-registration"). Written before any session ran.
//
//   node analyze.mjs --work <dir>

import { readFileSync } from "node:fs";
import { join } from "node:path";

const arg = (k, d = null) => { const i = process.argv.indexOf(`--${k}`); return i > 0 ? process.argv[i + 1] : d; };
const rows = readFileSync(join(arg("work"), "results.jsonl"), "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l));
const STEPS = Math.max(...rows.map((r) => r.step));

// Exact two-sided permutation test on the difference of arm means (chains are the units).
export function permutation(a, b) {
  const all = [...a, ...b], n = all.length, k = a.length;
  const mean = (x) => x.reduce((s, v) => s + v, 0) / x.length;
  const obs = Math.abs(mean(b) - mean(a));
  let extreme = 0, total = 0;
  const pick = (start, chosen) => {
    if (chosen.length === k) {
      const A = chosen.map((i) => all[i]), B = all.filter((_, i) => !chosen.includes(i));
      total++; if (Math.abs(mean(B) - mean(A)) >= obs - 1e-12) extreme++;
      return;
    }
    for (let i = start; i < n; i++) pick(i + 1, [...chosen, i]);
  };
  pick(0, []);
  return extreme / total;
}

const chains = {};
for (const r of rows) (chains[r.chain] ??= { arm: r.arm, steps: {} }).steps[r.step] = r;
const complete = Object.entries(chains).filter(([, c]) => Object.keys(c.steps).length === STEPS);
const arm = (a) => complete.filter(([, c]) => c.arm === a).map(([, c]) => c);
const mean = (x) => x.reduce((s, v) => s + v, 0) / (x.length || 1);
const pct = (x) => `${(100 * x).toFixed(1)}`;

console.log(`complete chains: bare ${arm("bare").length}, carja ${arm("carja").length} (of ${Object.keys(chains).length} started), ${STEPS} steps`);
console.log(`\nCumulative share of hidden tests passed (features 1..k), mean over chains:`);
console.log(`step  bare   carja  diff`);
for (let k = 1; k <= STEPS; k++) {
  const b = mean(arm("bare").map((c) => c.steps[k].cumulative)), c = mean(arm("carja").map((c) => c.steps[k].cumulative));
  console.log(`${String(k).padStart(4)}  ${pct(b).padStart(5)}  ${pct(c).padStart(5)}  ${(c - b >= 0 ? "+" : "") + pct(c - b)}`);
}

const final = (a) => arm(a).map((c) => c.steps[STEPS].cumulative);
const widen = (a) => arm(a).map((c) => c.steps[STEPS].cumulative - c.steps[2].cumulative);
const dFinal = mean(final("carja")) - mean(final("bare"));
const pFinal = permutation(final("bare"), final("carja"));
const dWiden = mean(widen("carja")) - mean(widen("bare"));
const pWiden = permutation(widen("bare"), widen("carja"));
console.log(`\nPrimary (step ${STEPS}, all features): carja − bare = ${pct(dFinal)} points, exact permutation p = ${pFinal.toFixed(3)}`);
console.log(`  per chain: bare ${final("bare").map(pct).join(", ")} | carja ${final("carja").map(pct).join(", ")}`);
console.log(`Growth (step ${STEPS} minus step 2, per chain): carja − bare = ${pct(dWiden)} points, exact permutation p = ${pWiden.toFixed(3)}`);

// Earlier features kept working: share of features 1..k−1 passing after step k, mean over steps 2..N.
const kept = (a) => arm(a).map((c) => mean(Array.from({ length: STEPS - 1 }, (_, i) => c.steps[i + 2].previous)));
console.log(`Earlier features still passing (mean over steps 2..${STEPS}): bare ${pct(mean(kept("bare")))}, carja ${pct(mean(kept("carja")))}`);
const cur = (a) => arm(a).map((c) => mean(Array.from({ length: STEPS }, (_, i) => c.steps[i + 1].current)));
console.log(`New feature passing at its own step (mean): bare ${pct(mean(cur("bare")))}, carja ${pct(mean(cur("carja")))}`);

const sum = (a, f) => arm(a).reduce((s, c) => s + Object.values(c.steps).reduce((q, r) => q + (f(r) || 0), 0), 0);
const cb = sum("bare", (r) => r.costUsd), cc = sum("carja", (r) => r.costUsd);
const wb = sum("bare", (r) => r.wallMs), wc = sum("carja", (r) => r.wallMs);
console.log(`\nCost: list price bare $${cb.toFixed(2)}, carja $${cc.toFixed(2)} (${(cc / cb).toFixed(2)}×); wall time ${(wc / wb).toFixed(2)}×`);
console.log(`Capped sessions: bare ${sum("bare", (r) => r.capped ? 1 : 0)}, carja ${sum("carja", (r) => r.capped ? 1 : 0)}; sessions leaving uncommitted work: bare ${sum("bare", (r) => r.uncommitted ? 1 : 0)}, carja ${sum("carja", (r) => r.uncommitted ? 1 : 0)}`);
const wf = arm("carja").flatMap((c) => Object.values(c.steps));
console.log(`Carja sessions that read spec-it: ${wf.filter((r) => r.workflowsRead.includes("spec-it")).length}/${wf.length}, build: ${wf.filter((r) => r.workflowsRead.includes("build")).length}/${wf.length}, started a subagent: ${wf.filter((r) => r.subagents > 0).length}/${wf.length}`);
const met = dFinal >= 0.1 && pFinal < 0.05;
console.log(`\nDecision rule (primary ≥ +10 points and p < 0.05): ${met ? "MET" : "not met"}`);
