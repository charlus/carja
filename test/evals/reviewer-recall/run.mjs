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
// --cases <last-run.json>: the same cases as an earlier run, so only the model or the context changes.
const all = arg("--cases") ? JSON.parse(readFileSync(resolve(arg("--cases")), "utf8")).results.map(({ findings, exit, ...c }) => c) : harvestCases(repo);
const cases = [...all.filter((c) => c.kind === "incident").slice(0, max), ...all.filter((c) => c.kind === "control").slice(0, max)];
console.log(`${repo}: ${cases.filter((c) => c.kind === "incident").length} incident(s), ${cases.filter((c) => c.kind === "control").length} control(s).`);
if (process.argv.includes("--harvest-only")) {
  for (const c of cases) console.log(`  ${c.kind.padEnd(8)} ${c.bad.slice(0, 10)}  ${c.key ?? ""}`);
  process.exit(0);
}
// --outer <dir>: the Carja folder of an outer layout. The reviewer gets it as it was on the
// commit's date (specs, architecture checklist), as a real review does, and nothing written later.
const outer = arg("--outer") ? resolve(arg("--outer")) : null;
const outerAt = (sha) => {
  if (!outer) return null;
  const when = execFileSync("git", ["-C", repo, "log", "-1", "--format=%cI", sha]).toString().trim();
  const head = execFileSync("git", ["-C", outer, "symbolic-ref", "--short", "refs/remotes/origin/HEAD"]).toString().trim();
  return execFileSync("git", ["-C", outer, "rev-list", "-1", `--before=${when}`, head]).toString().trim() || null;
};
const specNote = (dir) =>
  dir
    ? `\n\nThe project's Carja folder, as it was when this commit was written, is \`${dir}/carja/\`. Find the feature spec this commit implements under \`carja/2-backlog/\` (its acceptance criteria are the definition of done), and read \`carja/0-compass/architecture-checklist.md\` (rubric step 2). Read only; change nothing there.`
    : "";
if (process.argv.includes("--dry")) {
  const c = cases[0];
  console.log(`First case ${c.bad.slice(0, 10)}: outer commit ${outerAt(c.bad) ?? "(none)"}.${specNote("<outer worktree>")}`);
  process.exit(0);
}
if (process.env.CARJA_EVALS !== "1") {
  console.log("Skipped: set CARJA_EVALS=1 to run (one real reviewer call per case).");
  process.exit(0);
}

const brief = readFileSync(new URL("../../../templates/.agents/skills/independent-review/reviewer.md", import.meta.url), "utf8");
const results = [];
const cleanup = [];
for (const c of cases) {
  const wt = mkdtempSync(join(tmpdir(), "recall-wt-"));
  try {
    execFileSync("git", ["-C", repo, "worktree", "add", "-q", "--detach", wt, c.bad], { stdio: "ignore" });
    const subject = execFileSync("git", ["-C", repo, "log", "-1", "--format=%s%n%n%b", c.bad]).toString();
    let outerWt = null;
    const oc = outerAt(c.bad);
    if (oc) {
      outerWt = mkdtempSync(join(tmpdir(), "recall-outer-"));
      execFileSync("git", ["-C", outer, "worktree", "add", "-q", "--detach", outerWt, oc], { stdio: "ignore" });
    }
    const prompt = `${brief}\n\n---\n\n# The change under review\n\nIts commit message:\n\n${subject}\n\nThe diff is \`git diff ${c.base}...${c.bad}\` in this folder.${specNote(outerWt)} Write your report in the shape above.`;
    cleanup.push(() => {
      if (outerWt) {
        spawnSync("git", ["-C", outer, "worktree", "remove", "--force", outerWt]);
        rmSync(outerWt, { recursive: true, force: true });
      }
    });
    const model = arg("--model");
    const r = spawnSync("claude", ["-p", prompt, ...(model ? ["--model", model] : []), ...(outerWt ? ["--add-dir", outerWt] : []), "--allowedTools", "Read,Grep,Glob,Bash(git diff:*),Bash(git show:*),Bash(git log:*)"], { cwd: wt, encoding: "utf8", timeout: 900000 });
    const findings = parseReviewerReport(r.stdout);
    results.push({ ...c, findings, exit: r.status });
    console.log(`  ${c.kind.padEnd(8)} ${c.bad.slice(0, 10)}  ${findings.length} finding(s)`);
  } finally {
    while (cleanup.length) cleanup.pop()();
    spawnSync("git", ["-C", repo, "worktree", "remove", "--force", wt]);
    rmSync(wt, { recursive: true, force: true });
  }
}
const score = scoreRun(results);
console.log(JSON.stringify(score, null, 2));
writeFileSync(new URL("./last-run.json", import.meta.url), JSON.stringify({ repo, at: new Date().toISOString(), score, results }, null, 2));
