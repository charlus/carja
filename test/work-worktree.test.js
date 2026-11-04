// test/work-worktree.test.js
//
// Interactive work is branch-safe (owner, 2026-10-22): "the owner's folder (and
// its nested code repository) always stays on the default branch". Interactive
// Spec-It, Build and Ship work in one hidden worktree per item, made by
// `carja work <item>`; merged ones go on `git pull` and at a loop run, the
// way the loop's own do; `carja status` says when a folder is off its
// default branch. Real git in temp repositories: this is git behaviour.

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, rmSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync, spawnSync } from "node:child_process";
import { runCli } from "../src/cli.js";
import { pruneMergedLoopWorktrees, WORK_PREFIX, LOOP_PREFIX } from "../src/loop/reconcile.js";

const G = (cwd, ...a) => execFileSync("git", a, { cwd, stdio: "pipe" }).toString().trim();
const git = (cwd) => async (args) => {
  const r = spawnSync("git", args, { cwd, encoding: "utf8" });
  return { ok: r.status === 0, stdout: (r.stdout || "").trim(), stderr: (r.stderr || "").trim() };
};
const sink = () => ({ text: "", write(s) { this.text += s; } });
const run = async (args, cwd) => {
  const io = { stdout: sink(), stderr: sink(), cwd: () => cwd };
  const code = await runCli(args, io);
  return { code, out: io.stdout.text, err: io.stderr.text };
};

/** A repository with an origin, `carja/` and `.agents/`; returns {base, repo, bare}. */
function repoWithOrigin(base, name, files = {}) {
  const bare = join(base, `${name}.git`);
  const repo = join(base, name);
  execFileSync("git", ["init", "-q", "--bare", "-b", "main", bare]);
  execFileSync("git", ["clone", "-q", bare, repo], { stdio: "pipe" });
  G(repo, "config", "user.email", "t@t");
  G(repo, "config", "user.name", "t");
  for (const [f, body] of Object.entries({ "a.txt": "a\n", ...files })) {
    mkdirSync(join(repo, f, ".."), { recursive: true });
    writeFileSync(join(repo, f), body);
  }
  G(repo, "add", "-A");
  G(repo, "commit", "-qm", "init");
  G(repo, "push", "-q", "-u", "origin", "main");
  G(repo, "remote", "set-head", "origin", "main");
  return { repo, bare };
}

function singleLayout() {
  const base = mkdtempSync(join(tmpdir(), "work-"));
  const { repo } = repoWithOrigin(base, "proj", { "carja/1-workbench/inbox.md": "# Inbox\n", ".agents/AGENTS.md": "x\n", "src/a.js": "export const a = 1;\n" });
  return { base, root: repo };
}

/** Outer layout: private outer repo, gitignored nested code repo `repo/` with its own origin. */
function outerLayout({ setup } = {}) {
  const base = mkdtempSync(join(tmpdir(), "work-outer-"));
  const config = { verify: "none", loop: { code_dir: "repo", ...(setup ? { setup } : {}) } };
  const { repo: root } = repoWithOrigin(base, "outer", {
    "carja/1-workbench/inbox.md": "# Inbox\n",
    ".agents/AGENTS.md": "x\n",
    ".gitignore": "repo/\n",
    "carja.config.json": `${JSON.stringify(config)}\n`,
  });
  const { bare: codeBare } = repoWithOrigin(base, "code-src", { "src/a.js": "export const a = 1;\n" });
  execFileSync("git", ["clone", "-q", codeBare, join(root, "repo")], { stdio: "pipe" });
  G(join(root, "repo"), "config", "user.email", "t@t");
  G(join(root, "repo"), "config", "user.name", "t");
  G(join(root, "repo"), "remote", "set-head", "origin", "main");
  return { base, root, code: join(root, "repo") };
}

