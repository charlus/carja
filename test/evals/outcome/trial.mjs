#!/usr/bin/env node
// Outcome eval (Q3), step 2: prepare the arms, run trials, grade them.
// Pre-registration: docs/roadmap/Outcome-Eval.md. Everything project-specific
// comes from the PRIVATE work folder (task-check output + pilot manifest);
// nothing private is written into this repository.
//
//   node trial.mjs prompt  --work <dir> --task T1                 print the task prompt
//   node trial.mjs prepare --work <dir> --carja <7.1.0 checkout>  build one template per task and arm
//   node trial.mjs run     --work <dir> --plan <plan.json> [--parallel 3] [--limit N]
//
// A plan is [{task, arm: "bare"|"carja", label, run}]. `label` names the arm in
// the results (the noise floor runs two labels of the same arm). Each trial is
// a copy of its template under <work>/runs/; results append to <work>/results.jsonl.

import { spawn, spawnSync } from "node:child_process";
import { appendFileSync, cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync, copyFileSync, createWriteStream } from "node:fs";
import { dirname, join, basename } from "node:path";
import { pytest } from "./task-check-lib.mjs";

const arg = (k, d = null) => { const i = process.argv.indexOf(`--${k}`); return i > 0 ? process.argv[i + 1] : d; };
const CMD = process.argv[2];
const WORK = arg("work");
if (!WORK || WORK.startsWith("/tmp/claude-")) { console.error("--work <dir>, never under /tmp/claude-*"); process.exit(2); }
const MIRROR = join(WORK, "mirror.git");
const VENV = join(WORK, "venv");
const MODEL = arg("model", "claude-sonnet-5-5");
const CAP_MS = Number(arg("cap-minutes", "45")) * 60_000;
const SANDBOX = arg("sandbox", join(dirname(new URL(import.meta.url).pathname), "../../../templates/.agents/sandbox/claude-sandbox.settings.json"));
const tasks = JSON.parse(readFileSync(join(WORK, "pilot-tasks.json"), "utf8"));
const check = (id) => JSON.parse(readFileSync(join(WORK, "tasks", id, "check.json"), "utf8"));
const run = (cmd, args, cwd, extra = {}) => spawnSync(cmd, args, { cwd, encoding: "utf8", maxBuffer: 256 << 20, ...extra });
const git = (cwd, ...a) => run("git", ["-c", "user.name=q3", "-c", "user.email=q3@local", ...a], cwd);

