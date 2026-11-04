// test/watch-tower.test.js
//
// The watch tower (A4a): one live screen for every product the loop works on.
// `carja loop on` registers a product on this machine; `carja watch
// --all` shows each one's run, beat in progress, last news and waiting questions.

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync, spawnSync } from "node:child_process";
import { addLoopProject, listLoopProjects } from "../src/loop/projects-registry.js";

test("the registry adds a product once, by absolute path, outside every repository", async () => {
  const home = mkdtempSync(join(tmpdir(), "reg-"));
  const env = { CARJA_HOME: home };
  try {
    assert.deepEqual(await listLoopProjects(env), []);
    assert.equal(await addLoopProject("/w/app", env), true);
    assert.equal(await addLoopProject("/w/app/", env), false, "the same folder twice is one product");
    await addLoopProject("/w/site", env);
    assert.deepEqual(await listLoopProjects(env), ["/w/app", "/w/site"]);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

const REPO = new URL("..", import.meta.url).pathname;
const at = (min) => new Date(Date.now() - (60 - min) * 60000).toISOString();

function product(base, name, events, round = null) {
  const dir = join(base, name);
  mkdirSync(join(dir, ".git", "carja-loop-logs"), { recursive: true });
  execFileSync("git", ["init", "-q", dir]);
  writeFileSync(join(dir, ".git", "carja-loop-logs", "events.ndjson"), events.map((e) => JSON.stringify(e)).join("\n") + "\n");
  if (round) {
    mkdirSync(join(dir, "carja/1-workbench/questions"), { recursive: true });
    writeFileSync(join(dir, "carja/1-workbench/questions/task-a.md"), round);
  }
  return dir;
}

test("`carja loop on` registers the product for the tower, even when nothing else changes", () => {
  const base = mkdtempSync(join(tmpdir(), "tower-reg-"));
  try {
    const root = join(base, "app");
    execFileSync("node", [join(REPO, "bin/carja.js"), "init", root, "--all", "--no-detect"], { stdio: "pipe" });
    execFileSync("git", ["init", "-q", root]);
    const env = { ...process.env, CARJA_HOME: join(base, "home") };
    execFileSync("node", [join(REPO, "bin/carja.js"), "loop", "on", "--backlog", root, "--yes"], { stdio: "pipe", env });
    const r = spawnSync("node", [join(REPO, "bin/carja.js"), "watch", "--all", "--once"], { encoding: "utf8", env });
    assert.match(r.stdout, /1 product · /);
    assert.match(r.stdout, /· app +no run yet/);
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});

test("`carja watch --all --once`: one block per registered product, its run, its beat, its waiting questions", () => {
  const base = mkdtempSync(join(tmpdir(), "tower-"));
  const home = join(base, "home");
  try {
    const a = product(base, "alpha", [
      { run: "r1", at: at(0), type: "run_start", items: ["task:a"] },
      { run: "r1", at: at(30), type: "beat_start", task: "task:a", kind: "maker", model: "sonnet" },
      { run: "r1", at: at(31), type: "step", task: "task:a", kind: "maker", tool: "Bash", detail: "npm test" },
    ]);
    const b = product(base, "beta", [
      { run: "r2", at: at(0), type: "run_start", items: ["task:b"] },
      { run: "r2", at: at(10), type: "questions", task: "task:b", count: 1 },
      { run: "r2", at: at(10), type: "run_end", status: "awaiting_answers" },
    ], "# Questions: task:b (build)\n\n## Q1. Which?\nC.\n\n1. A — a\n2. B — b\n\n**Recommendation:** 1, because c\n**If wrong:** d\n\nAnswer:\n");
    const c = join(base, "gamma");
    mkdirSync(c);
    execFileSync("git", ["init", "-q", c]);
    const env = { ...process.env, CARJA_HOME: home };
    for (const d of [a, b, c]) {
      mkdirSync(home, { recursive: true });
    }
    writeFileSync(join(home, "loop-projects.json"), JSON.stringify({ projects: [a, b, c, join(base, "deleted-since")] }));
    const r = spawnSync("node", [join(REPO, "bin/carja.js"), "watch", "--all", "--once"], { encoding: "utf8", env });
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /3 products · ▶ 1 running · \? 1 waiting for you · ✔ 0 done/);
    assert.match(r.stdout, /▶ alpha[\s\S]*● a {2,}.*Build [▓░]{10} \d+ min · sonnet · 1 steps[\s\S]*last step \d\d:\d\d {2}Bash: npm test/);
    assert.match(r.stdout, /\? beta[\s\S]*question round waiting for you → carja\/1-workbench\/questions\/task-a\.md/);
    assert.match(r.stdout, /· gamma +no run yet/);
    const order = ["alpha", "beta", "gamma"].map((n) => r.stdout.indexOf(` ${n}`));
    assert.deepEqual([...order].sort((x, y) => x - y), order, "running first, then waiting, then idle");
    assert.doesNotMatch(r.stdout, /\x1b\[/, "no colour codes without a terminal");
    const none = spawnSync("node", [join(REPO, "bin/carja.js"), "watch", "--all", "--once"], { encoding: "utf8", env: { ...process.env, CARJA_HOME: join(base, "empty") } });
    assert.match(none.stdout, /No product registered[\s\S]*carja loop on/);
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});

test("a finished item is one line with its MR numbers, code before state", async () => {
  const { renderTower, mrRef, bar } = await import("../src/loop/tower.js");
  assert.equal(mrRef("https://code.euranova.eu/innovation/Autopportunity/-/merge_requests/261"), "!261");
  assert.equal(mrRef("https://github.com/o/r/pull/12"), "#12");
  assert.equal(bar(15), "▓▓▓▓▓░░░░░");
  const t0 = Date.parse("2026-10-21T12:49:00Z");
  const model = { started: new Date(t0).toISOString(), ended: { at: new Date(t0 + 87 * 60000).toISOString(), status: "completed" }, beats: 10, cost: 7.71, planned: [],
    items: [{ task: "task:kb-profile-save-can-wipe-experience-link", beats: { maker: 1, checker: 3, ship: 2 }, red: 0, rejected: 0, done: "merged", mr: { url: "https://x/-/merge_requests/84", code: "https://y/-/merge_requests/261" } }] };
  const s = renderTower([{ name: "autopportunity", root: "/w/a", model, waiting: [] }], t0 + 90 * 60000);
  assert.match(s, /✔ autopportunity +ended \d\d:\d\d completed · 87 min · 10 beats · \$7\.71/);
  assert.match(s, /✔ kb-profile-save-can-wipe-experience- +!261 \+ state !84 · 1 Build, 3 Review, 2 Ship/);
  assert.match(renderTower([{ name: "a", root: "/a", model, waiting: [] }], t0, { color: true }), /\x1b\[32m/);
});
