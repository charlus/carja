// test/rename-migration.test.js
//
// `carja upgrade` on a real 6.x install (docs/roadmap/Rename-To-Carja.md,
// "Tests"). The 6.x install is made by the 6.54.0 CLI itself, taken from this
// repository's history, so the fixture is what the owner's projects look like
// and not an imitation of it.

import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync, spawnSync } from "node:child_process";
import { rewritePaths } from "../src/rename-migration.js";

const REPO = new URL("..", import.meta.url).pathname;
const OLD = ["con", "ductor"].join("");
const V6 = "2be8f9d"; // master after #117: 6.54.0, the last 6.x
let v6dir;

const G = (cwd, ...a) => execFileSync("git", a, { cwd, stdio: "pipe", env: { ...process.env, GIT_AUTHOR_DATE: "", GIT_COMMITTER_DATE: "" } }).toString().trim();
const carja = (cwd, ...a) => spawnSync("node", [join(REPO, "bin/carja.js"), ...a], { cwd, encoding: "utf8", timeout: 180000 });

before(() => {
  v6dir = mkdtempSync(join(tmpdir(), "v6-cli-"));
  execFileSync("bash", ["-c", `git -C "${REPO}" archive ${V6} | tar -x -C "${v6dir}"`]);
});
after(() => rmSync(v6dir, { recursive: true, force: true }));

/** A 6.x project installed and committed by the 6.54.0 CLI, hooks on. */
function v6project({ remote = false } = {}) {
  const base = mkdtempSync(join(tmpdir(), "rename-"));
  const p = join(base, "app");
  execFileSync("node", [join(v6dir, `bin/${OLD}.js`), "init", p, "--all", "--no-detect"], { stdio: "pipe" });
  G(p, "init", "-q", "-b", "main");
  G(p, "config", "user.email", "t@t");
  G(p, "config", "user.name", "t");
  execFileSync("node", [join(v6dir, `bin/${OLD}.js`), "install-hooks", p], { stdio: "pipe" });
  writeFileSync(join(p, `${OLD}/2-backlog/task-backlog.md`), `# Backlog\n\n- [ ] see \`${OLD}/3-product-areas/billing/README.md\`\n`);
  G(p, "add", "-A");
  G(p, "commit", "-qm", "init");
  if (remote) {
    G(base, "init", "-q", "--bare", "-b", "main", "origin.git");
    G(p, "remote", "add", "origin", join(base, "origin.git"));
    G(p, "push", "-q", "-u", "origin", "main");
    G(p, "remote", "set-head", "origin", "main");
  }
  return { base, p };
}

test("rewritePaths: only the exact conductor/<numbered>/ pattern", () => {
  assert.equal(rewritePaths(`a \`${OLD}/2-backlog/x.md\``), "a `carja/2-backlog/x.md`");
  assert.equal(rewritePaths(`./${OLD}/1-workbench/a`), "./carja/1-workbench/a");
  assert.equal(rewritePaths(`.${OLD}/0-compass/b`), `.${OLD}/0-compass/b`, "the V4 dotted folder is not ours to rewrite");
  assert.equal(rewritePaths(`~/Workspace/app/${OLD}/2-backlog/a.md`), "~/Workspace/app/carja/2-backlog/a.md", "a link into the moved folder");
  assert.equal(rewritePaths(`../${OLD}/1-workbench/x`), "../carja/1-workbench/x");
  assert.equal(rewritePaths(`my-${OLD}/2-backlog/`), `my-${OLD}/2-backlog/`, "a longer name is not ours");
  assert.equal(rewritePaths(`${OLD}/product.md`), `${OLD}/product.md`, "Google Conductor's paths stay");
});