test("carja work <item> makes the item's branch in a hidden worktree from the default branch, and never moves the owner's folder", async () => {
  const { base, root } = singleLayout();
  try {
    // The owner sits on a feature branch with a local commit: it must not become the base.
    G(root, "checkout", "-q", "-b", "owner/feature");
    writeFileSync(join(root, "owner.txt"), "mine\n");
    G(root, "add", "-A");
    G(root, "commit", "-qm", "owner work");
    const r = await run(["work", "cop-availability/01-cockpit-access", root], root);
    assert.equal(r.code, 0, r.err);
    const wt = join(root, ".agents/.worktrees/work-cop-availability-01-cockpit-access");
    assert.ok(existsSync(wt), r.out);
    assert.match(r.out, new RegExp(wt.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
    assert.equal(G(wt, "rev-parse", "--abbrev-ref", "HEAD"), `${WORK_PREFIX}cop-availability-01-cockpit-access`);
    assert.equal(G(wt, "rev-parse", "HEAD"), G(root, "rev-parse", "origin/main"), "the base is the default branch, not the owner's branch");
    assert.equal(G(root, "rev-parse", "--abbrev-ref", "HEAD"), "owner/feature", "the owner's folder never moves");
    assert.equal(G(root, "status", "--porcelain"), "", "the worktree is git-excluded in the owner's folder");
    // Again: the same worktree, reused.
    const again = await run(["work", "cop-availability/01-cockpit-access", root], root);
    assert.equal(again.code, 0, again.err);
    assert.match(again.out, /reused|already/i);
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});

test("in the outer layout, the code repository gets a worktree on the same branch, inside the item's worktree, and setup runs there", async () => {
  const { base, root, code } = outerLayout({ setup: "touch setup-ran" });
  try {
    G(code, "checkout", "-q", "-b", "owner/code-feature");
    const r = await run(["work", "kb-search", root], root);
    assert.equal(r.code, 0, r.err);
    const wt = join(root, ".agents/.worktrees/work-kb-search");
    const codeWt = join(wt, "repo");
    assert.equal(G(codeWt, "rev-parse", "--abbrev-ref", "HEAD"), `${WORK_PREFIX}kb-search`);
    assert.equal(G(codeWt, "rev-parse", "HEAD"), G(code, "rev-parse", "origin/main"));
    assert.equal(G(code, "rev-parse", "--abbrev-ref", "HEAD"), "owner/code-feature", "the owner's code checkout never moves");
    assert.ok(existsSync(join(codeWt, "setup-ran")), "loop.setup runs in the code worktree");
    assert.match(r.out, /repo/);
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});

test("carja work inside an item's worktree, or a loop beat's, makes nothing and names where it is", async () => {
  const { base, root } = singleLayout();
  try {
    const loopWt = join(root, ".agents/.worktrees/loop-x");
    G(root, "worktree", "add", "-q", "-b", `${LOOP_PREFIX}loop-x`, loopWt);
    const r = await run(["work", "something-else"], loopWt);
    assert.equal(r.code, 0, r.err);
    assert.match(r.out, /already/i);
    assert.equal(existsSync(join(root, ".agents/.worktrees/work-something-else")), false);
    assert.equal(existsSync(join(loopWt, ".agents/.worktrees")), false, "no worktree inside a worktree");
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});

test("a merged interactive worktree is removed by the same prune the loop uses; open, fresh and dirty ones stay", async () => {
  const { base, root } = singleLayout();
  try {
    const mk = async (item, { commit = true } = {}) => {
      await run(["work", item, root], root);
      const p = join(root, `.agents/.worktrees/work-${item}`);
      if (commit) {
        writeFileSync(join(p, `${item}.txt`), "x\n");
        G(p, "add", "-A");
        G(p, "commit", "-qm", item);
      }
      return p;
    };
    const merged = await mk("merged");
    const open = await mk("open");
    const fresh = await mk("fresh", { commit: false });
    const dirty = await mk("dirty");
    G(root, "merge", "-q", "--no-ff", "-m", "m", `${WORK_PREFIX}merged`, `${WORK_PREFIX}dirty`);
    G(root, "push", "-q", "origin", "HEAD:main");
    G(root, "fetch", "-q", "origin");
    writeFileSync(join(dirty, "wip.txt"), "wip\n");
    const r = await pruneMergedLoopWorktrees({ git: git(root), prefixes: [LOOP_PREFIX, WORK_PREFIX] });
    assert.deepEqual(r.removed.map((w) => w.branch), [`${WORK_PREFIX}merged`]);
    assert.equal(existsSync(merged), false);
    assert.ok(existsSync(open) && existsSync(fresh) && existsSync(dirty));
    // The loop's default prune still only touches loop branches.
    const loopOnly = await pruneMergedLoopWorktrees({ git: git(root) });
    assert.deepEqual(loopOnly.removed, []);
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});

test("the post-merge hook removes a merged interactive worktree when the owner pulls", async () => {
  const { base, root } = singleLayout();
  try {
    const hooks = join(root, ".agents/hooks");
    mkdirSync(hooks, { recursive: true });
    for (const f of ["post-merge", "lib.sh"]) writeFileSync(join(hooks, f), readFileSync(new URL(`../templates/.agents/hooks/${f}`, import.meta.url)));
    execFileSync("chmod", ["+x", join(hooks, "post-merge")]);
    await run(["work", "shipped", root], root);
    const p = join(root, ".agents/.worktrees/work-shipped");
    writeFileSync(join(p, "s.txt"), "s\n");
    G(p, "add", "-A");
    G(p, "commit", "-qm", "s");
    G(p, "push", "-q", "-u", "origin", `${WORK_PREFIX}shipped`);
    const forge = join(base, "forge");
    execFileSync("git", ["clone", "-q", join(base, "proj.git"), forge], { stdio: "pipe" });
    G(forge, "config", "user.email", "t@t");
    G(forge, "config", "user.name", "t");
    G(forge, "merge", "-q", "--no-ff", "-m", "merge MR", `origin/${WORK_PREFIX}shipped`);
    G(forge, "push", "-q", "origin", "main");
    G(root, "config", "core.hooksPath", ".agents/hooks");
    G(root, "pull", "-q", "--no-rebase", "origin", "main");
    assert.equal(existsSync(p), false);
    assert.equal(G(root, "branch", "--list", `${WORK_PREFIX}shipped`), "");
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});

test("carja work clean removes merged item worktrees, the code one first", async () => {
  const { base, root, code } = outerLayout();
  try {
    await run(["work", "done", root], root);
    const wt = join(root, ".agents/.worktrees/work-done");
    for (const [dir, remoteRepo] of [[join(wt, "repo"), code], [wt, root]]) {
      writeFileSync(join(dir, "d.txt"), "d\n");
      G(dir, "add", "-A");
      G(dir, "commit", "-qm", "d");
      G(remoteRepo, "merge", "-q", "--no-ff", "-m", "m", `${WORK_PREFIX}done`);
      G(remoteRepo, "push", "-q", "origin", "HEAD:main");
      G(remoteRepo, "fetch", "-q", "origin");
    }
    const r = await run(["work", "clean", root], root);
    assert.equal(r.code, 0, r.err);
    assert.equal(existsSync(wt), false, r.out);
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});

test("carja status warns when the owner's folder or its code repository is off the default branch", async () => {
  const { base, root, code } = outerLayout();
  try {
    const clean = await run(["status", root, "--no-color"], root);
    assert.doesNotMatch(clean.out, /not on its default branch/);
    G(root, "checkout", "-q", "-b", "docs/x");
    G(code, "checkout", "-q", "-b", "feat/y");
    const r = await run(["status", root, "--no-color"], root);
    assert.match(r.out, /docs\/x/);
    assert.match(r.out, /repo\/.*feat\/y|feat\/y.*repo/);
    assert.match(r.out, /not on its default branch/);
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});
