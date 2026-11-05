// test/loop-state-sync.test.js
//
// F15: an agent beat runs in a worktree, which holds the COMMITTED loop-state.json,
// not the driver's live one. In the common setup (carja/ tracked) the agent saw
// an old goal and phase and refused to work. syncLoopStateInto copies the live
// state into the worktree before every beat and keeps the copy out of commits.
// Real git, temp repos: this is exactly the layer a stub would hide.

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { syncLoopStateInto, STATE_REL } from "../src/loop/state-sync.js";

const git = (cwd, ...args) => execFileSync("git", args, { cwd, encoding: "utf8" }).trim();

async function repoWith({ track = true, ignore = false } = {}, fn) {
  const root = await mkdtemp(join(tmpdir(), "statesync-"));
  try {
    git(root, "init", "-q");
    git(root, "config", "user.email", "t@t");
    git(root, "config", "user.name", "t");
    await mkdir(join(root, "carja/1-workbench"), { recursive: true });
    await writeFile(join(root, "README.md"), "x\n");
    if (ignore) await writeFile(join(root, ".gitignore"), "carja/1-workbench/loop-state.json\n");
    await writeFile(join(root, STATE_REL), JSON.stringify({ phase: "discovery", goal_description: "" }));
    git(root, "add", track ? "-A" : "README.md");
    if (ignore) git(root, "add", ".gitignore");
    git(root, "commit", "-qm", "init");
    // The driver's live state, never committed.
    await writeFile(join(root, STATE_REL), JSON.stringify({ phase: "execution", goal_description: "ship it" }));
    const wt = join(root, ".wt");
    git(root, "worktree", "add", "-q", "-b", "loop", wt);
    return await fn(root, wt);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

const run = (cwd) => async (args) => {
  try {
    return { ok: true, stdout: git(cwd, ...args) };
  } catch {
    return { ok: false, stdout: "" };
  }
};

for (const [name, opts] of [
  ["tracked", { track: true }],
  ["gitignored", { track: false, ignore: true }],
  ["untracked, not ignored", { track: false }],
]) {
  test(`F15 (${name}): the worktree gets the live state, and git never sees the copy`, async () => {
    await repoWith(opts, async (root, wt) => {
      await syncLoopStateInto({ root, cwd: wt, git: run(wt) });
      assert.deepEqual(JSON.parse(await readFile(join(wt, STATE_REL), "utf8")), { phase: "execution", goal_description: "ship it" });
      assert.equal(git(wt, "status", "--porcelain"), "");
      // A second sync (next beat) after the driver moved on: still invisible to git.
      await writeFile(join(root, STATE_REL), JSON.stringify({ phase: "execution", goal_description: "ship it", beat: 2 }));
      await syncLoopStateInto({ root, cwd: wt, git: run(wt) });
      assert.equal(JSON.parse(await readFile(join(wt, STATE_REL), "utf8")).beat, 2);
      assert.equal(git(wt, "status", "--porcelain"), "");
    });
  });
}

test("F15: the agent's own work is still committed next to the hidden state copy", async () => {
  await repoWith({ track: true }, async (root, wt) => {
    await syncLoopStateInto({ root, cwd: wt, git: run(wt) });
    await writeFile(join(wt, "hello.txt"), "hi\n");
    git(wt, "add", "-A");
    git(wt, "commit", "-qm", "work");
    assert.equal(git(wt, "show", "--name-only", "--format=", "HEAD"), "hello.txt");
  });
});

test("F15: running in the root itself is a no-op", async () => {
  await repoWith({ track: true }, async (root) => {
    const before = await readFile(join(root, STATE_REL), "utf8");
    await syncLoopStateInto({ root, cwd: root, git: run(root) });
    assert.equal(await readFile(join(root, STATE_REL), "utf8"), before);
  });
});

// F18: the driver's own signal files (maker-signal.json, checker-verdict.json)
// were swept into the branch by the auto-capture commit, so the PR carried them.
test("F18: the driver's signal files in the worktree are never committed", async () => {
  await repoWith({ track: true }, async (root, wt) => {
    await syncLoopStateInto({ root, cwd: wt, git: run(wt) });
    await writeFile(join(wt, "carja/1-workbench/maker-signal.json"), '{"done":true}');
    await writeFile(join(wt, "carja/1-workbench/checker-verdict.json"), '{"verdict":"approve"}');
    await writeFile(join(wt, "hello.txt"), "hi\n");
    git(wt, "add", "-A");
    git(wt, "commit", "-qm", "auto-capture");
    assert.equal(git(wt, "show", "--name-only", "--format=", "HEAD"), "hello.txt");
  });
});

test("a driver file a beat writes under a wrong folder (carja/carja/…) is not committed either", async () => {
  await repoWith({ track: true }, async (root, wt) => {
    await syncLoopStateInto({ root, cwd: wt, git: run(wt) });
    await mkdir(join(wt, "carja/carja/1-workbench"), { recursive: true });
    await writeFile(join(wt, "carja/carja/1-workbench/maker-signal.json"), '{"done":true}');
    await writeFile(join(wt, "hello.txt"), "hi\n");
    git(wt, "add", "-A");
    git(wt, "commit", "-qm", "auto-capture");
    assert.equal(git(wt, "show", "--name-only", "--format=", "HEAD"), "hello.txt");
  });
});
