// test/loop-monitor.test.js
//
// Loop Monitor M1 + M2 (docs/roadmap/Loop-Monitor.md): the driver writes an
// event log, and `carja watch` shows what each item is doing. R2: the view
// shows what was recorded, never a guess.

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync, appendFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { makeEmitter, readEvents, watchModel, renderWatch, EVENTS_FILE } from "../src/loop/events.js";

const T0 = Date.parse("2026-10-21T09:00:00Z");

test("the emitter appends one line per event, with the run and the time", async () => {
  const dir = mkdtempSync(join(tmpdir(), "events-"));
  try {
    let t = T0;
    const emit = makeEmitter(dir, "r1", { now: () => (t += 60000) });
    await emit("run_start", { items: ["task:a"] });
    await emit("beat_start", { task: "task:a", kind: "maker", model: "sonnet" });
    const ev = readEvents(readFileSync(join(dir, EVENTS_FILE), "utf8"));
    assert.deepEqual(ev.map((e) => [e.run, e.type]), [["r1", "run_start"], ["r1", "beat_start"]]);
    appendFileSync(join(dir, EVENTS_FILE), '{"cut by a cra');
    assert.equal(readEvents(readFileSync(join(dir, EVENTS_FILE), "utf8")).length, 2, "a line cut by a crash is skipped");
    await makeEmitter(null, "r1")("x");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

const at = (min) => new Date(T0 + min * 60000).toISOString();
const RUN = [
  { run: "r0", at: at(-100), type: "run_start", items: ["task:old"] },
  { run: "r1", at: at(0), type: "run_start", items: ["task:a"] },
  { run: "r1", at: at(1), type: "beat_start", task: "task:a", kind: "maker", model: "sonnet" },
  { run: "r1", at: at(21), type: "beat_end", task: "task:a", kind: "maker", duration_s: 1200, cost_usd: 0.9 },
  { run: "r1", at: at(24), type: "verify", task: "task:a", exit: 0, duration_s: 150 },
  { run: "r1", at: at(25), type: "beat_start", task: "task:a", kind: "checker", model: "opus" },
];

test("watch: the latest run only, the beat in progress, and the last recorded fact", () => {
  const m = watchModel(RUN);
  assert.equal(m.run, "r1");
  assert.equal(m.beats, 1);
  const screen = renderWatch(m, T0 + 31 * 60000);
  assert.match(screen, /started \d\d:\d\d · 31 min · 1 beat · ≈ \$0\.90/);
  assert.match(screen, /now: Review beat on opus, 6 min so far/);
  assert.match(screen, /last news \d\d:\d\d: Review beat started \(opus\)/);
  assert.match(screen, /so far: 1 Build$/m);
  const stepped = renderWatch(watchModel([...RUN, { run: "r1", at: at(27), type: "step", task: "task:a", kind: "checker", tool: "Bash", detail: "npm test" }]), T0 + 31 * 60000);
  assert.match(stepped, /now: Review beat on opus, 6 min so far, 1 step/);
  assert.match(stepped, /last step \d\d:\d\d: Bash: npm test/);
  const red = renderWatch(watchModel([...RUN.slice(0, 5), { run: "r1", at: at(24), type: "verify", task: "task:a", exit: 1 }, { run: "r1", at: at(26), type: "verdict", task: "task:a", approved: false, reason: "x" }]), T0 + 30 * 60000);
  assert.match(red, /so far: 1 Build \(1 red verify, 1 rejected review\)/);
  assert.doesNotMatch(screen, /task:old/);
  assert.match(screen, /Running\./);
  assert.doesNotMatch(screen, /last step/, "no step recorded, none shown");
});

test("watch: an ended run says how it ended; no run says how to start one", () => {
  const ended = watchModel([...RUN, { run: "r1", at: at(40), type: "merged", task: "task:a", url: "u2", code_url: "u1" }, { run: "r1", at: at(40), type: "run_end", status: "completed" }]);
  const s = renderWatch(ended, T0 + 41 * 60000);
  assert.match(s, /MR opened: u1, u2/);
  assert.match(s, /Run ended \d\d:\d\d: completed/);
  assert.match(renderWatch(watchModel([]), T0), /No loop run recorded/);
});

test("through the real CLI: a loop run writes its events and `carja watch --once` shows them", async () => {
  const { execFileSync, spawnSync } = await import("node:child_process");
  const { mkdirSync } = await import("node:fs");
  const REPO = new URL("..", import.meta.url).pathname;
  const base = mkdtempSync(join(tmpdir(), "watch-"));
  try {
    const root = join(base, "app");
    const bin = join(base, "bin");
    mkdirSync(bin);
    writeFileSync(join(bin, "claude"), readFileSync(join(REPO, "test/fixtures/stub-engine/claude")), { mode: 0o755 });
    writeFileSync(join(bin, "gh"), '#!/bin/sh\n[ "$1" = auth ] && exit 0\n[ "$1" = pr ] && [ "$2" = list ] && exit 0\necho https://example.invalid/pr/1\n', { mode: 0o755 });
    execFileSync("node", [join(REPO, "bin/carja.js"), "init", root, "--all", "--no-detect"], { stdio: "pipe" });
    const G = (...a) => execFileSync("git", a, { cwd: root, stdio: "pipe" }).toString().trim();
    G("init", "-q", "-b", "master");
    G("config", "user.email", "t@t");
    G("config", "user.name", "t");
    writeFileSync(join(root, ".gitignore"), ".agents/.worktrees/\n", { flag: "a" });
    writeFileSync(join(root, "carja/2-backlog/task-backlog.md"), "# Task Backlog\n\n- [ ] Add a flag (loop-ready)\n", { flag: "a" });
    const cfg = JSON.parse(readFileSync(join(root, "carja.config.json"), "utf8"));
    Object.assign(cfg, { verify: "true", loop: { forge: "gh", require_ready: true, inbox: false } });
    writeFileSync(join(root, "carja.config.json"), JSON.stringify(cfg));
    const st = JSON.parse(readFileSync(join(root, "carja/1-workbench/loop-state.json"), "utf8"));
    Object.assign(st, { phase: "execution", autonomy_level: "L3", sandbox: "cli-native", platform: "claude", concurrency: 1 });
    writeFileSync(join(root, "carja/1-workbench/loop-state.json"), JSON.stringify(st));
    G("add", "-A");
    G("commit", "-qm", "init");
    execFileSync("git", ["init", "-q", "--bare", "-b", "master", join(base, "o.git")]);
    G("remote", "add", "origin", join(base, "o.git"));
    G("push", "-q", "origin", "master");
    const env = { ...process.env, PATH: `${bin}:${process.env.PATH}` };
    const r = spawnSync("node", [join(REPO, "bin/carja.js"), "loop", root, "--from-carja"], { cwd: root, encoding: "utf8", env, timeout: 120000 });
    assert.equal(r.status, 0, r.stdout + r.stderr);
    const events = readEvents(readFileSync(join(root, ".git/carja-loop-logs", EVENTS_FILE), "utf8"));
    const types = events.map((e) => `${e.type}${e.kind ? `:${e.kind}` : ""}`);
    assert.deepEqual(types.slice(0, 2), ["run_start", "beat_start:maker"]);
    assert.ok(types.includes("verify") && types.includes("beat_start:checker") && types.includes("merged"));
    assert.equal(types.at(-1), "run_end");
    assert.ok(events.filter((e) => e.task).every((e) => e.task === "task:add-a-flag-loop-ready" || e.task.startsWith("task:")), "every beat names its item");
    const w = spawnSync("node", [join(REPO, "bin/carja.js"), "watch", root, "--once"], { encoding: "utf8" });
    assert.match(w.stdout, /Loop run started/);
    assert.match(w.stdout, /MR opened: https:\/\/example\.invalid\/pr\/1/);
    assert.match(w.stdout, /Run ended \d\d:\d\d: completed/);
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});