test("a 6.x install upgrades to carja/ in reviewable commits, and the hooks still run after", () => {
  const { base, p } = v6project();
  try {
    mkdirSync(join(p, `${OLD}/tracks`));
    writeFileSync(join(p, `${OLD}/product.md`), "Google Conductor's file\n");
    G(p, "add", "-A");
    G(p, "commit", "-qm", "google files");
    writeFileSync(join(G(p, "rev-parse", "--git-common-dir").startsWith("/") ? G(p, "rev-parse", "--git-common-dir") : join(p, ".git"), `${OLD}-loop-ready.json`), "[]\n");

    const r = carja(p, "upgrade");
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.match(r.stdout, /Step R: Rename Conductor to Carja/);
    assert.match(r.stdout, new RegExp(`Left ${OLD}/product\\.md`));

    assert.ok(existsSync(join(p, "carja/1-workbench/inbox.md")));
    assert.ok(existsSync(join(p, "carja.config.json")));
    assert.ok(!existsSync(join(p, `${OLD}.config.json`)));
    assert.ok(existsSync(join(p, `${OLD}/product.md`)), "Google's file stays");
    assert.ok(!existsSync(join(p, `${OLD}/1-workbench`)), "our folders moved");
    assert.ok(existsSync(join(p, ".agents/.carja-version.json")));
    assert.ok(!existsSync(join(p, `.agents/.${OLD}-version.json`)));
    assert.ok(existsSync(join(p, ".git/carja-loop-ready.json")), "the loop's queue follows the new name");

    const agentsMd = readFileSync(join(p, "AGENTS.md"), "utf8");
    assert.match(agentsMd, /<!-- carja:framework:begin/);
    assert.doesNotMatch(agentsMd, new RegExp(`<!-- ${OLD}:framework`));
    assert.match(readFileSync(join(p, "carja/2-backlog/task-backlog.md"), "utf8"), /`carja\/3-product-areas\/billing\/README\.md`/);
    assert.match(readFileSync(join(p, ".gitattributes"), "utf8"), /^carja\/0-compass\/ship-log\.md merge=union$/m);

    const log = G(p, "log", "--format=%s", "-4");
    assert.match(log, /chore: rename conductor to carja/);
    assert.match(log, /chore: point carja\/ knowledge at the renamed folder/);
    assert.match(log, /chore: upgrade Carja to 7\./);
    assert.match(G(p, "log", "--format=%B", "-1", "--grep=upgrade Carja to"), /Hook waiver \(Protected\)/, "the upgrade's waiver is recorded");
    assert.equal(G(p, "status", "--porcelain"), "", "everything is committed");
    assert.match(G(p, "log", "--follow", "--format=%s", "--", "carja/2-backlog/task-backlog.md"), /init/, "history follows the move");

    // The new hooks run on the next commit: an implementation file with no test is refused.
    writeFileSync(join(p, "app.js"), "export const x = 1;\n");
    G(p, "add", "app.js");
    const c = spawnSync("git", ["commit", "-qm", "code without a test"], { cwd: p, encoding: "utf8" });
    assert.notEqual(c.status, 0, "the TDD gate still blocks");
    assert.match(c.stdout + c.stderr, /Carja/);
    // A 6.x waiver still works through the 7.x hooks (D1).
    const waived = spawnSync("git", ["commit", "-qm", "waived"], { cwd: p, encoding: "utf8", env: { ...process.env, [`${OLD.toUpperCase()}_NO_TEST`]: "a 6.x waiver" } });
    assert.equal(waived.status, 0, waived.stdout + waived.stderr);
    G(p, "reset", "-q", "--hard", "HEAD~1");

    const check = spawnSync("bash", [join(p, ".agents/tests/check-carja.sh")], { cwd: p, encoding: "utf8" });
    assert.match(check.stdout, /STATUS: PASSED/, check.stdout.slice(-2000));

    // Idempotent: a second run moves nothing and makes no rename commit.
    const head = G(p, "rev-parse", "HEAD");
    const again = carja(p, "upgrade");
    assert.equal(again.status, 0, again.stdout + again.stderr);
    assert.doesNotMatch(again.stdout, /Step R/);
    assert.equal(G(p, "log", "--format=%s", `${head}..HEAD`).includes("rename"), false);
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});

test("with a remote, the rename and the upgrade land on the upgrade's own branch", () => {
  const { base, p } = v6project({ remote: true });
  try {
    const r = carja(p, "upgrade");
    assert.equal(r.status, 0, r.stdout + r.stderr);
    const branch = G(p, "symbolic-ref", "--short", "HEAD");
    assert.match(branch, /^chore\/carja-7\./);
    const onBranch = G(p, "log", "--format=%s", "main..HEAD");
    assert.match(onBranch, /chore: rename conductor to carja/);
    assert.match(onBranch, /chore: upgrade Carja to 7\./);
    assert.equal(G(p, "rev-parse", "main"), G(p, "rev-parse", "origin/main"), "main is untouched");
    // Review F2: the remote holds the 6.x lib.sh, which pre-push trusts. The push must go through.
    const push = spawnSync("git", ["push", "-u", "origin", branch], { cwd: p, encoding: "utf8" });
    assert.equal(push.status, 0, push.stdout + push.stderr);
    assert.equal(G(p, "status", "--porcelain"), "");
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});

test("a dirty tree or a live loop worktree: refused, nothing changed", () => {
  const { base, p } = v6project();
  try {
    writeFileSync(join(p, `${OLD}/1-workbench/inbox.md`), "edited\n");
    const dirty = carja(p, "upgrade");
    assert.notEqual(dirty.status, 0);
    assert.match(dirty.stderr, /uncommitted changes/);
    assert.ok(existsSync(join(p, `${OLD}/1-workbench`)) && !existsSync(join(p, "carja")));
    G(p, "checkout", "--", ".");

    G(p, "worktree", "add", "-q", "-b", `${OLD}/loop/item`, join(base, "wt"));
    const held = carja(p, "upgrade");
    assert.notEqual(held.status, 0);
    assert.match(held.stderr, new RegExp(`${OLD}/loop/item`));
    assert.ok(!existsSync(join(p, "carja")));
    assert.equal(G(p, "log", "--format=%s", "-1"), "init");
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});

test("dry run: names the moves, changes nothing", () => {
  const { base, p } = v6project();
  try {
    const r = carja(p, "upgrade", "--dry-run");
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.match(r.stdout, new RegExp(`would rename[\\s\\S]*${OLD}/1-workbench/ → carja/1-workbench/`));
    assert.ok(!existsSync(join(p, "carja")));
    assert.equal(G(p, "status", "--porcelain"), "");
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});

test("outer layout: the nested code repository's hooks find carja/ after the upgrade", () => {
  const { base, p } = v6project();
  try {
    writeFileSync(join(p, ".gitignore"), `${existsSync(join(p, ".gitignore")) ? readFileSync(join(p, ".gitignore"), "utf8") : ""}code/\n`);
    G(p, "add", ".gitignore");
    G(p, "commit", "-qm", "ignore the code repository");
    const code = join(p, "code");
    mkdirSync(code);
    G(code, "init", "-q", "-b", "main");
    G(code, "config", "user.email", "t@t");
    G(code, "config", "user.name", "t");
    writeFileSync(join(code, "README.md"), "code\n");
    G(code, "add", "-A");
    G(code, "commit", "-qm", "init");
    execFileSync("node", [join(v6dir, `bin/${OLD}.js`), "install-hooks", p], { stdio: "pipe" });
    assert.equal(G(code, "config", "core.hooksPath"), join(p, ".agents/hooks"), "the 6.x install wired the nested repository");

    const r = carja(p, "upgrade");
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.ok(existsSync(join(p, "carja/0-compass/ship-log.md")));

    writeFileSync(join(code, "app.js"), "export const x = 1;\n");
    G(code, "add", "app.js");
    const c = spawnSync("git", ["commit", "-qm", "code without a test"], { cwd: code, encoding: "utf8" });
    assert.notEqual(c.status, 0, "the gate still runs in the nested repository");
    assert.match(c.stdout + c.stderr, /Carja/);
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});

// eurassistant, 2026-11-04: the 6.x Brief gate refused the path-rewrite commit,
// because an archived feature spec with an old path and no Brief check reads as
// a new spec. The upgrade stopped with one commit made and the rewrite staged.
test("an archived feature spec with old paths does not stop the upgrade", () => {
  const { base, p } = v6project();
  try {
    const spec = join(p, `${OLD}/6-archive/completed-implementations/01-x/feature-spec.md`);
    mkdirSync(join(spec, ".."), { recursive: true });
    writeFileSync(spec, `# Feature spec\n\nSee \`${OLD}/4-context/technical/architecture.md\`.\n`);
    execFileSync("git", ["add", "-A"], { cwd: p });
    execFileSync("git", ["commit", "-qm", "archived spec"], { cwd: p, env: { ...process.env, [`${OLD.toUpperCase()}_NO_BRIEF`]: "fixture: an old spec" } });

    const r = carja(p, "upgrade");
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.match(readFileSync(join(p, "carja/6-archive/completed-implementations/01-x/feature-spec.md"), "utf8"), /`carja\/4-context\/technical\/architecture\.md`/);
    assert.match(G(p, "log", "--format=%B", "-1", "--grep=point carja"), /Hook waivers \(Protected, Brief, Report\)/, "the waiver is recorded, not silent");
    assert.equal(G(p, "status", "--porcelain"), "");
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});

test("a refused commit mid-rename undoes everything: files, commits, branch", () => {
  const { base, p } = v6project({ remote: true });
  try {
    // Knowledge with an old path, so the second commit happens; a commit-msg hook refuses it.
    writeFileSync(join(p, `${OLD}/1-workbench/scratchpad.md`), `see \`${OLD}/2-backlog/task-backlog.md\`\n`);
    G(p, "commit", "-qam", "scratch");
    G(p, "push", "-q");
    const hooks = join(base, "hooks");
    mkdirSync(hooks);
    writeFileSync(join(hooks, "commit-msg"), '#!/bin/sh\ngrep -q "point carja" "$1" && { echo "refused by test"; exit 1; }\nexit 0\n', { mode: 0o755 });
    G(p, "config", "core.hooksPath", hooks);
    const head = G(p, "rev-parse", "HEAD");
    // An ignored file the rename carries along must come back too.
    mkdirSync(join(p, `${OLD}/1-workbench/.cache`), { recursive: true });
    writeFileSync(join(p, ".git/info/exclude"), "*.local\n");
    writeFileSync(join(p, `${OLD}/1-workbench/notes.local`), "mine\n");

    const r = carja(p, "upgrade");
    assert.notEqual(r.status, 0);
    assert.match(r.stderr, /failed and was undone/);
    assert.equal(G(p, "rev-parse", "HEAD"), head, "no commit is left");
    assert.equal(G(p, "symbolic-ref", "--short", "HEAD"), "main", "back on the starting branch");
    assert.equal(G(p, "branch", "--list", "chore/carja-*"), "", "the upgrade branch is gone");
    assert.equal(G(p, "status", "--porcelain"), "");
    assert.ok(existsSync(join(p, `${OLD}/1-workbench/inbox.md`)));
    assert.ok(!existsSync(join(p, "carja")), "no carja/ is left for the readers to prefer");
    assert.equal(readFileSync(join(p, `${OLD}/1-workbench/notes.local`), "utf8"), "mine\n", "the ignored file is back");
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});

// Review F1: a state folder ignored as a whole must not be committed by the rename.
test("a gitignored conductor/ stays ignored as carja/: nothing new is committed", () => {
  const { base, p } = v6project();
  try {
    G(p, "rm", "-r", "-q", "--cached", OLD);
    writeFileSync(join(p, ".gitignore"), `${existsSync(join(p, ".gitignore")) ? readFileSync(join(p, ".gitignore"), "utf8") : ""}${OLD}/\n`);
    G(p, "add", "-A");
    execFileSync("git", ["commit", "-qm", "private state"], { cwd: p, env: { ...process.env, [`${OLD.toUpperCase()}_NO_PROTECTED`]: "fixture" } });
    assert.equal(G(p, "ls-files", "--", OLD), "");

    const r = carja(p, "upgrade");
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.ok(existsSync(join(p, "carja/1-workbench/inbox.md")), "moved on disk");
    assert.equal(G(p, "ls-files", "--", "carja/0-compass", "carja/2-backlog", "carja/3-product-areas", "carja/4-context", "carja/6-archive"), "", "no private file was committed");
    assert.match(readFileSync(join(p, ".gitignore"), "utf8"), /^carja\/$/m);
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});

// Review F4: --no-commit prints one command that commits the whole rename.
test("--no-commit: the printed command commits the rename in full", () => {
  const { base, p } = v6project();
  try {
    const r = carja(p, "upgrade", "--no-commit");
    assert.equal(r.status, 0, r.stdout + r.stderr);
    const cmd = /^\s+(git add -A && .*git commit -m "[^"]+")$/m.exec(r.stdout);
    assert.ok(cmd, r.stdout);
    execFileSync("bash", ["-c", cmd[1]], { cwd: p, stdio: "pipe" });
    assert.equal(G(p, "status", "--porcelain"), "", "nothing left over");
    assert.equal(G(p, "ls-files", "--", OLD), "", "no 6.x file left in the commit");
    assert.ok(G(p, "ls-files", "--", "carja/2-backlog").length > 0);
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});

// Review F5: a 6.x loop.setup names the 6.x variables.
test("a 6.x loop.setup is rewritten to the CARJA_* variables", () => {
  const { base, p } = v6project();
  try {
    const cfgPath = join(p, `${OLD}.config.json`);
    const cfg = JSON.parse(readFileSync(cfgPath, "utf8"));
    cfg.loop = { ...(cfg.loop ?? {}), setup: `ln -sfn "$${OLD.toUpperCase()}_CODE_ROOT/.venv" .venv` };
    writeFileSync(cfgPath, JSON.stringify(cfg, null, 2));
    G(p, "commit", "-qam", "setup");
    const r = carja(p, "upgrade");
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.equal(JSON.parse(readFileSync(join(p, "carja.config.json"), "utf8")).loop.setup, 'ln -sfn "$CARJA_CODE_ROOT/.venv" .venv');
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});

// Review F8: outside git, a refused rename changes nothing.
test("outside git: a name clash refuses before anything moves", () => {
  const base = mkdtempSync(join(tmpdir(), "rename-nogit-"));
  const p = join(base, "app");
  try {
    execFileSync("node", [join(v6dir, `bin/${OLD}.js`), "init", p, "--all", "--no-detect"], { stdio: "pipe" });
    writeFileSync(join(p, "carja.config.json"), "{}\n");
    const r = carja(p, "upgrade");
    assert.notEqual(r.status, 0);
    assert.match(r.stderr, /already exist/);
    assert.ok(existsSync(join(p, `${OLD}/1-workbench/inbox.md`)), "nothing moved");
    assert.ok(!existsSync(join(p, "carja")));
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});
