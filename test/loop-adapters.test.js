// test/loop-adapters.test.js
//
// Phase 2 acceptance: platform-adapter selection. The pure picker is unit-tested
// without spawning any CLI; the real resolveAdapter() probes PATH (IO) and is
// exercised indirectly by the `carja loop --dry-run` integration check.

import { test } from "node:test";
import assert from "node:assert/strict";
import { pickAdapterName, ADAPTERS, PRIORITY } from "../src/loop/adapters/index.js";

test("registry ships claude + antigravity + codex, claude first in priority", () => {
  assert.deepEqual(Object.keys(ADAPTERS).sort(), ["antigravity", "claude", "codex"]);
  assert.equal(PRIORITY[0], "claude");
  for (const mod of Object.values(ADAPTERS)) {
    assert.equal(typeof mod.name, "string");
    assert.equal(typeof mod.isAvailable, "function");
    assert.equal(typeof mod.runBeat, "function");
  }
});

test("explicit preference is honoured when available", () => {
  const avail = { claude: true, antigravity: true };
  assert.equal(pickAdapterName("antigravity", avail), "antigravity");
  assert.equal(pickAdapterName("claude", avail), "claude");
});

test("explicit unknown platform throws", () => {
  assert.throws(
    () => pickAdapterName("codex", { claude: true, antigravity: false }),
    /Unknown platform 'codex'/
  );
});

test("explicit but unavailable platform throws (no silent fallback)", () => {
  assert.throws(
    () => pickAdapterName("antigravity", { claude: true, antigravity: false }),
    /not on PATH/
  );
});

test("auto-detect returns the first available by priority order", () => {
  assert.equal(pickAdapterName(null, { claude: true, antigravity: true }), "claude");
  assert.equal(pickAdapterName(null, { claude: false, antigravity: true }), "antigravity");
});

test("auto-detect returns null when nothing is available", () => {
  assert.equal(pickAdapterName(null, { claude: false, antigravity: false }), null);
});

test("custom priority order is respected in auto-detect", () => {
  const avail = { claude: true, antigravity: true };
  assert.equal(pickAdapterName(null, avail, ["antigravity", "claude"]), "antigravity");
});

// ---- Adapter invocation parity (flags verified against agy 1.1.6 / codex 0.145.0)
// The maker AND the Checker must run WRITE-CAPABLE, or the Checker can't write its
// verdict file — the read-only bug that bit the claude adapter live. Each engine
// expresses that differently; these assert the mapping without spawning a CLI.

import * as antigravity from "../src/loop/adapters/antigravity.js";
import * as codex from "../src/loop/adapters/codex.js";

test("every adapter exposes the full interface incl. runChecker", () => {
  for (const mod of Object.values(ADAPTERS)) {
    assert.equal(typeof mod.runChecker, "function");
  }
});

test("antigravity: binary is `agy`, not `antigravity`", () => {
  assert.equal(antigravity.CLI, "agy");
  assert.equal(antigravity.name, "antigravity");
});

test("antigravity: permission mode maps to agy --mode (writable by default)", () => {
  assert.equal(antigravity.mapMode("acceptEdits"), "accept-edits");
  assert.equal(antigravity.mapMode("plan"), "plan");
  assert.equal(antigravity.mapMode(undefined), "accept-edits"); // default writable
  const args = antigravity.beatArgs({ prompt: "P", permissionMode: "acceptEdits" });
  assert.deepEqual(args, ["--print", "P", "--mode", "accept-edits", "--dangerously-skip-permissions"]);
  assert.ok(!args.includes("run"), "must not use the removed `run` subcommand");
  // agy's workspace is decoupled from cwd — without --add-dir it writes to its own
  // scratch project, so the loop must anchor it to the worktree (verified live).
  const withDir = antigravity.beatArgs({ prompt: "P", permissionMode: "acceptEdits", addDir: "/wt" });
  const di = withDir.indexOf("--add-dir");
  assert.ok(di !== -1 && withDir[di + 1] === "/wt", "must pass --add-dir <worktree>");
  // Headless writable beats MUST auto-approve tools or agy silently no-ops (exit 0).
  assert.ok(
    args.includes("--dangerously-skip-permissions"),
    "a writable headless beat must auto-approve tool permissions"
  );
  // plan = strictly read-only: no auto-approve.
  assert.ok(!antigravity.beatArgs({ prompt: "P", permissionMode: "plan" }).includes("--dangerously-skip-permissions"));
  // sandbox pairs with skip-permissions to keep auto-approve confined.
  assert.deepEqual(antigravity.beatArgs({ prompt: "P", sandbox: true }).slice(-1), ["--sandbox"]);
});

test("codex: exec with a writable sandbox by default; plan is read-only", () => {
  assert.equal(codex.mapMode("acceptEdits"), "workspace-write");
  assert.equal(codex.mapMode("plan"), "read-only");
  assert.equal(codex.mapMode(undefined), "workspace-write"); // default writable
  assert.deepEqual(codex.beatArgs({ prompt: "P", permissionMode: "acceptEdits" }), [
    "exec",
    "-s",
    "workspace-write",
    "--",
    "P",
  ]);
  // danger-full-access is a real value but must never be emitted by the mapping.
  for (const m of ["acceptEdits", "plan", "anything", undefined]) {
    assert.notEqual(codex.mapMode(m), "danger-full-access");
  }
});
