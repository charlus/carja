// test/evals/reviewer-recall/run.mjs
//
// F10 (docs/roadmap/Risk-Tiered-Merge.md): the reviewer measured on the bugs
// that mattered in a real repository. Cases come from its history
// (src/reviewer-recall.js harvestCases): each commit later reverted or fixed
// (`Fixes: <sha>`), and one size-matched clean commit per incident as the
// control. The reviewer gets reviewer.md and the commit's diff in a fresh
// `claude -p`, at the commit, with no access to what came after. A finding
// counts when it lands where the fix changed the code.
//
// Gated behind CARJA_EVALS=1: every case is a real model call.
//   CARJA_EVALS=1 node test/evals/reviewer-recall/run.mjs --repo ~/Workspace/<project> [--max 10] [--model <id>]
//   CARJA_EVALS=1 node test/evals/reviewer-recall/run.mjs --repo <dir> --harvest-only
// Writes test/evals/reviewer-recall/last-run.json. Keep a reviewer change only
// when recall goes up and control_blocked does not.

import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { harvestCases, parseReviewerReport, scoreRun } from "../../../src/reviewer-recall.js";

const arg = (name, dflt = null) => {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : dflt;
};
const repo = arg("--repo") ? resolve(arg("--repo")) : null;
if (!repo) {
  console.error("Usage: CARJA_EVALS=1 node test/evals/reviewer-recall/run.mjs --repo <dir> [--max N] [--model id] [--harvest-only]");
  process.exit(1);
}
const max = Number(arg("--max", "20"));
const all = harvestCases(repo);
const cases = [...all.filter((c) => c.kind === "incident").slice(0, max), ...all.filter((c) => c.kind === "control").slice(0, max)];
console.log(`${repo}: ${cases.filter((c) => c.kind === "incident").length} incident(s), ${cases.filter((c) => c.kind === "control").length} control(s).`);
if (process.argv.includes("--harvest-only")) {
  for (const c of cases) console.log(`  ${c.kind.padEnd(8)} ${c.bad.slice(0, 10)}  ${c.key ?? ""}`);
  process.exit(0);
}
if (process.env.CARJA_EVALS !== "1") {
  console.log("Skipped: set CARJA_EVALS=1 to run (one real reviewer call per case).");
  process.exit(0);
}

const brief = readFileSync(new URL("../../../templates/.agents/skills/independent-review/reviewer.md", import.meta.url), "utf8");
const results = [];
for (const c of cases) {
  const wt = mkdtempSync(join(tmpdir(), "recall-wt-"));
  try {
    execFileSync("git", ["-C", repo, "worktree", "add", "-q", "--detach", wt, c.bad], { stdio: "ignore" });
    const subject = execFileSync("git", ["-C", repo, "log", "-1", "--format=%s%n%n%b", c.bad]).toString();
    const prompt = `${brief}\n\n---\n\n# The change under review\n\nIts commit message is the definition of done:\n\n${subject}\n\nThe diff is \`git diff ${c.base}...${c.bad}\` in this folder. Write your report in the shape above.`;
    const model = arg("--model");
    const r = spawnSync("claude", ["-p", prompt, ...(model ? ["--model", model] : []), "--allowedTools", "Read,Grep,Glob,Bash(git diff:*),Bash(git show:*),Bash(git log:*)"], { cwd: wt, encoding: "utf8", timeout: 600000 });
    const findings = parseReviewerReport(r.stdout);
    results.push({ ...c, findings, exit: r.status });
    console.log(`  ${c.kind.padEnd(8)} ${c.bad.slice(0, 10)}  ${findings.length} finding(s)`);
  } finally {
    spawnSync("git", ["-C", repo, "worktree", "remove", "--force", wt]);
    rmSync(wt, { recursive: true, force: true });
  }
}
const score = scoreRun(results);
console.log(JSON.stringify(score, null, 2));
writeFileSync(new URL("./last-run.json", import.meta.url), JSON.stringify({ repo, at: new Date().toISOString(), score, results }, null, 2));
