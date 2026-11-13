#!/usr/bin/env node
// Longitudinal eval (docs/roadmap/Outcome-Eval.md, "Longitudinal benchmark
// pre-registration"). One product grown from an empty repository over a fixed
// sequence of feature requests, one fresh headless session per request, the
// repository the only thing carried from one session to the next. After each
// session, the hidden black-box tests of every feature are run against the
// chain; nothing is written into the chain by the grader.
//
// The work folder holds everything the agents must not see:
//   spec/brief.md, spec/f1.md … spec/fN.md   the requests, in order
//   hidden/conftest.py, hidden/test_fK.py    the acceptance tests per feature
//   reference/roombook/                      proves the tests are passable
//   venv/                                    Python with pytest, the only package
//   carja-preamble.md                        the carja arm's preamble
//
// The material is committed in fixture/ (spec, hidden, reference, preamble).
// `prepare` copies it into the work folder, makes the venv when missing, and
// builds the templates from the Carja checkout under test (the candidate).
//
//   node chain.mjs prepare --work <dir> --carja <candidate checkout> [--arms carja]
//   node chain.mjs control --work <dir> [--arms carja]
//   node chain.mjs prompt  --work <dir> --arm carja --step 1
//   node chain.mjs run     --work <dir> --chains 5 [--parallel 6] [--steps 8] [--arms carja]
//
// Results: <work>/results.jsonl, one row per (chain, step). The release gate
// (gate.mjs) runs the carja arm only and judges these rows.

