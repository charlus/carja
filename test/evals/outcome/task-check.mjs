#!/usr/bin/env node
// Outcome eval (Q3), step 2: the task check. Pre-registration:
// docs/roadmap/Outcome-Eval.md, "Tasks".
//
// For each task of a PRIVATE manifest (JSON: [{id, commits}]), in a work
// folder outside the repository (never under /tmp/claude-*):
//   base       the parent of the task's first commit
//   reference  the base plus the task's commits, cherry-picked in order
//   hidden     the test files those commits touched, as in the reference
//   hiddenIds  the test ids that FAIL on base+hidden and PASS on the reference
//   regression the test ids that pass on the pristine base
// A task passes the check when it has at least one hidden id.
//
// The project here is pytest-based; the runner is the only project-specific part.
//
// Usage: node task-check.mjs --work <dir> --mirror <bare repo> --manifest <json>
//                            --python <venv python> [--only T1,T2]

import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync, copyFileSync, symlinkSync } from "node:fs";
import { dirname, join } from "node:path";
import { pytest } from "./task-check-lib.mjs";

const arg = (k, d = null) => { const i = process.argv.indexOf(`--${k}`); return i > 0 ? process.argv[i + 1] : d; };
const WORK = arg("work"), MIRROR = arg("mirror"), PY = arg("python");
const tasks = JSON.parse(readFileSync(arg("manifest"), "utf8"));
const only = arg("only") ? new Set(arg("only").split(",")) : null;
if (!WORK || !MIRROR || !PY) { console.error("usage: see header"); process.exit(2); }
if (WORK.startsWith("/tmp/claude-")) { console.error("refusing a work folder under /tmp/claude-*"); process.exit(2); }

const run = (cmd, args, cwd, extra = {}) =>
  spawnSync(cmd, args, { cwd, encoding: "utf8", maxBuffer: 256 << 20, ...extra });
const git = (cwd, ...a) => run("git", ["-c", "user.name=q3", "-c", "user.email=q3@local", ...a], cwd);
const isTest = (p) => /(^|\/)tests?\//.test(p) || /(^|\/)test_[^/]*\.py$/.test(p) || p === "conftest.py";

export function worktree(dir, rev) {
  if (existsSync(dir)) { git(MIRROR, "worktree", "remove", "--force", dir); rmSync(dir, { recursive: true, force: true }); }
  const r = git(MIRROR, "worktree", "add", "--detach", "-q", dir, rev);
  if (r.status !== 0) throw new Error(r.stderr);
  symlinkSync(dirname(dirname(PY)), join(dir, ".venv"));
}

