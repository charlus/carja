// test/model-roles.test.js
//
// Model roles (docs/roadmap/Model-Roles.md, D1–D5). Carja names roles, the
// project names models: one `models` block in carja.config.json, read by the
// interactive workflows and by the loop. Carja ships no model ranking and no
// price: the built-in presets use the engine's aliases, a project ranks its own
// models, and a role left unset runs on the engine's default model.

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { parseModels, ROLES } from "../src/models.js";
import { parseLoopConfig, effectiveModels, effectiveEfforts, withRoleModels } from "../src/loop/config.js";
import { buildArgv } from "../src/loop/adapters/claude.js";
import * as codex from "../src/loop/adapters/codex.js";
import * as agy from "../src/loop/adapters/antigravity.js";
import { diagnose } from "../src/loop/doctor.js";

const FRONTIER = {
  models: {
    plan: { model: "claude-fable-5-2", effort: "high" },
    build: { model: "claude-opus-5-5", effort: "xhigh" },
    review: "claude-fable-5-2",
    bookkeeping: "claude-sonnet-5-5",
    rank: ["claude-fable-5-2", "claude-opus-5-5", "claude-sonnet-5-5"],
  },
};

test("D1: the roles, each a model id or { model, effort }", () => {
  assert.deepEqual(ROLES, ["plan", "build", "review", "bookkeeping", "escalate"]);
  const m = parseModels(FRONTIER);
  assert.deepEqual(m.errors, []);
  assert.deepEqual(m.roles.plan, { model: "claude-fable-5-2", effort: "high", source: "models.plan" });
  assert.deepEqual(m.roles.review, { model: "claude-fable-5-2", effort: null, source: "models.review" });
  assert.equal(m.roles.escalate, undefined, "unset: the engine's default");
  assert.deepEqual(m.rank, ["claude-fable-5-2", "claude-opus-5-5", "claude-sonnet-5-5"]);
});

test("D1: nothing set, nothing forced", () => {
  const m = parseModels({});
  assert.deepEqual(m.roles, {});
  assert.deepEqual(m.errors, []);
});

test("D1: invalid values are reported, never dropped", () => {
  for (const models of [
    { planner: "x" },
    { plan: "--flag" },
    { plan: "a b" },
    { plan: { effort: "high" } },
    { plan: { model: "x", effort: "very high" } },
    { plan: { model: "x", effort: "--max" } },
    { rank: "x" },
    { preset: "nope" },
    { presets: { mine: { plan: "--x" } } },
    "opus",
  ]) {
    assert.ok(parseModels({ models }).errors.length > 0, JSON.stringify(models));
  }
});

test("D2: presets: built-in ones use aliases, a project saves its own", () => {
  const q = parseModels({ models: { preset: "balanced" } });
  assert.equal(q.roles.build.model, "sonnet");
  assert.equal(q.roles.review.model, "opus");
  assert.equal(q.roles.build.source, "preset balanced");
  const own = parseModels({ models: { preset: "frontier", presets: { frontier: FRONTIER.models } } });
  assert.deepEqual(own.errors, []);
  assert.equal(own.roles.plan.model, "claude-fable-5-2");
  assert.equal(own.roles.build.effort, "xhigh");
  assert.deepEqual(own.rank, FRONTIER.models.rank, "a preset carries its rank");
  const over = parseModels({ models: { preset: "balanced", build: "claude-opus-5-5" } });
  assert.equal(over.roles.build.model, "claude-opus-5-5", "a role set directly wins over the preset");
});

test("the 7.x settings still work: loop.profile and loop.models", () => {
  const legacy = effectiveModels(parseLoopConfig({ loop: { profile: "balanced", models: { ship: "opus" } } }));
  assert.deepEqual(legacy, { maker: "sonnet", maker_escalation: "opus", checker: "opus", spec: "opus", blueprint: "opus", ship: "opus" });
  const both = effectiveModels(parseLoopConfig({ loop: { models: { maker: "sonnet" } }, models: { build: "claude-opus-5-5" } }));
  assert.equal(both.maker, "claude-opus-5-5", "the new block wins over loop.models");
});

