// From the autopportunity review (2026-10-06): twelve slices built, then 20
// production screenshots, 30 findings and five rework slices. The UX brief
// specified what each screen does, never how it is experienced; the design
// docs were a philosophy, not a system; unknown values were shown as answers;
// and nobody looked at a rendered screen before the product owner did.
//
//   A1  the UX brief specifies experience: layout and hierarchy, every state,
//       unknown values, a screen to match; the Designer challenges it
//   A2  DESIGN.md is a system: patterns, data display, reference screens
//   A3  the Designer's Review Lens: unknown shown as unknown, shared components
//   A4  a visual review of rendered screens exists, OFF by default: Build
//       mentions it once and runs it only when the product owner asks

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { DESIGN_SECTIONS, buildDesignMd } from "../src/design-md.js";

const T = join(import.meta.dirname, "..", "templates");
const read = (...p) => readFileSync(join(T, ...p), "utf8");

describe("A1 — the UX brief specifies experience, not only function", () => {
  const wf = read(".agents", "workflows", "ux-ui-design-brief.md");
  const tpl = read("carja", "5-templates", "blueprint-workflows", "ux-ui-design-brief.md");
  const phase3 = wf.slice(wf.indexOf("**Phase 3"), wf.indexOf("**Phase 4"));

  test("Phase 3 asks each screen for hierarchy, states, unknown values and a screen to match", () => {
    for (const re of [/hierarchy/i, /read.*edit|edit.*read/i, /empty/i, /status/i, /unknown/i, /screen to match|matches/i]) {
      assert.match(phase3, re, `Phase 3 does not ask for ${re}`);
    }
  });

  test("the template's screen section has a place for each", () => {
    const screen = tpl.slice(tpl.indexOf("## Screen-by-Screen"), tpl.indexOf("## Key Interactions"));
    for (const field of ["Layout & Hierarchy", "States", "Unknown and Empty Values", "Matches"]) {
      assert.match(screen, new RegExp(`\\*\\*${field}:\\*\\*`), `template screen lacks ${field}`);
    }
  });

  test("the Designer runs the Lens Pass on the brief before approval", () => {
    const assembly = wf.slice(wf.indexOf("## Phase 8"), wf.indexOf("## Completion Protocol"));
    assert.match(assembly, /Lens Pass[^\n]*personas\/designer\.md/);
  });
});

describe("A2 — DESIGN.md is a system, not a philosophy", () => {
  test("it has Patterns, Data Display and Reference Screens sections", () => {
    const titles = DESIGN_SECTIONS.map((s) => s.title);
    for (const t of ["Patterns", "Data Display", "Reference Screens"]) assert.ok(titles.includes(t), `${t} missing`);
  });

  test("the migration places a date or edit section where it belongs", () => {
    const { markdown } = buildDesignMd(
      { "notes.md": "## Date format\n\nDD/MM/YYYY everywhere.\n\n## Inline editing\n\nRead state first, Edit button.\n" },
      { source: "x" },
    );
    const at = (t) => markdown.indexOf(`## ${t}`);
    const dates = markdown.indexOf("DD/MM/YYYY");
    const edit = markdown.indexOf("Read state first");
    assert.ok(dates > at("Data Display") && dates < at("Brand Assets"), "date rule not under Data Display");
    assert.ok(edit > at("Patterns") && edit < at("Data Display"), "edit rule not under Patterns");
  });

  test("the design-system skill asks for patterns, data display and reference screens", () => {
    const skill = read(".agents", "skills", "design-system", "SKILL.md");
    assert.match(skill, /Patterns/);
    assert.match(skill, /Data Display/);
    assert.match(skill, /Reference Screens/);
  });
});

describe("A3 — the Designer's Review Lens", () => {
  const designer = read(".agents", "personas", "designer.md");
  const lens = designer.slice(designer.indexOf("## Review Lens"));

  test("an unknown value is shown as unknown, never as a default answer", () => {
    assert.match(lens, /unknown/i);
  });

  test("an element reuses the shared component DESIGN.md names", () => {
    assert.match(lens, /shared component/i);
  });
});

describe("A4 — the visual review is offered, never run by default", () => {
  const build = read(".agents", "workflows", "build.md");

  test("Build mentions the visual review once and runs it only on request", () => {
    assert.match(build, /visual review/i);
    assert.match(build, /off by default|skipped by default|not run by default/i);
    assert.match(build, /only (when|if) the (product owner|human|user) asks/i);
  });

  test("the how lives in one place", () => {
    const skill = read(".agents", "skills", "ux-reviewer", "SKILL.md");
    assert.match(skill, /## Visual Review/);
    assert.match(skill, /screenshot/i);
  });
});
