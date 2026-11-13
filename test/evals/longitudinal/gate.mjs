#!/usr/bin/env node
// Release gate (docs/roadmap/Outcome-Eval.md, "Release gate"). Runs the
// longitudinal benchmark on the carja arm of a committed Carja version, judges
// it against THRESHOLDS (gate-lib.mjs) and appends the verdict to
// releases.jsonl. test/release-gate.test.js fails while the templates/ on disk
// have no passing or waived row.
//
//   npm run eval:release                      # run on HEAD, about $25 and 1-2 h
//   npm run eval:release -- run --ref <sha> [--work <dir>] [--parallel 5]
//   npm run eval:release -- record --work <dir> [--ref <sha>]   # judge a finished run again
//   npm run eval:release -- status            # is the current templates/ covered?
//   npm run eval:release -- waive --reason "<why this change cannot move the result>"

import { spawnSync } from "node:child_process";
import { appendFileSync, existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { THRESHOLDS, summarise, verdict, baselineFor, treeHash, readHistory, covered } from "./gate-lib.mjs";

const HERE = dirname(new URL(import.meta.url).pathname);
const REPO = resolve(HERE, "../../..");
export const HISTORY = join(HERE, "releases.jsonl");
const FIXTURE_DIR = "test/evals/longitudinal/fixture";
const argv = process.argv.slice(2);
const CMD = argv[0] && !argv[0].startsWith("--") ? argv[0] : "run";
const arg = (k, d = null) => { const i = argv.indexOf(`--${k}`); return i >= 0 ? argv[i + 1] : d; };
const git = (...a) => {
  const r = spawnSync("git", a, { cwd: REPO, encoding: "utf8" });
  if (r.status !== 0) throw new Error(`git ${a.join(" ")}: ${r.stderr}`);
  return r.stdout.trim();
};

function describe(ref) {
  const sha = git("rev-parse", `${ref}^{commit}`);
  return { sha, templates: git("rev-parse", `${sha}:templates`), version: JSON.parse(git("show", `${sha}:package.json`)).version };
}

function record(work, ref, model) {
  const { sha, templates, version } = describe(ref);
  const fixture = treeHash(REPO, FIXTURE_DIR);
  const rows = readHistory(join(work, "results.jsonl"));
  const runModel = model ?? rows.find((r) => r.arm === "carja")?.model;
  const chains = summarise(rows);
  const history = readHistory(HISTORY);
  const base = baselineFor(history, { model: runModel, fixture });
  const v = verdict(chains, base);
  const row = { date: new Date().toISOString().slice(0, 10), version, ref: sha.slice(0, 12), templates, fixture, model: runModel,
    verdict: v.verdict, reasons: v.reasons, notes: v.notes, baseline: base?.version ?? null,
    meanFinal: v.meanFinal, minFinal: v.minFinal, meanKept: v.meanKept, meanCost: v.meanCost, costRatio: v.costRatio,
    chains: chains.map((c) => ({ ...c, costUsd: +c.costUsd.toFixed(4) })) };
  if (v.verdict !== "incomplete") appendFileSync(HISTORY, JSON.stringify(row) + "\n");
  console.log(`\n${version} (${row.ref}): ${v.verdict.toUpperCase()}`);
  for (const c of chains) console.log(`  ${c.chain}: final ${(100 * c.final).toFixed(1)}%, kept ${(100 * c.kept).toFixed(1)}%, $${c.costUsd.toFixed(2)}, ${Math.round(c.wallMs / 60000)} min, reviewed ${c.reviewed}/${THRESHOLDS.steps}${c.capped ? `, capped ${c.capped}` : ""}`);
  for (const r of v.reasons) console.log(`  FAIL ${r}`);
  for (const n of v.notes) console.log(`  note ${n}`);
  if (v.verdict === "incomplete") console.log(`  not recorded; resume with: npm run eval:release -- run --ref ${row.ref} --work ${work}`);
  return v.verdict === "pass";
}

async function runGate() {
  const { sha, version } = describe(arg("ref", "HEAD"));
  const work = resolve(arg("work", join(homedir(), ".cache/carja-release-gate", `${version}-${sha.slice(0, 8)}`)));
  if (work.startsWith("/tmp/claude-")) throw new Error("--work must be outside /tmp/claude-* (CLAUDE.md, Operating Truth 1)");
  const candidate = join(work, "candidate");
  if (!existsSync(candidate)) git("worktree", "add", "-q", "--detach", candidate, sha);
  const chain = await import("./chain.mjs");
  chain.useWork(work);
  chain.prepare(candidate, ["carja"]);
  if (!chain.control(["carja"])) throw new Error("grader control failed: the template passes tests or the reference does not pass all");
  const model = arg("model", chain.DEFAULT_MODEL);
  await chain.runChains(THRESHOLDS.chains, Number(arg("parallel", "5")), THRESHOLDS.steps, ["carja"]);
  const ok = record(work, sha, model);
  console.log(`\nWork folder kept: ${work}. Remove the candidate worktree with: git worktree remove ${candidate}`);
  return ok;
}

function status() {
  const templates = treeHash(REPO, "templates");
  const row = covered(readHistory(HISTORY), templates);
  if (row) console.log(`templates/ ${templates.slice(0, 12)}: ${row.verdict} (${row.version}, ${row.date})`);
  else console.log(`templates/ ${templates.slice(0, 12)}: NOT COVERED. Commit, then: npm run eval:release`);
  return !!row;
}

function waive(reason) {
  if (!reason) throw new Error('waive needs --reason "<why this change cannot move the result>"');
  const templates = treeHash(REPO, "templates");
  const version = JSON.parse(readFileSync(join(REPO, "package.json"), "utf8")).version;
  appendFileSync(HISTORY, JSON.stringify({ date: new Date().toISOString().slice(0, 10), version, templates, verdict: "waived", reason }) + "\n");
  console.log(`waived templates/ ${templates.slice(0, 12)} (${version}): ${reason}`);
  return true;
}

let ok;
if (CMD === "run") ok = await runGate();
else if (CMD === "record") ok = record(resolve(arg("work")), arg("ref", "HEAD"), arg("model"));
else if (CMD === "status") ok = status();
else if (CMD === "waive") ok = waive(arg("reason"));
else { console.error("commands: run | record | status | waive"); process.exit(2); }
process.exit(ok ? 0 : 1);