import { spawn, spawnSync } from "node:child_process";
import { appendFileSync, cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, createWriteStream, symlinkSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { classifyBeatResult } from "../../../src/loop/driver.js";
import { parseResetTime } from "../../../src/loop/quota.js";

const arg = (k, d = null) => { const i = process.argv.indexOf(`--${k}`); return i > 0 ? process.argv[i + 1] : d; };
const HERE = dirname(new URL(import.meta.url).pathname);
export const FIXTURE = join(HERE, "fixture");
export const DEFAULT_MODEL = "claude-sonnet-5-5";
export const PYTEST = "pytest==9.2.0";
const MAIN = process.argv[1] === new URL(import.meta.url).pathname;
const CMD = MAIN ? process.argv[2] : null;
let WORK = arg("work");
if (MAIN && (!WORK || WORK.startsWith("/tmp/claude-"))) { console.error("--work <dir>, never under /tmp/claude-*"); process.exit(2); }
const MODEL = arg("model", DEFAULT_MODEL);
const CAP_MS = Number(arg("cap-minutes", "60")) * 60_000;
const ARMS = (arg("arms", "bare,carja")).split(",");
const candidateOf = () => readFileSync(join(WORK, "candidate.txt"), "utf8").trim();
const sandbox = () => arg("sandbox", join(candidateOf(), "templates/.agents/sandbox/claude-sandbox.settings.json"));
const venv = () => join(WORK, "venv");
const steps = () => readdirSync(join(WORK, "spec")).filter((f) => /^f\d+\.md$/.test(f)).length;
export const useWork = (w) => { WORK = w; };
const run = (cmd, args, cwd, extra = {}) => spawnSync(cmd, args, { cwd, encoding: "utf8", maxBuffer: 256 << 20, ...extra });
const git = (cwd, ...a) => run("git", ["-c", "user.name=q3", "-c", "user.email=q3@local", ...a], cwd);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let pausedUntil = 0;

export function prompt(arm, step) {
  const spec = (f) => readFileSync(join(WORK, "spec", f), "utf8").trim();
  let s = step === 1 ? `${spec("brief.md")}\n\n` : "";
  s += `${spec(`f${step}.md`)}\n\nImplement this in this repository. Commit your work when you are done.\n`;
  if (arm === "carja") s = readFileSync(join(WORK, "carja-preamble.md"), "utf8").trim() + "\n\n" + s;
  return s;
}

// Each arm starts from an empty repository on branch `work`; the carja arm
// adds the candidate Carja (init --all, hooks installed by init) in one commit.
export function prepare(carjaCheckout, arms = ARMS) {
  mkdirSync(WORK, { recursive: true });
  for (const part of ["spec", "hidden", "reference", "carja-preamble.md"]) {
    if (!existsSync(join(WORK, part))) cpSync(join(FIXTURE, part), join(WORK, part), { recursive: true });
  }
  if (!existsSync(join(venv(), "bin/python"))) {
    for (const [cmd, a] of [["python3", ["-m", "venv", venv()]], [join(venv(), "bin/pip"), ["install", "-q", PYTEST]]]) {
      const r = run(cmd, a, WORK);
      if (r.status !== 0) throw new Error(`${cmd} ${a.join(" ")} failed: ${r.stderr}`);
    }
  }
  writeFileSync(join(WORK, "candidate.txt"), carjaCheckout + "\n");
  mkdirSync(join(WORK, "bin"), { recursive: true });
  writeFileSync(join(WORK, "bin/carja"), `#!/usr/bin/env bash\nexec node ${join(carjaCheckout, "bin/carja.js")} "$@"\n`, { mode: 0o755 });
  const version = JSON.parse(readFileSync(join(carjaCheckout, "package.json"), "utf8")).version;
  for (const arm of arms) {
    const dir = join(WORK, "templates", arm);
    rmSync(dir, { recursive: true, force: true });
    mkdirSync(dir, { recursive: true });
    git(dir, "init", "-q", "-b", "main");
    git(dir, "config", "user.name", "q3"); git(dir, "config", "user.email", "q3@local");
    writeFileSync(join(dir, ".gitignore"), ".venv\n__pycache__/\n");
    git(dir, "add", "."); git(dir, "commit", "-q", "-m", "initial");
    git(dir, "checkout", "-q", "-b", "work");
    if (arm === "carja") {
      const r = run("node", [join(carjaCheckout, "bin/carja.js"), "init", ".", "--all"], dir, { input: "" });
      if (r.status !== 0) throw new Error(`init failed: ${r.stdout}\n${r.stderr}`);
      git(dir, "add", "-A"); git(dir, "commit", "-q", "-m", `carja ${version}`);
    }
    if (git(dir, "status", "--porcelain").stdout.trim()) throw new Error(`${arm}: template not clean`);
    console.log(`${arm}: ready at ${git(dir, "rev-parse", "--short", "HEAD").stdout.trim()}`);
  }
}

// Hidden tests of every feature, run from a folder outside the chain.
export function grade(dir) {
  const xml = join(WORK, `.junit-${process.pid}-${Math.random().toString(36).slice(2)}.xml`);
  run(join(venv(), "bin/python"), ["-m", "pytest", "-q", "-p", "no:cacheprovider", "-o", "addopts=", `--junitxml=${xml}`, join(WORK, "hidden")],
    join(WORK, "hidden"), { env: { ...process.env, LB_REPO: dir, LB_PYTHON: join(venv(), "bin/python"), PYTHONDONTWRITEBYTECODE: "1" }, timeout: 1_800_000 });
  const per = {};
  const STEPS = steps();
  for (let k = 1; k <= STEPS; k++) per[`f${k}`] = { passed: 0, total: 0 };
  if (existsSync(xml)) {
    for (const m of readFileSync(xml, "utf8").matchAll(/<testcase classname="([^"]*)" name="([^"]*)"[^>]*?(\/>|>([\s\S]*?)<\/testcase>)/g)) {
      const f = m[1].match(/test_(f\d+)/)?.[1];
      if (!f || !per[f]) continue;
      per[f].total++;
      if (!/<(failure|error|skipped)\b/.test(m[4] || "")) per[f].passed++;
    }
    rmSync(xml, { force: true });
  }
  return per;
}

// The grader's own check: the empty templates pass nothing, the reference passes everything.
export function control(arms = ARMS) {
  let bad = 0;
  for (const [name, dir] of [...arms.map((a) => [`${a} template`, join(WORK, "templates", a)]), ["reference", join(WORK, "reference")]]) {
    const per = grade(dir);
    const p = Object.values(per).reduce((s, x) => s + x.passed, 0), t = Object.values(per).reduce((s, x) => s + x.total, 0);
    const ok = name === "reference" ? p === t && t > 0 : p === 0;
    if (!ok) bad++;
    console.log(`${name}: ${p}/${t} ${ok ? "" : "<-- WRONG"} ${JSON.stringify(per)}`);
  }
  return bad === 0;
}

function trace(file) {
  const out = { workflowsRead: [], subagents: 0, skills: [] };
  if (!existsSync(file)) return out;
  for (const l of readFileSync(file, "utf8").split("\n")) {
    let o; try { o = JSON.parse(l); } catch { continue; }
    if (o.type !== "assistant") continue;
    for (const c of o.message?.content ?? []) {
      if (c.type !== "tool_use") continue;
      for (const m of JSON.stringify(c.input ?? {}).matchAll(/\.agents\/workflows\/([\w-]+)\.md/g)) if (!out.workflowsRead.includes(m[1])) out.workflowsRead.push(m[1]);
      if (c.name === "Task" || c.name === "Agent") out.subagents++;
      if (c.name === "Skill" && c.input?.skill) out.skills.push(c.input.skill);
    }
  }
  return out;
}

function session(dir, arm, step) {
  return new Promise((resolve) => {
    const argv = ["-p", "--output-format", "stream-json", "--verbose", "--permission-mode", "acceptEdits",
      "--model", MODEL, "--settings", sandbox(), "--strict-mcp-config", "--", prompt(arm, step)];
    const env = { ...process.env, PATH: `${join(venv(), "bin")}:${arm === "carja" ? `${join(WORK, "bin")}:` : ""}${process.env.PATH}` };
    for (const k of Object.keys(env)) if (k.startsWith("ROOMBOOK_")) delete env[k];
    const t0 = Date.now();
    const log = createWriteStream(join(WORK, "transcripts", `${dir.split("/").pop()}-s${step}.jsonl`));
    const p = spawn("claude", argv, { cwd: dir, env, stdio: ["ignore", "pipe", "pipe"] });
    let last = "", capped = false;
    p.stdout.on("data", (b) => { log.write(b); last = (last + b.toString()).split("\n").slice(-50).join("\n"); });
    p.stderr.on("data", (b) => log.write(b));
    const timer = setTimeout(() => { capped = true; p.kill("SIGTERM"); setTimeout(() => p.kill("SIGKILL"), 10_000); }, CAP_MS);
    p.on("close", (code) => {
      clearTimeout(timer); log.end();
      const result = last.split("\n").reverse().map((l) => { try { return JSON.parse(l); } catch { return null; } }).find((o) => o?.type === "result") || {};
      const verdict = classifyBeatResult({ stdout: `${last}\n${result.result ?? ""}`, stderr: "", exitCode: code, apiErrorStatus: result.api_error_status });
      const outage = !capped && (result.type !== "result" || (result.is_error && /overloaded|api error|\b5\d\d\b|rate.?limit/i.test(String(result.result ?? ""))));
      resolve({ code, capped, result, wallMs: Date.now() - t0, infra: verdict.dead ? verdict.kind : outage ? "api_outage" : null, note: `${result.result ?? ""}\n${last.slice(-2000)}` });
    });
  });
}

async function step(chain, arm, rep, k) {
  const dir = join(WORK, "chains", chain);
  const start = git(dir, "rev-parse", "HEAD").stdout.trim();
  for (let attempt = 1; ; attempt++) {
    while (Date.now() < pausedUntil) await sleep(Math.min(60_000, pausedUntil - Date.now()));
    const s = await session(dir, arm, k);
    if (!s.infra) {
      const per = grade(dir);
      const cum = (n) => { let p = 0, t = 0; for (let i = 1; i <= n; i++) { p += per[`f${i}`].passed; t += per[`f${i}`].total; } return t ? p / t : 0; };
      const row = { ts: new Date().toISOString(), chain, arm, rep, step: k, model: MODEL, exit: s.code, capped: s.capped, wallMs: s.wallMs,
        turns: s.result.num_turns ?? null, costUsd: s.result.total_cost_usd ?? null, usage: s.result.usage ?? null,
        commits: Number(git(dir, "rev-list", "--count", `${start}..HEAD`).stdout.trim()),
        uncommitted: git(dir, "status", "--porcelain").stdout.trim().length > 0,
        perFeature: per, cumulative: cum(k), current: per[`f${k}`].total ? per[`f${k}`].passed / per[`f${k}`].total : 0,
        previous: k > 1 ? cum(k - 1) : null, ...trace(join(WORK, "transcripts", `${chain}-s${k}.jsonl`)) };
      appendFileSync(join(WORK, "results.jsonl"), JSON.stringify(row) + "\n");
      console.log(`${chain} step ${k}: cumulative ${(100 * row.cumulative).toFixed(0)}%, this feature ${(100 * row.current).toFixed(0)}%${k > 1 ? `, earlier features ${(100 * row.previous).toFixed(0)}%` : ""}, $${(row.costUsd ?? 0).toFixed(2)}, ${Math.round(s.wallMs / 60000)} min${s.capped ? ", CAPPED" : ""}`);
      return row;
    }
    // Not graded: put the chain back where the step started, wait, and run it again.
    appendFileSync(join(WORK, "infra.jsonl"), JSON.stringify({ ts: new Date().toISOString(), chain, step: k, attempt, kind: s.infra, note: s.note.slice(-1500) }) + "\n");
    git(dir, "reset", "-q", "--hard", start); git(dir, "clean", "-q", "-fdx", "-e", ".venv");
    if (attempt >= 6) { console.log(`${chain} step ${k}: given up after ${attempt} infra failures`); return null; }
    const reset = parseResetTime(s.note);
    pausedUntil = Math.max(pausedUntil, reset ? reset + 60_000 : Date.now() + 15 * 60_000);
    console.log(`${chain} step ${k}: ${s.infra}, not graded; waiting until ${new Date(pausedUntil).toLocaleTimeString()}`);
  }
}

export async function runChains(n, parallel, steps, arms = ARMS) {
  mkdirSync(join(WORK, "chains"), { recursive: true });
  mkdirSync(join(WORK, "transcripts"), { recursive: true });
  const done = new Set(existsSync(join(WORK, "results.jsonl")) ? readFileSync(join(WORK, "results.jsonl"), "utf8").split("\n").filter(Boolean).map((l) => { const r = JSON.parse(l); return `${r.chain}#${r.step}`; }) : []);
  // Interleaved: bare-1, carja-1, bare-2, carja-2, …
  const chains = [];
  for (let r = 1; r <= n; r++) for (const arm of arms) chains.push({ chain: `${arm}-${r}`, arm, rep: r });
  console.log(`${chains.length} chains × ${steps} steps, ${parallel} chains at a time, model ${MODEL}`);
  let i = 0;
  await Promise.all(Array.from({ length: parallel }, async () => {
    while (i < chains.length) {
      const c = chains[i++];
      const dir = join(WORK, "chains", c.chain);
      if (!existsSync(dir)) {
        cpSync(join(WORK, "templates", c.arm), dir, { recursive: true, verbatimSymlinks: true });
        symlinkSync(venv(), join(dir, ".venv"));
      }
      // The venv link is the harness's, not the product's: hidden from git whatever .gitignore becomes.
      if (!readFileSync(join(dir, ".git/info/exclude"), "utf8").includes("\n.venv\n")) appendFileSync(join(dir, ".git/info/exclude"), "\n.venv\n");
      for (let k = 1; k <= steps; k++) {
        if (done.has(`${c.chain}#${k}`)) continue;
        if (!(await step(c.chain, c.arm, c.rep, k))) break;
      }
    }
  }));
}

if (!MAIN) { /* imported by gate.mjs */ }
else if (CMD === "prepare") prepare(arg("carja"));
else if (CMD === "control") process.exit(control() ? 0 : 1);
else if (CMD === "prompt") process.stdout.write(prompt(arg("arm", "bare"), Number(arg("step", "1"))));
else if (CMD === "run") await runChains(Number(arg("chains", "5")), Number(arg("parallel", "6")), Number(arg("steps", String(steps()))));
else { console.error("commands: prepare | control | prompt | run"); process.exit(2); }
