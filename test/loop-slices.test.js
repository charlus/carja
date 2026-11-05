// test/loop-slices.test.js
//
// Unattended Lifecycle step 3 (docs/roadmap/Unattended-Lifecycle.md): the slice
// pipeline. A carved slice runs Spec-It → spec review (D2) → Build → Ship → one
// MR (D3), each stage a fresh beat with its own workflow, the stage read from
// files. One open slice per project at a time, the lowest number (R4).

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { isBlankDoc, harvestSlices, specEvidence } from "../src/loop/slices.js";
import { runSwarm, normalizeTask } from "../src/loop/swarm.js";
import { checkShipEvidence, shipBeatSection } from "../src/loop/ship.js";
import { renderAssignment } from "../src/loop/harvester.js";
import { parseLoopConfig } from "../src/loop/config.js";

const TEMPLATE = readFileSync(new URL("../templates/carja/5-templates/carve-workflow/feature-spec.md", import.meta.url), "utf8");
const FILLED = "# Feature Spec: Export CSV\n\n**Implementation:** 02-export-csv\n**Status:** Specced\n\n## Brief check\n\n- **C1 contradicts an earlier decision:** None found.\n- **C2 breaks existing users:** None found.\n- **C3 cost or duration mismatch:** None found.\n- **C4 missing data, access or rights:** None found.\n\n**Shared understanding:** Managers export their team's evaluations as CSV.\n\n## User stories\n- As a manager I can download a CSV.\n";

test("a carved, untouched spec is blank; a written one is not", () => {
  assert.equal(isBlankDoc(TEMPLATE, TEMPLATE), true);
  assert.equal(isBlankDoc("", TEMPLATE), true);
  assert.equal(isBlankDoc(null, TEMPLATE), true);
  assert.equal(isBlankDoc(FILLED, TEMPLATE), false);
});

test("harvestSlices takes the lowest open slice of each opted-in project, and reads its stage", () => {
  const items = harvestSlices({
    projects: [
      { name: "evals", slices: [
        { name: "02-export-csv", spec: TEMPLATE, plan: TEMPLATE },
        { name: "01-import", spec: FILLED, plan: "# Plan\n- step 1\n" },
      ] },
      { name: "billing", slices: [{ name: "03-invoices", spec: TEMPLATE, plan: TEMPLATE }] },
      { name: "other", slices: [{ name: "01-x", spec: TEMPLATE, plan: TEMPLATE }] },
    ],
    optIn: ["evals", "billing"],
    specTemplate: TEMPLATE,
    planTemplate: TEMPLATE,
  });
  assert.deepEqual(items.map((t) => t.id), ["slice:evals/01-import", "slice:billing/03-invoices"]);
  assert.equal(items[0].type, "slice");
  assert.equal(items[0].spec_ready, true, "a spec on the default branch is the owner's: no spec stage");
  assert.equal(items[1].spec_ready, false);
  assert.equal(items[1].source.kind, "slice");
  assert.equal(items[1].source.path, "carja/2-backlog/project-backlog/billing/implementations/03-invoices");
});

test("loop.slices opts projects in: a list, or true for all", () => {
  assert.deepEqual(parseLoopConfig({}).slices, []);
  assert.deepEqual(parseLoopConfig({ loop: { slices: ["evals"] } }).slices, ["evals"]);
  assert.equal(parseLoopConfig({ loop: { slices: true } }).slices, true);
  assert.ok(parseLoopConfig({ loop: { slices: "evals" } }).errors.length > 0);
});

test("specEvidence: both files written, and the Brief check answered", () => {
  assert.equal(specEvidence({ spec: FILLED, plan: "# Plan\n- a\n", specTemplate: TEMPLATE, planTemplate: TEMPLATE }).ok, true);
  const r = specEvidence({ spec: TEMPLATE, plan: TEMPLATE, specTemplate: TEMPLATE, planTemplate: TEMPLATE });
  assert.equal(r.ok, false);
  assert.ok(r.reasons.some((x) => /feature-spec/.test(x)));
  assert.ok(r.reasons.some((x) => /implementation-plan/.test(x)));
  const noBrief = specEvidence({ spec: FILLED.replace("## Brief check", "## Notes"), plan: "# Plan\n", specTemplate: TEMPLATE, planTemplate: TEMPLATE });
  assert.ok(noBrief.reasons.some((x) => /Brief check/.test(x)));
});

test("the slice assignment routes Build to the slice folder and asks for done only when ship-ready", () => {
  const t = renderAssignment({ id: "slice:evals/02-x", type: "slice", title: "02-x", source: { kind: "slice", path: "carja/2-backlog/project-backlog/evals/implementations/02-x" } });
  assert.match(t, /build\.md/);
  assert.match(t, /implementations\/02-x/);
  assert.match(t, /ship-ready/);
});

