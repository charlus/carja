// test/merge-stack-backlog.test.js
//
// `carja merge-stack --backlog` (owner, 2026-11-20): "merge stack only work on
// project, not on a loop that close unrelated tasks from the backlog". The
// pairing of a backlog run's MRs (pure), then the real CLI in the outer layout
// with real git and the stub `gh` merging for real (STUB_FORGE_REAL_MERGE=1):
// each state MR edits the task backlog, so the second conflicts after the
// first is merged, and the command takes the default branch in, both sides kept.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, writeFileSync, appendFileSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

import { backlogEntries, branchesOfStacks, isLoopBranch, mrNumber } from "../src/loop/backlog-mrs.js";
import { REPO, G, layout } from "./helpers/stacked-layout.js";

test("backlogEntries: pairs code and state MRs by branch, oldest first, skips stacks and other branches", () => {
  const outer = [
    { url: "https://f/o/-/merge_requests/12", branch: "carja/loop/loop-task-b", title: "Carja state: b" },
    { url: "https://f/o/-/merge_requests/11", branch: "carja/loop/loop-task-a", title: "Carja state: a" },
    { url: "https://f/o/-/merge_requests/13", branch: "carja/loop/loop-slice-p-01", title: "Carja state: slice" },
    { url: "https://f/o/-/merge_requests/14", branch: "feature/x", title: "human work" },
  ];
  const code = [
    { url: "https://f/c/-/merge_requests/5", branch: "carja/loop/loop-task-a", title: "a" },
    { url: "https://f/c/-/merge_requests/6", branch: "carja/loop/loop-task-c", title: "c" },
  ];
  const tasks = [{ id: "task:b", title: "Task B", worktree: { branch: "carja/loop/loop-task-b" }, ship: { body: "## Owner actions\n- Set FOO in production.\n" }, rulings: [] }];
  const stackBranches = branchesOfStacks([[{ outer: { branch: "carja/loop/loop-slice-p-01" }, code: null }]]);
  const { entries, orphans } = backlogEntries({ outer, code, stackBranches, tasks });
  assert.deepEqual(entries.map((e) => e.outer.url), ["https://f/o/-/merge_requests/11", "https://f/o/-/merge_requests/12"]);
  assert.equal(entries[0].title, "a", "no task: the MR title without the state prefix");
  assert.equal(entries[0].code.url, "https://f/c/-/merge_requests/5");
  assert.equal(entries[1].title, "Task B");
  assert.equal(entries[1].code, null);
  assert.deepEqual(entries[1].ownerActions, ["Set FOO in production."]);
  assert.deepEqual(orphans, ["https://f/c/-/merge_requests/6"], "a code MR without a state MR is never merged here");
  assert.equal(isLoopBranch("conductor/loop/x"), true);
  assert.equal(mrNumber("https://github.com/o/r/pull/7"), 7);
});

function mergeStack(l, args, env = {}) {
  return spawnSync("node", [join(REPO, "bin/carja.js"), "merge-stack", ...args], {
    cwd: l.root,
    encoding: "utf8",
    env: { ...process.env, PATH: `${l.bin}:${process.env.PATH}`, STUB_FORGE_DB: l.db, STUB_FORGE_REAL_MERGE: "1", CARJA_HOME: join(l.base, "home"), CARJA_MERGE_POLL_MS: "0", ...env },
    timeout: 60000,
  });
}

const BACKLOG = "carja/2-backlog/task-backlog.md";

/**
 * Three backlog items as a plain `carja loop` run leaves them: a code PR and a
 * state PR each, every state PR ticking the task backlog at the same place.
 * Plus a project's stacked PR and a person's PR, which the command leaves alone.
 */
