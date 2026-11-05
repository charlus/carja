// test/fresh-session-workflows.test.js
//
// The planning chain runs one workflow per session. A fresh session knows
// nothing, so each step must (1) end by printing the next command WITH the
// folder to read, and (2) start by reading a folder given to it instead of
// asking. Before this, Carve, Technical Vision and Build named no project at
// all — they relied on the old conversation already knowing it.
//
// Structural, and honest about it: this proves the instructions are present.
// Whether a fresh agent follows them is proven by a live run, not here.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const AGENTS = fileURLToPath(new URL("../templates/.agents", import.meta.url));
const TEMPLATES = fileURLToPath(new URL("../templates", import.meta.url));
const wf = (name) => readFileSync(join(AGENTS, "workflows", `${name}.md`), "utf8");

// Each step and the step a fresh session runs next.
const CHAIN = [
  ["genesis", "storyboard"],
  ["storyboard", "grand-prd"],
  ["grand-prd", "ux-ui-design-brief"],
  ["ux-ui-design-brief", "technical-vision"],
  ["technical-vision", "carve"],
  ["carve", "spec-it"],
  ["spec-it", "build"],
];

function section(text, heading) {
  const start = text.search(heading);
  assert.ok(start >= 0, `no section matching ${heading}`);
  const rest = text.slice(start + 1);
  const next = rest.search(/\n## /);
  return next < 0 ? rest : rest.slice(0, next);
}

for (const [step, next] of CHAIN) {
  test(`${step} ends by giving the fresh-session command for /${next} with a path`, () => {
    assert.ok(existsSync(join(AGENTS, "workflows", `${next}.md`)), `${next} is a real workflow`);
    const done = section(wf(step), /\n## Completion/);
    assert.match(done, /`\/clear`/);
    assert.match(done, new RegExp("`/" + next + " carja/2-backlog/project-backlog/\\[ProjectName\\]"));
    assert.match(done, /handoff\.md/);
  });
}

for (const [, receiver] of CHAIN) {
  test(`${receiver} reads the folder it was started with, and its handoff.md`, () => {
    const setup = section(wf(receiver), /\n## Phase 0/);
    assert.match(setup, /started with a path/);
    assert.match(setup, /do not ask/);
    assert.match(setup, /handoff\.md/);
  });
}

test("every workflow that reads a handoff.md removes it, so it never goes stale", () => {
  for (const [, receiver] of CHAIN) {
    assert.match(wf(receiver), /[Dd]elete (any `handoff\.md` you read|it once its items are handled)/, receiver);
  }
});

test("the handoff skill no longer tells agents to run the whole chain in one session", () => {
  const skill = readFileSync(join(AGENTS, "skills", "handoff", "SKILL.md"), "utf8");
  assert.doesNotMatch(skill, /do it in one session/);
  assert.match(skill, /## Between workflows/);
});

// A3: the Genesis metaphor vocabulary is gone. File names are unchanged on
// purpose (existing installs keep their documents); only the one note that maps
// the old names for older documents may still use them.
test("Genesis metaphor terms appear only in the note for older documents", () => {
  const files = [
    ".agents/workflows/genesis.md", ".agents/workflows/storyboard.md", ".agents/workflows/grand-prd.md",
    ".agents/workflows/technical-vision.md", ".agents/workflows/carve.md", ".agents/how-it-works.md",
    ".agents/skills/independent-review/SKILL.md",
    "carja/5-templates/genesis-workflow/problem-solar-system-template.md",
    "carja/5-templates/genesis-workflow/world-transformation-template.md",
    "carja/5-templates/genesis-workflow/functional-animator-template.md",
    "carja/5-templates/blueprint-workflows/grand-prd.md",
  ];
  const TERMS = /\bSun\b|Satellite|[Oo]rbit|Solar System|Functional Animator|World Transformation|Holy Trinity/;
  for (const rel of files) {
    const lines = readFileSync(join(TEMPLATES, rel), "utf8").split("\n");
    for (const line of lines) {
      if (line.startsWith("**Older documents:**")) continue;
      assert.doesNotMatch(line, TERMS, `${rel}: ${line.slice(0, 80)}`);
    }
  }
  assert.match(wf("genesis"), /\*\*Older documents:\*\*.*\*Sun\* = core problem/);
});
