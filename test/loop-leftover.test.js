// test/loop-leftover.test.js
//
// I5 (autopportunity, 2026-10-22): a run that died left a plain folder at the
// slice's worktree path, holding only carja/ files. The next run's
// `git worktree add` failed, the loop did not check, copied its files into the
// plain folder and ran a beat there; the isolation guard stopped it twice
// ($1.45). Now the folder is moved aside (never deleted) and the worktree made.

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync, spawnSync } from "node:child_process";
import { freeWorktreePath, isLiveWorktree } from "../src/loop/worktree.js";
import { ensureCodeWorktree } from "../src/loop/nested.js";

const G = (cwd, ...a) => execFileSync("git", a, { cwd, stdio: "pipe" }).toString().trim();
const gitIn = (cwd) => async (args) => {
  const r = spawnSync("git", args, { cwd, encoding: "utf8" });
  return { ok: r.status === 0, stdout: (r.stdout ?? "").trim(), stderr: (r.stderr ?? "").trim() };
};

function repo() {
  const base = mkdtempSync(join(tmpdir(), "leftover-"));
  const root = join(base, "r");
  mkdirSync(root);
  G(root, "init", "-q", "-b", "main");
  G(root, "config", "user.email", "t@t");
  G(root, "config", "user.name", "t");
  writeFileSync(join(root, "a.txt"), "a\n");
  G(root, "add", "-A");
  G(root, "commit", "-qm", "a");
  return { base, root };
}

test("tonight's case: a plain folder with carja/ files at the path is moved aside, and the worktree is made there", async () => {
  const { base, root } = repo();
  try {
    const path = join(root, ".agents/.worktrees/loop-slice-cop-01");
    mkdirSync(join(path, "carja/1-workbench"), { recursive: true });
    writeFileSync(join(path, "carja/1-workbench/loop-state.json"), '{"left":"over"}\n');
    const git = gitIn(root);
    assert.equal(await isLiveWorktree({ git, path }), false);
    const { moved } = await freeWorktreePath({ git, path, now: () => new Date("2026-10-22T14:44:00Z") });
    assert.match(moved, /\.git\/carja-loop-logs\/leftovers\/loop-slice-cop-01-2026-10-22T14-44-00-000Z$/);
    assert.equal(readFileSync(join(moved, "carja/1-workbench/loop-state.json"), "utf8"), '{"left":"over"}\n', "kept, never deleted");
    G(root, "worktree", "add", "-q", "-b", "carja/loop/x", path, "main");
    assert.equal(await isLiveWorktree({ git, path }), true);
    assert.equal(G(path, "rev-parse", "--show-toplevel"), path);
    // A live worktree is never moved.
    assert.deepEqual(await freeWorktreePath({ git, path }), { moved: null });
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});

test("a registered worktree whose folder is gone is pruned, so the add does not fail", async () => {
  const { base, root } = repo();
  try {
    const path = join(root, ".agents/.worktrees/gone");
    G(root, "worktree", "add", "-q", "-b", "carja/loop/gone", path, "main");
    rmSync(path, { recursive: true, force: true });
    const git = gitIn(root);
    assert.equal(await isLiveWorktree({ git, path }), false);
    await freeWorktreePath({ git, path });
    G(root, "worktree", "add", "-q", path, "carja/loop/gone");
    assert.equal(await isLiveWorktree({ git, path }), true);
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});

test("the code worktree: a leftover folder at its path is moved aside into the code repository's git dir", async () => {
  const { base, root } = repo();
  try {
    const bare = join(base, "code.git");
    G(base, "init", "-q", "--bare", "-b", "main", "code.git");
    G(root, "remote", "add", "origin", bare);
    G(root, "push", "-q", "-u", "origin", "main");
    G(root, "remote", "set-head", "origin", "main");
    const path = join(base, "outer-wt/repo");
    mkdirSync(path, { recursive: true });
    writeFileSync(join(path, "stray.txt"), "stray\n");
    const r = await ensureCodeWorktree({ codeGit: gitIn(root), path, branch: "carja/loop/y" });
    assert.equal(r.ok, true, r.reason);
    assert.match(r.movedAside, /carja-loop-logs\/leftovers\/repo-/);
    assert.equal(existsSync(join(r.movedAside, "stray.txt")), true);
    assert.equal(G(path, "rev-parse", "--abbrev-ref", "HEAD"), "carja/loop/y");
    assert.deepEqual(readdirSync(path).sort(), [".git", "a.txt"]);
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});
