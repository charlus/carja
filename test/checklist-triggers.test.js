// test/checklist-triggers.test.js
//
// F24 (docs/roadmap/Risk-Tiered-Merge.md): the Claude Code team's reliability
// checklist has 39 items, each with a trigger read from the diff; a review
// checks only the 3 to 10 whose trigger matches. A checklist item may carry
// `trigger: <glob>, <glob>`; an item without one always applies.

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync, spawnSync } from "node:child_process";

import { parseChecklist, applicableItems, renderApplicable } from "../src/checklist.js";

const MD = `# Architecture Checklist

## Schema

- **A column whose migration sets a server_default declares it in the model.**
  A Python default is not enough.
  trigger: \`repo/migrations/versions/**\`, \`**/nexus_models.py\`
- **Never stamp head.** Fix forward.

## Scheduler

- [ ] Every add_job sets misfire_grace_time.
      trigger: repo/src/services/scheduler.py
      check: \`true\`
`;

test("items keep their section, lines and triggers; an item without a trigger has none", () => {
  const items = parseChecklist(MD);
  assert.equal(items.length, 3);
  assert.deepEqual(items.map((i) => i.section), ["Schema", "Schema", "Scheduler"]);
  assert.deepEqual(items[0].trigger, ["repo/migrations/versions/**", "**/nexus_models.py"]);
  assert.equal(items[1].trigger, null);
  assert.deepEqual(items[2].trigger, ["repo/src/services/scheduler.py"]);
  assert.match(items[0].text, /A Python default is not enough/);
});

test("only the items whose trigger matches the diff apply; items without a trigger always do", () => {
  const items = parseChecklist(MD);
  const a = applicableItems(items, ["repo/src/database/nexus_models.py", "README.md"]);
  assert.deepEqual(a.applies.map((i) => i.section), ["Schema", "Schema"]);
  assert.equal(a.skipped, 1);
  const none = applicableItems(items, ["docs/x.md"]);
  assert.equal(none.applies.length, 1, "the untriggered item");
});

test("the rendering says how many were left out and keeps each item's lines", () => {
  const items = parseChecklist(MD);
  const text = renderApplicable(applicableItems(items, ["repo/src/services/scheduler.py"]));
  assert.match(text, /2 of 3 checklist items apply to this diff; 1 left out by its trigger/);
  assert.match(text, /## Scheduler\n\n- \[ \] Every add_job sets misfire_grace_time\.\n {6}trigger: repo\/src\/services\/scheduler\.py\n {6}check: `true`/);
  assert.doesNotMatch(text, /server_default/);
});

test("carja checklist prints the items that apply to the files given", () => {
  const d = mkdtempSync(join(tmpdir(), "checklist-"));
  try {
    execFileSync("git", ["init", "-q"], { cwd: d });
    mkdirSync(join(d, "carja/0-compass"), { recursive: true });
    writeFileSync(join(d, "carja/0-compass/architecture-checklist.md"), MD);
    const r = spawnSync("node", [new URL("../bin/carja.js", import.meta.url).pathname, "checklist", "--files", "repo/migrations/versions/abc.py"], { cwd: d, encoding: "utf8" });
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /2 of 3 checklist items apply/);
    assert.match(r.stdout, /server_default/);
    assert.doesNotMatch(r.stdout, /misfire_grace_time/);
  } finally {
    rmSync(d, { recursive: true, force: true });
  }
});

test("the loop's Checker gets only the items whose trigger matches the item's diff, from the base", async () => {
  const { layout, loop, G: g } = await import("./helpers/stacked-layout.js");
  const { readdirSync, readFileSync, rmSync: rm } = await import("node:fs");
  const l = layout({ carved: 1, prefix: "checklist-loop-" });
  try {
    mkdirSync(join(l.root, "carja/0-compass"), { recursive: true });
    writeFileSync(join(l.root, "carja/0-compass/architecture-checklist.md"), "# Architecture Checklist\n\n- MATCHED-ITEM built code is reviewed.\n  trigger: repo/src/**\n- SKIPPED-ITEM billing stays decimal.\n  trigger: repo/billing/**\n- ALWAYS-ITEM no secrets in logs.\n");
    g(l.root, "add", "-A");
    g(l.root, "commit", "-qm", "checklist");
    g(l.root, "push", "-q", "origin", "master");
    const r = loop(l, ["notes"]);
    assert.equal(r.status, 0, r.stdout + r.stderr);
    const prompts = readdirSync(join(l.base, "prompts")).map((f) => readFileSync(join(l.base, "prompts", f), "utf8"));
    const checker = prompts.filter((p) => /checklist items apply to this diff/.test(p));
    assert.ok(checker.length >= 1, "a Checker prompt carries the selected items");
    assert.ok(checker.every((p) => /MATCHED-ITEM/.test(p) && /ALWAYS-ITEM/.test(p) && !/SKIPPED-ITEM/.test(p)));
    assert.match(checker[0], /2 of 3 checklist items apply to this diff/);
  } finally {
    rm(l.base, { recursive: true, force: true });
  }
});
