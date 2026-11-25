// test/loop-run-state-cli.test.js
//
// Field report (website, 2026-11-25): every loop run left
// carja/1-workbench/loop-state.json modified in git. The real CLI, with the
// stub engine (test/fixtures/stub-engine/claude, no model): a run writes its
// state to the git common dir and leaves the tracked file as committed, and the
// next run resumes from the run file.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, mkdtempSync, mkdirSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync, spawnSync } from "node:child_process";

const REPO = new URL("..", import.meta.url).pathname;
const G = (cwd, ...a) => execFileSync("git", a, { cwd, stdio: "pipe" }).toString().trim();
const STATE = "carja/1-workbench/loop-state.json";
const DISCOVERY = ["genesis/problem-solar-system.md", "genesis/world-transformation.md", "genesis/functional-animator.md", "storyboard/main-character.md", "storyboard/storyboard.md"];

function project() {
  const base = mkdtempSync(join(tmpdir(), "run-state-"));
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
  const st = JSON.parse(readFileSync(join(root, STATE), "utf8"));
  Object.assign(st, { phase: "execution", autonomy_level: "L3", sandbox: "cli-native", platform: "claude", concurrency: 1 });
  st.budget = { max_beats: 2, max_wall_clock_min: 10 };
  st.iterations = { max_allowed: 2 };
  writeFileSync(join(root, STATE), `${JSON.stringify(st, null, 2)}\n`);
  G(root, "add", "-A");
  G(root, "commit", "-qm", "init");
  G(base, "init", "-q", "--bare", "-b", "master", "origin.git");
  G(root, "remote", "add", "origin", join(base, "origin.git"));
  G(root, "push", "-q", "origin", "master");
  G(root, "remote", "set-head", "origin", "master");
  return { base, root, bin };
}

const loop = ({ base, root, bin }) =>
  spawnSync("node", [join(REPO, "bin/carja.js"), "loop", root, "--from-carja"], {
    cwd: root,
    encoding: "utf8",
    env: { ...process.env, PATH: `${bin}:${process.env.PATH}`, STUB_LOG_DIR: join(base, "log") },
    timeout: 120000,
  });

test("a loop run leaves the tracked loop-state.json as committed, and keeps its state in the git dir", () => {
  const p = project();
  const committed = readFileSync(join(p.root, STATE), "utf8");
  const r = loop(p);
  assert.ok(r.status !== null, `the run did not end: ${r.stderr}`);
  assert.equal(readFileSync(join(p.root, STATE), "utf8"), committed, `the run wrote the tracked file\n${r.stdout}\n${r.stderr}`);
  assert.equal(G(p.root, "status", "--porcelain", "--", STATE), "", "git shows the tracked file as modified");
  const runFile = join(p.root, ".git/carja-loop-logs/loop-state.json");
  assert.ok(existsSync(runFile), `no run file\n${r.stdout}\n${r.stderr}`);
  const run = JSON.parse(readFileSync(runFile, "utf8"));
  assert.ok(run.iterations.current > 0, `the run counted no beat: ${JSON.stringify(run.iterations)}`);
  assert.equal(run.autonomy_level, "L3", "the run worked with the owner's settings");
  assert.ok(run.tasks.length > 0, "the run's tasks are in the run file");
});
