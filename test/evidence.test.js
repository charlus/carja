// test/evidence.test.js
//
// E2 — the Evidence Rule gets a FRESHNESS binding.
//
// Today "verify exit code, not self-report" proves the command was green AT THE
// MOMENT OF THE CHECK, and then the result is trusted forever. That is why a
// ship re-runs the whole suite once per review round: nothing can tell whether
// the code under test still matches the code that was tested.
//
// The fix is a content fingerprint of the working tree. Evidence records the
// tree it was produced against; a later check grades it FRESH / STALE / MISSING.
// Three properties make the fingerprint the right one, and each is asserted
// here because each was a real bug in the naive versions:
//
//   - Committing the SAME content must not change it (otherwise every ship
//     invalidates its own test run at commit time and re-runs for nothing).
//   - An untracked new source file MUST change it (otherwise "tests passed"
//     stays FRESH after a whole new module appears).
//   - .gitignored scratch must NOT change it (otherwise a log file written by
//     the test run invalidates the run that wrote it).
//
// These are behavior tests against real git repos, not structural checks.

import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile, mkdir, readFile } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { workingTreeFingerprint } from "../src/evidence/wtree.js";
import { recordRun, checkFreshness, resolveLedgerPath } from "../src/evidence/ledger.js";

const execFileAsync = promisify(execFile);

let repo;
let home;

async function git(args, cwd = repo) {
  return execFileAsync("git", args, { cwd });
}

async function commitAll(msg) {
  await git(["add", "-A"]);
  await execFileAsync("git", ["commit", "-qm", msg], {
    cwd: repo,
    env: { ...process.env, CARJA_HOOKS: "off" },
  });
}

before(async () => {
  repo = await mkdtemp(join(tmpdir(), "carja-ev-repo-"));
  home = await mkdtemp(join(tmpdir(), "carja-ev-home-"));
  await git(["init", "-q", "."]);
  await git(["config", "user.email", "t@t.t"]);
  await git(["config", "user.name", "T"]);
  await mkdir(join(repo, "src"), { recursive: true });
  await writeFile(join(repo, "src/app.js"), "export const a = 1;\n");
  await writeFile(join(repo, ".gitignore"), "node_modules/\n*.log\n");
  await commitAll("init");
});

after(async () => {
  await rm(repo, { recursive: true, force: true });
  await rm(home, { recursive: true, force: true });
});

describe("E2.1 — the working-tree fingerprint", () => {
  test("is a stable 40-hex tree hash", async () => {
    const fp = await workingTreeFingerprint(repo);
    assert.match(fp, /^[0-9a-f]{40}$/);
    assert.equal(await workingTreeFingerprint(repo), fp, "not deterministic on an unchanged tree");
  });

  test("CHANGES when a tracked file changes", async () => {
    const before_ = await workingTreeFingerprint(repo);
    await writeFile(join(repo, "src/app.js"), "export const a = 2;\n");
    const after_ = await workingTreeFingerprint(repo);
    assert.notEqual(after_, before_);
  });

  test("KEYSTONE: committing identical content does NOT change it", async () => {
    // The dirty-tree fingerprint must survive the commit of exactly that
    // content — otherwise every ship invalidates its own test run at commit
    // time and re-runs the suite for nothing.
    const dirty = await workingTreeFingerprint(repo);
    await commitAll("same content, now committed");
    const committed = await workingTreeFingerprint(repo);
    assert.equal(committed, dirty, "the fingerprint moved when only the commit boundary moved");
  });

  test("CHANGES when an UNTRACKED source file appears", async () => {
    // Otherwise "tests passed" stays FRESH after a whole new module lands.
    const before_ = await workingTreeFingerprint(repo);
    await writeFile(join(repo, "src/new-module.js"), "export const b = 1;\n");
    const after_ = await workingTreeFingerprint(repo);
    assert.notEqual(after_, before_, "an untracked new source file did not invalidate the fingerprint");
    await rm(join(repo, "src/new-module.js"));
  });

  test("IGNORES gitignored scratch", async () => {
    // A test run that writes its own log must not invalidate itself.
    const before_ = await workingTreeFingerprint(repo);
    await writeFile(join(repo, "test-output.log"), "noise\n");
    assert.equal(await workingTreeFingerprint(repo), before_);
    await rm(join(repo, "test-output.log"));
  });

  test("survives amend and rebase that preserve content", async () => {
    const before_ = await workingTreeFingerprint(repo);
    await execFileAsync("git", ["commit", "-q", "--amend", "-m", "reworded"], {
      cwd: repo,
      env: { ...process.env, CARJA_HOOKS: "off" },
    });
    assert.equal(await workingTreeFingerprint(repo), before_, "rewording a commit moved the fingerprint");
  });

  test("returns null outside a git repo instead of throwing", async () => {
    const notRepo = await mkdtemp(join(tmpdir(), "carja-ev-plain-"));
    try {
      assert.equal(await workingTreeFingerprint(notRepo), null);
    } finally {
      await rm(notRepo, { recursive: true, force: true });
    }
  });

  test("never mutates the real index", async () => {
    await writeFile(join(repo, "src/staged.js"), "export const s = 1;\n");
    await git(["add", "src/staged.js"]);
    const { stdout: before_ } = await git(["diff", "--cached", "--name-only"]);
    await workingTreeFingerprint(repo);
    const { stdout: after_ } = await git(["diff", "--cached", "--name-only"]);
    assert.equal(after_, before_, "the fingerprint disturbed the user's staging area");
    await git(["reset", "-q", "HEAD", "src/staged.js"]);
    await rm(join(repo, "src/staged.js"));
  });
});

