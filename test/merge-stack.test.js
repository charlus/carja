// test/merge-stack.test.js
//
// `carja merge-stack` (owner, 2026-11-17): "If I could I'll just delegate the
// post carja loop to an agent." The walk over a stacked run's MRs, bottom
// first, with a fake forge: what it merges, in which order, and where it stops.
// The CLI with the stub `gh` is in test/merge-stack-cli.test.js.

import { test } from "node:test";
import assert from "node:assert/strict";

import { walkStack, ghForge, glabForge, ownerNeeds } from "../src/loop/merge-stack.js";

/** A forge in memory. `mrs[url]` = {state, target, source, head, pipeline, conflict}. */
function fakeForge(mrs, calls, { onRetarget = null, pipelineAfter = null } = {}) {
  return {
    status: async (url) => {
      const m = mrs[url];
      if (!m) return null;
      if (pipelineAfter && m.pipeline === "running" && pipelineAfter.n-- <= 0) m.pipeline = pipelineAfter.to;
      return { ...m };
    },
    merge: async (url, { head }) => {
      calls.push(["merge", url, head]);
      const m = mrs[url];
      if (m.head !== head) return { ok: false, reason: "head changed" };
      m.state = "merged";
      for (const o of Object.values(mrs)) if (o.target === m.source) o.target = null; // the forge does not retarget by itself here
      return { ok: true };
    },
    retarget: async (url, base) => {
      calls.push(["retarget", url, base]);
      mrs[url].target = base;
      onRetarget?.(url);
      return { ok: true };
    },
  };
}

const entry = (n, { code = true, ...rest } = {}) => ({
  id: `slice:p/0${n}`,
  title: `slice 0${n}`,
  outer: { branch: `carja/loop/0${n}`, head: `o${n}`, url: `https://f/outer/${n}` },
  code: code ? { branch: `carja/loop/0${n}`, head: `c${n}`, url: `https://f/code/${n}` } : null,
  ...rest,
});

function stackMrs(entries) {
  const mrs = {};
  entries.forEach((e, i) => {
    const below = entries[i - 1];
    mrs[e.outer.url] = { state: "open", target: below ? below.outer.branch : "master", source: e.outer.branch, head: e.outer.head, pipeline: "success", conflict: false };
    if (e.code) mrs[e.code.url] = { state: "open", target: below?.code ? below.code.branch : "main", source: e.code.branch, head: e.code.head, pipeline: "success", conflict: false };
  });
  return mrs;
}

function setup(entries, opts = {}) {
  const calls = [];
  const mrs = stackMrs(entries);
  const forge = fakeForge(mrs, calls, opts);
  return { calls, mrs, io: { forges: { outer: forge, code: forge }, defaults: { outer: "master", code: "main" }, sleep: async () => {}, waitMs: 1000, pollMs: 100 } };
}

test("merges every item bottom first, code MR before state MR, each on the default branch", async () => {
  const entries = [entry(1), entry(2), entry(3)];
  const { calls, mrs, io } = setup(entries);
  const r = await walkStack({ project: "p", entries, ...io });
  assert.equal(r.code, 0, r.lines.join("\n"));
  assert.deepEqual(
    calls.filter((c) => c[0] === "merge").map((c) => c[1]),
    ["https://f/code/1", "https://f/outer/1", "https://f/code/2", "https://f/outer/2", "https://f/code/3", "https://f/outer/3"]
  );
  // Each MR above the bottom is moved to the default branch before its merge.
  assert.deepEqual(calls.filter((c) => c[0] === "retarget").map((c) => c[2]), ["main", "master", "main", "master"]);
  assert.ok(Object.values(mrs).every((m) => m.state === "merged"));
  assert.match(r.next, /Next: deploy and test the product/);
});

test("merges only the head it checked: the sha guard is passed to the forge", async () => {
  const entries = [entry(1)];
  const { calls, io } = setup(entries);
  await walkStack({ project: "p", entries, ...io });
  assert.deepEqual(calls.find((c) => c[1] === "https://f/code/1"), ["merge", "https://f/code/1", "c1"]);
});

