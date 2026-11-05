// test/loop-reconcile.test.js
//
// Unattended Lifecycle step 2 (docs/roadmap/Unattended-Lifecycle.md):
//   - claims come from git: an item whose loop branch is on the remote is in
//     progress or in review, so the harvester skips it. The loop no longer
//     commits 🤖 claim markers into the owner's checkout.
//   - reconcile on the next git touch: loop worktrees and local branches already
//     merged into the default branch are removed. Never one with uncommitted
//     work, never one whose branch is not provably merged.
// Real git in temp repos: this is a git behaviour, not a stub's.

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync, spawnSync } from "node:child_process";
import { pruneMergedLoopWorktrees, mergedLoopWorktrees, skipClaimed, defaultBranchRef } from "../src/loop/reconcile.js";

const G = (cwd, ...a) => execFileSync("git", a, { cwd, stdio: "pipe" }).toString().trim();
const git = (cwd) => async (args) => {
  const r = spawnSync("git", args, { cwd, encoding: "utf8" });
  return { ok: r.status === 0, stdout: (r.stdout || "").trim(), stderr: (r.stderr || "").trim() };
};

function setup() {
  const base = mkdtempSync(join(tmpdir(), "reconcile-"));
  const bare = join(base, "origin.git");
  const repo = join(base, "repo");
  execFileSync("git", ["init", "-q", "--bare", "-b", "master", bare]);
  execFileSync("git", ["clone", "-q", bare, repo], { stdio: "pipe" });
  G(repo, "config", "user.email", "t@t");
  G(repo, "config", "user.name", "t");
  writeFileSync(join(repo, "a.txt"), "a\n");
  G(repo, "add", "-A");
  G(repo, "commit", "-qm", "init");
  G(repo, "push", "-q", "-u", "origin", "master");
  G(repo, "remote", "set-head", "origin", "master");
  return { base, repo };
}

function loopWorktree(repo, name) {
  const path = join(repo, ".agents/.worktrees", name);
  G(repo, "worktree", "add", "-q", "-b", `carja/loop/${name}`, path);
  writeFileSync(join(path, `${name}.txt`), "work\n");
  G(path, "add", "-A");
  G(path, "commit", "-qm", `work ${name}`);
  G(path, "push", "-q", "-u", "origin", `carja/loop/${name}`);
  return path;
}

