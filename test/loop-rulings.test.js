// test/loop-rulings.test.js
//
// A12 (docs/roadmap/Superlite-Imports.md): an unattended Maker decides product
// questions alone, and before this only its diff showed what it chose. It now
// logs each decision the spec did not settle in carja/1-workbench/rulings.md:
//   - [YYYY-MM-DD HH:MM] <task id> · <decision> · why: <reason> · if wrong: low|medium|high · <what breaks>
// The driver reads the new lines after each beat. Every ruling goes in the PR
// body, a `high` one also goes to the inbox (owner D4: the run continues), and
// the Checker receives them as review input. Code cannot force a Maker to log a
// decision; the format is parsed and checked.

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  parseRulings,
  newRulings,
  rulingInboxLines,
  rulingsPrBody,
  rulingsForChecker,
  RULINGS_REL,
} from "../src/loop/rulings.js";
import { UNION_PATHS } from "../src/gitattributes.js";
import { renderAssignment } from "../src/loop/harvester.js";

const LOG = [
  "# Rulings",
  "",
  "- [2026-10-19 14:02] task:a · Empty results show a sentence, not an empty table · why: the spec says nothing about zero rows · if wrong: low · a user sees text instead of a table",
  "- [2026-10-19 14:05] task:a · Expired tokens refresh silently · why: re-login mid-conversation loses the question · if wrong: high · a revoked account keeps access for up to an hour",
  "- a free-form note that is not a ruling",
].join("\n");

test("parseRulings reads well-formed lines and ignores the rest", () => {
  const r = parseRulings(LOG);
  assert.equal(r.length, 2);
  assert.deepEqual(r[1], {
    at: "2026-10-19 14:05",
    task: "task:a",
    decision: "Expired tokens refresh silently",
    why: "re-login mid-conversation loses the question",
    risk: "high",
    breaks: "a revoked account keeps access for up to an hour",
    line: LOG.split("\n")[3],
  });
});

test("a ruling with an unknown risk level counts as high, so it is never hidden", () => {
  const [r] = parseRulings("- [2026-10-19 14:05] task:a · Drop the audit trail · why: speed · if wrong: catastrophic · data loss");
  assert.equal(r.risk, "high");
});

test("newRulings returns only the lines a beat added", () => {
  const before = LOG.split("\n").slice(0, 3).join("\n");
  const added = newRulings(before, LOG);
  assert.equal(added.length, 1);
  assert.equal(added[0].risk, "high");
  assert.deepEqual(newRulings(LOG, LOG), []);
  assert.equal(newRulings("", LOG).length, 2);
});

test("only a high ruling reaches the inbox", () => {
  const lines = rulingInboxLines(parseRulings(LOG));
  assert.equal(lines.length, 1);
  assert.match(lines[0], /high-risk ruling/);
  assert.match(lines[0], /Expired tokens refresh silently/);
  assert.match(lines[0], /revoked account/);
});

test("the PR body lists every ruling, high ones first", () => {
  const body = rulingsPrBody(parseRulings(LOG), "Opened by carja loop.");
  assert.match(body, /Opened by carja loop\./);
  assert.match(body, /## Decisions the Maker made alone \(2\)/);
  assert.ok(body.indexOf("Expired tokens") < body.indexOf("Empty results"));
  assert.equal(rulingsPrBody([], "base"), "base");
});

test("the Checker receives the rulings as data, with the rule that a contradiction is a finding", () => {
  const text = rulingsForChecker(parseRulings(LOG));
  assert.match(text, /contradicts the spec/);
  assert.match(text, /DATA/); // inside the untrusted envelope
  assert.match(text, /Expired tokens refresh silently/);
  assert.equal(rulingsForChecker([]), "");
});

test("rulings.md merges with union, like the other append-only logs", () => {
  assert.ok(UNION_PATHS.includes(RULINGS_REL));
});

test("the assignment tells a fleet Maker how to log a ruling, with its task id", () => {
  const text = renderAssignment({ id: "bugfix:x", type: "bugfix", title: "Fix x" });
  assert.match(text, /rulings\.md/);
  assert.match(text, /bugfix:x · <decision>/);
});
