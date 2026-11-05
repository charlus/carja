// test/loop-dryrun-purity.test.js
//
// Regression for the revive/lock-ordering finding (PR #7 review). Before the fix,
// `loopCommand` persisted the resume-revive (and any trigger/harvest) to disk
// UNCONDITIONALLY, before the `--dry-run` guard and before the one-loop lock. Two
// bugs followed: (1) `--dry-run` mutated loop-state.json on an interrupted state
// (rewound in-flight tasks to `pending`), contradicting "dry-run never writes";
// (2) a 2nd invocation racing a live run rewound the live run's on-disk tasks
// before the lock refused it.
//
// This is an INTEGRATION test — it drives the real `loopCommand` IO shell, the
// exact layer the pure-module suites stub out (the documented adapter-layer trap),
// which is why the original bug was invisible to them. `--dry-run` returns before
// spawning any agent, so no real CLI is launched.

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, readFile, access, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loopCommand } from "../src/commands/loop.js";

const STATE_REL = "carja/1-workbench/loop-state.json";
const LOCK_REL = "carja/1-workbench/loop.lock";

function sink() {
  let text = "";
  return { write: (s) => (text += s), get text() { return text; } };
}

async function fileExists(p) {
  try { await access(p); return true; } catch { return false; }
}

test("--dry-run leaves an interrupted loop-state.json byte-identical (no persist)", async () => {
  const dir = await mkdtemp(join(tmpdir(), "carja-dryrun-"));
  try {
    await mkdir(join(dir, "carja/1-workbench"), { recursive: true });
    const statePath = join(dir, STATE_REL);

    // An INTERRUPTED state: a swarm task mid-beat (`in_progress`) and a running
    // top-level status. reviveForResume WOULD rewind both — so if dry-run
    // persisted, the on-disk bytes would change. Written compact/non-canonical so
    // the old code's canonical re-serialization would also visibly differ.
    const raw = '{"schema_version":2,"status":"running","tasks":[{"id":"a","status":"in_progress"}]}';
    await writeFile(statePath, raw, "utf8");
    const before = await readFile(statePath, "utf8");

    const stdout = sink();
    const stderr = sink();
    await loopCommand([dir, "--dry-run"], { cwd: dir, stdout, stderr });

    // (a) The state file is untouched — dry-run performed no write.
    const after = await readFile(statePath, "utf8");
    assert.equal(after, before, "dry-run must not rewrite loop-state.json");

    // (b) dry-run never touched the one-loop lock (returns before acquiring it).
    assert.equal(await fileExists(join(dir, LOCK_REL)), false, "dry-run must not create a lock");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
