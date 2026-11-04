// test/loop-doc-conflict.test.js
//
// I3 (owner, 2026-10-23): KM relief stopped at slice 08 of 17: "would conflict
// on merge — carja/3-product-areas/nexus/nexus-technical.md,
// carja/4-context/technical/coding-patterns.md". Two things were wrong: in
// a stack, the check ran against main instead of the branch the MR merges into,
// and a conflict only in Carja documents stopped the whole project. Now
// such a conflict is resolved by keeping both sides, verify runs again, and the
// MR opens; a conflict in code still stops the item.

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync, spawnSync } from "node:child_process";
import { keepBothSides, onlyCarjaDocs, mergeKeepingDocs } from "../src/loop/conflict.js";
import { runSwarm } from "../src/loop/swarm.js";

const G = (cwd, ...a) => execFileSync("git", a, { cwd, stdio: "pipe" }).toString().trim();
const gitIn = (cwd) => async (args) => {
  const r = spawnSync("git", args, { cwd, encoding: "utf8" });
  return { ok: r.status === 0, stdout: (r.stdout ?? "").trim(), stderr: (r.stderr ?? "").trim(), exitCode: r.status };
};

test("keepBothSides keeps ours then theirs, drops a diff3 base, leaves clean text alone", () => {
  const text = "# Patterns\n<<<<<<< HEAD\n- KM: decisions are undone in one place\n=======\n- CoP: charts use the shared palette\n>>>>>>> origin/main\nend\n";
  assert.equal(keepBothSides(text), "# Patterns\n- KM: decisions are undone in one place\n- CoP: charts use the shared palette\nend\n");
  const diff3 = "a\n<<<<<<< ours\nx\n||||||| base\no\n=======\ny\n>>>>>>> theirs\n";
  assert.equal(keepBothSides(diff3), "a\nx\ny\n");
  assert.equal(keepBothSides("no conflict\n"), "no conflict\n");
  assert.equal(keepBothSides("<<<<<<< HEAD\nunterminated\n"), "<<<<<<< HEAD\nunterminated\n");
});

test("only Carja documents may be merged by the loop", () => {
  assert.equal(onlyCarjaDocs(["carja/3-product-areas/nexus/nexus-technical.md", "carja/0-compass/ship-log.md"]), true);
  assert.equal(onlyCarjaDocs(["carja/x.md", "repo/app.py"]), false);
  assert.equal(onlyCarjaDocs(["src/app.js"]), false);
  assert.equal(onlyCarjaDocs([]), false);
});

function twoSides({ codeConflict = false } = {}) {
  const base = mkdtempSync(join(tmpdir(), "doc-conflict-"));
  const root = join(base, "r");
  mkdirSync(join(root, "carja/4-context"), { recursive: true });
  G(base, "init", "-q", "-b", "main", "r");
  G(root, "config", "user.email", "t@t");
  G(root, "config", "user.name", "t");
  writeFileSync(join(root, "carja/4-context/coding-patterns.md"), "# Patterns\n- one\n");
  writeFileSync(join(root, "app.py"), "x = 1\n");
  G(root, "add", "-A");
  G(root, "commit", "-qm", "base");
  G(root, "checkout", "-q", "-b", "item");
  writeFileSync(join(root, "carja/4-context/coding-patterns.md"), "# Patterns\n- one\n- KM: decisions are undone in one place\n");
  if (codeConflict) writeFileSync(join(root, "app.py"), "x = 2\n");
  G(root, "commit", "-qam", "item");
  G(root, "checkout", "-q", "main");
  writeFileSync(join(root, "carja/4-context/coding-patterns.md"), "# Patterns\n- one\n- CoP: charts use the shared palette\n");
  if (codeConflict) writeFileSync(join(root, "app.py"), "x = 3\n");
  G(root, "commit", "-qam", "main moved");
  G(root, "checkout", "-q", "item");
  return { base, root };
}