test("unattended-loop.md has a Spec beat section that maps Spec-It's confirmations", () => {
  const text = readFileSync(new URL("../templates/.agents/workflows/unattended-loop.md", import.meta.url), "utf8");
  const section = shipBeatSection(text.replace(/^## Ship beat/m, "## Ignored").replace(/^## Spec beat/m, "## Ship beat"));
  assert.match(section, /locked\?/);
  assert.match(section, /one-way/);
});

test("ship evidence for a slice: its folder is archived in the branch", () => {
  const base = { rootShipLog: "", branchShipLog: "## 2026-10-20 — X\n\n**For you**\n- **Impact:** a\n- **Cost:** none\n- **Risk:** none\n- **Decide:** none\n", body: "## What changes for you\n## Decisions I took alone\n## Evidence\n## What I need from you\n" };
  assert.equal(checkShipEvidence({ ...base, slice: { stillInBacklog: false, archived: true } }).ok, true);
  const r = checkShipEvidence({ ...base, slice: { stillInBacklog: true, archived: false } });
  assert.ok(r.reasons.some((x) => /archive/.test(x)));
});

// ---- the pipeline in the swarm -------------------------------------------

function run(task, over = {}) {
  let clock = 0;
  const calls = [];
  const state = {
    goal_description: "", autonomy_level: "L3", sandbox: "container", phase: "execution",
    iterations: { current: 0, max_allowed: 100 }, budget: { max_wall_clock_min: 120, started_at: null },
    concurrency: 1, roles: ["maker", "checker"], tasks: [normalizeTask(task)],
  };
  let builds = 0;
  const deps = {
    verifyCommand: "t",
    runSpec: async () => (calls.push("spec"), { exitCode: 0 }),
    specEvidence: over.specEvidence ?? (async () => ({ ok: true, reasons: [] })),
    runBeat: async () => (calls.push("build"), (builds += 1), { exitCode: 0, signal: { done: builds >= (over.buildsToDone ?? 1) } }),
    runShip: async () => (calls.push("ship"), { exitCode: 0 }),
    shipEvidence: async () => ({ ok: true, reasons: [], body: "b" }),
    runVerify: async () => (calls.push("verify"), { exitCode: 0, output: "green" }),
    runChecker: async ({ phase }) => (calls.push(`checker:${phase ?? "build"}`), { exitCode: 0 }),
    merge: async () => (calls.push("merge"), { ok: true, prUrl: "u" }),
    gitHead: async () => `h${calls.length}`,
    assignWorktree: async ({ task: t }) => ({ path: `/wt/${t.id}`, branch: `b/${t.id}` }),
    now: () => (clock += 1000), persist: async () => {}, audit: async () => {}, writeInbox: async () => {}, log: () => {},
  };
  return runSwarm(state, deps).then((s) => ({ s, calls }));
}

test("a blank slice runs Spec-It, the spec review, Build, Ship, then one MR", async () => {
  const { s, calls } = await run({ id: "slice:p/01-a", type: "slice", spec_ready: false });
  assert.equal(s.tasks[0].status, "merged");
  assert.deepEqual(calls, ["spec", "checker:spec", "build", "verify", "checker:build", "ship", "verify", "checker:ship", "merge"]);
});

test("a slice whose spec the owner already wrote starts at Build", async () => {
  const { calls } = await run({ id: "slice:p/01-a", type: "slice", spec_ready: true });
  assert.equal(calls[0], "build");
  assert.ok(!calls.includes("spec") && !calls.includes("checker:spec"));
});

test("a slice is not passed until the Maker says the whole slice is ship-ready", async () => {
  const { calls } = await run({ id: "slice:p/01-a", type: "slice", spec_ready: true }, { buildsToDone: 3 });
  assert.equal(calls.filter((c) => c === "build").length, 3);
  assert.equal(calls.filter((c) => c === "checker:build").length, 1, "the Checker judges the finished slice, not each partial beat");
});

test("a spec beat that leaves the spec blank is retried with the reason, then fails before any Build", async () => {
  const { s, calls } = await run({ id: "slice:p/01-a", type: "slice", spec_ready: false }, {
    specEvidence: async () => ({ ok: false, reasons: ["feature-spec.md is still the carved template"] }),
  });
  assert.equal(s.tasks[0].status, "failed");
  assert.equal(calls.filter((c) => c === "spec").length, 2);
  assert.ok(!calls.includes("build"));
});

test("F20: the Ship beat runs the tests it adds, never the whole suite; the driver does that", () => {
  const text = readFileSync(new URL("../templates/.agents/workflows/unattended-loop.md", import.meta.url), "utf8");
  const section = shipBeatSection(text);
  assert.match(section, /Do not run the full test suite/);
  assert.match(section, /driver runs the full verification command after your beat/);
});
