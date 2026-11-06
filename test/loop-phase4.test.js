// test/loop-phase4.test.js
//
// Phase 4 (buildable parts): autonomy-slider enforcement (L0–L3), the L1 single-
// beat cap, level-aware completion, and the PR-gated merge module. The swarm
// scheduler is deferred behind an evidence gate and is NOT tested here (it does
// not exist yet); concurrency>1 is asserted to be refused.

import { test } from "node:test";
import assert from "node:assert/strict";
import { runLoop, normalizeState, autonomyPreflight, describeHalt } from "../src/loop/driver.js";
import { planMergeAction, prCommand, prLookupCommand, openPullRequest } from "../src/loop/merge.js";

function harness(overrides = {}) {
  const state = normalizeState({
    phase: "execution",
    status: "idle",
    goal_description: "goal",
    autonomy_level: "L3",
    sandbox: "container",
    iterations: { current: 0, max_allowed: overrides.max_allowed ?? 20 },
    ...overrides.state,
  });
  let head = 0;
  let clock = 0;
  let mergeCalls = 0;
  const deps = {
    verifyCommand: overrides.verifyCommand === undefined ? "run-tests" : overrides.verifyCommand,
    runBeat: overrides.runBeat ?? (async ({ state }) => {
      state.maker_reported_done = true;
      return { exitCode: 0 };
    }),
    runVerify: overrides.runVerify ?? (async () => ({ exitCode: 0, output: "green" })),
    runChecker: overrides.runChecker,
    merge: overrides.merge ?? (async () => {
      mergeCalls++;
      return { ok: true, branch: "carja/loop/goal", prUrl: "http://pr/1" };
    }),
    gitHead: async () => `sha-${head++}`,
    now: () => (clock += 1000),
    persist: async () => {},
    writeInbox: async () => {},
    audit: async () => {},
    log: () => {},
  };
  return { state, deps, mergeCalls: () => mergeCalls };
}

// ---- autonomyPreflight (pure) ---------------------------------------------

test("autonomyPreflight: L0 is interactive-only → refused", () => {
  assert.equal(autonomyPreflight(normalizeState({ autonomy_level: "L0", phase: "execution" })), "halted_autonomy");
});

test("autonomyPreflight: concurrency>1 (swarm) refused at every level", () => {
  for (const lvl of ["L1", "L2", "L3"]) {
    const s = normalizeState({ autonomy_level: lvl, phase: "execution", concurrency: 2, sandbox: "container" });
    assert.equal(autonomyPreflight(s), "halted_autonomy", `${lvl} concurrency 2`);
  }
});

test("autonomyPreflight: L2 execution refused (blueprint-only); L2 blueprint allowed", () => {
  assert.equal(autonomyPreflight(normalizeState({ autonomy_level: "L2", phase: "execution" })), "halted_autonomy");
  assert.equal(autonomyPreflight(normalizeState({ autonomy_level: "L2", phase: "blueprint" })), null);
});

test("autonomyPreflight: L1 and L3 permitted", () => {
  assert.equal(autonomyPreflight(normalizeState({ autonomy_level: "L1", phase: "execution" })), null);
  assert.equal(autonomyPreflight(normalizeState({ autonomy_level: "L3", phase: "execution", sandbox: "container" })), null);
});

test("describeHalt gives a specific reason per autonomy failure", () => {
  assert.match(describeHalt(normalizeState({ autonomy_level: "L0" }), "halted_autonomy"), /interactive-only/);
  assert.match(describeHalt(normalizeState({ autonomy_level: "L3", concurrency: 2 }), "halted_autonomy"), /swarm/);
  assert.match(describeHalt(normalizeState({ autonomy_level: "L2", phase: "execution" }), "halted_autonomy"), /blueprint-only/);
});

// ---- runLoop autonomy gates -----------------------------------------------

test("L0 halts before any beat", async () => {
  let beats = 0;
  const { state, deps } = harness({ state: { autonomy_level: "L0" }, runBeat: async () => (beats++, { exitCode: 0 }) });
  const final = await runLoop(state, deps);
  assert.equal(final.status, "halted_autonomy");
  assert.equal(beats, 0);
});

