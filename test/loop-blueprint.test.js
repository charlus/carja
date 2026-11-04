// test/loop-blueprint.test.js
//
// Unattended Lifecycle step 5 (docs/roadmap/Unattended-Lifecycle.md, D4): the
// Blueprint pipeline. A project whose Discovery is done (the owner's) runs Grand
// PRD → UX/UI Brief → Technical Vision → Carve, each a fresh beat running its own
// workflow, each reviewed by a fresh Checker with that stage's lens. All four go
// into one branch and one MR: merging it is the owner's sign-off, and only then
// do the carved slices exist on the default branch for step 3.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { BLUEPRINT_STAGES, discoveryDone, harvestBlueprints, blueprintStageEvidence, carryOver } from "../src/loop/blueprint.js";
import { runSwarm, normalizeTask } from "../src/loop/swarm.js";
import { parseLoopConfig } from "../src/loop/config.js";
import { shipBeatSection } from "../src/loop/ship.js";

const tpl = (rel) => readFileSync(new URL(`../templates/carja/5-templates/${rel}`, import.meta.url), "utf8");
const TEMPLATES = {
  "genesis/problem-solar-system.md": tpl("genesis-workflow/problem-solar-system-template.md"),
  "genesis/world-transformation.md": tpl("genesis-workflow/world-transformation-template.md"),
  "genesis/functional-animator.md": tpl("genesis-workflow/functional-animator-template.md"),
  "storyboard/main-character.md": tpl("storyboard-workflow/main-character-template.md"),
  "storyboard/storyboard.md": tpl("storyboard-workflow/storyboard-template.md"),
  "blueprint/grand-prd.md": tpl("blueprint-workflows/grand-prd.md"),
  "blueprint/ux-ui-design-brief.md": tpl("blueprint-workflows/ux-ui-design-brief.md"),
  "blueprint/technical-vision.md": tpl("blueprint-workflows/technical-vision.md"),
  "blueprint/implementation-overview.md": tpl("carve-workflow/implementation-overview.md"),
};
const written = (title) => `# ${title}\n\nWriters keep short notes and want them on every device.\n`;
const DISCOVERY = Object.fromEntries(
  ["genesis/problem-solar-system.md", "genesis/world-transformation.md", "genesis/functional-animator.md", "storyboard/main-character.md", "storyboard/storyboard.md"].map((k) => [k, written(k)])
);
const BODY = "## What changes for you\na\n## Decisions I took alone\nb\n## Evidence\nc\n## What I need from you\nd\n";

test("the stages are the four Blueprint workflows, in order, each with its review lens", () => {
  assert.deepEqual(BLUEPRINT_STAGES.map((s) => s.key), ["grand-prd", "ux-ui-brief", "technical-vision", "carve"]);
  assert.deepEqual(BLUEPRINT_STAGES.map((s) => s.workflow), ["grand-prd.md", "ux-ui-design-brief.md", "technical-vision.md", "carve.md"]);
  for (const s of BLUEPRINT_STAGES) assert.ok(s.lens, `${s.key} has a review lens`);
});

test("Discovery is done only when the five genesis and storyboard documents are written", () => {
  assert.equal(discoveryDone({ docs: DISCOVERY, templates: TEMPLATES }), true);
  assert.equal(discoveryDone({ docs: { ...DISCOVERY, "storyboard/storyboard.md": TEMPLATES["storyboard/storyboard.md"] }, templates: TEMPLATES }), false);
  const { ["genesis/functional-animator.md"]: _, ...missing } = DISCOVERY;
  assert.equal(discoveryDone({ docs: missing, templates: TEMPLATES }), false);
});

test("harvestBlueprints: an opted-in project after Discovery and before Carve; the owner's own documents are done", () => {
  const items = harvestBlueprints({
    projects: [
      { name: "notes", docs: { ...DISCOVERY, "blueprint/grand-prd.md": written("PRD") }, carved: false },
      { name: "early", docs: {}, carved: false },
      { name: "carved", docs: DISCOVERY, carved: true },
      { name: "other", docs: DISCOVERY, carved: false },
    ],
    optIn: ["notes", "early", "carved"],
    templates: TEMPLATES,
  });
  assert.deepEqual(items.map((t) => t.id), ["blueprint:notes"]);
  assert.equal(items[0].type, "blueprint");
  assert.equal(items[0].source.path, "carja/2-backlog/project-backlog/notes");
  assert.deepEqual(items[0].stages_done, ["grand-prd"], "a PRD on the default branch is the owner's: no PRD stage");
});

test("loop.blueprint opts projects in: a list, or true for all", () => {
  assert.deepEqual(parseLoopConfig({}).blueprint, []);
  assert.deepEqual(parseLoopConfig({ loop: { blueprint: ["notes"] } }).blueprint, ["notes"]);
  assert.equal(parseLoopConfig({ loop: { blueprint: true } }).blueprint, true);
  assert.ok(parseLoopConfig({ loop: { blueprint: "notes" } }).errors.length > 0);
});

