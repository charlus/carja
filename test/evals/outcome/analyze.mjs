#!/usr/bin/env node
// Outcome eval (Q3): the pre-registered analysis (docs/roadmap/Outcome-Eval.md,
// "Analysis" and "Pilot and stop rules"). Written and committed before any
// pilot result existed. Reads <work>/results.jsonl; prints the report.
//
//   node analyze.mjs --work <dir> [--json]

import { readFileSync } from "node:fs";
import { join } from "node:path";

const arg = (k, d = null) => { const i = process.argv.indexOf(`--${k}`); return i > 0 ? process.argv[i + 1] : d; };
const rows = readFileSync(join(arg("work"), "results.jsonl"), "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l)).filter((r) => !r.infra);

// Exact two-sided binomial test on the discordant pairs (McNemar's exact test).
export function mcnemarExact(b, c) {
  const n = b + c;
  if (n === 0) return 1;
  const k = Math.min(b, c);
  let lnC = 0, p = 0;
  for (let i = 0; i <= n; i++) {
    if (i > 0) lnC += Math.log(n - i + 1) - Math.log(i);
    if (i <= k) p += Math.exp(lnC - n * Math.LN2);
  }
  return Math.min(1, 2 * p);
}

// Seeded resampling, so the report is reproducible.
function rng(seed) { let a = seed | 0; return () => { a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
function bootstrap(items, stat, n = 10000, seed = 20261105) {
  const r = rng(seed), out = [];
  for (let i = 0; i < n; i++) { const s = items.map(() => items[Math.floor(r() * items.length)]); const v = stat(s); if (Number.isFinite(v)) out.push(v); }
  out.sort((a, b) => a - b);
  return [out[Math.floor(0.025 * out.length)], out[Math.floor(0.975 * out.length)]];
}

const pairsOf = (la, lb) => {
  const by = new Map(rows.map((r) => [`${r.task}|${r.label}|${r.run}`, r]));
  const out = [];
  for (const r of rows) if (r.label === la) { const o = by.get(`${r.task}|${lb}|${r.run}`); if (o) out.push({ task: r.task, run: r.run, a: r, b: o }); }
  return out;
};
const tokens = (r) => { const u = r.usage || {}; return (u.input_tokens || 0) + (u.cache_creation_input_tokens || 0) + (u.cache_read_input_tokens || 0) + (u.output_tokens || 0); };
const pct = (x) => `${(100 * x).toFixed(0)}%`;

function compare(la, lb) {
  const P = pairsOf(la, lb);
  const n = P.length;
  const passA = P.filter((p) => p.a.pass).length, passB = P.filter((p) => p.b.pass).length;
  const b = P.filter((p) => p.a.pass && !p.b.pass).length, c = P.filter((p) => !p.a.pass && p.b.pass).length;
  const diff = (passB - passA) / (n || 1);
  const diffCI = bootstrap(P, (s) => (s.filter((p) => p.b.pass).length - s.filter((p) => p.a.pass).length) / s.length);
  const ratio = (f) => (s) => s.reduce((x, p) => x + (f(p.b) || 0), 0) / s.reduce((x, p) => x + (f(p.a) || 0), 0);
  const cost = {};
  for (const [name, f] of [["turns", (r) => r.turns], ["tokens", tokens], ["wall time", (r) => r.wallMs], ["list price", (r) => r.costUsd]]) {
    cost[name] = { ratio: ratio(f)(P), ci: bootstrap(P, ratio(f)) };
  }
  const frac = (s, k) => s.reduce((x, p) => x + p[k].hiddenPassed / p[k].hiddenTotal, 0) / (s.length || 1);
  const perTask = {};
  for (const p of P) { const t = (perTask[p.task] ??= { [la]: 0, [lb]: 0, n: 0 }); t[la] += p.a.pass; t[lb] += p.b.pass; t.n++; }
  return { n, passA, passB, rateA: passA / (n || 1), rateB: passB / (n || 1), discordant: { [`${la} only`]: b, [`${lb} only`]: c }, p: mcnemarExact(b, c), diff, diffCI, hiddenFraction: { [la]: frac(P, "a"), [lb]: frac(P, "b") }, cost, perTask,
    capped: { [la]: P.filter((p) => p.a.capped).length, [lb]: P.filter((p) => p.b.capped).length } };
}

const noise = compare("bareA", "bareB");
const pilot = compare("bare", "carja");

// Pre-registered stop rules.
const stops = [];
if (pilot.rateA >= 0.9 && pilot.rateB >= 0.9) stops.push("ceiling: both arms pass at least 90%");
if (pilot.rateA <= 0.1 && pilot.rateB <= 0.1) stops.push("floor: both arms pass at most 10%");
if (Math.abs(pilot.diff) <= Math.abs(noise.diff)) stops.push(`noise: the pilot's difference (${pct(pilot.diff)}) is not above the noise floor's (${pct(noise.diff)})`);

if (process.argv.includes("--json")) { console.log(JSON.stringify({ noise, pilot, stops }, null, 1)); process.exit(0); }

const show = (title, r, la, lb) => {
  console.log(`\n${title}: ${r.n} pairs`);
  console.log(`  pass rate   ${la} ${pct(r.rateA)} (${r.passA}/${r.n})   ${lb} ${pct(r.rateB)} (${r.passB}/${r.n})`);
  console.log(`  difference  ${pct(r.diff)}  95% interval [${pct(r.diffCI[0])}, ${pct(r.diffCI[1])}]`);
  console.log(`  discordant  ${JSON.stringify(r.discordant)}   McNemar exact p = ${r.p.toFixed(3)}`);
  console.log(`  hidden tests passed (mean fraction)  ${la} ${pct(r.hiddenFraction[la])}   ${lb} ${pct(r.hiddenFraction[lb])}`);
  for (const [k, v] of Object.entries(r.cost)) console.log(`  ${k.padEnd(10)}  ${lb}/${la} = ${v.ratio.toFixed(2)}x  [${v.ci[0]?.toFixed(2)}, ${v.ci[1]?.toFixed(2)}]`);
  console.log(`  capped at the time limit  ${JSON.stringify(r.capped)}`);
  console.log(`  per task (passes out of runs): ${Object.entries(r.perTask).map(([t, v]) => `${t} ${v[la]}-${v[lb]}/${v.n}`).join(", ")}`);
};
show("Noise floor (bare against bare)", noise, "bareA", "bareB");
show("Pilot (bare against carja)", pilot, "bare", "carja");
console.log(`\nStop rules: ${stops.length ? stops.join("; ") : "none triggered: size the confirmatory run from the discordant-pair rate"}`);