test("concurrency>1 halts before any beat (swarm not implemented)", async () => {
  const { state, deps } = harness({ state: { concurrency: 3 } });
  const final = await runLoop(state, deps);
  assert.equal(final.status, "halted_autonomy");
});

// ---- L1 single-beat --------------------------------------------------------

test("L1 runs exactly one beat, hands off to review, and never merges", async () => {
  const h = harness({ state: { autonomy_level: "L1" } });
  const final = await runLoop(h.state, h.deps);
  assert.equal(final.status, "awaiting_review");
  assert.equal(final.iterations.current, 1); // exactly one Maker beat
  assert.equal(h.mergeCalls(), 0); // human merges, not the loop
});

test("L1 stops after one beat even when the check fails", async () => {
  const h = harness({ state: { autonomy_level: "L1" }, runVerify: async () => ({ exitCode: 1, output: "red" }) });
  const final = await runLoop(h.state, h.deps);
  assert.equal(final.status, "awaiting_review");
  assert.equal(final.iterations.current, 1);
});

// ---- L2 blueprint completion ----------------------------------------------

test("L2 blueprint completion awaits review without merging code", async () => {
  const h = harness({ state: { autonomy_level: "L2", phase: "blueprint" } });
  const final = await runLoop(h.state, h.deps);
  assert.equal(final.status, "awaiting_review");
  assert.equal(h.mergeCalls(), 0);
});

// ---- L3 execution completion → PR-gated merge -----------------------------

test("L3 execution completion opens a PR and completes", async () => {
  const h = harness(); // default L3 execution, green, done
  const final = await runLoop(h.state, h.deps);
  assert.equal(final.status, "completed");
  assert.equal(h.mergeCalls(), 1);
  assert.equal(final.merge.pr_url, "http://pr/1");
});

test("L3 completion with a failing merge escalates to awaiting_review", async () => {
  const h = harness({ merge: async () => ({ ok: false, reason: "no gh/glab" }) });
  const final = await runLoop(h.state, h.deps);
  assert.equal(final.status, "awaiting_review");
});

// ---- merge module (pure + injected IO) ------------------------------------

test("planMergeAction: PR only at L3 execution", () => {
  assert.equal(planMergeAction({ autonomyLevel: "L3", phase: "execution" }), "pr");
  assert.equal(planMergeAction({ autonomyLevel: "L3", phase: "blueprint" }), "none");
  assert.equal(planMergeAction({ autonomyLevel: "L1", phase: "execution" }), "none");
  assert.equal(planMergeAction({ autonomyLevel: "L2", phase: "blueprint" }), "none");
});

test("prCommand shapes gh/glab argv", () => {
  const [gh, ghArgs] = prCommand("gh", { branch: "b", title: "t" });
  assert.equal(gh, "gh");
  assert.ok(ghArgs.includes("pr") && ghArgs.includes("--head") && ghArgs.includes("b"));
  const [ghl, ghlArgs] = prLookupCommand("gh", { branch: "b" });
  assert.equal(ghl, "gh");
  assert.deepEqual(ghlArgs.slice(0, 4), ["pr", "list", "--head", "b"]);
  const [glab, glabArgs] = prCommand("glab", { branch: "b", title: "t" });
  assert.equal(glab, "glab");
  assert.ok(glabArgs.includes("mr") && glabArgs.includes("--source-branch"));
});

test("openPullRequest: no forge → clean failure, no push attempted", async () => {
  let pushed = false;
  const res = await openPullRequest({
    branch: "b",
    title: "t",
    git: async () => ((pushed = true), { ok: true, stdout: "" }),
    run: async () => ({ ok: true, stdout: "" }),
    forge: null,
  });
  assert.equal(res.ok, false);
  assert.match(res.reason, /no forge resolved/);
  assert.equal(pushed, false);
});

test("openPullRequest: push + gh returns the PR url", async () => {
  const res = await openPullRequest({
    branch: "carja/loop/x",
    title: "t",
    git: async (args) => ({ ok: args[0] === "push", stdout: "" }),
    run: async () => ({ ok: true, stdout: "https://github.com/o/r/pull/7\n" }),
    forge: "gh",
  });
  assert.equal(res.ok, true);
  assert.equal(res.prUrl, "https://github.com/o/r/pull/7");
});

