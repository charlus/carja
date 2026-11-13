// test/loop-profiles.test.js
//
// Owner decisions D1–D5 (2026-10-21): two model profiles instead of per-role
// models. `quality`: Opus everywhere. `balanced`: Sonnet writes the code and
// the ship bookkeeping and moves to Opus after two rejections; Opus reviews and
// writes specs and designs (the planner–executor practice). No profile: the
// engine's default model, as before. `loop.models` still overrides one role.

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { parseLoopConfig, effectiveModels, withRoleModels, PROFILES } from "../src/loop/config.js";

test("the two profiles, and no profile", () => {
  assert.deepEqual(effectiveModels(parseLoopConfig({ loop: { profile: "quality" } })), { maker: "opus", maker_escalation: "opus", checker: "opus", spec: "opus", blueprint: "opus", ship: "opus" });
  assert.deepEqual(effectiveModels(parseLoopConfig({ loop: { profile: "balanced" } })), { maker: "sonnet", maker_escalation: "opus", checker: "opus", spec: "opus", blueprint: "opus", ship: "sonnet" });
  assert.deepEqual(effectiveModels(parseLoopConfig({})), {}, "no profile: nothing is forced");
  assert.ok(parseLoopConfig({ loop: { profile: "cheap" } }).errors.length);
  assert.deepEqual(Object.keys(PROFILES), ["quality", "balanced"]);
});

test("loop.models overrides one role of the profile", () => {
  const m = effectiveModels(parseLoopConfig({ loop: { profile: "balanced", models: { ship: "opus" } } }));
  assert.equal(m.ship, "opus");
  assert.equal(m.maker, "sonnet");
  assert.equal(parseLoopConfig({ loop: { models: { spec: "opus", blueprint: "sonnet" } } }).errors.length, 0, "spec and blueprint are roles");
});

test("each beat kind runs on its role's model: specs and designs never on the Maker's", async () => {
  const seen = [];
  const adapter = { name: "claude", runBeat: async (o) => (seen.push(o.model ?? "default"), {}), runChecker: async (o) => (seen.push(`checker:${o.model}`), {}) };
  const a = withRoleModels(adapter, effectiveModels(parseLoopConfig({ loop: { profile: "balanced" } })));
  await a.runBeat({});
  await a.runBeat({ escalateModel: true });
  await a.runSpecBeat({});
  await a.runBlueprintBeat({});
  await a.runShipBeat({});
  await a.runChecker({});
  assert.deepEqual(seen, ["sonnet", "opus", "opus", "opus", "sonnet", "checker:opus"]);
});

test("`carja loop profile` shows the models and the cost basis, and switches without JSON", () => {
  const REPO = new URL("..", import.meta.url).pathname;
  const root = mkdtempSync(join(tmpdir(), "profiles-"));
  try {
    execFileSync("node", [join(REPO, "bin/carja.js"), "init", root, "--all", "--no-detect"], { stdio: "pipe" });
    const run = (...a) => execFileSync("node", [join(REPO, "bin/carja.js"), "loop", "profile", ...a, root], { stdio: ["ignore", "pipe", "pipe"], env: { ...process.env, ANTHROPIC_API_KEY: "" } }).toString();
    assert.match(run(), /not set: every role uses the engine's default model/);
    const out = run("balanced");
    assert.match(out, /balanced/);
    assert.match(out, /Maker +sonnet \(opus after 2 rejections\)/);
    assert.match(out, /Checker +opus/);
    assert.equal(JSON.parse(readFileSync(join(root, "carja.config.json"), "utf8")).models.preset, "balanced", "D2: a profile is a preset of the models block");
    assert.match(run(), /subscription/, "without an API key, the cost is quota use at list price, not money");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