test("stops before an item that has owner actions, and --confirm merges it, then stops after it", async () => {
  const entries = [entry(1), entry(2, { ownerActions: ["Back up the database, then run `alembic upgrade head`."] }), entry(3)];
  const { calls, mrs, io } = setup(entries);
  const r = await walkStack({ project: "p", entries, ...io });
  assert.equal(r.code, 2);
  assert.equal(mrs["https://f/outer/1"].state, "merged");
  assert.equal(mrs["https://f/code/2"].state, "open", "nothing of item 2 is merged before the owner confirms");
  assert.match(r.lines.join("\n"), /2\. slice 02: needs you before the merge:\n {3}- Back up the database/);
  assert.match(r.next, /carja merge-stack p --confirm 2/);

  calls.length = 0;
  const r2 = await walkStack({ project: "p", entries, confirm: 2, ...io });
  assert.equal(r2.code, 2, "stops after the item, for its after-merge steps");
  assert.equal(mrs["https://f/outer/2"].state, "merged");
  assert.equal(mrs["https://f/code/3"].state, "open", "nothing above it is merged before its after-merge steps");
  assert.match(r2.next, /after its merge.*then run `carja merge-stack p`/);
});

test("documents merged from both sides and a high-risk decision also need the owner", () => {
  const needs = ownerNeeds(entry(1, { docsMerged: ["carja/x.md"], rulings: [{ decision: "Drop table y", risk: "high" }, { decision: "Name z", risk: "low" }] }));
  assert.equal(needs.length, 2);
  assert.match(needs[0], /carja\/x\.md/);
  assert.match(needs[1], /Drop table y/);
});

test("a red pipeline stops the walk, and nothing above it is merged", async () => {
  const entries = [entry(1), entry(2), entry(3)];
  const { mrs, io } = setup(entries);
  mrs["https://f/code/2"].pipeline = "failed";
  const r = await walkStack({ project: "p", entries, ...io });
  assert.equal(r.code, 1);
  assert.equal(mrs["https://f/outer/1"].state, "merged");
  assert.equal(mrs["https://f/code/2"].state, "open");
  assert.equal(mrs["https://f/code/3"].state, "open");
  assert.match(r.lines.join("\n"), /slice 02: stopped\. The pipeline of https:\/\/f\/code\/2 failed/);
});

test("a conflict stops the walk", async () => {
  const entries = [entry(1)];
  const { mrs, io } = setup(entries);
  mrs["https://f/outer/1"].conflict = true;
  const r = await walkStack({ project: "p", entries, ...io });
  assert.equal(r.code, 1);
  assert.match(r.lines.join("\n"), /conflict/);
});

test("a running pipeline is waited for; one still running at the deadline stops the walk", async () => {
  const entries = [entry(1)];
  const ok = setup(entries, { pipelineAfter: { n: 2, to: "success" } });
  ok.mrs["https://f/code/1"].pipeline = "running";
  assert.equal((await walkStack({ project: "p", entries, ...ok.io })).code, 0);

  const late = setup(entries);
  late.mrs["https://f/code/1"].pipeline = "running";
  const r = await walkStack({ project: "p", entries, ...late.io });
  assert.equal(r.code, 1);
  assert.match(r.lines.join("\n"), /still running/);
  assert.equal(late.mrs["https://f/code/1"].state, "open");
});

test("an item already merged is passed; a closed one stops the walk", async () => {
  const entries = [entry(1), entry(2), entry(3)];
  const { mrs, io } = setup(entries);
  mrs["https://f/outer/1"].state = "merged";
  mrs["https://f/code/1"].state = "merged";
  mrs["https://f/outer/2"].state = "closed";
  const r = await walkStack({ project: "p", entries, ...io });
  assert.equal(r.code, 1);
  assert.match(r.lines.join("\n"), /1\. slice 01: already merged\.\n2\. slice 02: closed without a merge/);
  assert.equal(mrs["https://f/code/2"].state, "open", "an item is never half merged when one of its MRs is closed");
  assert.match(r.next, /carja loop p/);
});

test("--dry-run merges and retargets nothing, and lists every item", async () => {
  const entries = [entry(1), entry(2, { ownerActions: ["Set FOO."] }), entry(3)];
  const { calls, io } = setup(entries);
  const r = await walkStack({ project: "p", entries, dryRun: true, ...io });
  assert.deepEqual(calls, []);
  const out = r.lines.join("\n");
  assert.match(out, /1\. slice 01: ready/);
  assert.match(out, /2\. slice 02: needs you before the merge:/);
  assert.match(out, /3\. slice 03: ready/);
  assert.equal(r.code, 2);
});

