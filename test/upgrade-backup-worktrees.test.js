// test/upgrade-backup-worktrees.test.js
//
// `carja upgrade` backed up all of `.agents/`, live worktrees included: full
// checkouts with node_modules, once per upgrade (2026-11-23: 9.9 GB of copies
// over three projects, a disk at 90%). A restore after a failed upgrade also
// replaced `.agents/` wholesale, so it rewound every live worktree. The backup
// now leaves `.agents/.worktrees/` out, and a restore never touches it.

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { createBackup, restoreBackup } from "../src/backup.js";

function project() {
  const dir = mkdtempSync(join(tmpdir(), "carja-backup-"));
  mkdirSync(join(dir, ".agents/rules"), { recursive: true });
  mkdirSync(join(dir, ".agents/.worktrees/loop-01/node_modules"), { recursive: true });
  writeFileSync(join(dir, ".agents/rules/a.md"), "old rule\n");
  writeFileSync(join(dir, ".agents/.worktrees/loop-01/node_modules/big.js"), "x\n");
  writeFileSync(join(dir, ".agents/.worktrees/loop-01/work.txt"), "before\n");
  return dir;
}

test("the backup of .agents leaves the live worktrees out", () => {
  const dir = project();
  try {
    const b = createBackup(dir, [".agents"], { nowIso: "2026-11-23T10:00:00.000Z" });
    assert.deepEqual(b.copied, [".agents"]);
    assert.equal(readFileSync(join(b.backupRoot, ".agents/rules/a.md"), "utf8"), "old rule\n");
    assert.equal(existsSync(join(b.backupRoot, ".agents/.worktrees")), false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("a restore brings the framework files back and leaves the live worktrees as they are", () => {
  const dir = project();
  try {
    const b = createBackup(dir, [".agents"], { nowIso: "2026-11-23T10:00:00.000Z" });
    writeFileSync(join(dir, ".agents/rules/a.md"), "half-upgraded\n");
    writeFileSync(join(dir, ".agents/.worktrees/loop-01/work.txt"), "after\n");
    restoreBackup(dir, b.backupRoot, b.copied);
    assert.equal(readFileSync(join(dir, ".agents/rules/a.md"), "utf8"), "old rule\n");
    assert.equal(readFileSync(join(dir, ".agents/.worktrees/loop-01/work.txt"), "utf8"), "after\n", "not rewound, not removed");
    assert.equal(existsSync(join(dir, ".agents/.worktrees/loop-01/node_modules/big.js")), true);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
