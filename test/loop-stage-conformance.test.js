// test/loop-stage-conformance.test.js
//
// Unattended Lifecycle step 6 (docs/roadmap/Unattended-Lifecycle.md): the loop
// runs Carja's own workflows, stage by stage, and nothing else. Two halves:
//   - static: the stage table in code (src/loop/stages.js) names real workflow
//     files and real beat sections, and matches the roadmap's Stage map.
//   - behaviour: the real CLI, driven through every stage of a project with a
//     stub `claude` on PATH (test/fixtures/stub-engine/claude), routes each beat
//     to the stage's workflow and runs each stage's gate, in order. The stub
//     saves every prompt; this test reads them. No model is called.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync, spawnSync } from "node:child_process";
import { STAGES, stage } from "../src/loop/stages.js";
import { BLUEPRINT_STAGES } from "../src/loop/blueprint.js";
import { ROUTING } from "../src/loop/harvester.js";
import { sectionOf } from "../src/loop/ship.js";

const REPO = new URL("..", import.meta.url).pathname;
const WF = join(REPO, "templates/.agents/workflows");
const LOOP_MD = readFileSync(join(WF, "unattended-loop.md"), "utf8");
const ROADMAP = readFileSync(join(REPO, "docs/roadmap/Unattended-Lifecycle.md"), "utf8");

// ---- static ---------------------------------------------------------------

test("every stage names workflow files that exist, and every loop stage a beat section that exists", () => {
  for (const s of STAGES) {
    for (const w of s.workflows) assert.ok(existsSync(join(WF, w)), `${s.name}: ${w} does not exist`);
    if (s.runner === "loop" && s.section) assert.ok(sectionOf(LOOP_MD, s.section).trim(), `${s.name}: unattended-loop.md has no "## ${s.section}" section`);
    if (s.runner === "loop") assert.ok(s.gate?.length, `${s.name} has no gate`);
  }
  assert.throws(() => stage("nope"), /unknown loop stage/);
});

test("the code's routes come from the stage table", () => {
  assert.deepEqual(BLUEPRINT_STAGES.map((s) => s.workflow), ["grand-prd", "ux-ui-brief", "technical-vision", "carve"].map((k) => stage(k).workflows[0]));
  assert.equal(ROUTING.slice.workflow, `.agents/workflows/${stage("build").workflows[0]}`);
});

