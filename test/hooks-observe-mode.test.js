// test/hooks-observe-mode.test.js
//
// F8 (docs/roadmap/Risk-Tiered-Merge.md): "Start a new gate in observe mode"
// (Anthropic, Claude Code team). gates.<name>: "observe" in carja.config.json
// lets a policy gate log what it would have blocked, and lets the commit
// through. The mode is read from the committed HEAD, so a commit cannot relax
// its own gate. The gates that keep the gates honest always enforce. Real git,
// real hooks.

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, rmSync, mkdirSync, readFileSync, existsSync, cpSync, unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync, spawnSync } from "node:child_process";

const HOOKS = new URL("../templates/.agents/hooks/", import.meta.url).pathname;
const G = (cwd, ...a) => execFileSync("git", a, { cwd, stdio: "pipe" }).toString().trim();
const commit = (cwd) => spawnSync("git", ["commit", "-qm", "x"], { cwd, encoding: "utf8" });
const LOG = (root) => join(root, ".git/carja-gate-observe.log");

function project(config) {
  const root = mkdtempSync(join(tmpdir(), "observe-"));
  G(root, "init", "-q", "-b", "main");
  G(root, "config", "user.email", "t@t");
  G(root, "config", "user.name", "t");
  mkdirSync(join(root, ".agents"), { recursive: true });
  cpSync(HOOKS, join(root, ".agents/hooks"), { recursive: true });
  mkdirSync(join(root, "carja/0-compass"), { recursive: true });
  writeFileSync(join(root, "carja/0-compass/ship-log.md"), "# Ship log\n");
  writeFileSync(join(root, "carja.config.json"), JSON.stringify({ verify: "none", ...config }));
  mkdirSync(join(root, "test"), { recursive: true });
  writeFileSync(join(root, "test/old.test.js"), "test('old', () => { expect(1).toBe(1); });\n");
  G(root, "add", "-A");
  execFileSync("git", ["commit", "-qm", "init"], { cwd: root, env: { ...process.env, CARJA_HOOKS: "off" } });
  G(root, "checkout", "-q", "-b", "item");
  G(root, "config", "core.hooksPath", ".agents/hooks");
  return root;
}

const stageCodeWithoutTest = (root) => {
  mkdirSync(join(root, "src"), { recursive: true });
  writeFileSync(join(root, "src/a.js"), "export const a = 1;\n");
  G(root, "add", "-A");
};

test("default: the TDD gate blocks, as before", () => {
  const root = project({});
  try {
    stageCodeWithoutTest(root);
    const r = commit(root);
    assert.notEqual(r.status, 0);
    assert.equal(existsSync(LOG(root)), false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("gates.tdd observe: the commit goes through, says it would have been blocked, and logs it", () => {
  const root = project({ gates: { tdd: "observe" } });
  try {
    stageCodeWithoutTest(root);
    const r = commit(root);
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.match(r.stdout + r.stderr, /tdd gate in observe mode: this commit would have been blocked/);
    assert.match(readFileSync(LOG(root), "utf8"), /\ttdd\titem\t/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("a commit cannot switch its own gate to observe: the mode comes from HEAD", () => {
  const root = project({});
  try {
    writeFileSync(join(root, "carja.config.json"), JSON.stringify({ verify: "none", gates: { tdd: "observe" } }));
    stageCodeWithoutTest(root);
    const r = commit(root);
    assert.notEqual(r.status, 0, "the staged config relaxed its own gate");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("the Goodhart boundary always enforces, whatever the config says", () => {
  const root = project({ gates: { goodhart: "observe", tdd: "observe" } });
  try {
    unlinkSync(join(root, "test/old.test.js"));
    G(root, "add", "-A");
    const r = commit(root);
    assert.notEqual(r.status, 0, "a test deletion went through in observe mode");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
