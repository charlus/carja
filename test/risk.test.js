// test/risk.test.js
//
// The risk block (owner, 2026-11-18): "low and medium: no human review. High:
// human review. The agent tends to categorize medium for things I don't
// personally care." The tier of a stacked item, and which tiers wait for the
// owner. Pure: src/loop/risk.js.

import { test } from "node:test";
import assert from "node:assert/strict";

import { parseRiskConfig, itemTier, needsOwnerReview, globMatch, rulingRule } from "../src/loop/risk.js";

const OWNER = { risk: { owner_review: ["high"], high_means: "Data loss, security, billing.", high_paths: ["**/billing/**"], low_paths: ["docs/**"] } };
const item = (over = {}) => ({ files: { outer: ["carja/1-workbench/x.md"], code: ["src/app.js"] }, rulings: [], ownerActions: [], detected: [], docsMerged: [], ...over });

test("no risk block: every tier waits for the owner, as before", () => {
  const r = parseRiskConfig({});
  assert.equal(r.configured, false);
  assert.deepEqual(r.ownerReview, ["low", "medium", "high"]);
  assert.equal(needsOwnerReview(item(), r).length > 0, true);
});

test("the owner's block parses, and bad values are errors", () => {
  const r = parseRiskConfig(OWNER);
  assert.deepEqual(r.errors, []);
  assert.deepEqual(r.ownerReview, ["high"]);
  assert.equal(r.highMeans, "Data loss, security, billing.");
  const bad = parseRiskConfig({ risk: { owner_review: ["huge"], high_paths: "x", high_means: 3 } });
  assert.equal(bad.errors.length, 3);
});

test("high is always reviewed, even when the config leaves it out", () => {
  const r = parseRiskConfig({ risk: { owner_review: [] } });
  assert.deepEqual(r.ownerReview, ["high"]);
  assert.match(r.notes.join(" "), /high/);
});

test("an ordinary change is medium and merges without the owner", () => {
  const r = parseRiskConfig(OWNER);
  const t = itemTier(item(), r);
  assert.equal(t.tier, "medium");
  assert.deepEqual(needsOwnerReview(item(), r), []);
});

test("only low paths: low", () => {
  assert.equal(itemTier(item({ files: { outer: ["docs/a.md"], code: [] } }), parseRiskConfig(OWNER)).tier, "low");
});

test("a high path in either repository: high, and the owner is asked why", () => {
  const r = parseRiskConfig(OWNER);
  const e = item({ files: { outer: [], code: ["src/billing/invoice.js"] } });
  assert.equal(itemTier(e, r).tier, "high");
  assert.match(needsOwnerReview(e, r).join(" "), /billing\/invoice\.js/);
});

test("the gates and the risk config itself are always high, whatever the config says", () => {
  const r = parseRiskConfig({ risk: { owner_review: ["high"], low_paths: ["**"] } });
  for (const f of [".agents/hooks/pre-push", "carja.config.json", ".github/workflows/ci.yml", ".gitlab-ci.yml", ".claude/settings.json"]) {
    assert.equal(itemTier(item({ files: { outer: [f], code: [] } }), r).tier, "high", f);
    assert.equal(itemTier(item({ files: { outer: [], code: [f] } }), r).tier, "high", `code ${f}`);
  }
});

test("a high ruling, an owner action, a migration, a new env var or a deploy change: high", () => {
  const r = parseRiskConfig(OWNER);
  assert.equal(itemTier(item({ rulings: [{ risk: "high", decision: "drop column" }] }), r).tier, "high");
  assert.equal(itemTier(item({ ownerActions: ["Rotate the API key"] }), r).tier, "high");
  assert.equal(itemTier(item({ detected: ["Back up the database, then run the new migration where the product runs: `x`."] }), r).tier, "high");
  assert.equal(itemTier(item({ detected: ["Set the new environment variable where the product runs, before you deploy: `K`."] }), r).tier, "high");
  assert.equal(itemTier(item({ detected: ["Deployment configuration changed, read it before you deploy: `Dockerfile`."] }), r).tier, "high");
});

test("a dependency that passed the gate, a medium ruling, merged documents: medium", () => {
  const r = parseRiskConfig(OWNER);
  const lowFiles = { outer: ["docs/a.md"], code: [] };
  assert.equal(itemTier(item({ files: lowFiles, detected: ["Install the new dependency where the product runs: left-pad 1.3.0 (npm). The loop installed it in its own worktree only."] }), r).tier, "medium");
  assert.equal(itemTier(item({ files: lowFiles, rulings: [{ risk: "medium", decision: "x" }] }), r).tier, "medium");
  assert.equal(itemTier(item({ files: lowFiles, docsMerged: ["carja/x.md"] }), r).tier, "medium");
});

test("fail safe: an item with no record of its files, or adopted from an earlier run, is high", () => {
  const r = parseRiskConfig(OWNER);
  assert.equal(itemTier(item({ files: undefined }), r).tier, "high");
  assert.equal(itemTier(item({ adopted: true }), r).tier, "high");
});

test("an unknown ruling risk is high", () => {
  assert.equal(itemTier(item({ rulings: [{ risk: "weird" }] }), parseRiskConfig(OWNER)).tier, "high");
});

test("an owner who reviews medium too gets asked for medium", () => {
  const r = parseRiskConfig({ risk: { owner_review: ["medium", "high"] } });
  assert.equal(needsOwnerReview(item(), r).length, 1);
});

test("globs: ** crosses folders, * does not", () => {
  assert.equal(globMatch("docs/**", "docs/a/b.md"), true);
  assert.equal(globMatch("docs/*", "docs/a/b.md"), false);
  assert.equal(globMatch("**/billing/**", "src/billing/x.js"), true);
  assert.equal(globMatch("**/billing/**", "billing/x.js"), true);
  assert.equal(globMatch("*.md", "a.md"), true);
  assert.equal(globMatch("*.md", "x/a.md"), false);
});

test("the ruling rule: the owner's definition replaces the built-in one", () => {
  assert.match(rulingRule(null), /anything a user would notice/);
  const own = rulingRule("Data loss, security, billing.");
  assert.match(own, /Data loss, security, billing\./);
  assert.doesNotMatch(own, /anything a user would notice/);
});
