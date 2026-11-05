// test/loop-catch-up.test.js
//
// Owner, 2026-10-22: "I open GitLab, review the MR, accept it. Then what? I
// can't just hit the up arrow, the merge will be on the main branch, not the
// current one." The loop reads the backlog, the slices and the Blueprint from
// the folder it runs in, so after a merge it must bring that folder up to the
// default branch itself: a fast-forward only, never a rebase or a stash.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync, spawnSync } from "node:child_process";
import { catchUpCheckout } from "../src/loop/reconcile.js";
import { runCli } from "../src/commands/loop.js";

const REPO = new URL("..", import.meta.url).pathname;
const G = (cwd, ...a) => execFileSync("git", a, { cwd, stdio: "pipe" }).toString().trim();
const gitIn = (cwd) => (a) => runCli("git", a, cwd);

/** A bare remote, the owner's clone on master, and a second clone that lands merges. */
function repos() {
  const base = mkdtempSync(join(tmpdir(), "catch-up-"));
  const root = join(base, "app");
  const other = join(base, "other");
  G(base, "init", "-q", "--bare", "-b", "master", "origin.git");
  for (const dir of [root, other]) {
    mkdirSync(dir);
    G(dir, "init", "-q", "-b", "master");
    G(dir, "config", "user.email", "t@t");
    G(dir, "config", "user.name", "t");
    G(dir, "remote", "add", "origin", join(base, "origin.git"));
  }
  writeFileSync(join(root, "backlog.md"), "- [ ] one\n");
  writeFileSync(join(root, "config.json"), "{}\n");
  G(root, "add", "-A");
  G(root, "commit", "-qm", "init");
  G(root, "push", "-q", "-u", "origin", "master");
  G(root, "remote", "set-head", "origin", "master");
  G(other, "pull", "-q", "origin", "master");
  return { base, root, other };
}

/** A merge lands on the remote: a new line in the backlog. */
function landMerge({ other }, file = "backlog.md", text = "- [ ] one\n- [ ] two\n") {
  writeFileSync(join(other, file), text);
  G(other, "commit", "-qam", "merged");
  G(other, "push", "-q", "origin", "master");
}

test("after a merge on the remote, the checkout fast-forwards to the default branch", async () => {
  const r = repos();
  try {
    landMerge(r);
    G(r.root, "fetch", "-q", "origin");
    const out = await catchUpCheckout({ git: gitIn(r.root) });
    assert.deepEqual(out, { status: "updated", ref: "origin/master", count: 1 });
    assert.match(readFileSync(join(r.root, "backlog.md"), "utf8"), /two/);
  } finally {
    rmSync(r.base, { recursive: true, force: true });
  }
});

test("an uncommitted edit to another file survives the fast-forward", async () => {
  const r = repos();
  try {
    landMerge(r);
    writeFileSync(join(r.root, "config.json"), '{ "mine": true }\n');
    G(r.root, "fetch", "-q", "origin");
    const out = await catchUpCheckout({ git: gitIn(r.root) });
    assert.equal(out.status, "updated");
    assert.match(readFileSync(join(r.root, "backlog.md"), "utf8"), /two/);
    assert.equal(readFileSync(join(r.root, "config.json"), "utf8"), '{ "mine": true }\n');
  } finally {
    rmSync(r.base, { recursive: true, force: true });
  }
});

test("a branch that diverged is left as it is, with the reason", async () => {
  const r = repos();
  try {
    landMerge(r);
    writeFileSync(join(r.root, "backlog.md"), "- [x] one\n");
    G(r.root, "commit", "-qam", "local");
    const head = G(r.root, "rev-parse", "HEAD");
    G(r.root, "fetch", "-q", "origin");
    const out = await catchUpCheckout({ git: gitIn(r.root) });
    assert.equal(out.status, "failed");
    assert.equal(out.ref, "origin/master");
    assert.ok(out.reason, "a reason is given");
    assert.equal(G(r.root, "rev-parse", "HEAD"), head, "nothing was rebased or merged");
  } finally {
    rmSync(r.base, { recursive: true, force: true });
  }
});