test("the stage table matches the roadmap's Stage map, row by row", () => {
  const rows = ROADMAP.slice(ROADMAP.indexOf("## Stage map"))
    .split("\n")
    .filter((l) => /^\| [A-Z]/.test(l) && !/^\| Stage \|/.test(l))
    .map((l) => l.split("|").map((c) => c.trim()));
  assert.deepEqual(rows.map((r) => r[1]), STAGES.map((s) => s.name));
  for (const [, name, workflow, , , gate] of rows) {
    const s = STAGES.find((x) => x.name === name);
    assert.deepEqual([...workflow.matchAll(/`([^`]+\.md)`/g)].map((m) => m[1]), s.workflows, `${name}: the roadmap names other workflows`);
    if (s.runner === "none") assert.match(gate, /not built/i, `${name} is not built: the roadmap must say so`);
    if (s.runner === "owner") assert.match(gate, /human only/i);
  }
});

// ---- behaviour: the real CLI through every stage ----------------------------

const G = (cwd, ...a) => execFileSync("git", a, { cwd, stdio: "pipe" }).toString().trim();
const DISCOVERY = ["genesis/problem-solar-system.md", "genesis/world-transformation.md", "genesis/functional-animator.md", "storyboard/main-character.md", "storyboard/storyboard.md"];

function project() {
  const base = mkdtempSync(join(tmpdir(), "conformance-"));
  const root = join(base, "app");
  const bin = join(base, "bin");
  mkdirSync(bin);
  writeFileSync(join(bin, "claude"), readFileSync(join(REPO, "test/fixtures/stub-engine/claude")), { mode: 0o755 });
  writeFileSync(join(bin, "gh"), '#!/bin/sh\n[ "$1" = auth ] && exit 0\n[ "$1" = pr ] && [ "$2" = list ] && exit 0\necho https://example.invalid/pr/1\n', { mode: 0o755 });
  execFileSync("node", [join(REPO, "bin/carja.js"), "init", root, "--all", "--no-detect"], { stdio: "pipe" });
  G(root, "init", "-q", "-b", "master");
  G(root, "config", "user.email", "t@t");
  G(root, "config", "user.name", "t");
  writeFileSync(join(root, "package.json"), '{ "name": "app", "type": "module", "scripts": { "test": "true" } }\n');
  writeFileSync(join(root, ".gitignore"), ".agents/.worktrees/\n", { flag: "a" });
  const p = join(root, "carja/2-backlog/project-backlog/notes");
  for (const rel of DISCOVERY) {
    mkdirSync(join(p, rel, ".."), { recursive: true });
    writeFileSync(join(p, rel), `# ${rel}\n\nWriters keep notes.\n`);
  }
  const cfg = JSON.parse(readFileSync(join(root, "carja.config.json"), "utf8"));
  cfg.verify = "true";
  cfg.loop = { forge: "gh", blueprint: ["notes"], slices: ["notes"], inbox: false };
  writeFileSync(join(root, "carja.config.json"), JSON.stringify(cfg, null, 2));
  const st = JSON.parse(readFileSync(join(root, "carja/1-workbench/loop-state.json"), "utf8"));
  Object.assign(st, { phase: "execution", autonomy_level: "L3", sandbox: "cli-native", platform: "claude", concurrency: 1 });
  st.budget = { max_beats: 30, max_wall_clock_min: 10 };
  st.iterations = { current: 0, max_allowed: 30 };
  writeFileSync(join(root, "carja/1-workbench/loop-state.json"), JSON.stringify(st, null, 2));
  G(root, "add", "-A");
  G(root, "commit", "-qm", "init");
  G(base, "init", "-q", "--bare", "-b", "master", "origin.git");
  G(root, "remote", "add", "origin", join(base, "origin.git"));
  G(root, "push", "-q", "origin", "master");
  G(root, "remote", "set-head", "origin", "master");
  return { base, root, bin };
}

function loop({ base, root, bin }, logDir, env = {}) {
  const r = spawnSync("node", [join(REPO, "bin/carja.js"), "loop", root, "--from-carja"], {
    cwd: root,
    encoding: "utf8",
    env: { ...process.env, PATH: `${bin}:${process.env.PATH}`, STUB_LOG_DIR: join(base, logDir), ...env },
    timeout: 120000,
  });
  const dir = join(base, logDir);
  const files = existsSync(dir) ? readdirSync(dir).filter((f) => f.endsWith(".txt")).sort() : [];
  const prompts = files.map((f) => readFileSync(join(dir, f), "utf8"));
  const models = files.map((f) => readFileSync(join(dir, f.replace(/\.txt$/, ".model")), "utf8"));
  return { ...r, prompts, models };
}

/** What each prompt was routed to: the stage whose workflow it starts with, or the review it carries. */
function routeOf(prompt, root) {
  const read = (w) => readFileSync(join(root, ".agents/workflows", w), "utf8");
  if (prompt.startsWith(read("loop-checker.md"))) {
    const review = prompt.match(/# This review: the ([a-z-]+) stage of the Blueprint/)?.[1] ?? (/# This review: the slice's spec/.test(prompt) ? "spec" : null);
    return `checker:${review ?? "code"}`;
  }
  for (const s of STAGES.filter((x) => x.runner === "loop")) {
    const w = read(s.workflows[0]);
    if (s.prompt === "inline" && prompt.startsWith(w)) {
      assert.ok(!s.section || prompt.includes(sectionOf(read("unattended-loop.md"), s.section).trim().split("\n")[0]), `${s.key}: the beat section is missing`);
      return s.key;
    }
    if (s.prompt === "named" && prompt.startsWith(read("unattended-loop.md")) && prompt.includes(`**Run workflow:** \`.agents/workflows/${s.workflows[0]}\``)) return s.key;
  }
  return `unknown:${prompt.split("\n")[0]}`;
}

test("the CLI runs a project through every loop stage, each beat on its stage's workflow, each stage behind its review", () => {
  const p = project();
  try {
    // Run 1: the Blueprint, one MR (D4).
    const r1 = loop(p, "log1");
    assert.equal(r1.status, 0, r1.stdout + r1.stderr);
    assert.deepEqual(r1.prompts.map((x) => routeOf(x, p.root)), [
      "grand-prd", "checker:grand-prd",
      "ux-ui-brief", "checker:ux-ui-brief",
      "technical-vision", "checker:technical-vision",
      "carve", "checker:carve",
    ]);
    assert.match(r1.stdout, /finished: completed/);
    assert.match(r1.stdout, /Next: review and merge the MR/, "the run ends with the next command");

    // The owner merges the Blueprint MR: the slices now exist on the default branch.
    const branch = G(p.root, "ls-remote", "--heads", "origin", "carja/loop/*").split("\t")[1].replace("refs/heads/", "");
    G(p.root, "fetch", "-q", "origin", branch);
    G(p.root, "merge", "-q", "--no-ff", "-m", "merge Blueprint MR", "FETCH_HEAD");
    G(p.root, "push", "-q", "origin", "master");

    // Run 2: the first slice, Spec-It → Build → Ship, one MR (D2, D3).
    const r2 = loop(p, "log2");
    assert.equal(r2.status, 0, r2.stdout + r2.stderr);
    assert.deepEqual(r2.prompts.map((x) => routeOf(x, p.root)), ["spec", "checker:spec", "build", "checker:code", "ship", "checker:code"]);
    // F20 (autopportunity 2026-10-21): a code review is told the driver already ran the
    // full suite outside the sandbox, so it does not run it again inside, where it hung.
    const codeReviews = r2.prompts.filter((x) => routeOf(x, p.root) === "checker:code");
    assert.ok(codeReviews.every((x) => /# The full verification already ran/.test(x) && /Do not run the full suite/.test(x)));
    assert.ok(!/# The full verification already ran/.test(r2.prompts.find((x) => routeOf(x, p.root) === "checker:spec")), "a spec review has no tests to run");
    assert.match(r2.stdout, /finished: completed/);
  } finally {
    rmSync(p.base, { recursive: true, force: true });
  }
});

test("the balanced profile: each beat starts on its role's model, through the real CLI", () => {
  const p = project();
  try {
    const cfgPath = join(p.root, "carja.config.json");
    const cfg = JSON.parse(readFileSync(cfgPath, "utf8"));
    cfg.loop.profile = "balanced";
    writeFileSync(cfgPath, JSON.stringify(cfg, null, 2));
    G(p.root, "commit", "-qam", "profile");
    G(p.root, "push", "-q", "origin", "master");
    const r1 = loop(p, "log1");
    const at = (routes, models, name) => models[routes.indexOf(name)];
    const routes1 = r1.prompts.map((x) => routeOf(x, p.root));
    assert.equal(at(routes1, r1.models, "grand-prd"), "opus", "designs on Opus");
    assert.equal(at(routes1, r1.models, "checker:grand-prd"), "opus", "review on Opus");
    const branch = G(p.root, "ls-remote", "--heads", "origin", "carja/loop/*").split("\t")[1].replace("refs/heads/", "");
    G(p.root, "fetch", "-q", "origin", branch);
    G(p.root, "merge", "-q", "--no-ff", "-m", "merge", "FETCH_HEAD");
    G(p.root, "push", "-q", "origin", "master");
    const r2 = loop(p, "log2");
    const routes2 = r2.prompts.map((x) => routeOf(x, p.root));
    assert.deepEqual(["spec", "build", "ship"].map((k) => at(routes2, r2.models, k)), ["opus", "sonnet", "sonnet"]);
    assert.ok(r2.models.filter((_, i) => routes2[i].startsWith("checker")).every((m) => m === "opus"));
  } finally {
    rmSync(p.base, { recursive: true, force: true });
  }
});

test("a stage whose beat writes nothing is stopped by its gate, retried once, and no later stage runs", () => {
  const p = project();
  try {
    const r = loop(p, "log", { STUB_SKIP: "ux-ui-brief" });
    const routes = r.prompts.map((x) => routeOf(x, p.root));
    assert.deepEqual(routes, ["grand-prd", "checker:grand-prd", "ux-ui-brief", "ux-ui-brief"], "no review of an unwritten brief, no Technical Vision");
    assert.doesNotMatch(r.stdout, /finished: completed/);
  } finally {
    rmSync(p.base, { recursive: true, force: true });
  }
});