test("an item with no code MR (the Carve) merges its state MR only", async () => {
  const entries = [entry(1, { code: false }), entry(2)];
  const { calls, io } = setup(entries);
  const r = await walkStack({ project: "p", entries, ...io });
  assert.equal(r.code, 0, r.lines.join("\n"));
  assert.deepEqual(calls.filter((c) => c[0] === "merge").map((c) => c[1]), ["https://f/outer/1", "https://f/code/2", "https://f/outer/2"]);
});

test("gh: no squash, the checked head only, the source branch deleted", async () => {
  const seen = [];
  const run = async (cmd, argv) => {
    seen.push([cmd, ...argv]);
    return { ok: true, stdout: "" };
  };
  const f = ghForge(run);
  await f.merge("https://github.com/o/r/pull/7", { head: "abc", source: "carja/loop/x" });
  assert.deepEqual(seen[0], ["gh", "pr", "merge", "https://github.com/o/r/pull/7", "--merge", "--match-head-commit", "abc"]);
  assert.deepEqual(seen[1], ["gh", "api", "-X", "DELETE", "repos/{owner}/{repo}/git/refs/heads/carja/loop/x"]);
  await f.retarget("https://github.com/o/r/pull/7", "main");
  assert.deepEqual(seen[2], ["gh", "pr", "edit", "https://github.com/o/r/pull/7", "--base", "main"]);
});

test("gh: the status reads state, target, head, conflict and checks", async () => {
  const run = async () => ({
    ok: true,
    stdout: JSON.stringify({
      state: "OPEN",
      baseRefName: "main",
      headRefName: "carja/loop/x",
      headRefOid: "abc",
      mergeable: "CONFLICTING",
      statusCheckRollup: [{ status: "COMPLETED", conclusion: "SUCCESS" }, { status: "IN_PROGRESS", conclusion: "" }],
    }),
  });
  assert.deepEqual(await ghForge(run).status("u"), { state: "open", target: "main", source: "carja/loop/x", head: "abc", pipeline: "running", conflict: true, checking: false });
});

test("glab: no squash, the checked head only, the source branch removed, on the MR's own project", async () => {
  const seen = [];
  const run = async (cmd, argv) => {
    seen.push([cmd, ...argv]);
    return { ok: true, stdout: JSON.stringify({ state: "merged" }) };
  };
  const f = glabForge(run);
  const url = "https://code.example.eu/innovation/website-cms/-/merge_requests/85";
  await f.merge(url, { head: "abc", source: "carja/loop/x" });
  assert.deepEqual(seen[0], [
    "glab", "api", "--hostname", "code.example.eu", "-X", "PUT",
    "projects/innovation%2Fwebsite-cms/merge_requests/85/merge",
    "-F", "squash=false", "-F", "should_remove_source_branch=true", "-f", "sha=abc",
  ]);
  await f.retarget(url, "main");
  assert.deepEqual(seen[1], ["glab", "api", "--hostname", "code.example.eu", "-X", "PUT", "projects/innovation%2Fwebsite-cms/merge_requests/85", "-f", "target_branch=main"]);
});

test("glab: the status maps GitLab's states", async () => {
  const mk = (o) => async () => ({ ok: true, stdout: JSON.stringify({ state: "opened", target_branch: "main", source_branch: "b", sha: "s", has_conflicts: false, detailed_merge_status: "mergeable", ...o }) });
  const url = "https://h/g/p/-/merge_requests/1";
  assert.equal((await glabForge(mk({ head_pipeline: { status: "success" } })).status(url)).pipeline, "success");
  assert.equal((await glabForge(mk({ head_pipeline: { status: "canceled" } })).status(url)).pipeline, "failed");
  assert.equal((await glabForge(mk({ head_pipeline: { status: "pending" } })).status(url)).pipeline, "running");
  assert.equal((await glabForge(mk({ head_pipeline: { status: "manual" } })).status(url)).pipeline, "manual");
  assert.equal((await glabForge(mk({ head_pipeline: null })).status(url)).pipeline, "none");
  assert.equal((await glabForge(mk({ detailed_merge_status: "checking" })).status(url)).checking, true);
  assert.equal((await glabForge(mk({ state: "merged" })).status(url)).state, "merged");
});