function backlogRun({ ownerActionOn = null } = {}) {
  const l = layout({ prefix: "merge-backlog-" });
  const prs = [];
  const tasks = [];
  const origin = (dir) => G(dir, "remote", "get-url", "origin");
  const open = (dir, branch, base, title) => {
    const n = prs.length + 1;
    prs.push({ n, repo: origin(dir), head: branch, base, title, state: "OPEN", url: `https://example.invalid/o/r/pull/${n}` });
    return `https://example.invalid/o/r/pull/${n}`;
  };
  const commit = (dir, branch, from, file, text, msg, append = false) => {
    G(dir, "checkout", "-q", "-b", branch, from);
    mkdirSync(join(dir, file, ".."), { recursive: true });
    (append ? appendFileSync : writeFileSync)(join(dir, file), text);
    G(dir, "add", file);
    G(dir, "commit", "-qm", msg);
    G(dir, "push", "-q", "--no-verify", "origin", branch);
  };
  for (const k of ["a", "b", "c"]) {
    const branch = `carja/loop/loop-task-${k}`;
    commit(l.code, branch, "main", `item-${k}.txt`, `${k}\n`, `item ${k}`);
    const codeUrl = open(l.code, branch, "main", `Item ${k}`);
    commit(l.root, branch, "master", BACKLOG, `- [x] item ${k}\n`, `ship item ${k}`, true);
    const stateUrl = open(l.root, branch, "master", `Carja state: Item ${k}`);
    tasks.push({ id: `task:${k}`, title: `Item ${k}`, status: "merged", worktree: { branch }, merge: { pr_url: stateUrl, code_pr_url: codeUrl }, rulings: [], ...(ownerActionOn === k ? { ship: { body: "## Owner actions\n- Set FOO in production.\n" } } : {}) });
  }
  // Not backlog items: a project's stacked item and a person's branch.
  commit(l.root, "carja/loop/loop-slice-notes-01", "master", "carja/1-workbench/slice.md", "s\n", "slice");
  open(l.root, "carja/loop/loop-slice-notes-01", "master", "Carja state: slice 01");
  commit(l.root, "feature/human", "master", "human.md", "h\n", "human");
  open(l.root, "feature/human", "master", "A person's work");
  G(l.code, "checkout", "-q", "main");
  G(l.root, "checkout", "-q", "master");
  writeFileSync(l.db, JSON.stringify({ prs }, null, 2));
  const run = join(l.root, ".git/carja-loop-logs/runs/notes");
  mkdirSync(run, { recursive: true });
  writeFileSync(join(run, "stack.json"), JSON.stringify([{ id: "slice:notes/01", title: "slice 01", merged: true, outer: { branch: "carja/loop/loop-slice-notes-01", url: prs.at(-2).url }, code: null }]));
  const statePath = join(l.root, "carja/1-workbench/loop-state.json");
  const st = JSON.parse(readFileSync(statePath, "utf8"));
  st.tasks = tasks;
  writeFileSync(statePath, JSON.stringify(st, null, 2));
  return l;
}

const states = (l) => Object.fromEntries(JSON.parse(readFileSync(l.db, "utf8")).prs.map((p) => [p.title, p.state]));

