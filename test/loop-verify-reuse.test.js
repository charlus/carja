// test/loop-verify-reuse.test.js
//
// P1 of the verification-cost work: the loop driver runs verify through the
// evidence ledger. A green verdict recorded on the same content, by the exact
// same command, with the same .env files, is reused instead of run again. On
// autopportunity (2026-10-22) the driver ran the full suite twice on an
// unchanged code tree, 545 s of a 12-minute run.
//
// The Evidence Rule stays intact: only a real green run on identical content is
// reused, and anything the ledger cannot prove runs again. Behaviour tests
// against a real git repository and a real ledger.

import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile, readFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { verifyWithEvidence } from "../src/loop/verify-evidence.js";

let base;
let repo;
let home;
let count;

const runs = async () => Number((await readFile(count, "utf8").catch(() => "")).trim().split("\n").filter(Boolean).length);
const cmd = () => `echo run >> ${count} && test -f app.py`;

before(async () => {
  base = await mkdtemp(join(tmpdir(), "verify-reuse-"));
  repo = join(base, "repo");
  home = join(base, "home");
  count = join(base, "count");
  execFileSync("git", ["init", "-q", repo]);
  execFileSync("git", ["config", "user.email", "t@t"], { cwd: repo });
  execFileSync("git", ["config", "user.name", "t"], { cwd: repo });
  await writeFile(join(repo, ".gitignore"), ".env\n");
  await writeFile(join(repo, "app.py"), "x = 1\n");
  await writeFile(join(repo, ".env"), "KEY=a\n");
  execFileSync("git", ["add", "-A"], { cwd: repo });
  execFileSync("git", ["commit", "-qm", "init"], { cwd: repo, env: { ...process.env, CARJA_HOOKS: "off" } });
});

after(async () => {
  await rm(base, { recursive: true, force: true });
});

test("a green verdict on the same content and command is reused, not run again", async () => {
  const first = await verifyWithEvidence(cmd(), repo, { home });
  assert.equal(first.exitCode, 0);
  assert.equal(first.reused, false);
  assert.equal(await runs(), 1);

  const second = await verifyWithEvidence(cmd(), repo, { home });
  assert.equal(second.exitCode, 0);
  assert.equal(second.reused, true);
  assert.match(second.output, /reused/);
  assert.equal(await runs(), 1, "the command did not run a second time");
});

test("a change to a tracked file runs verify again", async () => {
  await writeFile(join(repo, "app.py"), "x = 2\n");
  const r = await verifyWithEvidence(cmd(), repo, { home });
  assert.equal(r.reused, false);
  assert.equal(await runs(), 2);
});

test("a change to an ignored .env file runs verify again", async () => {
  await writeFile(join(repo, ".env"), "KEY=b\n");
  const r = await verifyWithEvidence(cmd(), repo, { home });
  assert.equal(r.reused, false);
  assert.equal(await runs(), 3);
});

test("another command is never served by this command's verdict", async () => {
  const r = await verifyWithEvidence(`${cmd()} && true`, repo, { home });
  assert.equal(r.reused, false);
  assert.equal(await runs(), 4);
});

test("a red run is never reused, and its exit code is the result", async () => {
  const red = `echo run >> ${count} && false`;
  const a = await verifyWithEvidence(red, repo, { home });
  const b = await verifyWithEvidence(red, repo, { home });
  assert.equal(a.exitCode, 1);
  assert.equal(b.exitCode, 1);
  assert.equal(b.reused, false);
  assert.equal(await runs(), 6);
});

test("an unwritable ledger runs verify every time and keeps the command's exit code", async () => {
  const fileHome = join(base, "home-is-a-file");
  await writeFile(fileHome, "");
  const a = await verifyWithEvidence(cmd(), repo, { home: fileHome });
  const b = await verifyWithEvidence(cmd(), repo, { home: fileHome });
  assert.equal(a.exitCode, 0);
  assert.equal(b.exitCode, 0);
  assert.equal(b.reused, false);
  assert.equal(await runs(), 8);
});