test("a conflict only in a Carja document is merged with both sides kept, and committed", async () => {
  const { base, root } = twoSides();
  try {
    const r = await mergeKeepingDocs({
      git: gitIn(root),
      base: "main",
      read: (rel) => readFile(join(root, rel), "utf8"),
      write: (rel, t) => writeFile(join(root, rel), t),
      message: "chore(carja): take main into item",
    });
    assert.equal(r.merged, true, r.reason);
    assert.deepEqual(r.files, ["carja/4-context/coding-patterns.md"]);
    assert.equal(readFileSync(join(root, "carja/4-context/coding-patterns.md"), "utf8"), "# Patterns\n- one\n- KM: decisions are undone in one place\n- CoP: charts use the shared palette\n");
    assert.equal(G(root, "status", "--porcelain"), "");
    assert.match(G(root, "log", "-1", "--format=%P"), / /, "a merge commit");
    assert.equal(G(root, "merge-base", "--is-ancestor", "main", "item") === "", true);
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});

test("a conflict in code aborts: the branch is left as it was", async () => {
  const { base, root } = twoSides({ codeConflict: true });
  try {
    const head = G(root, "rev-parse", "HEAD");
    const r = await mergeKeepingDocs({
      git: gitIn(root),
      base: "main",
      read: (rel) => readFile(join(root, rel), "utf8"),
      write: (rel, t) => writeFile(join(root, rel), t),
      message: "x",
    });
    assert.equal(r.merged, false);
    assert.match(r.reason, /outside the Carja documents \(app\.py\): code is never merged by the loop/);
    assert.equal(G(root, "rev-parse", "HEAD"), head);
    assert.equal(G(root, "status", "--porcelain"), "");
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});

// The swarm: a passed item whose predicted conflict is only in documents is merged after a green verify.
function swarmState() {
  return {
    status: "idle", phase: "execution", autonomy_level: "L3", sandbox: "cli-native", concurrency: 1,
    iterations: { current: 0, max_allowed: 20 }, budget: { max_beats: 20, max_wall_clock_min: 60 }, verification: { command: "true" },
    tasks: [{ id: "slice:km/08-career", type: "task", status: "pending" }],
  };
}
function deps(over) {
  const inbox = [];
  const verifies = [];
  return {
    inbox,
    verifies,
    d: {
      verifyCommand: "true",
      runBeat: async () => ({ exitCode: 0, stdout: "", stderr: "", signal: { done: true } }),
      runVerify: async ({ task }) => {
        verifies.push(task.id);
        return { exitCode: 0, output: "ok" };
      },
      runChecker: async () => ({ exitCode: 0 }),
      gitHead: async () => String(Math.random()),
      merge: async () => ({ ok: true, prUrl: "https://example.invalid/pr/1" }),
      now: () => Date.now(),
      persist: async () => {},
      writeInbox: async (_s, r) => inbox.push(r),
      ...over,
    },
  };
}

test("the swarm: a document-only conflict is resolved, verified again, and the MR opens", async () => {
  const { d, inbox, verifies } = deps({
    predictConflict: async () => ({ conflicted: true, files: ["carja/4-context/technical/coding-patterns.md"], method: "merge-tree" }),
    resolveDocConflict: async () => ({ merged: true, files: ["carja/4-context/technical/coding-patterns.md"] }),
  });
  const s = await runSwarm(swarmState(), d);
  assert.equal(s.status, "completed", inbox.join("; "));
  assert.equal(s.tasks[0].status, "merged");
  assert.deepEqual(s.tasks[0].docs_merged, ["carja/4-context/technical/coding-patterns.md"]);
  assert.equal(verifies.length, 2, "verify ran again after the merge");
});

test("the swarm: a code conflict still stops the item, and the resolver is not asked", async () => {
  let asked = false;
  const { d, inbox } = deps({
    predictConflict: async () => ({ conflicted: true, files: ["carja/x.md", "repo/app.py"], method: "merge-tree" }),
    resolveDocConflict: async () => {
      asked = true;
      return { merged: true, files: [] };
    },
  });
  const s = await runSwarm(swarmState(), d);
  assert.equal(asked, false);
  assert.equal(s.status, "awaiting_review");
  assert.match(inbox.join("\n"), /would conflict on merge — carja\/x\.md, repo\/app\.py/);
});
