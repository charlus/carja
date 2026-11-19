// test/verification-stamp.test.js
//
// F25 (docs/roadmap/Risk-Tiered-Merge.md): every commit says how it was
// verified, "none" included. The prepare-commit-msg hook adds a `Verified:`
// trailer from the evidence ledger: a green run recorded on exactly the tree
// being committed, or `none`. Real git, the real hook, the real CLI.

import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, copyFileSync, chmodSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { stampLines } from "../src/evidence/stamp.js";

const ROOT = join(fileURLToPath(new URL(".", import.meta.url)), "..");
const TREE = "a".repeat(40);
const rec = (over = {}) => ({ ts: "2026-11-19T10:00:00.000Z", label: "verify", command: "npm test", exit: 0, wtree: TREE, ...over });

test("a green run on the committed tree is the stamp", () => {
  assert.deepEqual(stampLines([rec()], TREE), ["verify: npm test, exit 0, 2026-11-19T10:00Z"]);
});

test("nothing recorded, a red run, another tree or a run that changed files: none", () => {
  assert.deepEqual(stampLines([], TREE), ["none"]);
  assert.deepEqual(stampLines([rec({ exit: 1 })], TREE), ["none"]);
  assert.deepEqual(stampLines([rec({ wtree: "b".repeat(40) })], TREE), ["none"]);
  assert.deepEqual(stampLines([rec({ tree_changed: ["x"] })], TREE), ["none"]);
  assert.deepEqual(stampLines([rec()], null), ["none"]);
});

test("one line per label, the latest run of each, a long command shortened", () => {
  const long = "x".repeat(200);
  const lines = stampLines([rec(), rec({ ts: "2026-11-19T11:00:00.000Z" }), rec({ label: "evals", command: long })], TREE);
  assert.equal(lines.length, 2);
  assert.match(lines[0], /^verify: npm test, exit 0, 2026-11-19T11:00Z$/);
  assert.ok(lines[1].length < 120, lines[1]);
});

function repo() {
  const dir = mkdtempSync(join(tmpdir(), "carja-stamp-"));
  const home = join(dir, "home");
  const bin = join(dir, "bin");
  const hooks = join(dir, "hooks");
  const work = join(dir, "work");
  for (const d of [home, bin, hooks, work]) mkdirSync(d);
  writeFileSync(join(bin, "carja"), `#!/bin/sh\nexec node ${JSON.stringify(join(ROOT, "bin/carja.js"))} "$@"\n`);
  chmodSync(join(bin, "carja"), 0o755);
  copyFileSync(join(ROOT, "templates/.agents/hooks/prepare-commit-msg"), join(hooks, "prepare-commit-msg"));
  chmodSync(join(hooks, "prepare-commit-msg"), 0o755);
  const env = { ...process.env, CARJA_HOME: home, PATH: `${bin}:${process.env.PATH}`, GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@t", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@t" };
  const git = (...a) => execFileSync("git", a, { cwd: work, env, encoding: "utf8" });
  git("init", "-q", "-b", "main");
  git("config", "core.hooksPath", hooks);
  const carja = (...a) => execFileSync(join(bin, "carja"), a, { cwd: work, env, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  const stamp = () => git("log", "-1", "--format=%(trailers:key=Verified,valueonly)").trim();
  return { work, git, carja, stamp };
}

test("the hook stamps none, then the green run on exactly that tree, then none again after an untested change", () => {
  const { work, git, carja, stamp } = repo();
  writeFileSync(join(work, "a.txt"), "1\n");
  git("add", "-A");
  git("commit", "-q", "-m", "first");
  assert.equal(stamp(), "none");

  writeFileSync(join(work, "a.txt"), "2\n");
  carja("evidence", "run", "--label", "verify", "--", "true");
  git("commit", "-q", "-a", "-m", "tested");
  assert.match(stamp(), /^verify: true, exit 0, \d{4}-\d\d-\d\dT\d\d:\d\dZ$/);

  writeFileSync(join(work, "a.txt"), "3\n");
  git("commit", "-q", "-a", "-m", "untested");
  assert.equal(stamp(), "none");
});

test("--no-verify still stamps, and an amend keeps one stamp", () => {
  const { work, git, stamp } = repo();
  writeFileSync(join(work, "a.txt"), "1\n");
  git("add", "-A");
  git("commit", "-q", "--no-verify", "-m", "first");
  assert.equal(stamp(), "none");
  git("commit", "-q", "--amend", "-m", "first, reworded");
  const body = git("log", "-1", "--format=%B");
  assert.equal(body.match(/^Verified:/gm)?.length, 1, body);
});