describe("E2.2 — `evidence run` is a transparent wrapper", () => {
  test("passes a GREEN child's exit code through unchanged", async () => {
    const r = await recordRun({ label: "tests", command: "exit 0", cwd: repo, home });
    assert.equal(r.exitCode, 0);
  });

  test("passes a RED child's exit code through unchanged", async () => {
    const r = await recordRun({ label: "tests", command: "exit 7", cwd: repo, home });
    assert.equal(r.exitCode, 7, "the wrapper altered the child's exit code");
  });

  test("records exit code, command hash and the tree it ran against", async () => {
    await recordRun({ label: "unit", command: "true", cwd: repo, home });
    const lines = (await readFile(await resolveLedgerPath({ cwd: repo, home }), "utf8"))
      .trim()
      .split("\n")
      .map((l) => JSON.parse(l));
    const rec = lines.at(-1);
    assert.equal(rec.label, "unit");
    assert.equal(rec.exit, 0);
    assert.match(rec.cmd_sha256, /^[0-9a-f]{64}$/);
    assert.match(rec.wtree, /^[0-9a-f]{40}$/);
    assert.match(rec.ts, /^\d{4}-\d{2}-\d{2}T/);
  });

  test("TRANSPARENCY: a bookkeeping failure never turns a green run red", async () => {
    // An unwritable ledger must degrade to a warning. The wrapper exists to
    // record runs, not to be able to fail them.
    // A regular FILE used as the home dir: mkdir under it fails immediately
    // with ENOTDIR, which is the cheapest reliable "unwritable" on every OS.
    const blocker = join(home, "not-a-directory");
    await writeFile(blocker, "x");
    const r = await recordRun({ label: "tests", command: "exit 0", cwd: repo, home: blocker });
    assert.equal(r.exitCode, 0, "a ledger write failure changed the child's exit code");
    assert.ok(r.warning, "the failure was silent — it must warn");
  });

  test("works outside a git repo (no fingerprint, still runs the command)", async () => {
    const plain = await mkdtemp(join(tmpdir(), "carja-ev-plain2-"));
    try {
      const r = await recordRun({ label: "x", command: "exit 3", cwd: plain, home });
      assert.equal(r.exitCode, 3);
    } finally {
      await rm(plain, { recursive: true, force: true });
    }
  });
});

