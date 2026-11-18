// test/pre-existing-findings.test.js
//
// F12 (docs/roadmap/Risk-Tiered-Merge.md): Anthropic found that 59% of what its
// reviewer kept flagging predated the change under review. A PRE-EXISTING
// finding is a defect the diff did not introduce: it never withholds APPROVE,
// the author is not asked to fix it, and the loop records it so it is not lost.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { parseCheckerVerdict, preExistingFindings, preExistingLine } from "../src/loop/checker.js";

const verdict = (findings, approved = true) => JSON.stringify({ approved, reason: "r", findings });
const OLD = { severity: "PRE-EXISTING", file: "src/old.js", line: 12, quote: "eval(input)", class: "security — eval of user input" };

test("a PRE-EXISTING finding does not count as a blocker: the approval stands", () => {
  const v = parseCheckerVerdict(verdict([OLD]));
  assert.equal(v.approved, true);
  assert.equal(v.provenBlockers, 0);
});

test("pre-existing findings are picked out, in either spelling, and nothing else", () => {
  const list = [OLD, { ...OLD, severity: "pre_existing", file: "b.js" }, { severity: "BLOCKER", file: "c.js" }, { severity: "NIT" }, null];
  assert.deepEqual(preExistingFindings(list).map((f) => f.file), ["src/old.js", "b.js"]);
});

test("the recorded line names the place, the class and the quote", () => {
  assert.equal(preExistingLine(OLD), "src/old.js:12 — security — eval of user input — `eval(input)`");
});

test("the reviewer brief and the caller's half define PRE-EXISTING as never blocking", () => {
  const reviewer = readFileSync(new URL("../templates/.agents/skills/independent-review/reviewer.md", import.meta.url), "utf8");
  const skill = readFileSync(new URL("../templates/.agents/skills/independent-review/SKILL.md", import.meta.url), "utf8");
  assert.match(reviewer, /\*\*PRE-EXISTING\*\*/);
  assert.match(reviewer, /git blame/);
  assert.match(skill, /\| \*\*PRE-EXISTING\*\* \|/);
});

test("the review log accepts a PRE-EXISTING finding, so its share can be measured", async () => {
  const { normalizeFinding } = await import("../src/commands/review-log.js");
  const r = normalizeFinding({ round: 1, severity: "PRE-EXISTING", category: "security", file: "src/old.js", line: 12, action: "known-gap" });
  assert.equal(r.ok, true, r.error);
});