test("a branch that does not track the default branch is never touched", async () => {
  const r = repos();
  try {
    landMerge(r);
    G(r.root, "checkout", "-q", "-b", "feature");
    G(r.root, "fetch", "-q", "origin");
    assert.equal((await catchUpCheckout({ git: gitIn(r.root) })).status, "skipped");
    G(r.root, "branch", "-q", "--set-upstream-to", "origin/master");
    assert.equal((await catchUpCheckout({ git: gitIn(r.root) })).status, "updated", "a branch that tracks it, as the owner's loop folder does, is updated");
  } finally {
    rmSync(r.base, { recursive: true, force: true });
  }
});

test("an up-to-date checkout reports current", async () => {
  const r = repos();
  try {
    assert.deepEqual(await catchUpCheckout({ git: gitIn(r.root) }), { status: "current", ref: "origin/master", count: 0 });
  } finally {
    rmSync(r.base, { recursive: true, force: true });
  }
});

// The real CLI: the owner merges the Discovery, the Grand PRD and the UX/UI
// Brief on the remote, presses the up arrow, and the run sees them without any
// git step. Since 6.51.0 the loop starts only after the Technical Vision, so the
// run must name that one document, and only it, as missing.
const MERGED = ["genesis/problem-solar-system.md", "genesis/world-transformation.md", "genesis/functional-animator.md", "storyboard/main-character.md", "storyboard/storyboard.md", "blueprint/grand-prd.md", "blueprint/ux-ui-design-brief.md"];

test("carja loop <project> sees what was merged on the remote since the last run", () => {
  const base = mkdtempSync(join(tmpdir(), "catch-up-cli-"));
  try {
    const root = join(base, "app");
    const other = join(base, "other");
    const bin = join(base, "bin");
    mkdirSync(bin);
    writeFileSync(join(bin, "claude"), readFileSync(join(REPO, "test/fixtures/stub-engine/claude")), { mode: 0o755 });
    writeFileSync(join(bin, "gh"), '#!/bin/sh\n[ "$1" = auth ] && exit 0\n[ "$1" = pr ] && [ "$2" = list ] && exit 0\necho https://example.invalid/pr/1\n', { mode: 0o755 });
    execFileSync("node", [join(REPO, "bin/carja.js"), "init", root, "--all", "--no-detect"], { stdio: "pipe" });
    G(root, "init", "-q", "-b", "master");
    G(root, "config", "user.email", "t@t");
    G(root, "config", "user.name", "t");
    writeFileSync(join(root, "package.json"), '{ "name": "app", "type": "module", "scripts": { "test": "true" } }\n');
    mkdirSync(join(root, "carja/2-backlog/project-backlog/notes"), { recursive: true });
    writeFileSync(join(root, "carja/2-backlog/project-backlog/notes/README.md"), "# notes\n");
    const cfg = JSON.parse(readFileSync(join(root, "carja.config.json"), "utf8"));
    cfg.verify = "true";
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
    G(root, "push", "-q", "-u", "origin", "master");
    G(root, "remote", "set-head", "origin", "master");
    // The Discovery is merged on the remote, from another clone.
    G(base, "clone", "-q", join(base, "origin.git"), other);
    G(other, "config", "user.email", "t@t");
    G(other, "config", "user.name", "t");
    for (const rel of MERGED) {
      const p = join(other, "carja/2-backlog/project-backlog/notes", rel);
      mkdirSync(join(p, ".."), { recursive: true });
      writeFileSync(p, `# ${rel}\n\nnotes: writers keep notes.\n`);
    }
    G(other, "add", "-A");
    G(other, "commit", "-qm", "Discovery and Blueprint");
    G(other, "push", "-q", "origin", "master");

    const env = { ...process.env, PATH: `${bin}:${process.env.PATH}`, STUB_LOG_DIR: join(base, "log"), CARJA_HOME: join(base, "home") };
    const r = spawnSync("node", [join(REPO, "bin/carja.js"), "loop", "notes"], { cwd: root, encoding: "utf8", env, timeout: 120000 });
    assert.match(r.stdout, /updated to origin\/master \(1 new commit\)/, r.stdout + r.stderr);
    assert.match(r.stdout + r.stderr, /does not have the Technical Vision yet/, "the merged Grand PRD and UX/UI Brief are seen");
    assert.equal(G(root, "rev-parse", "master"), G(root, "rev-parse", "origin/master"), "the owner's checkout is the merged master");
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});
