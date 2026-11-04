// test/context-budget.test.js
//
// E2 — the context-budget RATCHET. Progressive Disclosure stops being a
// paragraph and becomes a number that CI defends.
//
// Two ledgers, and they are not equally dangerous:
//   ALWAYS-ON  every session pays it before doing anything (the classifier,
//              always-on rules, every skill's frontmatter). Growth here is
//              multiplied by every session forever.
//   EAGER      paid only when a skill or workflow is invoked. A big workflow
//              is fine; a big always-on rule never is.
//
// The ratchet fails on growth past the committed fixture AND on a new skill or
// workflow with no budget entry at all — adding context must be a conscious,
// visible decision, not a default.
//
// Ceilings are in BYTES on purpose: exact, machine-independent, no model call.
// Token figures are reported as an estimate with the divisor named, so nobody
// mistakes them for measurements.
//
// ON FAILURE, see scripts/capture-context-budget.js — the protocol is
// "intended growth → re-capture in the same commit; accidental bloat → fix the
// bloat; after a reduction → re-capture so the ceiling ratchets down".

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  buildBill,
  checkBudget,
  captureBudget,
  frontmatterOf,
  isAlwaysOn,
  estimateTokens,
} from "../src/context-bill.js";

const ROOT = new URL("..", import.meta.url).pathname;
const AGENTS = join(ROOT, "templates", ".agents");
const FIXTURE = join(ROOT, "test", "fixtures", "context-budget.json");

const RATCHET_HELP =
  "Ratchet protocol: intended growth → `node scripts/capture-context-budget.js` and commit the " +
  "refreshed fixture in the SAME commit; accidental bloat → fix the bloat; after a reduction → " +
  "re-capture so the ceiling ratchets down.";

// A hard cap on top of the ratchet. The ratchet only stops growth being
// *invisible*; this stops it being accepted forever, one re-capture at a time.
// ~6k tokens of framework before any project context is already generous.
const ALWAYS_ON_HARD_CAP_BYTES = 24 * 1024;

const budget = JSON.parse(readFileSync(FIXTURE, "utf8"));
const bill = await buildBill(AGENTS);

describe("E2.4 — the bill measures the right things", () => {
  test("frontmatterOf extracts only the leading YAML block", () => {
    const text = "---\nname: X\n---\n\n# Body\n\n---\n\nnot frontmatter\n";
    assert.equal(frontmatterOf(text), "---\nname: X\n---");
    assert.equal(frontmatterOf("# no frontmatter\n"), "");
  });

  test("isAlwaysOn distinguishes always-on rules from on-demand ones", () => {
    assert.equal(isAlwaysOn("---\ntrigger: manual\ninline: true\n---\n"), true);
    assert.equal(isAlwaysOn("---\ntrigger: always_on\n---\n"), false, "Antigravity's trigger no longer decides it");
    assert.equal(isAlwaysOn("---\ndescription: loop-scoped\n---\n"), false);
    assert.equal(isAlwaysOn("# no frontmatter"), false);
  });

  test("a skill's BODY is eager, not always-on — only its frontmatter is scanned", () => {
    const fm = bill.alwaysOn.items.find((i) => i.kind === "skill-frontmatter");
    const body = bill.eager.find((e) => e.name === fm.name);
    assert.ok(fm && body, "expected the same skill in both ledgers");
    assert.ok(
      fm.bytes < body.bytes,
      `${fm.name}: frontmatter (${fm.bytes}B) should be far smaller than the body (${body.bytes}B) — ` +
        "if these are close, the router is being made to read a whole skill to route",
    );
  });

  test("loop-scoped rules are NOT billed as always-on", () => {
    // loop-guardrails.md is deliberately on-demand; if it ever gains
    // `inline: true` every session starts paying for it.
    const loopRule = bill.alwaysOn.items.find((i) => i.name === "rules/loop-guardrails.md");
    assert.equal(loopRule, undefined, "loop-guardrails.md became always-on — it is loop-scoped");
  });

  test("workflows are never always-on", () => {
    for (const i of bill.alwaysOn.items) {
      assert.ok(!i.name.startsWith("workflows/"), `${i.name} is billed as always-on`);
    }
  });

  test("the token estimate is derived from bytes and clearly an estimate", () => {
    assert.equal(estimateTokens(4000, "prose"), 1000);
    assert.equal(estimateTokens(3500, "frontmatter"), 1000);
  });
});

