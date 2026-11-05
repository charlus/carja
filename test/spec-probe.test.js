// test/spec-probe.test.js
//
// O4 — verify the live system before the spec is written.
//
// Four retrospectives in two projects, spread over four months, asked for the
// same thing and none of them reached the framework:
//   2026-03-13  an API type code was trusted from its label ("HR" was 144, not 4)
//   2026-06-22  a new ID format was introduced and three sibling endpoints missed
//   2026-07-14  consumers authenticated differently than assumed; the CI config
//               silently skipped the whole unit suite ("read conftest.py early")
//   2026-07-24  "the original source mapping was wrong and survived ~4 months in
//               the specs" — "run live API + credential discovery up front"
// Carve and Spec-It had no step that turns an assumption about the outside
// world into a fact, and Retrospective's only route for a workflow lesson was
// "note it for future framework updates", which has no destination.
//
// Three decisions pinned here:
//   * Spec-It probes BEFORE Phase 1 writes the Feature Spec, and the spec
//     carries the result as `Verified:` / `Assumed:` lines, so a reader can
//     tell a checked fact from a guess.
//   * Carve's per-slice cross-check asks whether what the slice relies on
//     exists TODAY in the source system, not in the blueprint.
//   * Retrospective routes workflow lessons to the ship-log's
//     `Framework lesson` line (see test/ship-tail.test.js), which one grep
//     finds across every project.
//
// Structural on prose. It proves the step is in the instructions, not that an
// agent runs it — whether wrong-assumption rework stops is read from the
// `Surprised:` lines that ships write from now on.

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = new URL("..", import.meta.url).pathname;
const wf = (name) => readFileSync(join(ROOT, "templates", ".agents", "workflows", name), "utf8");
const SPEC_IT = wf("spec-it.md");
const CARVE = wf("carve.md");
const RETRO = wf("retrospective.md");
const FEATURE_SPEC = readFileSync(
  join(ROOT, "templates", "carja", "5-templates", "carve-workflow", "feature-spec.md"),
  "utf8",
);

const PROBE = "Probe the live system";

describe("O4 — Spec-It turns external assumptions into facts before writing the spec", () => {
  test("a probe step exists and comes before Phase 1", () => {
    const probe = SPEC_IT.indexOf(PROBE);
    const phase1 = SPEC_IT.indexOf("## Phase 1");
    assert.ok(probe >= 0, `spec-it.md has no "${PROBE}" step`);
    assert.ok(phase1 >= 0, "spec-it.md lost Phase 1");
    assert.ok(probe < phase1, "the probe step sits after Phase 1 — the spec is written on assumptions");
  });

  test("the probe names the four assumption classes the retros paid for", () => {
    const step = SPEC_IT.slice(SPEC_IT.indexOf(PROBE), SPEC_IT.indexOf("## Phase 1"));
    for (const needle of [/API/i, /auth/i, /CI/, /test (harness|runner|command|config)|conftest/i]) {
      assert.match(step, needle, `probe step does not mention ${needle}`);
    }
  });

  test("the probe records Verified vs Assumed, and the spec template has a home for it", () => {
    const step = SPEC_IT.slice(SPEC_IT.indexOf(PROBE), SPEC_IT.indexOf("## Phase 1"));
    assert.match(step, /Verified:/, "probe step never writes `Verified:`");
    assert.match(step, /Assumed:/, "probe step never writes `Assumed:`");
    assert.match(FEATURE_SPEC, /## External Assumptions/, "feature-spec.md has no External Assumptions section");
    assert.match(FEATURE_SPEC, /Verified:/);
    assert.match(FEATURE_SPEC, /Assumed:/);
  });
});

describe("O4 — Carve asks whether the slice's dependencies exist today", () => {
  test("Phase 3's cross-check reads the source system, not the blueprint", () => {
    const phase3 = CARVE.slice(CARVE.indexOf("## Phase 3"), CARVE.indexOf("## Phase 4"));
    assert.ok(phase3.length > 0, "carve.md lost Phase 3");
    assert.match(phase3, /exist(s)? today/i, "Phase 3 never asks whether the field/endpoint exists today");
    assert.match(phase3, /source system|live system|read the (code|schema|API)/i,
      "Phase 3 does not tell the agent where to look for the answer");
  });
});

describe("O4 — Retrospective's workflow lessons have a destination", () => {
  test("Process Updates routes to the ship-log's Framework lesson line", () => {
    const section = RETRO.slice(RETRO.indexOf("### Process Updates"));
    assert.ok(section.length > 0, "retrospective.md lost the Process Updates section");
    assert.match(section, /Framework lesson/, "Process Updates still ends in 'note it for future framework updates'");
    assert.doesNotMatch(section, /note it for future framework updates/, "the dead-end phrasing is still there");
  });
});
