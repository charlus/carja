// test/review-verdict.test.js
//
// The review gate's record (7.2.0). The gate itself is proven on the real hook
// by test/hooks-review-gate.sh; this file pins the record the hook reads, the
// CLI that writes it, the loop's own write before its push, and the severity
// calibration a production project's review records asked for.

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, existsSync, rmSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { verdictLine, recordApproval, VERDICTS_FILE } from "../src/review-verdict.js";
import { normalizeFinding } from "../src/commands/review-log.js";
import { openPullRequest } from "../src/loop/merge.js";

const BIN = join(dirname(fileURLToPath(import.meta.url)), "../bin/carja.js");
const SHA = "0123456789abcdef0123456789abcdef01234567";

function gitRepo() {
  const d = mkdtempSync(join(tmpdir(), "carja-verdict-"));
  const g = (...a) => spawnSync("git", a, { cwd: d, encoding: "utf8" });
  g("init", "-q", "-b", "main"); g("config", "user.email", "t@t"); g("config", "user.name", "t");
  writeFileSync(join(d, "a.txt"), "a\n"); g("add", "."); g("commit", "-q", "-m", "a");
  return { d, g, head: g("rev-parse", "HEAD").stdout.trim() };
}
const runner = (cwd) => async (args) => {
  const r = spawnSync("git", args, { cwd, encoding: "utf8" });
  return { ok: r.status === 0, stdout: r.stdout ?? "" };
};

describe("the verdict record", () => {
  test("one tab-separated line: sha, APPROVE, time, source", () => {
    assert.equal(verdictLine({ sha: SHA, source: "x", now: () => 0 }), `${SHA}\tAPPROVE\t1970-01-01T00:00:00.000Z\tx\n`);
  });
  test("refuses anything but a full sha (the hook compares full shas)", () => {
    assert.throws(() => verdictLine({ sha: "abc123", source: "x" }));
  });
  test("recordApproval writes HEAD into the repository's git folder, shared by its worktrees", async () => {
    const { d, g, head } = gitRepo();
    const wt = `${d}-wt`;
    g("worktree", "add", "-q", "-b", "side", wt);
    const res = await recordApproval({ git: runner(wt), cwd: wt, source: "test" });
    assert.ok(res.ok, res.reason);
    assert.equal(res.file, join(d, ".git", VERDICTS_FILE));
    assert.match(readFileSync(res.file, "utf8"), new RegExp(`^${head}\\tAPPROVE\\t`));
    rmSync(wt, { recursive: true, force: true }); rmSync(d, { recursive: true, force: true });
  });
});

describe("carja review-log verdict", () => {
  test("records HEAD of the --repo repository (the outer layout's code repository)", () => {
    const outer = mkdtempSync(join(tmpdir(), "carja-outer-"));
    mkdirSync(join(outer, "carja"), { recursive: true }); mkdirSync(join(outer, ".agents"));
    const { d: code, head } = gitRepo();
    const r = spawnSync("node", [BIN, "review-log", "verdict", "APPROVE", "--repo", code], { cwd: outer, encoding: "utf8" });
    assert.equal(r.status, 0, r.stderr);
    assert.match(readFileSync(join(code, ".git", VERDICTS_FILE), "utf8"), new RegExp(`^${head}\\tAPPROVE`));
    rmSync(outer, { recursive: true, force: true }); rmSync(code, { recursive: true, force: true });
  });
  test("records nothing but APPROVE", () => {
    const { d } = gitRepo();
    const r = spawnSync("node", [BIN, "review-log", "verdict", "CHANGES"], { cwd: d, encoding: "utf8" });
    assert.equal(r.status, 1);
    assert.equal(existsSync(join(d, ".git", VERDICTS_FILE)), false);
    rmSync(d, { recursive: true, force: true });
  });
});

describe("the loop records its Checker's approval before it pushes", () => {
  test("openPullRequest writes the verdict line, then pushes", async () => {
    const { d, head } = gitRepo();
    const calls = [];
    const real = runner(d);
    const git = async (args) => {
      calls.push(args[0]);
      if (args[0] === "push") return { ok: true, stdout: "" };
      return real(args);
    };
    const res = await openPullRequest({ branch: "carja/loop/x", title: "t", git, run: async () => ({ ok: true, stdout: "https://forge/mr/1\n" }), forge: "gh" });
    assert.ok(res.ok);
    assert.match(readFileSync(join(d, ".git", VERDICTS_FILE), "utf8"), new RegExp(`^${head}\\tAPPROVE\\t.*\\tloop checker`));
    assert.ok(calls.indexOf("rev-parse") < calls.indexOf("push"), "recorded before the push");
    rmSync(d, { recursive: true, force: true });
  });
});

describe("severity calibration (2026-11-06 audit: 42 of 142 blockers overstated)", () => {
  test("a consistency finding (naming, wording, docs) is refused as a BLOCKER", () => {
    for (const category of ["naming", "wording", "documentation", "consistency"]) {
      const r = normalizeFinding({ severity: "BLOCKER", confidence: 9, category, quote: "x", action: "fixed" });
      assert.equal(r.ok, false, category);
      assert.match(r.error, /never a BLOCKER/);
    }
  });
  test("the same finding as IMPORTANT is recorded", () => {
    assert.equal(normalizeFinding({ severity: "IMPORTANT", category: "naming", action: "fixed" }).ok, true);
  });
});
