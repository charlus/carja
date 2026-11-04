// test/loop-setup-guidance.test.js
//
// The first doctor run on autopportunity (2026-10-20), after the 6.33 upgrade:
//   F10 "verify": "none" (no tests, on purpose) was executed as a command;
//   F11 --from-carja would have taken all 70 backlog and inbox items;
//   F12 three failures for one cause: the loop is not set up there;
//   F13 no command to let the loop take tagged backlog items only.

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { configVerify } from "../src/commands/loop.js";
import { diagnose } from "../src/loop/doctor.js";
import { planLoopOn } from "../src/loop/enable.js";

test("F10: `\"verify\": \"none\"` is no command, never a command to run", async () => {
  const dir = mkdtempSync(join(tmpdir(), "verify-none-"));
  try {
    writeFileSync(join(dir, "carja.config.json"), JSON.stringify({ verify: "none", repos: { repo: { verify: "None" } } }));
    assert.equal(await configVerify(dir), "");
    assert.equal(await configVerify(dir, "repo"), "");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("F12: a project where the loop is not set up gets one line and one command, not a list of failures", () => {
  const checks = diagnose({ notSetUp: true, state: { phase: "discovery", sandbox: "none" }, preflightHalt: "halted_scoping", nestedRepos: ["repo/"] });
  assert.equal(checks.length, 1);
  assert.match(checks[0].title, /not set up/);
  assert.match(checks[0].fix, /carja loop on/);
  assert.match(checks[0].fix, /--backlog/);
});

const FACTS = {
  project: "km", projects: ["km"], discoveryDone: true, carved: false,
  config: {}, state: { phase: "discovery", autonomy_level: "L1", sandbox: "none" }, nestedRepos: [], envDirs: [], claudeOnPath: true,
};

test("F11: turning the loop on takes only tagged backlog items and no inbox thought, unless already set", () => {
  const p = planLoopOn(FACTS);
  assert.equal(p.config.loop.require_ready, true);
  assert.equal(p.config.loop.inbox, false);
  assert.ok(p.changes.some((c) => /\(loop-ready\)/.test(c)));
  const kept = planLoopOn({ ...FACTS, config: { loop: { require_ready: false, inbox: true } } });
  assert.deepEqual([kept.config.loop.require_ready, kept.config.loop.inbox], [false, true], "an explicit choice is kept");
});

test("F13: `loop on --backlog` sets the run up for tagged backlog items, with no project", () => {
  const p = planLoopOn({ ...FACTS, project: null, backlog: true, nestedRepos: ["repo/"], envDirs: [".venv"] });
  assert.equal(p.ok, true, p.error);
  assert.equal(p.config.loop.blueprint, undefined);
  assert.equal(p.config.loop.slices, undefined);
  assert.equal(p.config.loop.require_ready, true);
  assert.equal(p.config.loop.code_dir, "repo");
  assert.equal(p.state.autonomy_level, "L3");
  assert.ok(p.changes.some((c) => /tag/.test(c)));
});

test("F12 through the CLI: on a project the loop has never run on, the doctor names the one command", () => {
  const REPO = new URL("..", import.meta.url).pathname;
  const root = mkdtempSync(join(tmpdir(), "not-set-up-"));
  try {
    execFileSync("node", [join(REPO, "bin/carja.js"), "init", root, "--all", "--no-detect"], { stdio: "pipe" });
    execFileSync("git", ["init", "-q"], { cwd: root });
    let out;
    try {
      out = execFileSync("node", [join(REPO, "bin/carja.js"), "loop", "doctor", root], { stdio: ["ignore", "pipe", "pipe"] }).toString();
    } catch (e) {
      out = `${e.stdout}`;
    }
    assert.match(out, /not set up/);
    assert.match(out, /carja loop on/);
    assert.doesNotMatch(out, /halted_scoping/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("the .env advice: copy the example, never the real file, which holds secrets", () => {
  const withExample = diagnose({ state: { phase: "execution" }, dotenv: { present: true, copiedBySetup: false, example: true } }).find((c) => c.id === "dotenv");
  assert.match(withExample.fix, /cp \.env\.example \.env/);
  assert.match(withExample.fix, /Never put the real \.env/);
});
