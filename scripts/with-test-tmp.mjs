#!/usr/bin/env node
// scripts/with-test-tmp.mjs <command> [args...]
//
// Run a test command with its own TMPDIR, then delete it. Many tests create a
// temp folder holding a full Carja install and never remove it: about
// 21,000 inodes a full run, and on 2026-10-20 /tmp ran out of inodes for every
// session on the machine. Node's tmpdir() and bash's mktemp both honour TMPDIR,
// so one folder per run catches every leak, whatever the test, however it exits.
// The exit code is the command's.

import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const [cmd, ...args] = process.argv.slice(2);
if (!cmd) {
  console.error("usage: with-test-tmp.mjs <command> [args...]");
  process.exit(2);
}
const runTmp = mkdtempSync(join(tmpdir(), "carja-test-run-"));
let status = 1;
try {
  // CARJA_HOME too: a test that runs `carja loop on` must not register
  // its scratch project in the developer's own watch-tower list (2026-10-21).
  const r = spawnSync(cmd, args, { stdio: "inherit", env: { ...process.env, TMPDIR: runTmp, TMP: runTmp, TEMP: runTmp, CARJA_HOME: join(runTmp, "carja-home") } });
  status = r.status ?? (r.signal ? 1 : 0);
} finally {
  rmSync(runTmp, { recursive: true, force: true });
}
process.exit(status);