test("the loop's roles come from the models block, with their effort", () => {
  const cfg = parseLoopConfig(FRONTIER);
  assert.deepEqual(cfg.errors, []);
  assert.deepEqual(effectiveModels(cfg), {
    maker: "claude-opus-5-5",
    checker: "claude-fable-5-2",
    spec: "claude-fable-5-2",
    blueprint: "claude-fable-5-2",
    ship: "claude-sonnet-5-5",
  });
  assert.deepEqual(effectiveEfforts(cfg), { maker: "xhigh", spec: "high", blueprint: "high" });
});

test("each beat kind gets its role's model and effort", async () => {
  const seen = [];
  const adapter = { name: "x", runBeat: async (o) => (seen.push([o.model ?? "-", o.effort ?? "-"]), {}), runChecker: async (o) => (seen.push(["checker", o.model, o.effort ?? "-"]), {}) };
  const cfg = parseLoopConfig(FRONTIER);
  const a = withRoleModels(adapter, effectiveModels(cfg), effectiveEfforts(cfg));
  await a.runBeat({});
  await a.runSpecBeat({});
  await a.runShipBeat({});
  await a.runChecker({});
  assert.deepEqual(seen, [["claude-opus-5-5", "xhigh"], ["claude-fable-5-2", "high"], ["claude-sonnet-5-5", "-"], ["checker", "claude-fable-5-2", "-"]]);
});

test("D5: every engine passes the model and the effort", () => {
  const c = buildArgv({ prompt: "p", model: "claude-opus-5-5", effort: "xhigh" });
  assert.equal(c[c.indexOf("--effort") + 1], "xhigh");
  assert.ok(!buildArgv({ prompt: "p" }).includes("--effort"));
  const x = codex.beatArgs({ prompt: "p", model: "gpt-x", effort: "high" });
  assert.equal(x[x.indexOf("-m") + 1], "gpt-x");
  assert.equal(x[x.indexOf("-c") + 1], 'model_reasoning_effort="high"');
  assert.ok(x.indexOf("-m") < x.indexOf("--"), "flags before the prompt");
  assert.deepEqual(codex.beatArgs({ prompt: "p" }), ["exec", "-s", "workspace-write", "--", "p"]);
  const g = agy.beatArgs({ prompt: "p", model: "gemini-x", effort: "low" });
  assert.equal(g[g.indexOf("--model") + 1], "gemini-x");
  assert.equal(g[g.indexOf("--effort") + 1], "low");
  for (const a of [codex, agy]) assert.equal(a.takesModel, true, a.name);
});

test("D3: the doctor ranks with the project's own list, never a built-in one", () => {
  const find = (f) => diagnose({ state: {}, ...f }).find((c) => c.id === "models");
  // A family Carja has never heard of, ranked by the project.
  const weaker = find({ models: { maker: "claude-fable-5-2", checker: "claude-opus-5-5" }, modelRank: ["claude-fable-5-2", "claude-opus-5-5"] });
  assert.equal(weaker?.level, "warn");
  assert.match(weaker.title, /checker.*claude-opus-5-5.*weaker.*claude-fable-5-2/i);
  assert.equal(find({ models: { maker: "claude-opus-5-5", checker: "claude-fable-5-2" }, modelRank: ["claude-fable-5-2", "claude-opus-5-5"] }), undefined);
  // Two different models and no rank: it cannot tell, and says how to fix it.
  const unknown = find({ models: { maker: "opus", checker: "haiku" } });
  assert.equal(unknown?.level, "warn");
  assert.match(unknown.title, /cannot tell/);
  assert.match(unknown.fix, /models\.rank/);
  // Same model, or a role on the default: nothing to check.
  for (const models of [{ maker: "sonnet", checker: "sonnet" }, { maker: "opus", checker: null }, { maker: null, checker: "haiku" }]) assert.equal(find({ models }), undefined, JSON.stringify(models));
  // The built-in preset carries its own rank.
  const cfg = parseLoopConfig({ models: { preset: "balanced" } });
  assert.equal(find({ models: effectiveModels(cfg), modelRank: cfg.modelRank }), undefined);
});

