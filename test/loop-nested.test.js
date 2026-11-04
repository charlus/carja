// test/loop-nested.test.js
//
// Unattended Lifecycle step 7: the loop in the outer layout (`loop.code_dir`).
// Pure parts, and the code worktree against real git: its base is the code
// repository's default branch, never the branch the owner has checked out.

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync, spawnSync } from "node:child_process";
import { ensureCodeWorktree, codeHasWork, mergeNested, stateMrBody, unionBranches, refusedNestedRepos, codePaths } from "../src/loop/nested.js";
import { parseLoopConfig } from "../src/loop/config.js";

const G = (cwd, ...a) => execFileSync("git", a, { cwd, stdio: "pipe" }).toString().trim();
const git = (cwd) => async (args) => {
  const r = spawnSync("git", args, { cwd, encoding: "utf8" });
  return { ok: r.status === 0, stdout: (r.stdout || "").trim(), stderr: (r.stderr || "").trim() };
};

test("loop.code_dir names the nested code repository: a relative folder, nothing else", () => {
  assert.equal(parseLoopConfig({}).codeDir, null);
  assert.equal(parseLoopConfig({ loop: { code_dir: "repo" } }).codeDir, "repo");
  assert.equal(parseLoopConfig({ loop: { code_dir: "repo/" } }).codeDir, "repo");
  for (const bad of ["", "/abs", "../up", "a/../b", 3]) assert.ok(parseLoopConfig({ loop: { code_dir: bad } }).errors.length, `${bad} is refused`);
});

test("the declared code repository is not refused; any other ignored nested repository still is", () => {
  assert.deepEqual(refusedNestedRepos(["repo/", "video/"], "repo"), ["video/"]);
  assert.deepEqual(refusedNestedRepos(["repo/"], null), ["repo/"]);
  assert.deepEqual(codePaths({ root: "/o", codeDir: "repo", outerWorktree: "/o/.agents/.worktrees/x" }), { codeRoot: "/o/repo", codeWorktree: "/o/.agents/.worktrees/x/repo" });
});

test("claims come from either remote", () => {
  assert.deepEqual([...unionBranches(new Set(["a"]), new Set(["b"]))].sort(), ["a", "b"]);
  assert.deepEqual([...unionBranches(null, new Set(["b"]))], ["b"]);
  assert.equal(unionBranches(null, null), null);
});

test("two MRs, code first; a failed code MR opens no state MR; a failed state MR names the open code MR", async () => {
  const calls = [];
  const ok = await mergeNested({
    hasCode: true,
    openCode: async () => (calls.push("code"), { ok: true, prUrl: "https://forge/code/1" }),
    openState: async ({ codeUrl }) => (calls.push(`state:${codeUrl}`), { ok: true, prUrl: "https://forge/state/2" }),
  });
  assert.deepEqual(calls, ["code", "state:https://forge/code/1"]);
  assert.deepEqual([ok.ok, ok.prUrl, ok.codeUrl], [true, "https://forge/state/2", "https://forge/code/1"]);

  const noState = [];
  const codeFails = await mergeNested({ hasCode: true, openCode: async () => ({ ok: false, reason: "push rejected" }), openState: async () => (noState.push(1), { ok: true }) });
  assert.equal(codeFails.ok, false);
  assert.match(codeFails.reason, /push rejected.*No state MR/);
  assert.equal(noState.length, 0);

  const stateFails = await mergeNested({ hasCode: true, openCode: async () => ({ ok: true, prUrl: "u1" }), openState: async () => ({ ok: false, reason: "glab down" }) });
  assert.equal(stateFails.ok, false);
  assert.match(stateFails.reason, /glab down.*The code MR is open: u1/);

  const docsOnly = [];
  const blueprint = await mergeNested({ hasCode: false, openCode: async () => (docsOnly.push("code"), { ok: true }), openState: async ({ codeUrl }) => (docsOnly.push(`state:${codeUrl}`), { ok: true, prUrl: "s" }) });
  assert.deepEqual(docsOnly, ["state:null"]);
  assert.equal(blueprint.ok, true);
  assert.match(stateMrBody({ codeUrl: "u1", body: "b" }), /Merge the code MR first:\*\* u1/);
});

test("the code worktree starts from the code repository's default branch, not the owner's checked-out branch", async () => {
  const base = mkdtempSync(join(tmpdir(), "nested-"));
  try {
    G(base, "init", "-q", "--bare", "-b", "main", "code.git");
    const code = join(base, "repo");
    execFileSync("git", ["clone", "-q", join(base, "code.git"), code], { stdio: "pipe" });
    G(code, "config", "user.email", "t@t");
    G(code, "config", "user.name", "t");
    writeFileSync(join(code, "app.py"), "x = 1\n");
    G(code, "add", "-A");
    G(code, "commit", "-qm", "main");
    G(code, "push", "-q", "-u", "origin", "main");
    G(code, "remote", "set-head", "origin", "main");
    // The owner is working on a feature branch in the main checkout.
    G(code, "checkout", "-q", "-b", "feat/owner");
    writeFileSync(join(code, "owner.py"), "wip = True\n");
    G(code, "add", "-A");
    G(code, "commit", "-qm", "owner wip");

    const wt = join(base, "outer-wt", "repo");
    const r = await ensureCodeWorktree({ codeGit: git(code), path: wt, branch: "carja/loop/x" });
    assert.equal(r.ok, true, r.reason);
    assert.equal(r.base, "origin/main");
    assert.equal(existsSync(join(wt, "app.py")), true);
    assert.equal(existsSync(join(wt, "owner.py")), false, "the owner's work in progress is not the base");
    assert.equal(G(code, "branch", "--show-current"), "feat/owner", "the owner's checkout is untouched");
    assert.equal(await codeHasWork({ codeGit: git(code), branch: "carja/loop/x" }), false);

    writeFileSync(join(wt, "built.py"), "built = True\n");
    G(wt, "add", "-A");
    G(wt, "commit", "-qm", "loop work");
    assert.equal(await codeHasWork({ codeGit: git(code), branch: "carja/loop/x" }), true);
    assert.equal((await ensureCodeWorktree({ codeGit: git(code), path: wt, branch: "carja/loop/x" })).reused, true, "a second run reuses it");
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});

test("F15: the sandbox may write what a commit in the code repository writes, never its config or hooks", async () => {
  const { nestedSandboxWrites } = await import("../src/loop/nested.js");
  const { mergeSandboxSettings } = await import("../src/loop/config.js");
  const writes = nestedSandboxWrites("/w/app/repo/.git");
  assert.deepEqual(writes, ["/w/app/repo/.git/objects", "/w/app/repo/.git/refs", "/w/app/repo/.git/logs", "/w/app/repo/.git/worktrees"]);
  assert.ok(!writes.some((p) => /config|hooks/.test(p)));
  const s = mergeSandboxSettings({ sandbox: { enabled: true, filesystem: { allowWrite: ["/x"] } } }, [], writes);
  assert.deepEqual(s.sandbox.filesystem.allowWrite, ["/x", ...writes]);
  assert.equal(mergeSandboxSettings({ sandbox: {} }, []).sandbox.filesystem, undefined, "nothing added outside the outer layout");
});