test("merge-stack --backlog: merges every item, takes master into each conflicting state MR with both sides kept", () => {
  const l = backlogRun();
  try {
    const dry = mergeStack(l, ["--backlog", "--dry-run"]);
    assert.equal(dry.status, 0, dry.stdout + dry.stderr);
    assert.match(dry.stdout, /^backlog: 3 items, bottom first\. Dry run: nothing is merged\.\n1\. Item a: ready \(#1 \+ #2\)\.\n2\. Item b: ready \(#3 \+ #4\)\.\n3\. Item c: ready \(#5 \+ #6\)\./);

    // No project named and no project stack waiting: the backlog, without the flag.
    const r = mergeStack(l, []);
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.match(r.stdout, /1\. Item a: merged #1 \+ #2\./);
    assert.match(r.stdout, /2\. Item b: took master into #4, both sides kept in `carja\/2-backlog\/task-backlog\.md`\.\n2\. Item b: merged #3 \+ #4\./);
    assert.match(r.stdout, /3\. Item c: merged #5 \+ #6\.\nNext: deploy and test the product/);
    const s = states(l);
    for (const k of ["a", "b", "c"]) {
      assert.equal(s[`Item ${k}`], "MERGED");
      assert.equal(s[`Carja state: Item ${k}`], "MERGED");
    }
    assert.equal(s["Carja state: slice 01"], "OPEN", "a project's stacked MR is not a backlog item");
    assert.equal(s["A person's work"], "OPEN", "a person's MR is never merged");
    G(l.root, "fetch", "-q", "origin");
    const backlog = G(l.root, "show", `origin/master:${BACKLOG}`);
    for (const k of ["a", "b", "c"]) assert.match(backlog, new RegExp(`- \\[x\\] item ${k}`), `both sides kept: item ${k}`);
    assert.doesNotMatch(backlog, /^(<{7}|={7}|>{7})/m);
    assert.equal(G(l.root, "worktree", "list").split("\n").length, 1, "the throwaway worktree is removed");
  } finally {
    rmSync(l.base, { recursive: true, force: true });
  }
});

test("merge-stack --backlog: a conflict in code stops the walk, and the code is never merged by the command", () => {
  const l = backlogRun();
  try {
    // Item b's code changes the same file as item a's, at the same line.
    G(l.code, "checkout", "-q", "carja/loop/loop-task-b");
    writeFileSync(join(l.code, "item-a.txt"), "b's version\n");
    G(l.code, "add", "item-a.txt");
    G(l.code, "commit", "-qm", "b touches a");
    G(l.code, "push", "-q", "--no-verify", "origin", "carja/loop/loop-task-b");
    G(l.code, "checkout", "-q", "main");
    const r = mergeStack(l, ["--backlog"]);
    assert.equal(r.status, 1, r.stdout + r.stderr);
    assert.match(r.stdout, /2\. Item b: stopped\. https:\/\/example\.invalid\/o\/r\/pull\/3 has a conflict\./);
    const s = states(l);
    assert.equal(s["Item b"], "OPEN");
    assert.equal(s["Carja state: Item b"], "OPEN");
  } finally {
    rmSync(l.base, { recursive: true, force: true });
  }
});

test("merge-stack --backlog: an owner action stops before the item, and --confirm takes the state MR's number", () => {
  const l = backlogRun({ ownerActionOn: "b" });
  try {
    const first = mergeStack(l, ["--backlog"]);
    assert.equal(first.status, 2, first.stdout + first.stderr);
    assert.match(first.stdout, /2\. Item b: needs you before the merge:\n {3}- Set FOO in production\./);
    assert.match(first.stdout, /Next: do the steps above that come before the merge, then run `carja merge-stack --backlog --confirm 4`\./);
    assert.equal(states(l)["Item b"], "OPEN");

    // Item a is gone from the list now; the number still names item b.
    const confirmed = mergeStack(l, ["--backlog", "--confirm", "4"]);
    assert.equal(confirmed.status, 2, confirmed.stdout + confirmed.stderr);
    assert.match(confirmed.stdout, /1\. Item b: took master into #4, both sides kept in `carja\/2-backlog\/task-backlog\.md`\.\n1\. Item b: merged #3 \+ #4\.\n {3}Now do its steps that come after the merge:/);

    const rest = mergeStack(l, ["--backlog"]);
    assert.equal(rest.status, 0, rest.stdout + rest.stderr);
    assert.match(rest.stdout, /1\. Item c: took master into #6, both sides kept in `carja\/2-backlog\/task-backlog\.md`\.\n1\. Item c: merged #5 \+ #6\./);
  } finally {
    rmSync(l.base, { recursive: true, force: true });
  }
});

test("merge-stack --backlog: refuses while a backlog run is live, and says when nothing waits", () => {
  const l = backlogRun();
  try {
    writeFileSync(join(l.root, "carja/1-workbench/loop.lock"), `${JSON.stringify({ pid: process.pid, at: new Date().toISOString() })}\n`);
    const r = mergeStack(l, ["--backlog"]);
    assert.equal(r.status, 1);
    assert.match(r.stderr, /`carja loop` is running here/);
    rmSync(join(l.root, "carja/1-workbench/loop.lock"));
    assert.equal(mergeStack(l, ["notes", "--backlog"]).status, 1, "a project and --backlog together are refused");
    writeFileSync(l.db, JSON.stringify({ prs: [] }));
    const none = mergeStack(l, []);
    assert.equal(none.status, 0, none.stdout + none.stderr);
    assert.match(none.stdout, /backlog: no MR waits for a merge\./);
  } finally {
    rmSync(l.base, { recursive: true, force: true });
  }
});