test("stage evidence: each stage's document written; the Brief also DESIGN.md; Carve its slices and the MR body", () => {
  const base = { templates: TEMPLATES, hasDesignMd: false, sliceCount: 0, docs: {}, prBody: "" };
  assert.match(blueprintStageEvidence("grand-prd", base).reasons.join(), /grand-prd\.md/);
  assert.equal(blueprintStageEvidence("grand-prd", { ...base, docs: { "blueprint/grand-prd.md": written("PRD") } }).ok, true);
  const brief = blueprintStageEvidence("ux-ui-brief", { ...base, docs: { "blueprint/ux-ui-design-brief.md": written("Brief") } });
  assert.ok(brief.reasons.some((r) => /DESIGN\.md/.test(r)));
  assert.equal(blueprintStageEvidence("technical-vision", { ...base, docs: { "blueprint/technical-vision.md": written("TV") } }).ok, true);
  const carve = blueprintStageEvidence("carve", { ...base, docs: { "blueprint/implementation-overview.md": written("Overview") } });
  assert.ok(carve.reasons.some((r) => /implementations/.test(r)));
  assert.ok(carve.reasons.some((r) => /pr-body/.test(r)));
  assert.equal(blueprintStageEvidence("carve", { ...base, sliceCount: 2, prBody: BODY, docs: { "blueprint/implementation-overview.md": written("Overview") } }).ok, true);
});

test("carryOver keeps what a stage earned in the last run for the same item", () => {
  const prev = [{ id: "blueprint:notes", stages_reviewed: ["grand-prd"], answered_round: "q.md" }, { id: "slice:a/01", spec_reviewed: true }];
  const now = carryOver(prev, [{ id: "blueprint:notes" }, { id: "slice:a/01" }, { id: "task:new" }]);
  assert.deepEqual(now[0].stages_reviewed, ["grand-prd"]);
  assert.equal(now[0].answered_round, "q.md");
  assert.equal(now[1].spec_reviewed, true);
  assert.equal(now[2].spec_reviewed, undefined);
});

test("unattended-loop.md has a Blueprint beat section that maps the conversation steps", () => {
  const text = readFileSync(new URL("../templates/.agents/workflows/unattended-loop.md", import.meta.url), "utf8");
  const section = shipBeatSection(text.replace(/^## Ship beat/m, "## Ignored").replace(/^## Blueprint beat/m, "## Ship beat"));
  assert.match(section, /independent review/i);
  assert.match(section, /one-way/);
  assert.match(section, /pr-body\.md/);
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
  const done = new Set();
  const deps = {
    verifyCommand: "t",
    runStage: async ({ stage }) => (calls.push(stage), done.add(stage), { exitCode: 0, signal: { done: true } }),
    stageEvidence: over.stageEvidence ?? (async ({ stage }) => (done.has(stage) ? { ok: true, reasons: [], body: stage === "carve" ? BODY : undefined } : { ok: false, reasons: [`${stage} not written`] })),
    runBeat: async () => (calls.push("build"), { exitCode: 0, signal: { done: true } }),
    runShip: async () => (calls.push("ship"), { exitCode: 0 }),
    shipEvidence: async () => ({ ok: true, reasons: [], body: "b" }),
    runVerify: async () => (calls.push("verify"), { exitCode: 0, output: "green" }),
    runChecker: over.runChecker ?? (async ({ phase }) => (calls.push(`checker:${phase ?? "build"}`), { exitCode: 0 })),
    merge: async ({ task: t }) => (calls.push(`merge:${t.ship?.body ? "body" : "none"}`), { ok: true, prUrl: "u" }),
    gitHead: async () => `h${calls.length}`,
    assignWorktree: async ({ task: t }) => ({ path: `/wt/${t.id}`, branch: `b/${t.id}` }),
    now: () => (clock += 1000), persist: async () => {}, audit: async () => {}, writeInbox: async () => {}, log: () => {},
  };
  return runSwarm(state, deps).then((s) => ({ s, calls }));
}

test("a Blueprint runs its four stages, each reviewed with its lens, then one MR with Carve's body; no Build, no Ship beat", async () => {
  const { s, calls } = await run({ id: "blueprint:notes", type: "blueprint" });
  assert.equal(s.tasks[0].status, "merged");
  assert.deepEqual(calls, [
    "grand-prd", "checker:blueprint:grand-prd",
    "ux-ui-brief", "checker:blueprint:ux-ui-brief",
    "technical-vision", "checker:blueprint:technical-vision",
    "carve", "checker:blueprint:carve",
    "verify", "merge:body",
  ]);
});

test("a stage the owner already wrote is skipped, and one reviewed in an earlier run is not redone", async () => {
  const { calls } = await run({ id: "blueprint:notes", type: "blueprint", stages_done: ["grand-prd"], stages_reviewed: ["ux-ui-brief"] }, {
    stageEvidence: async ({ stage }) => ({ ok: true, reasons: [], body: stage === "carve" ? BODY : undefined }),
  });
  assert.ok(!calls.includes("grand-prd") && !calls.includes("ux-ui-brief"));
  assert.equal(calls[0], "technical-vision");
});

test("a stage its review rejects twice fails the Blueprint before the next stage starts", async () => {
  const { s, calls } = await run({ id: "blueprint:notes", type: "blueprint" }, {
    runChecker: async ({ phase }) => (phase === "blueprint:ux-ui-brief" ? { exitCode: 1, reasons: ["Scene 3 has no screen"] } : { exitCode: 0 }),
  });
  assert.equal(s.tasks[0].status, "failed");
  assert.equal(calls.filter((c) => c === "ux-ui-brief").length, 2);
  assert.ok(!calls.includes("technical-vision"));
  assert.ok(!calls.some((c) => c.startsWith("merge")));
});