describe("E2.5 — the fixture cannot silently disable the ceiling", () => {
  test("the committed fixture is well-formed", () => {
    assert.equal(typeof budget.alwaysOnBytes, "number");
    assert.ok(Number.isFinite(budget.alwaysOnBytes));
    const bad = Object.entries(budget.eagerBytes ?? {}).filter(
      ([, v]) => typeof v !== "number" || !Number.isFinite(v),
    );
    assert.deepEqual(bad.map(([k]) => k), [], "non-numeric ceilings would pass every comparison");
  });

  test("a fixture with a non-numeric always-on ceiling FAILS loudly", () => {
    const res = checkBudget(bill, { alwaysOnBytes: "lots", eagerBytes: {} });
    assert.equal(res.ok, false);
    assert.match(res.failures.join(" "), /ceiling is OFF/i);
  });

  test("a missing always-on ceiling FAILS loudly", () => {
    const res = checkBudget(bill, { eagerBytes: {} });
    assert.equal(res.ok, false);
  });
});

describe("E2.6 — the ratchet", () => {
  test("always-on context is within its committed ceiling", () => {
    assert.ok(
      bill.totals.alwaysOnBytes <= budget.alwaysOnBytes,
      `always-on grew to ${bill.totals.alwaysOnBytes} bytes (ceiling ${budget.alwaysOnBytes}). ` +
        `EVERY session pays this. ${RATCHET_HELP}`,
    );
  });

  test("every skill and workflow is within its committed ceiling, and none is unbudgeted", () => {
    const res = checkBudget(bill, budget);
    assert.ok(res.ok, `${res.failures.join("\n  ")}\n\n${RATCHET_HELP}`);
  });

  test("a NEW skill with no budget entry fails the ratchet", () => {
    // The property that makes this a ratchet rather than a suggestion: adding
    // context cannot be a default, it has to be recorded.
    const withNewSkill = {
      ...bill,
      eager: [...bill.eager, { name: "skills/brand-new", kind: "skill", bytes: 4096 }],
    };
    const res = checkBudget(withNewSkill, budget);
    assert.equal(res.ok, false);
    assert.match(res.failures.join(" "), /skills\/brand-new has no budget entry/);
  });

  test("growth past a ceiling fails the ratchet", () => {
    const grown = {
      ...bill,
      totals: { ...bill.totals, alwaysOnBytes: budget.alwaysOnBytes + 1 },
    };
    const res = checkBudget(grown, budget);
    assert.equal(res.ok, false);
    assert.match(res.failures.join(" "), /always-on grew/);
  });

  test("captureBudget round-trips: the current bill always satisfies its own capture", () => {
    const res = checkBudget(bill, captureBudget(bill));
    assert.ok(res.ok, `a freshly captured budget rejected its own bill: ${res.failures.join(", ")}`);
  });

  test("always-on stays under the HARD CAP, which no re-capture can raise", () => {
    assert.ok(
      bill.totals.alwaysOnBytes <= ALWAYS_ON_HARD_CAP_BYTES,
      `always-on is ${bill.totals.alwaysOnBytes} bytes, over the ${ALWAYS_ON_HARD_CAP_BYTES}-byte hard cap ` +
        `(~${bill.totals.alwaysOnTokensEstimate} tokens before any project context). The ratchet stops growth ` +
        `being invisible; this stops it being accepted forever one re-capture at a time. Cut, don't raise.`,
    );
  });
});

// `carja context-bill /abs/path` joined the absolute path onto cwd and
// reported "nothing found". An absolute directory must be used as given.
test("context-bill accepts an absolute target directory", async () => {
  const { contextBillCommand } = await import("../src/commands/context-bill.js");
  const { fileURLToPath } = await import("node:url");
  const templates = fileURLToPath(new URL("../templates", import.meta.url));
  let out = "";
  let err = "";
  const code = await contextBillCommand([templates, "--json"], {
    cwd: (await import("node:os")).tmpdir(),
    stdout: { write: (s) => (out += s) },
    stderr: { write: (s) => (err += s) },
  });
  assert.equal(code, 0, err);
  assert.ok(JSON.parse(out).totals.alwaysOnBytes > 0);
});
