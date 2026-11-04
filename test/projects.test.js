// test/projects.test.js
//
// D1, D2 (2026-10-20): the owner finds the projects, their stage and whether
// the loop is on, in `carja status` and in `carja loop on` without a name.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { describeProject, renderProjects } from "../src/projects.js";

const tpl = (rel) => readFileSync(new URL(`../templates/carja/5-templates/${rel}`, import.meta.url), "utf8");
const TEMPLATES = {
  "genesis/problem-solar-system.md": tpl("genesis-workflow/problem-solar-system-template.md"),
  "genesis/world-transformation.md": tpl("genesis-workflow/world-transformation-template.md"),
  "genesis/functional-animator.md": tpl("genesis-workflow/functional-animator-template.md"),
  "storyboard/main-character.md": tpl("storyboard-workflow/main-character-template.md"),
  "storyboard/storyboard.md": tpl("storyboard-workflow/storyboard-template.md"),
  "blueprint/grand-prd.md": tpl("blueprint-workflows/grand-prd.md"),
  "blueprint/ux-ui-design-brief.md": tpl("blueprint-workflows/ux-ui-design-brief.md"),
  "blueprint/technical-vision.md": tpl("blueprint-workflows/technical-vision.md"),
  "blueprint/implementation-overview.md": tpl("carve-workflow/implementation-overview.md"),
};
const DISCOVERY = Object.fromEntries(["genesis/problem-solar-system.md", "genesis/world-transformation.md", "genesis/functional-animator.md", "storyboard/main-character.md", "storyboard/storyboard.md"].map((k) => [k, `# ${k}\n\ntext\n`]));
const base = { templates: TEMPLATES, carved: false, openSlices: [], oldLayout: false, loopOn: {} };

test("each project's stage, read as the loop reads it", () => {
  const km = describeProject({ ...base, name: "km", docs: { ...DISCOVERY, "blueprint/grand-prd.md": "# PRD\n\nx\n", "blueprint/ux-ui-design-brief.md": "# Brief\n\nx\n" } });
  assert.deepEqual([km.stage, km.canTurnOn, km.loop], ["Blueprint 2 of 4 (Technical Vision next)", true, "loop off"]);
  assert.equal(describeProject({ ...base, name: "kb", docs: {} }).stage, "no Discovery yet (yours: /genesis, /storyboard)");
  assert.equal(describeProject({ ...base, name: "perf", docs: {}, oldLayout: true }).canTurnOn, false);
  const carved = describeProject({ ...base, name: "c", docs: {}, carved: true, openSlices: ["02-b", "03-c"], loopOn: { slices: true } });
  assert.deepEqual([carved.stage, carved.loop], ["2 slices open (next: 02-b)", "loop on (slices)"]);
  assert.equal(describeProject({ ...base, name: "d", docs: {}, carved: true }).stage, "every slice shipped");
  assert.match(renderProjects([km, carved]), /^ {2}Projects\n {4}km +Blueprint 2 of 4/);
});

test("`carja status` lists the projects; `carja loop on` without a name lists the ones it can turn on and the next command", () => {
  const REPO = new URL("..", import.meta.url).pathname;
  const root = mkdtempSync(join(tmpdir(), "projects-"));
  try {
    execFileSync("node", [join(REPO, "bin/carja.js"), "init", root, "--all", "--no-detect"], { stdio: "pipe" });
    execFileSync("git", ["init", "-q"], { cwd: root });
    const p = join(root, "carja/2-backlog/project-backlog");
    for (const [rel, text] of Object.entries(DISCOVERY)) {
      mkdirSync(join(p, "notes", rel, ".."), { recursive: true });
      writeFileSync(join(p, "notes", rel), text);
    }
    mkdirSync(join(p, "later"), { recursive: true });
    writeFileSync(join(p, "later/project-documentation.md"), "# later\n");
    const cli = (...a) => {
      try {
        return execFileSync("node", [join(REPO, "bin/carja.js"), ...a], { cwd: root, stdio: ["ignore", "pipe", "pipe"] }).toString();
      } catch (e) {
        return `${e.stdout}${e.stderr}`;
      }
    };
    const status = cli("status", "--no-color");
    assert.match(status, /Projects\n.*later +no Discovery yet[\s\S]*notes +Blueprint 0 of 4 \(Grand PRD next\) +· loop off/);
    const list = cli("loop", "on");
    assert.match(list, /notes +Blueprint 0 of 4/);
    assert.match(list, /Next: `carja loop on notes`/);
    const elsewhere = execFileSync("node", [join(REPO, "bin/carja.js"), "loop", "on", root], { cwd: tmpdir(), stdio: ["ignore", "pipe", "pipe"] }).toString();
    assert.match(elsewhere, /notes +Blueprint 0 of 4/, "a lone path is the folder");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
