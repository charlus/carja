// test/loop-risk-merge.test.js
//
// The risk block (owner, 2026-11-18): "low and medium: no human review. High:
// human review." The real CLI in the outer layout, with the stub engine and the
// stub `gh` (test/fixtures/stub-forge/gh): `carja loop <project>` merges the
// items the owner does not review, bottom first, through the MR API, and stops
// at the first one that waits for the owner. No model is called.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";

import { G, layout, loop } from "./helpers/stacked-layout.js";

const prs = (l) => JSON.parse(readFileSync(l.db, "utf8")).prs;
const stack = (l) => JSON.parse(readFileSync(join(l.root, ".git/carja-loop-logs/runs/notes/stack.json"), "utf8"));
const report = (l) => readFileSync(join(l.root, "carja/1-workbench/loop-report-notes.md"), "utf8");

function withRisk(l, risk) {
  const p = join(l.root, "carja.config.json");
  const cfg = JSON.parse(readFileSync(p, "utf8"));
  cfg.risk = risk;
  writeFileSync(p, JSON.stringify(cfg, null, 2));
  G(l.root, "commit", "-qam", "risk");
  G(l.root, "push", "-q", "origin", "master");
}

test("owner reviews high only: the loop merges every medium item itself, and says so in the report", () => {
  const l = layout({ prefix: "risk-merge-" });
  try {
    withRisk(l, { owner_review: ["high"] });
    const r = loop(l, ["notes"], "prompts", { CARJA_MERGE_POLL_MS: "0" });
    assert.equal(r.status, 0, r.stdout + r.stderr);
    const s = stack(l);
    assert.equal(s.length, 4);
    for (const e of s) assert.ok(e.files, `${e.title} records its files`);
    const merged = prs(l).filter((p) => p.state === "MERGED");
    assert.equal(merged.length, 7, r.stdout);
    assert.ok(merged.every((p) => p.merged?.method === "merge" && p.merged.sha), "merged without squash, at the checked head");
    assert.match(report(l), /## Merged by the loop \(4 items\)/);
    assert.match(report(l), /Risk: \*\*medium\*\*/);
    assert.match(report(l), /No MR waits for you/);
    assert.match(r.stdout, /Next: deploy and test the product\. The loop merged every item\./);
  } finally {
    rmSync(l.base, { recursive: true, force: true });
  }
});

test("a high path stops the merge at that item; nothing above it is merged", () => {
  const l = layout({ prefix: "risk-merge-" });
  try {
    // The stub engine writes src/built-2.js for slice 2.
    withRisk(l, { owner_review: ["high"], high_paths: ["src/built-2.js"] });
    const r = loop(l, ["notes"], "prompts", { CARJA_MERGE_POLL_MS: "0" });
    assert.equal(r.status, 0, r.stdout + r.stderr);
    const s = stack(l);
    const state = (u) => prs(l).find((p) => p.url === u).state;
    assert.equal(state(s[0].outer.url), "MERGED");
    assert.equal(state(s[1].outer.url), "MERGED");
    assert.equal(state(s[2].code.url), "OPEN");
    assert.equal(state(s[3].code.url), "OPEN");
    assert.match(report(l), /Risk high, which waits for your review: touches a path you rate high: src\/built-2\.js/);
    assert.match(report(l), /Merge these MRs in this order \(2 items\)/);
  } finally {
    rmSync(l.base, { recursive: true, force: true });
  }
});

test("without a risk block, the loop merges nothing, as before", () => {
  const l = layout({ prefix: "risk-merge-" });
  try {
    const r = loop(l, ["notes"]);
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.equal(prs(l).filter((p) => p.state === "MERGED").length, 0);
    assert.doesNotMatch(report(l), /Merged by the loop/);
  } finally {
    rmSync(l.base, { recursive: true, force: true });
  }
});
