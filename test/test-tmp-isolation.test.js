// test/test-tmp-isolation.test.js
//
// 2026-10-20: /tmp ran out of inodes. Every full test run left about 108 temp
// folders, each a full Carja install, about 21,000 inodes a run: some 50
// runs filled /tmp for every session on the machine. The test scripts now run
// under scripts/with-test-tmp.mjs, which gives the run its own TMPDIR and
// deletes it at the end, whatever the tests left and however they exit.

import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";

const WRAPPER = new URL("../scripts/with-test-tmp.mjs", import.meta.url).pathname;

test("the wrapper gives the run its own TMPDIR and removes it, with what the run left in it", () => {
  const child = "const fs=require('fs'),os=require('os'),p=require('path');const d=fs.mkdtempSync(p.join(os.tmpdir(),'leak-'));fs.writeFileSync(p.join(d,'f'),'x');console.log(os.tmpdir());";
  const r = spawnSync(process.execPath, [WRAPPER, process.execPath, "-e", child], { encoding: "utf8" });
  assert.equal(r.status, 0, r.stderr);
  const runTmp = r.stdout.trim().split("\n").pop();
  assert.notEqual(runTmp, tmpdir(), "the run must not use the shared temp folder");
  assert.equal(existsSync(runTmp), false, "the run's temp folder is removed");
});

test("the wrapper keeps the run's exit code", () => {
  const r = spawnSync(process.execPath, [WRAPPER, process.execPath, "-e", "process.exit(3)"], { encoding: "utf8" });
  assert.equal(r.status, 3);
});

test("every test script runs under the wrapper", () => {
  const scripts = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")).scripts;
  const bare = Object.entries(scripts).filter(([k, v]) => /^test(:|$)/.test(k) && k !== "test:init" && !v.includes("with-test-tmp"));
  assert.deepEqual(bare.map(([k]) => k), []);
});