test("openPullRequest: failed push aborts before opening a PR", async () => {
  let prOpened = false;
  const res = await openPullRequest({
    branch: "b",
    title: "t",
    git: async () => ({ ok: false, stdout: "" }),
    run: async () => ((prOpened = true), { ok: true, stdout: "" }),
    forge: "gh",
  });
  assert.equal(res.ok, false);
  assert.match(res.reason, /git push failed/);
  assert.equal(prOpened, false);
});

// Regression (live-run finding): a stale same-named loop branch from a prior run
// (divergent history) rejects a plain push; the loop owns carja/loop/* so it
// falls back to --force-with-lease, then opens the PR.
test("openPullRequest: plain push rejected → force-with-lease fallback, then PR", async () => {
  const pushes = [];
  const res = await openPullRequest({
    branch: "carja/loop/x",
    title: "t",
    git: async (args) => {
      if (args[0] === "push") {
        pushes.push(args);
        return { ok: args.includes("--force-with-lease") }; // plain fails, forced ok
      }
      return { ok: true, stdout: "" }; // fetch
    },
    run: async () => ({ ok: true, stdout: "https://github.com/o/r/pull/12\n" }),
    forge: "gh",
  });
  assert.equal(res.ok, true);
  assert.equal(res.prUrl, "https://github.com/o/r/pull/12");
  assert.equal(pushes.length, 2); // plain, then force-with-lease
  assert.ok(pushes[1].includes("--force-with-lease"));
});

// Regression (live-run finding): `gh pr create` exits non-zero when a PR already
// exists for the branch (contention / a retried beat). That must NOT be read as a
// merge failure — probe for an existing PR and reuse it.
test("openPullRequest: create fails but a PR already exists → reuse it (no false-negative)", async () => {
  const res = await openPullRequest({
    branch: "carja/loop/x",
    title: "t",
    git: async (args) => ({ ok: args[0] === "push", stdout: "" }),
    run: async (_cmd, argv) => {
      if (argv[0] === "pr" && argv[1] === "create") return { ok: false, stdout: "a pull request already exists" };
      if (argv[0] === "pr" && argv[1] === "list") return { ok: true, stdout: "https://github.com/o/r/pull/9\n" };
      return { ok: false, stdout: "" };
    },
    forge: "gh",
  });
  assert.equal(res.ok, true);
  assert.equal(res.prUrl, "https://github.com/o/r/pull/9");
  assert.equal(res.reused, true);
});

test("openPullRequest: create fails and no PR exists → genuine failure", async () => {
  const res = await openPullRequest({
    branch: "carja/loop/x",
    title: "t",
    git: async (args) => ({ ok: args[0] === "push", stdout: "" }),
    run: async (_cmd, argv) => {
      if (argv[1] === "create") return { ok: false, stdout: "some real error" };
      if (argv[1] === "list") return { ok: true, stdout: "\n" }; // no url → none open
      return { ok: false, stdout: "" };
    },
    forge: "gh",
  });
  assert.equal(res.ok, false);
  assert.match(res.reason, /failed to open the PR/);
});

// Field report F4: the forge is chosen from the origin host, not from which CLI
// happens to be installed. openPullRequest takes the resolved forge.
test("F4: openPullRequest with forge glab pushes then opens the MR with glab", async () => {
  const calls = [];
  const res = await openPullRequest({
    branch: "carja/loop/x",
    title: "t",
    git: async (args) => (calls.push(["git", ...args]), { ok: true, stdout: "" }),
    run: async (cmd, argv) => (calls.push([cmd, ...argv]), { ok: true, stdout: "https://code.example/g/p/-/merge_requests/7" }),
    forge: "glab",
  });
  assert.equal(res.ok, true);
  assert.equal(res.prUrl, "https://code.example/g/p/-/merge_requests/7");
  // 7.2.0: the Checker's approval is recorded (git rev-parse) before the push.
  const push = calls.findIndex((c) => c[0] === "git" && c[1] === "push");
  const mr = calls.findIndex((c) => c[0] === "glab");
  assert.ok(push >= 0, "pushed");
  assert.equal(mr, push + 1, "the MR opens right after the push");
  assert.deepEqual(calls[mr].slice(0, 3), ["glab", "mr", "create"]);
});
