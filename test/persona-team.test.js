// The personas as one engineering team, with the human as product owner.
//
// One reviewer reads every triggered persona's Review Lens, so two findings in
// the same review can pull opposite ways (Security wants a re-authentication
// step, the Designer wants no extra step). A real team settles that itself and
// only asks the product owner when every option changes what the user gets.
//
//   D1  the author settles engineering conflicts in a fixed order: security and
//       data integrity, then acceptance criteria, then performance, then design
//   D2  the product owner is asked only when every option is user-visible
//   D3  upstream, a persona's engineering question becomes a recorded decision
//   D4  the ledger records which persona lost each conflict, so a lens that
//       loses most of the time shows up as a calibration defect
//   R1  after the delta round, only security and data-loss blockers go to the
//       human; the rest are fixed or written into the PR as known gaps
//
// D1 and D4 are enforced in code (the ledger refuses an override that reverses
// the order). The rest is prose in the skills, pinned here.

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { PRECEDENCE, outranks } from "../src/personas.js";
import { normalizeFinding, summarise } from "../src/commands/review-log.js";

const AGENTS = join(import.meta.dirname, "..", "templates", ".agents");
const read = (...p) => readFileSync(join(AGENTS, ...p), "utf8");
const at = () => 0;

describe("D1 — the precedence order", () => {
  test("security and data integrity, then acceptance criteria, then architecture, then performance, then design", () => {
    assert.deepEqual(PRECEDENCE, [
      "security-auditor",
      "database-architect",
      "acceptance-criteria",
      "architect",
      "performance-optimizer",
      "designer",
    ]);
    assert.ok(outranks("security-auditor", "designer"));
    assert.ok(!outranks("designer", "performance-optimizer"));
    assert.ok(outranks("architect", "performance-optimizer"));
    assert.ok(!outranks("architect", "acceptance-criteria"));
  });
});

describe("D1 + D4 — the ledger records conflicts and refuses a reversed order", () => {
  const loser = { severity: "IMPORTANT", category: "ui", action: "dismissed", persona: "designer" };

  test("a finding records the persona whose lens raised it", () => {
    const r = normalizeFinding({ severity: "NIT", category: "ui", action: "fixed", persona: "designer" }, { now: at });
    assert.equal(r.record.persona, "designer");
  });

  test("an unknown persona is refused", () => {
    assert.equal(normalizeFinding({ ...loser, persona: "tech-lead" }).ok, false);
  });

  test("a lower persona overridden by a higher one is accepted", () => {
    const r = normalizeFinding({ ...loser, overridden_by: "security-auditor" }, { now: at });
    assert.equal(r.ok, true);
    assert.equal(r.record.overridden_by, "security-auditor");
  });

  test("an override that reverses the order is refused: it is a product decision", () => {
    const r = normalizeFinding({ ...loser, persona: "security-auditor", overridden_by: "designer" });
    assert.equal(r.ok, false);
    assert.match(r.error, /product owner/);
  });

  test("the same reversal is accepted when the product owner decided it", () => {
    const r = normalizeFinding(
      { ...loser, persona: "security-auditor", overridden_by: "designer", po_decision: true },
      { now: at },
    );
    assert.equal(r.ok, true);
    assert.equal(r.record.po_decision, true);
  });

  test("an override needs the losing persona and a dismissed finding", () => {
    assert.equal(normalizeFinding({ ...loser, persona: undefined, overridden_by: "security-auditor" }).ok, false);
    assert.equal(normalizeFinding({ ...loser, action: "fixed", overridden_by: "security-auditor" }).ok, false);
  });

  test("the summary flags a persona that loses most of its conflicts", () => {
    const s = summarise([
      { ...loser, overridden_by: "performance-optimizer" },
      { ...loser, overridden_by: "acceptance-criteria" },
      { ...loser, overridden_by: "security-auditor" },
      { ...loser, action: "fixed" },
      { severity: "IMPORTANT", category: "n+1", action: "fixed", persona: "database-architect" },
    ]);
    const designer = s.personas.find((p) => p.name === "designer");
    assert.equal(designer.total, 4);
    assert.equal(designer.overridden, 3);
    assert.deepEqual(s.lensSuspects.map((p) => p.name), ["designer"]);
  });
});

describe("D2 + R1 — the review skill's conflict and escalation rules", () => {
  const SKILL = read("skills", "independent-review", "SKILL.md");

  test("conflicting findings are settled by the author in the D1 order", () => {
    assert.match(SKILL, /## Conflicting findings/);
    assert.match(SKILL, /security and data integrity.*acceptance criteria.*architecture.*performance.*design/is);
  });

  test("the product owner is asked only when every option changes what the user sees or does", () => {
    assert.match(SKILL, /every option changes what the user sees or does/i);
  });

  test("after the delta round only security and data-loss blockers go to the human", () => {
    assert.match(SKILL, /only security and data-loss blockers/i);
    assert.doesNotMatch(SKILL, /Blockers remain → \*\*stop and ask the human once\.\*\* Batch every remaining blocker/);
  });
});

describe("O1–O4 + D3 — the personas upstream", () => {
  const GRILLING = read("skills", "grilling", "SKILL.md");

  test("Grilling has a lens pass that decides engineering questions and asks only product ones", () => {
    assert.match(GRILLING, /## Lens Pass/);
    assert.match(GRILLING, /at most two/i);
    assert.match(GRILLING, /Lens decisions/);
  });

  test("Spec-It turns each triggered persona's Review Lens into acceptance criteria", () => {
    const spec = read("workflows", "spec-it.md");
    assert.match(spec, /carja personas/);
    assert.match(spec, /Review Lens[^.]*acceptance criteria/i);
  });

  test("Technical Vision runs the lens pass with the Architect and the three specialists", () => {
    const tv = read("workflows", "technical-vision.md");
    assert.match(tv, /skills\/architecture-patterns\/SKILL\.md/, "technical-vision never loads architecture-patterns");
    for (const p of ["architect", "database-architect", "security-auditor", "performance-optimizer"]) {
      assert.match(tv, new RegExp(`personas/${p}\\.md`), `technical-vision does not load ${p}`);
    }
    assert.match(tv, /Lens Pass/);
  });

  test("Genesis and Grand PRD run the lens pass with the Product Manager only", () => {
    for (const wf of ["genesis.md", "grand-prd.md"]) {
      const text = read("workflows", wf);
      assert.match(text, /personas\/product-manager\.md/, `${wf} does not load the Product Manager`);
      assert.doesNotMatch(text, /personas\/(architect|security-auditor|database-architect|performance-optimizer)\.md/,
        `${wf} brings a technical persona into product discovery`);
    }
  });
});

describe("every persona path a template names exists", () => {
  test("no dangling .agents/personas/<name>.md reference", () => {
    const r = spawnSync("grep", ["-rhoE", "personas/[a-zA-Z-]+\\.md", AGENTS], { encoding: "utf8" });
    const named = [...new Set(r.stdout.split("\n").filter(Boolean))];
    assert.ok(named.length > 5);
    for (const p of named) assert.ok(existsSync(join(AGENTS, p)), `${p} does not exist`);
  });
});