const summary = [];
for (const t of tasks) {
  if (only && !only.has(t.id)) continue;
  const dir = join(WORK, "tasks", t.id);
  mkdirSync(dir, { recursive: true });
  // Topological order, oldest first; the base is the first commit's parent.
  const full = t.commits.map((c) => git(MIRROR, "rev-parse", c).stdout.trim());
  const commits = full.slice().sort((a, b) => git(MIRROR, "merge-base", "--is-ancestor", a, b).status === 0 ? -1 : 1);
  const base = `${commits[0]}^`;
  const out = { id: t.id, base: git(MIRROR, "rev-parse", base).stdout.trim(), commits, dropped: null };

  // Reference: base + the task's commits.
  const ref = join(dir, "reference");
  worktree(ref, base);
  const isState = (p) => /^(carja|conductor)\//.test(p);
  const touched = [...new Set(commits.flatMap((c) => git(MIRROR, "diff-tree", "--no-commit-id", "--name-only", "-r", c).stdout.split("\n").filter(Boolean)))].filter((p) => !isState(p));
  out.mode = "cherry-pick";
  for (const c of commits) {
    if (git(ref, "cherry-pick", "-x", c).status === 0) continue;
    const conflicted = git(ref, "diff", "--name-only", "--diff-filter=U").stdout.split("\n").filter(Boolean);
    if (conflicted.every(isState)) {
      // Carja's own state files (task trackers, backlog): keep the base side.
      git(ref, "checkout", "--ours", "--", ...conflicted);
      git(ref, "add", "--", ...conflicted);
      if (git(ref, "-c", "core.editor=true", "cherry-pick", "--continue").status === 0) continue;
    }
    // Other commits of the same area landed between the task's commits:
    // take the task's files as they are at its last commit (range mode).
    git(ref, "cherry-pick", "--abort");
    git(ref, "reset", "-q", "--hard", base);
    const last = commits[commits.length - 1];
    const present = touched.filter((p) => git(MIRROR, "cat-file", "-e", `${last}:${p}`).status === 0);
    const gone = touched.filter((p) => !present.includes(p));
    if (present.length) git(ref, "checkout", last, "--", ...present);
    for (const p of gone) rmSync(join(ref, p), { force: true });
    git(ref, "add", "-A", "--", ...touched);
    git(ref, "commit", "-q", "-m", `range mode: ${t.id} files at ${last.slice(0, 7)}`);
    out.mode = "range";
    out.between = git(MIRROR, "log", "--format=%h %s", `${commits[0]}^..${last}`, "--", ...touched).stdout.split("\n").filter(Boolean)
      .filter((l) => !commits.some((c) => c.startsWith(l.split(" ")[0])));
    break;
  }
  out.hiddenFiles = touched.filter(isTest).filter((p) => existsSync(join(ref, p)));
  out.implFiles = touched.filter((p) => !isTest(p));

  if (!out.dropped) {
    // Save the hidden files as the reference has them.
    for (const p of out.hiddenFiles) { mkdirSync(dirname(join(dir, "hidden", p)), { recursive: true }); copyFileSync(join(ref, p), join(dir, "hidden", p)); }

    // Base + hidden test files: what the task must turn green.
    const bh = join(dir, "base-hidden");
    worktree(bh, base);
    for (const p of out.hiddenFiles) { mkdirSync(dirname(join(bh, p)), { recursive: true }); copyFileSync(join(dir, "hidden", p), join(bh, p)); }
    const targets = out.hiddenFiles.filter((p) => /\.py$/.test(p) && !/conftest\.py$/.test(p));
    const atBase = pytest(bh, targets);
    const atRef = pytest(ref, targets);
    out.hiddenIds = Object.keys(atRef).filter((id) => atRef[id] === "pass" && atBase[id] !== "pass");
    out.refFailing = Object.keys(atRef).filter((id) => atRef[id] === "fail");

    // Regression set: what passes on the pristine base, and still passes on the reference.
    const pb = join(dir, "base");
    worktree(pb, base);
    const baseAll = pytest(pb);
    const refAll = pytest(ref);
    out.regression = Object.keys(baseAll).filter((id) => baseAll[id] === "pass" && refAll[id] === "pass");
    out.regressionBrokenByRef = Object.keys(baseAll).filter((id) => baseAll[id] === "pass" && refAll[id] === "fail");
    if (out.hiddenIds.length === 0) out.dropped = "no test fails at the base and passes on the reference";
  }
  writeFileSync(join(dir, "check.json"), JSON.stringify(out, null, 1));
  const line = `${t.id}: ${out.dropped ? `DROPPED (${out.dropped})` : `ok (${out.mode}${out.between?.length ? `, +${out.between.length} commits between` : ""}), ${out.hiddenIds.length} hidden ids, ${out.regression.length} regression ids` + (out.refFailing.length ? `, ${out.refFailing.length} failing on the reference` : "") + (out.regressionBrokenByRef.length ? `, ${out.regressionBrokenByRef.length} regression ids broken by the reference` : "")}`;
  console.log(line);
  summary.push(line);
}
writeFileSync(join(WORK, "task-check.txt"), summary.join("\n") + "\n");
