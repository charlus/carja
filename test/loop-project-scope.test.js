// test/loop-project-scope.test.js
//
// `carja loop <project>` (owner, 2026-10-22): "I go into my project folder
// and run the loop on a project. For the second project I open another
// terminal, same folder, run the loop on another project. Carja works in
// isolation and cleans its mess when it has finished." The real CLI, with the
// stub engine (test/fixtures/stub-engine/claude) on PATH: no model is called.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync, spawn, spawnSync } from "node:child_process";

const REPO = new URL("..", import.meta.url).pathname;
const G = (cwd, ...a) => execFileSync("git", a, { cwd, stdio: "pipe" }).toString().trim();
// The owner's documents, up to the approved Technical Vision: the loop's start signal (S8).
const DISCOVERY = [
  "genesis/problem-solar-system.md",
  "genesis/world-transformation.md",
  "genesis/functional-animator.md",
  "storyboard/main-character.md",
  "storyboard/storyboard.md",
  "blueprint/grand-prd.md",
  "blueprint/ux-ui-design-brief.md",
  "blueprint/technical-vision.md",
];

function folder() {
  const base = mkdtempSync(join(tmpdir(), "project-scope-"));
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
  for (const name of ["notes", "board"]) {
    const p = join(root, "carja/2-backlog/project-backlog", name);
    for (const rel of DISCOVERY) {
      mkdirSync(join(p, rel, ".."), { recursive: true });
      writeFileSync(join(p, rel), `# ${rel}\n\n${name}: writers keep notes.\n`);
    }
  }
  // A loop-ready backlog item and an inbox line: a project's run takes neither.
  writeFileSync(join(root, "carja/2-backlog/task-backlog.md"), "# Task Backlog\n\n## P1\n\n- [ ] Fix the login (loop-ready)\n");
  writeFileSync(join(root, "carja/1-workbench/inbox.md"), "# Inbox\n\n- an idea\n");
  const cfg = JSON.parse(readFileSync(join(root, "carja.config.json"), "utf8"));
  cfg.verify = "true";
  // The owner's config turns nothing on: the command line names the project.
  cfg.loop = { forge: "gh" };
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

const env = ({ base, bin }, log) => ({ ...process.env, PATH: `${bin}:${process.env.PATH}`, STUB_LOG_DIR: join(base, log), CARJA_HOME: join(base, "home") });

function loopSync(f, args, log = "log") {
  return spawnSync("node", [join(REPO, "bin/carja.js"), "loop", ...args], { cwd: f.root, encoding: "utf8", env: env(f, log), timeout: 120000 });
}

function loopAsync(f, args, log) {
  return new Promise((res) => {
    const c = spawn("node", [join(REPO, "bin/carja.js"), "loop", ...args], { cwd: f.root, env: env(f, log) });
    let stdout = "";
    let stderr = "";
    c.stdout.on("data", (d) => (stdout += d));
    c.stderr.on("data", (d) => (stderr += d));
    c.on("close", (status) => res({ status, stdout, stderr }));
  });
}

test("the dry run says, first and in plain words, what the named project's run builds, and nothing else", () => {
  const f = folder();
  try {
    const r = loopSync(f, ["notes", "--dry-run"]);
    assert.equal(r.status, 0, r.stdout + r.stderr);
    const first = r.stdout.split("\n").slice(0, 3).join("\n");
    assert.match(first, /^notes: the Carve\.\nEach item starts from the one below it, so nothing waits for a merge\./);
    assert.match(first, /One-way questions stop the run/);
    assert.match(r.stdout, /harvested: 1 work item/);
    assert.doesNotMatch(r.stdout, /Fix the login|an idea|board/, "no backlog, no inbox, no other project");
  } finally {
    rmSync(f.base, { recursive: true, force: true });
  }
});

test("an unknown project is refused with the projects that exist", () => {
  const f = folder();
  try {
    const r = loopSync(f, ["nope", "--dry-run"]);
    assert.equal(r.status, 1);
    assert.match(r.stderr, /No project "nope".*Projects here: board, notes\./);
  } finally {
    rmSync(f.base, { recursive: true, force: true });
  }
});

test("the same project twice is refused; a whole-folder run and a project run never run together", () => {
  const f = folder();
  try {
    const runs = join(f.root, ".git/carja-loop-logs/runs/notes");
    mkdirSync(runs, { recursive: true });
    writeFileSync(join(runs, "loop.lock"), JSON.stringify({ pid: process.pid, at: "now" }));
    const twice = loopSync(f, ["notes"]);
    assert.equal(twice.status, 1);
    assert.match(twice.stderr, /notes is already being built by another loop in this folder/);
    const whole = loopSync(f, [".", "--from-carja"]);
    assert.equal(whole.status, 1);
    assert.match(whole.stderr, /carja loop <project>` runs are going on in this folder \(notes/);
    rmSync(runs, { recursive: true, force: true });
    writeFileSync(join(f.root, "carja/1-workbench/loop.lock"), JSON.stringify({ pid: process.pid, at: "now" }));
    const scoped = loopSync(f, ["board"]);
    assert.equal(scoped.status, 1);
    assert.match(scoped.stderr, /A `carja loop --from-carja` run is going on in this folder/);
  } finally {
    rmSync(f.base, { recursive: true, force: true });
  }
});

test("two projects from the same folder at once: each builds its own, nothing lands on master, and each cleans up", async () => {
  const f = folder();
  try {
    const before = G(f.root, "rev-parse", "master");
    const [a, b] = await Promise.all([loopAsync(f, ["notes"], "log-notes"), loopAsync(f, ["board"], "log-board")]);
    assert.equal(a.status, 0, a.stdout + a.stderr);
    assert.equal(b.status, 0, b.stdout + b.stderr);
    assert.match(a.stdout, /^notes: /);
    assert.match(b.stdout, /^board: /);
    for (const r of [a, b]) {
      assert.match(r.stdout, /finished: completed/);
      assert.doesNotMatch(r.stdout, /removed the merged/, "neither run removed the other's worktree");
      assert.match(r.stdout, /Next: merge the 2 item\(s\) in the order of carja\/1-workbench\/loop-report-(notes|board)\.md/);
    }
    assert.equal(G(f.root, "rev-parse", "master"), before, "nothing was committed on the owner's branch");
    assert.equal(G(f.root, "status", "--porcelain", "--", "carja/1-workbench/loop-state.json"), "", "the owner's loop-state.json is untouched");
    // Each pushed its own branch, from its own worktree, then removed that worktree.
    const remote = G(f.root, "ls-remote", "--heads", "origin", "carja/loop/*");
    for (const b of ["blueprint-notes", "blueprint-board", "slice-notes-01-first", "slice-board-01-first"]) assert.match(remote, new RegExp(b));
    const wts = join(f.root, ".agents/.worktrees");
    assert.deepEqual(existsSync(wts) ? readdirSync(wts) : [], [], "every worktree was removed at the end");
    // Each project's run has its own state, invisible in the folder.
    for (const p of ["notes", "board"]) {
      const s = JSON.parse(readFileSync(join(f.root, ".git/carja-loop-logs/runs", p, "loop-state.json"), "utf8"));
      assert.equal(s.status, "completed");
      assert.deepEqual(s.tasks.map((t) => t.id), [`slice:${p}/01-first`]);
      const stack = JSON.parse(readFileSync(join(f.root, ".git/carja-loop-logs/runs", p, "stack.json"), "utf8"));
      assert.deepEqual(stack.map((e) => e.title), ["the Carve", "slice 01-first"]);
    }
    // carja watch shows both runs, each under its project.
    const events = readFileSync(join(f.root, ".git/carja-loop-logs/events.ndjson"), "utf8");
    const starts = events.split("\n").filter(Boolean).map((l) => JSON.parse(l)).filter((e) => e.type === "run_start");
    assert.deepEqual([...new Set(starts.map((e) => e.project))].sort(), ["board", "notes"], "one run start per item, each under its project");
  } finally {
    rmSync(f.base, { recursive: true, force: true });
  }
});