describe("E2.3 — `evidence check` grades freshness", () => {
  test("a run just recorded is FRESH", async () => {
    await recordRun({ label: "suite", command: "true", cwd: repo, home });
    const res = await checkFreshness({ labels: [{ label: "suite" }], cwd: repo, home });
    assert.equal(res.byLabel.suite.state, "FRESH");
    assert.equal(res.ok, true);
  });

  test("a label never recorded is MISSING", async () => {
    const res = await checkFreshness({ labels: [{ label: "never-ran" }], cwd: repo, home });
    assert.equal(res.byLabel["never-ran"].state, "MISSING");
    assert.equal(res.ok, false);
  });

  test("editing a source file makes it STALE", async () => {
    await recordRun({ label: "suite", command: "true", cwd: repo, home });
    await writeFile(join(repo, "src/app.js"), `export const a = ${Date.now()};\n`);
    const res = await checkFreshness({ labels: [{ label: "suite" }], cwd: repo, home });
    assert.equal(res.byLabel.suite.state, "STALE");
    assert.equal(res.ok, false);
  });

  test("a RED recorded run is never FRESH — freshness is not approval", async () => {
    await recordRun({ label: "redlane", command: "exit 1", cwd: repo, home });
    const res = await checkFreshness({ labels: [{ label: "redlane" }], cwd: repo, home });
    assert.notEqual(res.byLabel.redlane.state, "FRESH");
    assert.equal(res.byLabel.redlane.exit, 1);
  });

  test("--expect-cmd binds freshness to the REAL suite, not any green command", async () => {
    // Without this, `evidence run --label tests -- echo ok` would satisfy the
    // gate. The recorded command must be the one the caller expects — and note
    // BOTH commands here are GREEN, so only the hash mismatch can explain the
    // STALE verdict.
    const REAL_SUITE = "true # the project's real suite";

    await recordRun({ label: "tests", command: "echo ok", cwd: repo, home });
    const wrong = await checkFreshness({
      labels: [{ label: "tests", expectCmd: REAL_SUITE }],
      cwd: repo,
      home,
    });
    assert.notEqual(wrong.byLabel.tests.state, "FRESH", "a green decoy command satisfied the gate");
    assert.equal(wrong.byLabel.tests.exit, 0, "precondition: the decoy really was green");
    assert.match(wrong.byLabel.tests.reason, /command/i);

    await recordRun({ label: "tests", command: REAL_SUITE, cwd: repo, home });
    const right = await checkFreshness({
      labels: [{ label: "tests", expectCmd: REAL_SUITE }],
      cwd: repo,
      home,
    });
    assert.equal(right.byLabel.tests.state, "FRESH");
  });

  test("--max-age expires an old-but-matching record", async () => {
    await recordRun({ label: "aged", command: "true", cwd: repo, home, now: () => 0 });
    const res = await checkFreshness({
      labels: [{ label: "aged" }],
      cwd: repo,
      home,
      maxAgeHours: 1,
      now: () => 10 * 3600 * 1000,
    });
    assert.equal(res.byLabel.aged.state, "STALE");
    assert.match(res.byLabel.aged.reason, /age|old/i);
  });

  test("the KEYSTONE holds end-to-end: commit the tested content, stay FRESH", async () => {
    await writeFile(join(repo, "src/app.js"), "export const a = 42;\n");
    await recordRun({ label: "keystone", command: "true", cwd: repo, home });
    await commitAll("ship the tested content");
    const res = await checkFreshness({ labels: [{ label: "keystone" }], cwd: repo, home });
    assert.equal(res.byLabel.keystone.state, "FRESH", "committing the tested content invalidated its evidence");
  });

  test("--allow-paths keeps evidence FRESH when only release files changed", async () => {
    // A ship edits CHANGELOG/VERSION between running the suite and pushing.
    // Without this escape the fast path would almost never fire.
    await recordRun({ label: "allow", command: "true", cwd: repo, home });
    await writeFile(join(repo, "CHANGELOG.md"), `# changed ${Date.now()}\n`);

    const strict = await checkFreshness({ labels: [{ label: "allow" }], cwd: repo, home });
    assert.equal(strict.byLabel.allow.state, "STALE", "precondition: it is STALE without the allowance");

    const lenient = await checkFreshness({
      labels: [{ label: "allow" }],
      cwd: repo,
      home,
      allowPaths: ["CHANGELOG.md", "VERSION"],
    });
    assert.equal(lenient.byLabel.allow.state, "FRESH");
    assert.match(lenient.byLabel.allow.reason, /allow-listed/i);
  });

  test("--allow-paths does NOT excuse a source change alongside a release file", async () => {
    await recordRun({ label: "allow2", command: "true", cwd: repo, home });
    await writeFile(join(repo, "CHANGELOG.md"), `# again ${Date.now()}\n`);
    await writeFile(join(repo, "src/app.js"), `export const a = ${Date.now()};\n`);
    const res = await checkFreshness({
      labels: [{ label: "allow2" }],
      cwd: repo,
      home,
      allowPaths: ["CHANGELOG.md", "VERSION"],
    });
    assert.equal(res.byLabel.allow2.state, "STALE", "a source change slipped through the allow-list");
  });

  test("a directory allowance covers everything under it", async () => {
    await mkdir(join(repo, "docs"), { recursive: true });
    await recordRun({ label: "allow3", command: "true", cwd: repo, home });
    await writeFile(join(repo, "docs/notes.md"), `notes ${Date.now()}\n`);
    const res = await checkFreshness({
      labels: [{ label: "allow3" }],
      cwd: repo,
      home,
      allowPaths: ["docs/"],
    });
    assert.equal(res.byLabel.allow3.state, "FRESH");
  });

  test("an empty allow-list never excuses anything", async () => {
    await recordRun({ label: "allow4", command: "true", cwd: repo, home });
    await writeFile(join(repo, "src/app.js"), `export const a = ${Date.now()};\n`);
    const res = await checkFreshness({
      labels: [{ label: "allow4" }],
      cwd: repo,
      home,
      allowPaths: [],
    });
    assert.equal(res.byLabel.allow4.state, "STALE");
  });

  test("check is read-only and never throws, even on a corrupt ledger", async () => {
    const badHome = await mkdtemp(join(tmpdir(), "carja-ev-bad-"));
    try {
      const p = await resolveLedgerPath({ cwd: repo, home: badHome });
      await mkdir(join(p, ".."), { recursive: true });
      await writeFile(p, "not json at all\n{also not}\n");
      const res = await checkFreshness({ labels: [{ label: "any" }], cwd: repo, home: badHome });
      assert.equal(res.byLabel.any.state, "MISSING");
    } finally {
      await rm(badHome, { recursive: true, force: true });
    }
  });

  test("the newest record for a label wins", async () => {
    await recordRun({ label: "dup", command: "exit 1", cwd: repo, home });
    await recordRun({ label: "dup", command: "exit 0", cwd: repo, home });
    const res = await checkFreshness({ labels: [{ label: "dup" }], cwd: repo, home });
    assert.equal(res.byLabel.dup.exit, 0, "an older record outvoted the newest one");
  });
});

