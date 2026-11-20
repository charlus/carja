// test/merge-stack-cli.test.js
//
// `carja merge-stack` through the real CLI, in the outer layout (code nested at
// repo/), with the stub `gh` (test/fixtures/stub-forge/gh): a recorded stack of
// three items, the middle one with an owner action.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, writeFileSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

import { REPO, G, layout } from "./helpers/stacked-layout.js";

function mergeStack(l, args) {
  return spawnSync("node", [join(REPO, "bin/carja.js"), "merge-stack", ...args], {
    cwd: l.root,
    encoding: "utf8",
    env: { ...process.env, PATH: `${l.bin}:${process.env.PATH}`, STUB_FORGE_DB: l.db, CARJA_HOME: join(l.base, "home"), CARJA_MERGE_POLL_MS: "0" },
    timeout: 60000,
  });
}

/** Three stacked items in both repositories, their PRs open, the stack recorded as the loop leaves it. */
function stacked() {
  const l = layout({ prefix: "merge-stack-" });
  const prs = [];
  const entries = [];
  const origin = (dir) => G(dir, "remote", "get-url", "origin");
  let below = { outer: "master", code: "main" };
  for (let i = 1; i <= 3; i++) {
    const branch = `carja/loop/0${i}`;
    const side = {};
    for (const [key, dir] of [["code", l.code], ["outer", l.root]]) {
      G(dir, "checkout", "-q", "-b", branch, below[key]);
      writeFileSync(join(dir, `item-${i}.txt`), `${i}\n`);
      G(dir, "add", `item-${i}.txt`);
      G(dir, "commit", "-qm", `item ${i}`);
      G(dir, "push", "-q", "--no-verify", "origin", branch);
      const n = prs.length + 1;
      prs.push({ n, repo: origin(dir), head: branch, base: below[key], title: `item ${i}`, state: "OPEN", url: `https://example.invalid/o/r/pull/${n}` });
      side[key] = { branch, head: G(dir, "rev-parse", "HEAD"), url: `https://example.invalid/o/r/pull/${n}` };
    }
    entries.push({ id: `slice:notes/0${i}`, title: `slice 0${i}`, ...side, ...(i === 2 ? { ownerActions: ["Back up the database, then run the migration."] } : {}) });
    below = { outer: branch, code: branch };
  }
  G(l.code, "checkout", "-q", "main");
  G(l.root, "checkout", "-q", "master");
  writeFileSync(l.db, JSON.stringify({ prs }, null, 2));
  const run = join(l.root, ".git/carja-loop-logs/runs/notes");
  mkdirSync(run, { recursive: true });
  writeFileSync(join(run, "stack.json"), JSON.stringify(entries, null, 2));
  return l;
}

const state = (l) => JSON.parse(readFileSync(l.db, "utf8")).prs.map((p) => p.state);

test("merge-stack: dry run, then bottom first up to the owner action, --confirm, then the rest", () => {
  const l = stacked();
  try {
    const dry = mergeStack(l, ["--dry-run"]);
    assert.equal(dry.status, 2, dry.stdout + dry.stderr);
    assert.match(dry.stdout, /^notes: 3 items, bottom first\. Dry run: nothing is merged\.\n1\. slice 01: ready \(#1 \+ #2\)\.\n2\. slice 02: needs you before the merge:\n {3}- Back up the database/);
    assert.deepEqual(state(l), ["OPEN", "OPEN", "OPEN", "OPEN", "OPEN", "OPEN"]);

    const first = mergeStack(l, ["notes"]);
    assert.equal(first.status, 2, first.stdout + first.stderr);
    assert.match(first.stdout, /1\. slice 01: merged #1 \+ #2\.\n2\. slice 02: needs you before the merge:/);
    assert.match(first.stdout, /Next: do the steps above that come before the merge, then run `carja merge-stack notes --confirm 2`\./);
    assert.deepEqual(state(l), ["MERGED", "MERGED", "OPEN", "OPEN", "OPEN", "OPEN"]);
    const db = JSON.parse(readFileSync(l.db, "utf8")).prs;
    assert.equal(db[0].merged.method, "merge", "never squashed");
    assert.equal(G(l.code, "ls-remote", "--heads", "origin", "carja/loop/01"), "", "the source branch is deleted");

    const confirmed = mergeStack(l, ["notes", "--confirm", "2"]);
    assert.equal(confirmed.status, 2, confirmed.stdout + confirmed.stderr);
    assert.match(confirmed.stdout, /1\. slice 01: already merged\.\n2\. slice 02: merged #3 \+ #4\.\n {3}Now do its steps that come after the merge:/);
    const moved = JSON.parse(readFileSync(l.db, "utf8")).prs;
    assert.equal(moved[2].base, "main", "the code MR was moved to the default branch before its merge");
    assert.equal(moved[3].base, "master");
    assert.deepEqual(state(l), ["MERGED", "MERGED", "MERGED", "MERGED", "OPEN", "OPEN"]);

    const rest = mergeStack(l, []);
    assert.equal(rest.status, 0, rest.stdout + rest.stderr);
    assert.match(rest.stdout, /3\. slice 03: merged #5 \+ #6\.\nNext: deploy and test the product/);
    assert.deepEqual(state(l), ["MERGED", "MERGED", "MERGED", "MERGED", "MERGED", "MERGED"]);
  } finally {
    rmSync(l.base, { recursive: true, force: true });
  }
});

test("merge-stack: a red check stops before the merge, and nothing is merged", () => {
  const l = stacked();
  try {
    const d = JSON.parse(readFileSync(l.db, "utf8"));
    d.prs[0].checks = "FAILURE";
    writeFileSync(l.db, JSON.stringify(d));
    const r = mergeStack(l, ["notes"]);
    assert.equal(r.status, 1, r.stdout + r.stderr);
    assert.match(r.stdout, /1\. slice 01: stopped\. The pipeline of https:\/\/example\.invalid\/o\/r\/pull\/1 failed\./);
    assert.deepEqual(state(l), ["OPEN", "OPEN", "OPEN", "OPEN", "OPEN", "OPEN"]);
  } finally {
    rmSync(l.base, { recursive: true, force: true });
  }
});

test("merge-stack: refuses while the project's loop runs, and says when nothing waits", () => {
  const l = stacked();
  try {
    writeFileSync(join(l.root, ".git/carja-loop-logs/runs/notes/loop.lock"), `${JSON.stringify({ pid: process.pid, at: new Date().toISOString() })}\n`);
    const r = mergeStack(l, ["notes"]);
    assert.equal(r.status, 1);
    assert.match(r.stderr, /carja loop notes` is running/);
    rmSync(join(l.root, ".git/carja-loop-logs/runs/notes"), { recursive: true });
    // No project stack waits: the command turns to the backlog runs' MRs (test/merge-stack-backlog.test.js).
    writeFileSync(l.db, JSON.stringify({ prs: [] }));
    const none = mergeStack(l, []);
    assert.equal(none.status, 0, none.stdout + none.stderr);
    assert.match(none.stdout, /backlog: no MR waits for a merge\./);
  } finally {
    rmSync(l.base, { recursive: true, force: true });
  }
});
