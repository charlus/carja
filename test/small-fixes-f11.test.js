// test/small-fixes-f11.test.js
//
// F11 — small defects seen in real usage (2026-10).
//   - Ship archived only from carja/1-workbench/. Carve puts slices under
//     2-backlog/project-backlog/<P>/implementations/, so 18 shipped slices in
//     autopportunity were never archived until the owner asked.
//   - how-it-works sent "I know exactly what to build" to Quick-Path OR Spec-It,
//     but Spec-It requires Carve. The product owner ran /spec-it twice on
//     uncarved features and the agent reversed its own recommendation.
//   - `"eval": "none"` was not understood: a repository whose evals are run by
//     hand (website-cms) got the "not enforced" notice on every push.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const AG = join(new URL("..", import.meta.url).pathname, "templates", ".agents");
const read = (...p) => readFileSync(join(AG, ...p), "utf8");

test("Ship archives the slice from wherever it lives", () => {
  const archive = read("workflows", "ship.md").split("3.  **Archive:**")[1].split("---")[0];
  assert.match(archive, /project-backlog\/[^`]*implementations/);
  assert.match(archive, /1-workbench/);
});

test("routing: an uncarved feature goes to Quick-Path, and Spec-It hands it over", () => {
  const how = read("how-it-works.md");
  assert.doesNotMatch(how, /I know exactly what to build"\* → \*\*Quick-Path\*\* or \*\*Spec-It\*\*/);
  const spec = read("workflows", "spec-it.md");
  assert.match(spec, /no Implementation folder[^.]*Quick-Path|Quick-Path[^.]*no Implementation folder/i);
});

test('pre-push understands "eval": "none" as a declared opt-out', () => {
  const push = read("hooks", "pre-push");
  assert.match(push, /eval_cmd" = "none"/);
});
