// test/loop-commit-guard.test.js
//
// 2026-10-22 (autopportunity): another loop's cleanup removed a live run's
// worktree. The driver went on writing its files into the same path, now a plain
// folder inside the owner's checkout, and the auto-capture's `git add -A` there
// committed the owner's loop-state.json and loop.lock onto main. The capture now
// commits only in the worktree it expects, on a loop branch; anything else is
// refused and the run halts. Real git: this is a git behaviour.

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync, spawnSync } from "node:child_process";
import { autoCommit } from "../src/loop/autocommit.js";

const G = (cwd, ...a) => execFileSync("git", a, { cwd, stdio: "pipe" }).toString().trim();
const git = (cwd) => async (args) => {
  const r = spawnSync("git", args, { cwd, encoding: "utf8" });
  return { ok: r.status === 0, stdout: (r.stdout || "").trim(), stderr: (r.stderr || "").trim() };
};

function repo() {
  const base = mkdtempSync(join(tmpdir(), "commit-guard-"));
  const r = join(base, "repo");
  execFileSync("git", ["init", "-q", "-b", "main", r]);
  G(r, "config", "user.email", "t@t");
  G(r, "config", "user.name", "t");
  writeFileSync(join(r, "a.txt"), "a\n");
  G(r, "add", "-A");
  G(r, "commit", "-qm", "init");
  return { base, r };
}

test("a worktree that is gone (a plain folder inside the owner's checkout) is refused: nothing lands on main", async () => {
  const { base, r } = repo();
  try {
    const gone = join(r, ".agents/.worktrees/loop-slice");
    mkdirSync(gone, { recursive: true });
    writeFileSync(join(gone, "loop-state.json"), "{}\n");
    writeFileSync(join(r, "owner-state.json"), "{}\n");
    const res = await autoCommit({ git: git(gone), message: "chore: capture", expect: { path: gone } });
    assert.equal(res.committed, false);
    assert.equal(res.refused, true);
    assert.match(res.reason, /not the loop worktree/);
    assert.equal(G(r, "rev-list", "--count", "main"), "1", "nothing was committed on main");
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});

test("a worktree on the default branch (not a loop branch) is refused", async () => {
  const { base, r } = repo();
  try {
    writeFileSync(join(r, "b.txt"), "b\n");
    const res = await autoCommit({ git: git(r), message: "chore: capture", expect: { path: r } });
    assert.equal(res.refused, true);
    assert.match(res.reason, /not on a loop branch/);
    assert.equal(G(r, "rev-list", "--count", "main"), "1");
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});

test("the expected loop worktree on its loop branch still captures the work", async () => {
  const { base, r } = repo();
  try {
    const wt = join(r, ".agents/.worktrees/loop-x");
    G(r, "worktree", "add", "-q", "-b", "carja/loop/loop-x", wt);
    writeFileSync(join(wt, "work.txt"), "work\n");
    const res = await autoCommit({ git: git(wt), message: "chore: capture", expect: { path: wt } });
    assert.equal(res.committed, true);
    assert.equal(G(wt, "log", "-1", "--format=%s"), "chore: capture");
    assert.equal(G(r, "rev-list", "--count", "main"), "1");
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});
