// test/review-log.test.js
//
// E2 — the review findings ledger. This is the instrument that settles the
// question E1 answered with an argument: is the reviewer's rubric too strict,
// or does the Maker write bad code? Both hypotheses predict "a blocker every
// round"; only the data separates them.
//
// The ledger enforces the SAME bar as rubric v2 at the write boundary, so it
// cannot record a finding the rubric would have refused — otherwise the
// measurement would be taken with a different ruler than the gate.

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { normalizeFinding, summarise } from "../src/commands/review-log.js";

const at = () => 0;

describe("E2.7 — the ledger enforces the rubric bar at write time", () => {
  test("a BLOCKER with a quote and confidence >= 7 is accepted", () => {
    const r = normalizeFinding(
      {
        severity: "BLOCKER",
        confidence: 9,
        category: "security",
        file: "src/db.js",
        line: 42,
        quote: "db.raw(`SELECT ${id}`)",
        action: "fixed",
      },
      { now: at },
    );
    assert.equal(r.ok, true, r.error);
    assert.equal(r.record.severity, "BLOCKER");
    assert.equal(r.record.fingerprint, "src/db.js:42:security");
  });

  test("a BLOCKER with confidence < 7 is REFUSED", () => {
    const r = normalizeFinding({ severity: "BLOCKER", confidence: 5, quote: "x", action: "fixed", category: "correctness" });
    assert.equal(r.ok, false);
    assert.match(r.error, /confidence >= 7/);
  });

  test("a BLOCKER with no quote is REFUSED", () => {
    const r = normalizeFinding({ severity: "BLOCKER", confidence: 9, action: "fixed", category: "correctness" });
    assert.equal(r.ok, false);
    assert.match(r.error, /quoted line/);
  });

  test("IMPORTANT and NIT need no quote — only blockers carry the bar", () => {
    for (const severity of ["IMPORTANT", "NIT"]) {
      const r = normalizeFinding({ severity, action: "dismissed", category: "consistency" });
      assert.equal(r.ok, true, `${severity}: ${r.error}`);
    }
  });

  test("an unknown severity or action is refused", () => {
    assert.equal(normalizeFinding({ severity: "CRITICAL", action: "fixed" }).ok, false);
    assert.equal(normalizeFinding({ severity: "NIT", action: "ignored" }).ok, false);
  });

  test("a non-object is refused rather than silently recorded", () => {
    for (const bad of [null, "x", 3, []]) {
      assert.equal(normalizeFinding(bad).ok, false);
    }
  });

  test("a long quote is truncated, not rejected — the ledger must not lose a finding", () => {
    const r = normalizeFinding({
      severity: "BLOCKER",
      confidence: 8,
      quote: "x".repeat(5000),
      action: "fixed",
      category: "correctness",
    });
    assert.equal(r.ok, true);
    assert.equal(r.record.quote.length, 400);
  });
});

describe("E2.8 — the summary answers the questions the plan asked", () => {
  const records = [
    { severity: "BLOCKER", category: "sql", action: "fixed", round: 1 },
    { severity: "BLOCKER", category: "sql", action: "fixed", round: 1 },
    { severity: "IMPORTANT", category: "test-structure", action: "dismissed", round: 1 },
    { severity: "IMPORTANT", category: "test-structure", action: "dismissed", round: 2 },
    { severity: "NIT", category: "test-structure", action: "dismissed", round: 2 },
    { severity: "NIT", category: "naming", action: "fixed", round: 2 },
  ];
  const s = summarise(records);

  test("counts findings, blockers and rounds", () => {
    assert.equal(s.findings, 6);
    assert.equal(s.blockers, 2);
    assert.equal(s.maxRound, 2);
  });

  test("computes the dismissal rate", () => {
    assert.equal(s.dismissed, 3);
    assert.equal(s.dismissalRate, 0.5);
  });

  test("flags a class dismissed most of the time as a RUBRIC suspect", () => {
    // This is the point of the ledger: three findings in `test-structure`, all
    // dismissed, means the rubric is wrong there — not that the author is
    // ignoring real defects.
    // (`test-structure` is an old free-text name: it counts under test-quality.)
    assert.deepEqual(s.rubricSuspects.map((c) => c.name), ["test-quality"]);
  });

  test("does NOT flag a class with real, fixed blockers", () => {
    assert.ok(!s.rubricSuspects.some((c) => c.name === "sql"));
  });

  test("needs at least 3 findings before calling a class a suspect", () => {
    const thin = summarise([
      { severity: "NIT", category: "one-off", action: "dismissed", round: 1 },
      { severity: "NIT", category: "one-off", action: "dismissed", round: 1 },
    ]);
    assert.deepEqual(thin.rubricSuspects, [], "two dismissals is noise, not a pattern");
  });

  test("an empty ledger summarises to zeros, not NaN", () => {
    const empty = summarise([]);
    assert.equal(empty.findings, 0);
    assert.equal(empty.dismissalRate, 0);
    assert.equal(empty.maxRound, 0);
  });
});

