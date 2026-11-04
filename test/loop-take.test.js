// test/loop-take.test.js
//
// C4-F4 (docs/roadmap/Unattended-Crossing.md): a `(loop-ready)` tag is an
// uncommitted edit to the tracked backlog, which the state MR also changes, so
// the owner's next `git pull` refused after the fourth crossing. Owner decision
// 2026-10-22 (O1): the owner picks work with `carja loop take "<item>"`,
// kept in the git dir, never in a tracked file. The tag still works.

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync, spawnSync } from "node:child_process";
import { resolveTake } from "../src/loop/ready-queue.js";
import { harvestWorkQueue, workItemId } from "../src/loop/harvester.js";

const REPO = new URL("..", import.meta.url).pathname;
const BACKLOG = `# Task Backlog

## P1
- [ ] Fix the flaky login test
- [ ] Add CSV export to the report page
- [ ] Add CSV import to the admin page
- [x] Fix the footer link
`;

test("take matches one open backlog item, by exact title or a unique part of it", () => {
  assert.equal(resolveTake(BACKLOG, "flaky login").item.title, "Fix the flaky login test");
  assert.equal(resolveTake(BACKLOG, "add csv export to the report page").item.title, "Add CSV export to the report page");
  const amb = resolveTake(BACKLOG, "CSV");
  assert.equal(amb.item, undefined);
  assert.deepEqual(amb.candidates.map((c) => c.title), ["Add CSV export to the report page", "Add CSV import to the admin page"]);
  assert.equal(resolveTake(BACKLOG, "footer").item, undefined, "a done item is never taken");
  assert.deepEqual(resolveTake(BACKLOG, "footer").candidates, []);
});

test("with require_ready, a taken item is harvested like a tagged one", () => {
  const id = workItemId("bugfix", "Fix the flaky login test");
  const q = harvestWorkQueue({ backlogMd: BACKLOG, requireReady: true, readyIds: new Set([id]) });
  assert.deepEqual(q.map((t) => t.title), ["Fix the flaky login test"]);
  assert.deepEqual(harvestWorkQueue({ backlogMd: BACKLOG, requireReady: true }), []);
});

test("carja loop take queues an item in the git dir and leaves the checkout clean", () => {
  const base = mkdtempSync(join(tmpdir(), "loop-take-"));
  const root = join(base, "p");
  try {
    execFileSync("node", [join(REPO, "bin/carja.js"), "init", root, "--all", "--no-detect"], { stdio: "pipe" });
    const G = (...a) => execFileSync("git", a, { cwd: root, stdio: "pipe" }).toString().trim();
    G("init", "-q", "-b", "master");
    G("config", "user.email", "t@t");
    G("config", "user.name", "t");
    writeFileSync(join(root, "carja/2-backlog/task-backlog.md"), BACKLOG);
    const cfg = JSON.parse(readFileSync(join(root, "carja.config.json"), "utf8"));
    cfg.loop = { forge: "gh", require_ready: true, inbox: false };
    writeFileSync(join(root, "carja.config.json"), JSON.stringify(cfg));
    G("add", "-A");
    G("commit", "-qm", "init");
    const cli = (...a) => spawnSync("node", [join(REPO, "bin/carja.js"), "loop", ...a], { cwd: root, encoding: "utf8" });

    const r = cli("take", "flaky login");
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.match(r.stdout, /Fix the flaky login test/);
    assert.equal(G("status", "--porcelain"), "", "no tracked file changes");
    assert.ok(existsSync(join(root, ".git/carja-loop-ready.json")));

    const amb = cli("take", "CSV");
    assert.equal(amb.status, 1);
    assert.match(amb.stderr, /Add CSV export to the report page[\s\S]*Add CSV import to the admin page/);

    const dry = cli(".", "--from-carja", "--dry-run");
    assert.match(dry.stdout, /harvested: 1 work item/);
    assert.match(dry.stdout, /Fix the flaky login test/);

    const list = cli("take");
    assert.equal(list.status, 0);
    assert.match(list.stdout, /Fix the flaky login test/);

    // Once the state MR ticks it, the item leaves the queue.
    writeFileSync(join(root, "carja/2-backlog/task-backlog.md"), BACKLOG.replace("- [ ] Fix the flaky", "- [x] Fix the flaky"));
    assert.doesNotMatch(cli("take").stdout, /Fix the flaky login test/);

    cli("take", "CSV export");
    const drop = cli("take", "--drop", "CSV export");
    assert.equal(drop.status, 0, drop.stdout + drop.stderr);
    assert.doesNotMatch(cli("take").stdout, /CSV export/);
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});