test("a merged loop worktree is removed; unmerged and dirty ones are kept", async () => {
  const { base, repo } = setup();
  try {
    const merged = loopWorktree(repo, "merged");
    const open = loopWorktree(repo, "open");
    const dirty = loopWorktree(repo, "dirty");
    // The owner merges two MRs on the forge; the third stays open.
    G(repo, "merge", "-q", "--no-ff", "-m", "merge", "carja/loop/merged", "carja/loop/dirty");
    G(repo, "push", "-q", "origin", "master");
    writeFileSync(join(dirty, "uncommitted.txt"), "not committed\n");
    G(repo, "fetch", "-q", "origin");

    assert.equal(await defaultBranchRef(git(repo)), "origin/master");
    const found = await mergedLoopWorktrees({ git: git(repo) });
    assert.deepEqual(found.map((w) => w.branch).sort(), ["carja/loop/dirty", "carja/loop/merged"]);

    const pruned = await pruneMergedLoopWorktrees({ git: git(repo) });
    assert.deepEqual(pruned.removed.map((w) => w.branch), ["carja/loop/merged"]);
    assert.deepEqual(pruned.kept.map((w) => w.branch), ["carja/loop/dirty"]);
    assert.match(pruned.kept[0].reason, /uncommitted/);
    assert.equal(existsSync(merged), false);
    assert.equal(existsSync(open), true, "an open MR's worktree stays");
    assert.equal(existsSync(dirty), true, "uncommitted work is never removed");
    assert.equal(G(repo, "branch", "--list", "carja/loop/merged"), "", "the merged local branch is deleted");
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});

test("skipClaimed leaves out items whose loop branch is on the remote, and names merged-but-open ones", () => {
  const queue = [{ id: "task:a" }, { id: "task:b" }, { id: "task:c" }];
  const branchFor = (t) => `carja/loop/loop-${t.id.replace(/[^a-z0-9]+/g, "-")}`;
  const r = skipClaimed(queue, {
    remoteBranches: new Set(["carja/loop/loop-task-a", "carja/loop/loop-task-c"]),
    mergedBranches: new Set(["carja/loop/loop-task-c"]),
    branchFor,
  });
  assert.deepEqual(r.queue.map((t) => t.id), ["task:b"]);
  assert.deepEqual(r.inReview.map((t) => t.id), ["task:a"]);
  assert.deepEqual(r.mergedButOpen.map((t) => t.id), ["task:c"]);
});

test("the post-merge hook removes a merged loop worktree when the owner pulls", () => {
  const { base, repo } = setup();
  try {
    const hooks = join(repo, ".agents/hooks");
    execFileSync("mkdir", ["-p", hooks]);
    for (const f of ["post-merge", "lib.sh"]) {
      writeFileSync(join(hooks, f), execFileSync("cat", [new URL(`../templates/.agents/hooks/${f}`, import.meta.url).pathname]));
    }
    execFileSync("chmod", ["+x", join(hooks, "post-merge")]);
    const path = loopWorktree(repo, "shipped");
    // The merge happens on the forge, here a second clone.
    const forge = join(base, "forge");
    execFileSync("git", ["clone", "-q", join(base, "origin.git"), forge], { stdio: "pipe" });
    G(forge, "config", "user.email", "t@t");
    G(forge, "config", "user.name", "t");
    G(forge, "merge", "-q", "--no-ff", "-m", "merge MR", "origin/carja/loop/shipped");
    G(forge, "push", "-q", "origin", "master");
    G(repo, "config", "core.hooksPath", ".agents/hooks");
    const out = execFileSync("git", ["pull", "-q", "--no-rebase", "origin", "master"], { cwd: repo, stdio: "pipe" }).toString();
    assert.equal(existsSync(path), false, `the worktree is still there; hook said: ${out}`);
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});

test("carja status names merged loop worktrees and deletes nothing", async () => {
  const { base, repo } = setup();
  try {
    const { initCommand } = await import("../src/commands/init.js");
    const { statusCommand } = await import("../src/commands/status.js");
    const sink = () => ({ text: "", write(s) { this.text += s; } });
    await initCommand([repo, "--all", "--no-detect"], { cwd: tmpdir(), stdout: sink(), stderr: sink() });
    const path = loopWorktree(repo, "done");
    G(repo, "merge", "-q", "--no-ff", "-m", "merge", "carja/loop/done");
    G(repo, "push", "-q", "origin", "master");
    G(repo, "fetch", "-q", "origin");
    const out = sink();
    await statusCommand([repo, "--no-color"], { cwd: repo, stdout: out, stderr: sink() });
    assert.match(out.text, /1 merged worktree \(carja\/loop\/done\)/);
    assert.equal(existsSync(path), true, "status never deletes");
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});

test("step 7: a merged outer worktree that still holds a code worktree is kept, by the loop and by the post-merge hook", async () => {
  const { base, repo } = setup();
  try {
    const hooks = join(repo, ".agents/hooks");
    execFileSync("mkdir", ["-p", hooks]);
    for (const f of ["post-merge", "lib.sh"]) writeFileSync(join(hooks, f), execFileSync("cat", [new URL(`../templates/.agents/hooks/${f}`, import.meta.url).pathname]));
    execFileSync("chmod", ["+x", join(hooks, "post-merge")]);
    const path = loopWorktree(repo, "slice");
    // The code worktree of another repository, inside the outer one (gitignored there).
    const code = join(base, "code");
    G(base, "init", "-q", "-b", "main", "code");
    G(code, "config", "user.email", "t@t");
    G(code, "config", "user.name", "t");
    writeFileSync(join(code, "a.py"), "a\n");
    G(code, "add", "-A");
    G(code, "commit", "-qm", "init");
    G(code, "worktree", "add", "-q", "-b", "carja/loop/slice", join(path, "repo"));
    const forge = join(base, "forge");
    execFileSync("git", ["clone", "-q", join(base, "origin.git"), forge], { stdio: "pipe" });
    G(forge, "config", "user.email", "t@t");
    G(forge, "config", "user.name", "t");
    G(forge, "merge", "-q", "--no-ff", "-m", "merge state MR", "origin/carja/loop/slice");
    G(forge, "push", "-q", "origin", "master");
    G(repo, "fetch", "-q", "origin");

    const keep = async (w) => (existsSync(join(w.path, "repo", ".git")) ? "its code worktree is still open" : null);
    const pruned = await pruneMergedLoopWorktrees({ git: git(repo), skip: keep });
    assert.deepEqual(pruned.removed, []);
    assert.match(pruned.kept[0].reason, /code worktree/);

    G(repo, "config", "core.hooksPath", ".agents/hooks");
    execFileSync("git", ["pull", "-q", "--no-rebase", "origin", "master"], { cwd: repo, stdio: "pipe" });
    assert.equal(existsSync(join(path, "repo", "a.py")), true, "the pull did not delete the open code worktree");
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});

// F22: 6.40 squash-merges loop MRs and the forge deletes the source branch, so
// `merge-base --is-ancestor` never sees them merged. The forge's word decides,
// and only when the merged MR's head is the local branch head (nothing unpushed).
function squashOnForge(base, branch) {
  const forge = join(base, "forge");
  execFileSync("git", ["clone", "-q", join(base, "origin.git"), forge], { stdio: "pipe" });
  G(forge, "config", "user.email", "t@t");
  G(forge, "config", "user.name", "t");
  G(forge, "merge", "-q", "--squash", `origin/${branch}`);
  G(forge, "commit", "-qm", "squashed MR");
  G(forge, "push", "-q", "origin", "master");
  G(forge, "push", "-q", "origin", "--delete", branch);
}

test("F22: a squash-merged loop worktree is removed when the forge reports its MR merged at the branch head", async () => {
  const { base, repo } = setup();
  try {
    const squashed = loopWorktree(repo, "squashed");
    const ahead = loopWorktree(repo, "ahead");
    const gone = loopWorktree(repo, "gone");
    const heads = {
      "carja/loop/squashed": G(repo, "rev-parse", "carja/loop/squashed"),
      "carja/loop/ahead": G(repo, "rev-parse", "carja/loop/ahead"),
    };
    squashOnForge(base, "carja/loop/squashed");
    // A commit made after the MR merged: never lost.
    writeFileSync(join(ahead, "later.txt"), "later\n");
    G(ahead, "add", "-A");
    G(ahead, "commit", "-qm", "later");
    // The remote branch is gone but no MR was merged: not a merge.
    G(repo, "push", "-q", "origin", "--delete", "carja/loop/gone");
    G(repo, "fetch", "-q", "--prune", "origin");

    const forgeMerged = async (branch) => heads[branch] ?? null;
    const pruned = await pruneMergedLoopWorktrees({ git: git(repo), forgeMerged });
    assert.deepEqual(pruned.removed.map((w) => w.branch), ["carja/loop/squashed"]);
    assert.deepEqual(pruned.kept.map((w) => w.branch), ["carja/loop/ahead"]);
    assert.match(pruned.kept[0].reason, /commits after its merged MR/);
    assert.equal(existsSync(squashed), false);
    assert.equal(G(repo, "branch", "--list", "carja/loop/squashed"), "", "the squashed local branch is deleted");
    assert.equal(existsSync(ahead), true);
    assert.equal(existsSync(gone), true, "a deleted remote branch alone is not a merge");

    // Without the forge, nothing squash-merged is removed.
    const local = await pruneMergedLoopWorktrees({ git: git(repo) });
    assert.deepEqual(local.removed, []);
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});

test("F22: the post-merge hook asks the forge about a squash-merged loop branch", () => {
  const { base, repo } = setup();
  try {
    const hooks = join(repo, ".agents/hooks");
    execFileSync("mkdir", ["-p", hooks]);
    for (const f of ["post-merge", "lib.sh"]) writeFileSync(join(hooks, f), execFileSync("cat", [new URL(`../templates/.agents/hooks/${f}`, import.meta.url).pathname]));
    execFileSync("chmod", ["+x", join(hooks, "post-merge")]);
    const squashed = loopWorktree(repo, "squashed");
    const open = loopWorktree(repo, "open");
    const head = G(repo, "rev-parse", "carja/loop/squashed");
    squashOnForge(base, "carja/loop/squashed");
    // A stub glab: the GitLab API answers for the squashed branch only.
    const bin = join(base, "bin");
    execFileSync("mkdir", ["-p", bin]);
    writeFileSync(
      join(bin, "glab"),
      `#!/bin/sh\ncase "$*" in *source_branch=carja%2Floop%2Fsquashed*) printf '[{"iid":7,"merge_commit_sha":null,"sha":"${head}","state":"merged"}]' ;; *) printf '[]' ;; esac\n`
    );
    execFileSync("chmod", ["+x", join(bin, "glab")]);
    G(repo, "remote", "set-url", "origin", join(base, "origin.git"));
    G(repo, "config", "core.hooksPath", ".agents/hooks");
    const out = execFileSync("git", ["pull", "-q", "--no-rebase", "origin", "master"], {
      cwd: repo, stdio: "pipe", env: { ...process.env, PATH: `${bin}:${process.env.PATH}` },
    }).toString();
    assert.equal(existsSync(squashed), false, `the squashed worktree is still there; hook said: ${out}`);
    assert.equal(existsSync(open), true, "an open MR's worktree stays");
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});

// 2026-10-22 (autopportunity): two loops on one repository. The second loop's
// start-up cleanup removed the first loop's LIVE worktree: a fresh loop branch
// has no commit of its own yet, so it sits on the default branch's own history
// and `merge-base --is-ancestor` called it merged. Worktrees are shared by every
// checkout of a repository, so one loop sees the other's.
function freshLoopWorktree(repo, name) {
  const path = join(repo, ".agents/.worktrees", name);
  G(repo, "worktree", "add", "-q", "-b", `carja/loop/${name}`, path, "origin/master");
  return path;
}

test("a fresh loop worktree (no commit of its own yet) is not merged, and is never removed", async () => {
  const { base, repo } = setup();
  try {
    const fresh = freshLoopWorktree(repo, "fresh");
    G(repo, "fetch", "-q", "origin");
    assert.deepEqual(await mergedLoopWorktrees({ git: git(repo) }), []);
    const pruned = await pruneMergedLoopWorktrees({ git: git(repo) });
    assert.deepEqual(pruned.removed, []);
    assert.equal(existsSync(fresh), true, "a live run's fresh worktree survives another loop's cleanup");
    assert.notEqual(G(repo, "branch", "--list", "carja/loop/fresh"), "");
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});

test("a merged loop worktree that a live run holds is kept", async () => {
  const { base, repo } = setup();
  try {
    const held = loopWorktree(repo, "held");
    G(repo, "merge", "-q", "--no-ff", "-m", "merge", "carja/loop/held");
    G(repo, "push", "-q", "origin", "master");
    G(repo, "fetch", "-q", "origin");
    const { markWorktreeHeld } = await import("../src/loop/reconcile.js");
    await markWorktreeHeld({ git: git(held), pid: process.pid });
    const pruned = await pruneMergedLoopWorktrees({ git: git(repo) });
    assert.deepEqual(pruned.removed, []);
    assert.match(pruned.kept[0].reason, /live loop run/);
    assert.equal(existsSync(held), true);
    // Once its holder is gone, the merged worktree goes.
    await markWorktreeHeld({ git: git(held), pid: 2 ** 22 + 12345 });
    const again = await pruneMergedLoopWorktrees({ git: git(repo) });
    assert.deepEqual(again.removed.map((w) => w.branch), ["carja/loop/held"]);
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});

test("the post-merge hook leaves a fresh loop worktree and a held one alone", () => {
  const { base, repo } = setup();
  try {
    const hooks = join(repo, ".agents/hooks");
    execFileSync("mkdir", ["-p", hooks]);
    for (const f of ["post-merge", "lib.sh"]) writeFileSync(join(hooks, f), execFileSync("cat", [new URL(`../templates/.agents/hooks/${f}`, import.meta.url).pathname]));
    execFileSync("chmod", ["+x", join(hooks, "post-merge")]);
    const fresh = freshLoopWorktree(repo, "fresh");
    const held = loopWorktree(repo, "held");
    writeFileSync(join(G(held, "rev-parse", "--path-format=absolute", "--git-dir"), "carja-holder"), `${JSON.stringify({ pid: process.pid, at: "now" })}\n`);
    const forge = join(base, "forge");
    execFileSync("git", ["clone", "-q", join(base, "origin.git"), forge], { stdio: "pipe" });
    G(forge, "config", "user.email", "t@t");
    G(forge, "config", "user.name", "t");
    writeFileSync(join(forge, "b.txt"), "b\n");
    G(forge, "add", "-A");
    G(forge, "commit", "-qm", "someone else's work");
    G(forge, "merge", "-q", "--no-ff", "-m", "merge MR", "origin/carja/loop/held");
    G(forge, "push", "-q", "origin", "master");
    G(repo, "config", "core.hooksPath", ".agents/hooks");
    execFileSync("git", ["pull", "-q", "--no-rebase", "origin", "master"], { cwd: repo, stdio: "pipe" });
    assert.equal(existsSync(fresh), true, "the pull deleted a fresh loop worktree");
    assert.equal(existsSync(held), true, "the pull deleted a worktree a live run holds");
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});

test("carja loop <project> removes the clean worktrees it held at the end, keeps uncommitted work, and leaves other runs alone", async () => {
  const { base, repo } = setup();
  try {
    const { markWorktreeHeld, removeHeldWorktrees } = await import("../src/loop/reconcile.js");
    const pushed = loopWorktree(repo, "pushed"); // committed and pushed: worktree and branch go
    const dirty = loopWorktree(repo, "dirty");
    writeFileSync(join(dirty, "wip.txt"), "uncommitted\n");
    const local = freshLoopWorktree(repo, "local");
    writeFileSync(join(local, "c.txt"), "c\n");
    G(local, "add", "-A");
    G(local, "commit", "-qm", "local only"); // committed, not pushed: worktree goes, branch stays
    const other = loopWorktree(repo, "other"); // another run's
    for (const p of [pushed, dirty, local]) await markWorktreeHeld({ git: git(p), pid: process.pid });
    await markWorktreeHeld({ git: git(other), pid: process.pid + 1 });

    const r = await removeHeldWorktrees({ git: git(repo), pid: process.pid });
    assert.deepEqual(r.removed.map((w) => w.branch).sort(), ["carja/loop/local", "carja/loop/pushed"]);
    assert.deepEqual(r.kept.map((w) => w.branch), ["carja/loop/dirty"]);
    assert.equal(existsSync(pushed), false);
    assert.equal(existsSync(local), false);
    assert.equal(existsSync(dirty), true, "uncommitted work is kept");
    assert.equal(existsSync(other), true, "another run's worktree is not ours to remove");
    assert.equal(G(repo, "branch", "--list", "carja/loop/pushed"), "", "a pushed branch is deleted with its worktree");
    assert.notEqual(G(repo, "branch", "--list", "carja/loop/local"), "", "an unpushed branch keeps its commits");
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});
