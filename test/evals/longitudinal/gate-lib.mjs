// Release gate: the pure part. A release passes when the longitudinal
// benchmark (carja arm, 5 chains x 8 features) holds quality and does not
// cost clearly more than the last release that passed on the same model and
// the same material. Thresholds are in THRESHOLDS; gate.mjs runs and records.

import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

export const THRESHOLDS = {
  chains: 5,
  steps: 8,
  meanFinal: 0.98, // mean share of all hidden tests passed after the last feature
  minFinal: 0.95, // every chain; one unwritten convention costs about 10 points
  meanKept: 0.98, // earlier features still passing, mean over steps 2..8
  costFail: 1.25, // mean cost per chain vs the baseline; 5 chains cannot see less
  costNote: 1.10,
};

const mean = (x) => x.reduce((s, v) => s + v, 0) / (x.length || 1);

// Rows of results.jsonl -> one summary per complete carja chain.
export function summarise(rows, steps = THRESHOLDS.steps) {
  const chains = {};
  for (const r of rows) if (r.arm === "carja") (chains[r.chain] ??= {})[r.step] = r;
  const out = [];
  for (const [chain, s] of Object.entries(chains)) {
    if (Object.keys(s).length !== steps) continue;
    const all = Object.values(s);
    out.push({
      chain,
      final: s[steps].cumulative,
      kept: mean(Array.from({ length: steps - 1 }, (_, i) => s[i + 2].previous)),
      costUsd: all.reduce((t, r) => t + (r.costUsd || 0), 0),
      wallMs: all.reduce((t, r) => t + (r.wallMs || 0), 0),
      reviewed: all.filter((r) => r.subagents > 0).length,
      capped: all.filter((r) => r.capped).length,
    });
  }
  return out.sort((a, b) => a.chain.localeCompare(b.chain));
}

// The last passing row on the same model and material is the cost baseline.
export function baselineFor(history, { model, fixture }) {
  return [...history].reverse().find((r) => r.verdict === "pass" && r.model === model && r.fixture === fixture) ?? null;
}

export function verdict(chains, baseline, t = THRESHOLDS) {
  const reasons = [], notes = [];
  if (chains.length < t.chains) return { verdict: "incomplete", reasons: [`${chains.length}/${t.chains} chains complete`], notes };
  const meanFinal = mean(chains.map((c) => c.final));
  const minFinal = Math.min(...chains.map((c) => c.final));
  const meanKept = mean(chains.map((c) => c.kept));
  const meanCost = mean(chains.map((c) => c.costUsd));
  const pct = (x) => `${(100 * x).toFixed(1)}%`;
  if (meanFinal < t.meanFinal) reasons.push(`quality: mean final ${pct(meanFinal)} < ${pct(t.meanFinal)}`);
  if (minFinal < t.minFinal) reasons.push(`quality: one chain at ${pct(minFinal)} < ${pct(t.minFinal)}`);
  if (meanKept < t.meanKept) reasons.push(`quality: earlier features kept ${pct(meanKept)} < ${pct(t.meanKept)}`);
  let costRatio = null;
  if (!baseline) notes.push("no baseline on this model and material: this run becomes the baseline");
  else {
    costRatio = meanCost / baseline.meanCost;
    const vs = `$${meanCost.toFixed(2)} vs $${baseline.meanCost.toFixed(2)} per chain (${baseline.version})`;
    if (costRatio > t.costFail) reasons.push(`cost: ${costRatio.toFixed(2)}x, ${vs}`);
    else if (costRatio > t.costNote) notes.push(`cost up ${costRatio.toFixed(2)}x, inside the noise of 5 chains: ${vs}`);
  }
  return { verdict: reasons.length ? "fail" : "pass", reasons, notes, meanFinal, minFinal, meanKept, meanCost, costRatio };
}

// Git tree hash of a folder as it is on disk (tracked and untracked, .gitignore
// applied). Equals `git rev-parse HEAD:<folder>` on a clean tree.
export function treeHash(repo, folder) {
  const tmp = mkdtempSync(join(tmpdir(), "carja-gate-"));
  try {
    const env = { ...process.env, GIT_INDEX_FILE: join(tmp, "index") };
    const add = spawnSync("git", ["add", "-A", "--", folder], { cwd: repo, env, encoding: "utf8" });
    if (add.status !== 0) throw new Error(add.stderr);
    const w = spawnSync("git", ["write-tree", `--prefix=${folder}/`], { cwd: repo, env, encoding: "utf8" });
    if (w.status !== 0) throw new Error(w.stderr);
    return w.stdout.trim();
  } finally { rmSync(tmp, { recursive: true, force: true }); }
}

export const readHistory = (file) => {
  try { return readFileSync(file, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l)); }
  catch (e) { if (e.code === "ENOENT") return []; throw e; }
};

// The templates on disk are covered when a row for exactly this tree passed or was waived.
export function covered(history, templates) {
  return history.find((r) => r.templates === templates && (r.verdict === "pass" || r.verdict === "waived")) ?? null;
}