test("`carja models` shows each role, and `carja models use` switches preset without JSON", () => {
  const REPO = new URL("..", import.meta.url).pathname;
  const root = mkdtempSync(join(tmpdir(), "models-"));
  try {
    execFileSync("node", [join(REPO, "bin/carja.js"), "init", root, "--all", "--no-detect"], { stdio: "pipe" });
    const run = (...a) => execFileSync("node", [join(REPO, "bin/carja.js"), "models", ...a, root], { stdio: ["ignore", "pipe", "pipe"] }).toString();
    assert.match(run(), /plan +engine default/);
    const cfgPath = join(root, "carja.config.json");
    const cfg = JSON.parse(readFileSync(cfgPath, "utf8"));
    cfg.models = { presets: { frontier: FRONTIER.models } };
    writeFileSync(cfgPath, JSON.stringify(cfg, null, 2));
    const out = run("use", "frontier");
    assert.match(out, /plan +claude-fable-5-2 +high/);
    assert.match(out, /build +claude-opus-5-5 +xhigh/);
    assert.match(out, /\/model claude-fable-5-2/, "says how to switch an interactive session");
    assert.equal(JSON.parse(readFileSync(cfgPath, "utf8")).models.preset, "frontier");
    assert.throws(() => run("use", "nope"), /No preset "nope"/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("`carja models set` and `carja models rank` write the block, so the owner never edits JSON", () => {
  const REPO = new URL("..", import.meta.url).pathname;
  const root = mkdtempSync(join(tmpdir(), "models-set-"));
  try {
    execFileSync("node", [join(REPO, "bin/carja.js"), "init", root, "--all", "--no-detect"], { stdio: "pipe" });
    const run = (...a) => execFileSync("node", [join(REPO, "bin/carja.js"), "models", ...a, root], { stdio: ["ignore", "pipe", "pipe"] }).toString();
    run("set", "plan", "claude-fable-5-2", "--effort", "high");
    run("set", "build", "claude-opus-5-5");
    const out = run("rank", "claude-fable-5-2", "claude-opus-5-5");
    const m = JSON.parse(readFileSync(join(root, "carja.config.json"), "utf8")).models;
    assert.deepEqual(m.plan, { model: "claude-fable-5-2", effort: "high" });
    assert.equal(m.build, "claude-opus-5-5");
    assert.deepEqual(m.rank, ["claude-fable-5-2", "claude-opus-5-5"]);
    assert.match(out, /Rank: +claude-fable-5-2 > claude-opus-5-5/);
    run("set", "build", "default");
    assert.equal(JSON.parse(readFileSync(join(root, "carja.config.json"), "utf8")).models.build, undefined, "`default` unsets a role");
    run("set", "build", "claude-opus-5-5");
    run("save", "frontier");
    const saved = JSON.parse(readFileSync(join(root, "carja.config.json"), "utf8")).models;
    assert.deepEqual(saved.presets.frontier, { plan: { model: "claude-fable-5-2", effort: "high" }, build: "claude-opus-5-5", rank: ["claude-fable-5-2", "claude-opus-5-5"] });
    assert.equal(saved.preset, "frontier", "save also puts the preset in use");
    assert.equal(saved.plan, undefined, "the roles move into the preset");
    assert.match(run(), /plan +claude-fable-5-2 +high +preset frontier/);
    assert.throws(() => run("set", "planner", "x"), /unknown role/);
    assert.throws(() => run("set", "plan", "--x"), /not a model id/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("`carja models` shows what the loop runs from the 7.x settings, not \"engine default\"", async () => {
  const { renderModels } = await import("../src/commands/models.js");
  const out = renderModels({ loop: { models: { maker: "sonnet", checker: "opus" } } });
  assert.match(out, /build +sonnet +default +loop\.models \(7\.x, loop only\)/);
  assert.match(out, /review +opus +default +loop\.models \(7\.x, loop only\)/);
  assert.match(out, /plan +engine default/);
  assert.match(renderModels({ loop: { profile: "balanced" } }), /build +sonnet +default +loop\.profile balanced \(7\.x, loop only\)/);
  assert.doesNotMatch(out, /\/model sonnet/, "a loop-only setting gives no interactive hint");
});
