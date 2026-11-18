// test/check-carja-worktrees.test.js
//
// Found on the 7.6.0 upgrade of a real project (2026-11-18): the install check
// scanned .agents/.worktrees/, the hidden `carja work` worktrees, and failed on
// an old copy of the code that carried its own legacy .agents/. Every upgrade
// of that project reported FAILED for a file that is not the install.

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync, spawnSync } from "node:child_process";

const BIN = new URL("../bin/carja.js", import.meta.url).pathname;

test("the install check ignores the hidden work worktrees", () => {
  const d = mkdtempSync(join(tmpdir(), "check-wt-"));
  try {
    execFileSync("node", [BIN, "init", d, "--all", "--no-detect"], { stdio: "pipe" });
    const old = join(d, ".agents/.worktrees/work-x/repo/legacy/.agents/workflows");
    mkdirSync(old, { recursive: true });
    writeFileSync(join(old, "Build.md"), "See .agents/workflows/Quick-Path.md\n");
    const r = spawnSync("bash", [join(d, ".agents/tests/check-carja.sh")], { cwd: d, encoding: "utf8" });
    assert.doesNotMatch(r.stdout, /Dead Title-Case path references found/, r.stdout.slice(-800));
  } finally {
    rmSync(d, { recursive: true, force: true });
  }
});