describe("E2.5 — a run that changes the working tree is not evidence", () => {
  // AI-DLC's verification check (aidlc-construction-checkpoints.ts) fails a
  // command that changes files while it runs. A verify command that rewrites
  // snapshots, fixes lint or updates a lockfile passes against code that is
  // not the code being pushed.
  let r2;
  const run = (cmd, label = "verify") => recordRun({ label, command: cmd, cwd: r2, home });
  const cli = async (args) => {
    const { evidenceCommand } = await import("../src/commands/evidence.js");
    let out = "";
    let err = "";
    const code = await evidenceCommand(args, {
      cwd: r2,
      stdout: { write: (s) => (out += s) },
      stderr: { write: (s) => (err += s) },
    });
    return { code, out, err };
  };

  before(async () => {
    r2 = await mkdtemp(join(tmpdir(), "carja-ev-stable-"));
    await execFileAsync("git", ["init", "-q", "."], { cwd: r2 });
    await execFileAsync("git", ["config", "user.email", "t@t.t"], { cwd: r2 });
    await execFileAsync("git", ["config", "user.name", "T"], { cwd: r2 });
    await mkdir(join(r2, "src"), { recursive: true });
    await writeFile(join(r2, "src/app.js"), "export const a = 1;\n");
    await writeFile(join(r2, ".gitignore"), "*.log\n");
    await execFileAsync("git", ["add", "-A"], { cwd: r2 });
    await execFileAsync("git", ["commit", "-qm", "init"], {
      cwd: r2,
      env: { ...process.env, CARJA_HOOKS: "off" },
    });
  });
  after(async () => rm(r2, { recursive: true, force: true }));
  const restore = () => execFileAsync("git", ["checkout", "-q", "--", "."], { cwd: r2 });

  test("records the files a run changed", async () => {
    const r = await run("echo '// touched' >> src/app.js");
    assert.equal(r.exitCode, 0, "the plain wrapper stays transparent");
    assert.deepEqual(r.record.tree_changed, ["src/app.js"]);
    await restore();
  });

  test("a run that writes only ignored files changes nothing", async () => {
    const r = await run("echo noise > run.log");
    assert.equal(r.record.tree_changed, undefined);
    await rm(join(r2, "run.log"));
  });

  test("its evidence is never FRESH, even once the files are put back", async () => {
    await run("echo '// touched' >> src/app.js", "mutating");
    await restore();
    const res = await checkFreshness({ labels: [{ label: "mutating" }], cwd: r2, home });
    assert.equal(res.byLabel.mutating.state, "STALE");
    assert.match(res.byLabel.mutating.reason, /changed files while it ran/);
  });

  test("`run --stable-tree` fails a green run that changed files, and names them", async () => {
    const r = await cli(["run", "--label", "verify", "--stable-tree", "--", "echo '// x' >> src/app.js"]);
    assert.equal(r.code, 1);
    assert.match(r.err, /src\/app\.js/);
    await restore();
  });

  test("`run --stable-tree` passes a green run that changed nothing (sensitivity)", async () => {
    const r = await cli(["run", "--label", "verify", "--stable-tree", "--", "true"]);
    assert.equal(r.code, 0, r.err);
  });

  test("`run --stable-tree` keeps a red run's own exit code", async () => {
    const r = await cli(["run", "--label", "verify", "--stable-tree", "--", "echo y >> src/app.js; exit 5"]);
    assert.equal(r.code, 5);
    await restore();
  });
});
