// test/app-command.test.js
//
// F7 (docs/roadmap/Risk-Tiered-Merge.md): "Running the app end to end matters
// more than tests" (Claude Code team). An agent cannot drive a product it
// cannot start, and working out how to start it again in every session is slow
// and unreliable. `carja app up|check|down` starts the app from the project's
// `app` block in carja.config.json, waits until it is ready, and stops it.
// Real processes through the real CLI.

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, readFileSync, existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync, spawnSync } from "node:child_process";

const BIN = new URL("../bin/carja.js", import.meta.url).pathname;
const carja = (cwd, ...args) => spawnSync("node", [BIN, ...args], { cwd, encoding: "utf8", timeout: 60000 });
const alive = (pid) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

function project(app) {
  const root = mkdtempSync(join(tmpdir(), "carja-app-"));
  execFileSync("git", ["init", "-q"], { cwd: root });
  writeFileSync(join(root, "carja.config.json"), JSON.stringify({ app }));
  writeFileSync(join(root, "server.js"), "setTimeout(() => require('fs').writeFileSync('ready.flag', ''), 300); console.log('booting'); setInterval(() => {}, 1000);\n");
  return root;
}

test("up starts the app and waits until it is ready; check says so; down stops it", () => {
  const root = project({ start: "node server.js", ready: "test -f ready.flag", url: "http://localhost:3000" });
  try {
    const up = carja(root, "app", "up");
    assert.equal(up.status, 0, up.stdout + up.stderr);
    assert.match(up.stdout, /ready at http:\/\/localhost:3000/);
    const pid = Number(readFileSync(join(root, ".git/carja-app.pid"), "utf8"));
    assert.ok(alive(pid), "the app runs after up returns");
    assert.match(readFileSync(join(root, ".git/carja-app.log"), "utf8"), /booting/);

    const again = carja(root, "app", "up");
    assert.equal(again.status, 0);
    assert.match(again.stdout, /already running/);

    assert.equal(carja(root, "app", "check").status, 0);
    const down = carja(root, "app", "down");
    assert.equal(down.status, 0, down.stdout + down.stderr);
    assert.equal(existsSync(join(root, ".git/carja-app.pid")), false);
    for (let i = 0; i < 50 && alive(pid); i++) execFileSync("sleep", ["0.1"]);
    assert.equal(alive(pid), false, "down stops the app");
  } finally {
    carja(root, "app", "down");
    rmSync(root, { recursive: true, force: true });
  }
});

test("an app that never gets ready: up stops it, shows the end of its log, and fails", () => {
  const root = project({ start: "node server.js", ready: "false", ready_timeout_s: 2 });
  try {
    const up = carja(root, "app", "up");
    assert.equal(up.status, 1);
    assert.match(up.stderr, /not ready after 2 s/);
    assert.match(up.stderr, /booting/);
    assert.equal(existsSync(join(root, ".git/carja-app.pid")), false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("no app block: up says what to add", () => {
  const root = project(undefined);
  try {
    const up = carja(root, "app", "up");
    assert.equal(up.status, 1);
    assert.match(up.stderr, /"app": \{ "start"/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
