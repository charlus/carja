// test/hooks-default-branch.test.js
//
// The owner's folder stays on the default branch, and code reaches it only
// through a merged MR (owner, 2026-10-22). Enforced in code: pre-commit refuses
// a commit of code on the default branch of a repository that has a remote, in
// the main checkout and in a nested code repository. Carja's own files
// (carja/, .agents/, AGENTS.md, carja.config.json, .gitattributes) may
// still be committed there: the inbox, the loop state, an upgrade without a
// remote. A waiver is logged. Real git, real hooks.

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, rmSync, mkdirSync, readFileSync, cpSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync, spawnSync } from "node:child_process";

const HOOKS = new URL("../templates/.agents/hooks/", import.meta.url).pathname;
const G = (cwd, ...a) => execFileSync("git", a, { cwd, stdio: "pipe" }).toString().trim();
const commit = (cwd, env = {}) => spawnSync("git", ["commit", "-qm", "x"], { cwd, encoding: "utf8", env: { ...process.env, ...env } });

function project({ remote = true } = {}) {
  const base = mkdtempSync(join(tmpdir(), "defbranch-"));
  const root = join(base, "proj");
  if (remote) {
    execFileSync("git", ["init", "-q", "--bare", "-b", "main", join(base, "proj.git")]);
    execFileSync("git", ["clone", "-q", join(base, "proj.git"), root], { stdio: "pipe" });
  } else {
    mkdirSync(root);
    G(root, "init", "-q", "-b", "main");
  }
  G(root, "config", "user.email", "t@t");
  G(root, "config", "user.name", "t");
  mkdirSync(join(root, ".agents"), { recursive: true });
  cpSync(HOOKS, join(root, ".agents/hooks"), { recursive: true });
  mkdirSync(join(root, "carja/0-compass"), { recursive: true });
  writeFileSync(join(root, "carja/0-compass/ship-log.md"), "# Ship log\n");
  writeFileSync(join(root, "carja.config.json"), '{ "verify": "none" }\n');
  G(root, "add", "-A");
  execFileSync("git", ["commit", "-qm", "init"], { cwd: root, env: { ...process.env, CARJA_HOOKS: "off" } });
  if (remote) {
    G(root, "push", "-q", "-u", "origin", "main");
    G(root, "remote", "set-head", "origin", "main");
  }
  G(root, "config", "core.hooksPath", ".agents/hooks");
  return { base, root };
}

const stageCode = (root, name = "src/a.js") => {
  mkdirSync(join(root, "src"), { recursive: true });
  mkdirSync(join(root, "test"), { recursive: true });
  writeFileSync(join(root, name), "export const a = 1;\n");
  writeFileSync(join(root, "test/a.test.js"), "test('a', () => { expect(1).toBe(1); });\n");
  G(root, "add", "-A");
};

test("a commit of code on the default branch is refused, and names the item worktree", () => {
  const { base, root } = project();
  try {
    stageCode(root);
    const r = commit(root);
    assert.notEqual(r.status, 0, "code on main went through");
    assert.match(r.stdout + r.stderr, /default branch/);
    assert.match(r.stdout + r.stderr, /carja work/);
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});

test("the same code on an item branch goes through", () => {
  const { base, root } = project();
  try {
    G(root, "checkout", "-q", "-b", "carja/work/a");
    stageCode(root);
    const r = commit(root);
    assert.equal(r.status, 0, r.stdout + r.stderr);
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});

test("Carja's own files may still be committed on the default branch", () => {
  const { base, root } = project();
  try {
    writeFileSync(join(root, "carja/0-compass/ship-log.md"), "# Ship log\n\n- note\n");
    mkdirSync(join(root, "carja/1-workbench"), { recursive: true });
    writeFileSync(join(root, "carja/1-workbench/inbox.md"), "- idea\n");
    writeFileSync(join(root, "AGENTS.md"), "card\n");
    G(root, "add", "-A");
    const r = commit(root);
    assert.equal(r.status, 0, r.stdout + r.stderr);
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});

test("without a remote there is no MR flow, so the rule does not apply", () => {
  const { base, root } = project({ remote: false });
  try {
    stageCode(root);
    const r = commit(root);
    assert.equal(r.status, 0, r.stdout + r.stderr);
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});

test("a waiver lets it through and is logged in the ship-log", () => {
  const { base, root } = project();
  try {
    stageCode(root);
    const r = commit(root, { CARJA_ON_DEFAULT: "hotfix agreed with the team" });
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.match(readFileSync(join(root, "carja/0-compass/ship-log.md"), "utf8"), /hotfix agreed with the team/);
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});

test("in a nested code repository, any commit on its default branch is refused", () => {
  const { base, root } = project();
  try {
    writeFileSync(join(root, ".gitignore"), "app/\n");
    G(root, "add", "-A");
    commit(root);
    execFileSync("git", ["init", "-q", "--bare", "-b", "main", join(base, "app.git")]);
    const app = join(root, "app");
    execFileSync("git", ["clone", "-q", join(base, "app.git"), app], { stdio: "pipe" });
    G(app, "config", "user.email", "t@t");
    G(app, "config", "user.name", "t");
    writeFileSync(join(app, "README.md"), "app\n");
    G(app, "add", "-A");
    G(app, "commit", "-qm", "init");
    G(app, "push", "-q", "-u", "origin", "main");
    G(app, "remote", "set-head", "origin", "main");
    G(app, "config", "core.hooksPath", join(root, ".agents/hooks"));
    stageCode(app);
    const r = commit(app);
    assert.notEqual(r.status, 0, "code on the code repository's main went through");
    assert.match(r.stdout + r.stderr, /default branch/);
    G(app, "checkout", "-q", "-b", "carja/work/x");
    assert.equal(commit(app).status, 0);
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});
