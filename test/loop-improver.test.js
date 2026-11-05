// test/loop-improver.test.js
//
// Cross-run self-improvement (P2.1): mine the ship-log for failures recurring
// >= threshold and propose rules. Pure — exercised directly on ship-log strings.

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  parseShipLogMessages,
  classifyMessage,
  normalizeReason,
  mineRecurringFailures,
  renderImprovementReport,
} from "../src/loop/improver.js";

test("parseShipLogMessages extracts only [loop] messages", () => {
  const md = [
    "# Ship Log",
    "- [2026-07-23T00:00:00Z] [loop] checker rejected: nope",
    "- [2026-07-23T00:01:00Z] [human] did a thing", // not [loop]
    "random prose",
  ].join("\n");
  const msgs = parseShipLogMessages(md);
  assert.equal(msgs.length, 1);
  assert.equal(msgs[0].message, "checker rejected: nope");
});

test("classifyMessage recognises each failure kind (and ignores success)", () => {
  assert.equal(classifyMessage("checker rejected: tests are missing").kind, "checker-rejection");
  assert.equal(classifyMessage("task task:foo: failed (stalled)").kind, "task-failure");
  assert.equal(classifyMessage("task foo: merge failed → awaiting_review").kind, "merge-failure");
  assert.equal(classifyMessage("pre-flight halt: halted_sandbox_required — needs a sandbox").kind, "halt");
  assert.equal(classifyMessage("beat 1: auto-captured uncommitted maker changes (commit hook bypassed)").kind, "hook-bypass");
  assert.equal(classifyMessage("shipped task:foo — done (PR http://x)"), null);
  assert.equal(classifyMessage("harvested 3 work item(s) from carja/"), null);
});

test("normalizeReason generalises run-specific specifics", () => {
  const a = normalizeReason("`npm test` exits non-zero: 2 of 3 fail because src/sum.js is missing");
  const b = normalizeReason("`npm test` exits non-zero: 1 of 3 fail because src/multiply.js is missing");
  assert.equal(a, b); // same normalized pattern despite different file/number
});

test("mineRecurringFailures clusters near-identical reasons and applies the threshold", () => {
  const md = [
    "# Ship Log",
    "- [t1] [loop] checker rejected: `npm test` exits non-zero: 2 of 3 fail because src/sum.js is missing",
    "- [t2] [loop] checker rejected: `npm test` exits non-zero: 1 of 3 fail because src/multiply.js is missing",
    "- [t3] [loop] task task:foo: failed (stalled)", // only once → below threshold
    "- [t4] [loop] shipped task:bar — done",          // success, ignored
  ].join("\n");
  const patterns = mineRecurringFailures(md, { threshold: 2 });
  assert.equal(patterns.length, 1);
  assert.equal(patterns[0].kind, "checker-rejection");
  assert.equal(patterns[0].count, 2);
  assert.equal(patterns[0].samples.length, 2);
});

test("mineRecurringFailures returns nothing when no pattern crosses the threshold", () => {
  const md = "- [t1] [loop] checker rejected: a one-off issue\n- [t2] [loop] shipped x — done";
  assert.deepEqual(mineRecurringFailures(md), []);
});

test("renderImprovementReport: null when empty, actionable doc when patterns exist", () => {
  assert.equal(renderImprovementReport([]), null);
  const doc = renderImprovementReport(
    [{ kind: "checker-rejection", key: "k", count: 3, reason: "tests missing", samples: ["checker rejected: tests missing"] }],
    { nowIso: "2026-07-23T00:00:00Z" }
  );
  assert.match(doc, /Loop Self-Improvement/);
  assert.match(doc, /seen 3×/);
  assert.match(doc, /PROPOSALS, not active rules/); // safety framing present
  assert.match(doc, /Suggested rule:/);
});

// ---- Fix C: an infra outage must not masquerade as a content rejection ------
// The JuRaph incident: the Checker never ran (session limit), so it wrote no
// verdict file — a distinct `parseCheckerVerdict` outcome from a substantive
// reject. When loop.js emits it as `checker infra-failure:`, the miner must
// classify it as an outage signal, NEVER as a `checker-rejection` content
// pattern (which would propose an .agents/rules/ rule for a beat where no agent ran).

test("classifyMessage: infra-failure is its own kind, not a content rejection", () => {
  const sig = classifyMessage("checker infra-failure: no verdict file written by Checker");
  assert.equal(sig.kind, "checker-infra");
  assert.notEqual(sig.kind, "checker-rejection");
  // a genuine substantive rejection is still checker-rejection
  assert.equal(classifyMessage("checker rejected: acceptance test missing").kind, "checker-rejection");
});

test("renderImprovementReport: a checker-infra pattern warns against a content rule", () => {
  const doc = renderImprovementReport(
    [{ kind: "checker-infra", key: "k", count: 47, reason: "no verdict file written by Checker", samples: ["checker infra-failure: no verdict file written by Checker"] }],
    { nowIso: "2026-07-27T00:00:00Z" }
  );
  assert.match(doc, /infrastructure|outage/i);
  assert.match(doc, /do not|don't/i); // explicitly steers away from a content rule
});