// The backlog entry "- [ ] **ID: …" and its indented continuation lines.
function backlogEntries(text, ids) {
  const lines = text.split("\n"), out = [];
  for (const id of ids) {
    const i = lines.findIndex((l) => new RegExp(`^- \\[[ x]\\] \\*\\*${id.replace("-", "\\-")}\\b`).test(l));
    if (i < 0) throw new Error(`backlog entry ${id} not found`);
    let j = i + 1;
    while (j < lines.length && !/^(- \[|#)/.test(lines[j])) j++;
    out.push(lines.slice(i, j).join("\n").trimEnd());
  }
  return out.join("\n\n");
}

export function prompt(id) {
  const t = tasks.find((x) => x.id === id), base = check(id).base;
  const show = (p) => { const r = git(MIRROR, "show", `${base}:${p}`); if (r.status !== 0) throw new Error(`${p} missing at ${base}`); return r.stdout; };
  let s = `Implement the following in this repository.\n\n${t.item}\n`;
  if (t.backlog) s += `\n${backlogEntries(show(t.backlog.file), t.backlog.ids)}\n`;
  if (t.interface?.length) s += `\nThe acceptance tests call these names, so use them exactly (names and signatures only; the behaviour is yours to get right):\n${t.interface.map((x) => `- ${x}`).join("\n")}\n`;
  if (t.docs?.length) {
    s += `\nReference documents, verbatim as of this commit:\n`;
    for (const p of t.docs) s += `\n===== ${p.split("/").slice(-2).join("/")} =====\n${show(p)}\n`;
  }
  s += `\nCommit your work when you are done.\n`;
  return s;
}

// Files that make a tree a Carja install (any version): removed in the bare arm.
const CARJA_PATHS = [".agents", ".claude", "conductor", "carja", "AGENTS.md", "CLAUDE.md", "GEMINI.md", "conductor.config.json", "carja.config.json"];

function prepare(carjaCheckout) {
  const bin = join(carjaCheckout, "bin/carja.js");
  const version = JSON.parse(readFileSync(join(carjaCheckout, "package.json"), "utf8")).version;
  for (const t of tasks) {
    const base = check(t.id).base;
    for (const arm of ["bare", "carja"]) {
      const dir = join(WORK, "templates", `${t.id}-${arm}`);
      rmSync(dir, { recursive: true, force: true });
      mkdirSync(dirname(dir), { recursive: true });
      if (run("git", ["clone", "-q", "--no-checkout", MIRROR, dir]).status !== 0) throw new Error("clone failed");
      git(dir, "checkout", "-q", "-B", "work", base);
      git(dir, "remote", "remove", "origin");                 // nothing to push to, in either arm
      git(dir, "config", "user.name", "q3"); git(dir, "config", "user.email", "q3@local");
      if (arm === "bare") {
        git(dir, "rm", "-r", "-q", "--ignore-unmatch", ...CARJA_PATHS);
        for (const p of CARJA_PATHS) rmSync(join(dir, p), { recursive: true, force: true });
        git(dir, "commit", "-q", "-m", "bare arm: no Carja");
      } else {
        const r = run("node", [bin, "upgrade", "."], dir);
        if (r.status !== 0) throw new Error(`upgrade failed for ${t.id}: ${r.stdout}\n${r.stderr}`);
        const h = run("node", [bin, "install-hooks"], dir);
        if (h.status !== 0) throw new Error(`install-hooks failed for ${t.id}: ${h.stderr}`);
        git(dir, "checkout", "-q", "-B", "work");
        const v = JSON.parse(readFileSync(join(dir, ".agents/.carja-version.json"), "utf8")).frameworkVersion;
        if (v !== version) throw new Error(`${t.id}: installed ${v}, expected ${version}`);
      }
      if (git(dir, "status", "--porcelain").stdout.trim()) throw new Error(`${t.id}-${arm}: template not clean`);
      run("ln", ["-s", VENV, join(dir, ".venv")]);
      appendFileSync(join(dir, ".git/info/exclude"), "\n.venv\n.q3-*\n");
      console.log(`${t.id}-${arm}: ready at ${git(dir, "rev-parse", "--short", "HEAD").stdout.trim()}`);
    }
  }
}

function grade(dir, id, start = "HEAD") {
  const c = check(id);
  const status = git(dir, "status", "--porcelain").stdout.trim();
  git(dir, "add", "-A", "-N");
  writeFileSync(join(dir, ".q3-diff.patch"), git(dir, "diff", start, "--", ".", ":!.agents", ":!carja", ":!.claude").stdout);
  // The hidden tests replace whatever the arm wrote at the same paths.
  for (const p of c.hiddenFiles) { mkdirSync(dirname(join(dir, p)), { recursive: true }); copyFileSync(join(WORK, "tasks", id, "hidden", p), join(dir, p)); }
  const res = pytest(dir);
  const hiddenFailed = c.hiddenIds.filter((x) => res[x] !== "pass");
  const regressionFailed = c.regression.filter((x) => x in res && res[x] !== "pass");
  return {
    hiddenPassed: c.hiddenIds.length - hiddenFailed.length, hiddenTotal: c.hiddenIds.length,
    regressionFailed: regressionFailed.length, regressionTotal: c.regression.length,
    pass: hiddenFailed.length === 0 && regressionFailed.length === 0,
    uncommitted: status.length > 0, hiddenFailedIds: hiddenFailed.slice(0, 20), regressionFailedIds: regressionFailed.slice(0, 20),
  };
}

function trial({ task, arm, label, run: n }) {
  return new Promise((resolve) => {
    const dir = join(WORK, "runs", `${task}-${label}-${n}`);
    rmSync(dir, { recursive: true, force: true });
    cpSync(join(WORK, "templates", `${task}-${arm}`), dir, { recursive: true, verbatimSymlinks: true });
    const start = git(dir, "rev-parse", "HEAD").stdout.trim();
    const argv = ["-p", "--output-format", "stream-json", "--verbose", "--permission-mode", "acceptEdits",
      "--model", MODEL, "--settings", SANDBOX, "--strict-mcp-config", "--", prompt(task)];
    const t0 = Date.now();
    const log = createWriteStream(join(dir, ".q3-transcript.jsonl"));
    const p = spawn("claude", argv, { cwd: dir, stdio: ["ignore", "pipe", "pipe"] });
    let last = "", capped = false;
    p.stdout.on("data", (b) => { log.write(b); last = (last + b.toString()).split("\n").slice(-50).join("\n"); });
    p.stderr.on("data", (b) => log.write(b));
    const timer = setTimeout(() => { capped = true; p.kill("SIGTERM"); setTimeout(() => p.kill("SIGKILL"), 10_000); }, CAP_MS);
    p.on("close", (code) => {
      clearTimeout(timer); log.end();
      const result = last.split("\n").reverse().map((l) => { try { return JSON.parse(l); } catch { return null; } }).find((o) => o?.type === "result") || {};
      const g = grade(dir, task, start);
      const commits = Number(git(dir, "rev-list", "--count", `${start}..HEAD`).stdout.trim());
      const row = { ts: new Date().toISOString(), task, arm, label, run: n, model: MODEL, exit: code, capped,
        wallMs: Date.now() - t0, turns: result.num_turns ?? null, costUsd: result.total_cost_usd ?? null,
        usage: result.usage ?? null, subtype: result.subtype ?? null, commits, ...g };
      appendFileSync(join(WORK, "results.jsonl"), JSON.stringify(row) + "\n");
      console.log(`${task} ${label} #${n}: ${g.pass ? "PASS" : "fail"} hidden ${g.hiddenPassed}/${g.hiddenTotal}, regression broken ${g.regressionFailed}, ${Math.round(row.wallMs / 60000)} min, ${row.turns} turns${capped ? ", CAPPED" : ""}${code ? `, exit ${code}` : ""}`);
      resolve(row);
    });
  });
}

async function runPlan(plan, parallel, limit) {
  const done = new Set(existsSync(join(WORK, "results.jsonl"))
    ? readFileSync(join(WORK, "results.jsonl"), "utf8").split("\n").filter(Boolean).map((l) => { const r = JSON.parse(l); return `${r.task}-${r.label}-${r.run}`; }) : []);
  const todo = plan.filter((x) => !done.has(`${x.task}-${x.label}-${x.run}`)).slice(0, limit ?? Infinity);
  console.log(`${todo.length} trials to run (${done.size} already done), ${parallel} at a time, model ${MODEL}`);
  let i = 0;
  await Promise.all(Array.from({ length: parallel }, async () => { while (i < todo.length) await trial(todo[i++]); }));
}

// The grader's own check: an untouched tree must fail, and the same tree with
// the reference implementation copied in must pass, in both arms.
function control() {
  let bad = 0;
  for (const t of tasks) {
    const c = check(t.id);
    for (const arm of ["bare", "carja"]) {
      for (const withRef of [false, true]) {
        const dir = join(WORK, "runs", `control-${t.id}-${arm}-${withRef ? "ref" : "none"}`);
        rmSync(dir, { recursive: true, force: true });
        cpSync(join(WORK, "templates", `${t.id}-${arm}`), dir, { recursive: true, verbatimSymlinks: true });
        if (withRef) for (const p of c.implFiles) {
          const src = join(WORK, "tasks", t.id, "reference", p);
          if (existsSync(src)) { mkdirSync(dirname(join(dir, p)), { recursive: true }); copyFileSync(src, join(dir, p)); } else rmSync(join(dir, p), { force: true });
        }
        const g = grade(dir, t.id);
        const ok = g.pass === withRef;
        if (!ok) bad++;
        console.log(`${t.id} ${arm} ${withRef ? "reference" : "untouched"}: ${g.pass ? "PASS" : "fail"} (hidden ${g.hiddenPassed}/${g.hiddenTotal}, regression broken ${g.regressionFailed}) ${ok ? "" : "<-- WRONG " + JSON.stringify(g.regressionFailedIds.slice(0, 3))}`);
        rmSync(dir, { recursive: true, force: true });
      }
    }
  }
  process.exit(bad ? 1 : 0);
}

if (CMD === "control") control();
else if (CMD === "prompt") process.stdout.write(prompt(arg("task")));
else if (CMD === "prepare") prepare(arg("carja"));
else if (CMD === "run") await runPlan(JSON.parse(readFileSync(arg("plan"), "utf8")), Number(arg("parallel", "3")), arg("limit") ? Number(arg("limit")) : null);
else { console.error("commands: prompt | prepare | run"); process.exit(2); }