// ---------------------------------------------------------------------------
// F7 — one vocabulary, nothing lost, one place.
//
// Real ledgers (2026-10): 30 rows with category "undefined", the same idea under
// spec-gap / spec-ambiguity / ambiguity, so the ">50% dismissed" rubric alarm
// could never fire. An append of {finding, disposition} lost the finding text.
// Paths were written as backend/x and website-cms/backend/x for one file.
// ---------------------------------------------------------------------------
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { reviewLogCommand, CATEGORIES, canonicalCategory } from "../src/commands/review-log.js";
import { execFileSync } from "node:child_process";

describe("F7 — the ledger keeps one vocabulary", () => {
  test("categories are a closed set and common names map onto it", () => {
    assert.ok(CATEGORIES.includes("acceptance") && CATEGORIES.includes("other"));
    assert.equal(canonicalCategory("spec-gap"), "acceptance");
    assert.equal(canonicalCategory("Spec-Ambiguity"), "acceptance");
    assert.equal(canonicalCategory("n-plus-one"), "performance");
    assert.equal(canonicalCategory("vacuous-test"), "test-quality");
    assert.equal(canonicalCategory("sql-injection"), "security");
    assert.equal(canonicalCategory("made-up-thing"), null);
  });

  test("an alias is stored as its class, with the original kept as detail", () => {
    const r = normalizeFinding({ severity: "NIT", action: "fixed", category: "naming" }, { now: at });
    assert.equal(r.record.category, "consistency");
    assert.equal(r.record.detail, "naming");
  });

  test("a missing or unknown category is refused with the list", () => {
    for (const category of [undefined, "undefined", "made-up-thing"]) {
      const r = normalizeFinding({ severity: "NIT", action: "fixed", category }, { now: at });
      assert.equal(r.ok, false, String(category));
      assert.match(r.error, /acceptance/);
    }
  });

  test("an unknown field is refused, never silently dropped", () => {
    const r = normalizeFinding({ severity: "IMPORTANT", action: "deferred", category: "correctness", finding: "the text", disposition: "deferred" }, { now: at });
    assert.equal(r.ok, false);
    assert.match(r.error, /finding/);
    assert.match(r.error, /disposition/);
  });

  test("summary groups old free-text rows under their class", () => {
    const s = summarise([
      { severity: "NIT", category: "spec-gap", action: "dismissed", round: 1 },
      { severity: "NIT", category: "ambiguity", action: "dismissed", round: 1 },
      { severity: "NIT", category: "spec", action: "dismissed", round: 1 },
    ]);
    assert.deepEqual(s.classes.map((c) => c.name), ["acceptance"]);
    assert.equal(s.rubricSuspects.length, 1, "the alarm fires once the class is one class");
  });
});

describe("F7 — the ledger lives in the project, paths from the project root", () => {
  function outer() {
    const root = mkdtempSync(join(tmpdir(), "cond-rl-"));
    mkdirSync(join(root, "carja", "1-workbench"), { recursive: true });
    mkdirSync(join(root, ".agents"), { recursive: true });
    mkdirSync(join(root, "cms", "backend"), { recursive: true });
    writeFileSync(join(root, "cms", "backend", "x.py"), "x = 1\n");
    writeFileSync(join(root, ".gitignore"), "cms/\n");
    execFileSync("git", ["init", "-q"], { cwd: root });
    execFileSync("git", ["init", "-q"], { cwd: join(root, "cms") });
    return root;
  }
  const sink = () => { let t = ""; return { write: (s) => { t += s; }, get text() { return t; } }; };
  const rows = (root) => readFileSync(join(root, "carja", "1-workbench", "review-log.jsonl"), "utf8").trim().split("\n").map((l) => JSON.parse(l));

  test("run from a nested code repository, it writes the project's ledger with a project-relative path", async () => {
    const root = outer();
    const out = sink(), err = sink();
    const code = await reviewLogCommand(["append", JSON.stringify({ severity: "NIT", action: "fixed", category: "correctness", file: "backend/x.py", line: 1 })], { cwd: join(root, "cms"), stdout: out, stderr: err });
    assert.equal(code, 0, err.text);
    assert.ok(!existsSync(join(root, "cms", "carja")), "a stray ledger was created in the code repository");
    assert.equal(rows(root)[0].file, "cms/backend/x.py");
  });

  test("run from the project root with a code-repository-relative path, the path is resolved", async () => {
    const root = outer();
    const out = sink(), err = sink();
    await reviewLogCommand(["append", JSON.stringify({ severity: "NIT", action: "fixed", category: "correctness", file: "backend/x.py" })], { cwd: root, stdout: out, stderr: err });
    assert.equal(rows(root)[0].file, "cms/backend/x.py");
  });
});

describe("F7 — the reviewer and the caller use the same vocabulary", () => {
  const AG = join(new URL("..", import.meta.url).pathname, "templates", ".agents", "skills", "independent-review");
  const REVIEWER = readFileSync(join(AG, "reviewer.md"), "utf8");
  const SKILL = readFileSync(join(AG, "SKILL.md"), "utf8");

  test("the reviewer brief lists every class and asks for the lens of each finding", () => {
    for (const c of CATEGORIES) assert.ok(REVIEWER.includes(c), `reviewer.md does not name the class ${c}`);
    assert.match(REVIEWER, /^\s*lens:/m);
  });

  test("the caller records the class as category and the lens as persona", () => {
    assert.match(SKILL, /`class`[^.]*`category`/);
    assert.match(SKILL, /`lens`[^.]*`persona`/);
  });
});
