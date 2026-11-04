// test/build-needs-spec.test.js
//
// D6 (2026-10-21): a worker given "implement slice 01" built from
// project-documentation.md, because Build only checked that feature-spec.md and
// implementation-plan.md exist, and Carve creates both as blank templates. A
// template still holding its placeholders must count as missing, so Build
// routes to Spec-It. Advisory in interactive use; the loop enforces it in code
// (src/loop/slices.js isBlankDoc, spec_ready).

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { isBlankDoc } from "../src/loop/slices.js";

const build = readFileSync(new URL("../templates/.agents/workflows/build.md", import.meta.url), "utf8");
const prereq = build.slice(build.indexOf("## Prerequisites"), build.indexOf("## Behavioral Rules"));

test("Build's prerequisites treat a blank carved template as missing, and route to Spec-It", () => {
  assert.match(prereq, /exist \*\*and are written\*\*/);
  assert.match(prereq, /placeholders.*\*\*missing\*\*/s);
  assert.match(prereq, /No Implementation Plan\?\*\* → Run \*\*Spec-It\*\*/);
});

test("the placeholder the text names is really in the carved templates, so the rule is checkable", () => {
  const tpl = readFileSync(new URL("../templates/carja/5-templates/carve-workflow/feature-spec.md", import.meta.url), "utf8");
  assert.ok(/\[Implementation Name\]/.test(tpl) || isBlankDoc(tpl, tpl));
  assert.equal(isBlankDoc(tpl, tpl), true, "the loop's own check agrees: an untouched template is blank");
});
