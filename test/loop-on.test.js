// test/loop-on.test.js
//
// `carja loop on <project>` / `off <project>`: the owner turns the loop on
// for a project with one command, never by writing JSON (owner decision
// 2026-10-20). The planner names each change in plain words; the command asks
// once, then writes carja.config.json and loop-state.json.

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { planLoopOn, planLoopOff } from "../src/loop/enable.js";

const AUTOPPORTUNITY = {
  project: "km-workload-relief",
  projects: ["km-workload-relief", "kb-api-v2"],
  discoveryDone: true,
  carved: false,
  config: { verify: "none", repos: { repo: { verify: "pytest tests/unit" } } },
  state: { phase: "discovery", autonomy_level: "L1", sandbox: "none", platform: null },
  nestedRepos: ["repo/", "video/"],
  envDirs: [".venv"],
  claudeOnPath: true,
};

test("on autopportunity's layout: Blueprint and slices, the code repository from `repos`, the other one ignored, the venv linked, an L3 sandboxed run", () => {
  const p = planLoopOn(AUTOPPORTUNITY);
  assert.equal(p.ok, true, p.error);
  assert.deepEqual(p.config.loop.blueprint, ["km-workload-relief"]);
  assert.deepEqual(p.config.loop.slices, ["km-workload-relief"]);
  assert.equal(p.config.loop.code_dir, "repo");
  assert.equal(p.config.loop.allow_nested_repo, true);
  assert.equal(p.config.loop.setup, 'ln -sfn "$CARJA_CODE_ROOT/.venv" .venv');
  assert.deepEqual([p.state.phase, p.state.autonomy_level, p.state.sandbox, p.state.platform], ["execution", "L3", "cli-native", "claude"]);
  assert.equal(p.config.repos.repo.verify, "pytest tests/unit", "nothing else in the config is touched");
  assert.ok(p.changes.some((c) => /video\//.test(c)));
  assert.ok(p.changes.every((c) => !/[{}]/.test(c)), "every change is in plain words, not JSON");
  assert.deepEqual(p.notes, []);
  const named = planLoopOn({ ...AUTOPPORTUNITY, stagesDone: ["Grand PRD", "UX/UI Brief"] });
  assert.match(named.changes[0], /Technical Vision and Carve for km-workload-relief \(you wrote the Grand PRD and UX\/UI Brief\)/);
});

test("a second run changes nothing; a carved project gets slices only; no Discovery is refused with what to do", () => {
  const again = planLoopOn({ ...AUTOPPORTUNITY, config: planLoopOn(AUTOPPORTUNITY).config, state: planLoopOn(AUTOPPORTUNITY).state });
  assert.deepEqual(again.changes, []);
  assert.match(again.notes.join(), /already on/);
  const carved = planLoopOn({ ...AUTOPPORTUNITY, carved: true });
  assert.equal(carved.config.loop.blueprint, undefined);
  assert.deepEqual(carved.config.loop.slices, ["km-workload-relief"]);
  const early = planLoopOn({ ...AUTOPPORTUNITY, discoveryDone: false });
  assert.equal(early.ok, false);
  assert.match(early.error, /\/genesis/);
  assert.match(planLoopOn({ ...AUTOPPORTUNITY, project: "nope" }).error, /Projects: km-workload-relief, kb-api-v2/);
});

test("several nested repositories and none in `repos`: it asks which, with the command", () => {
  const p = planLoopOn({ ...AUTOPPORTUNITY, config: {}, nestedRepos: ["a/", "b/"] });
  assert.equal(p.ok, false);
  assert.match(p.error, /--code-dir a/);
  assert.equal(planLoopOn({ ...AUTOPPORTUNITY, config: {}, nestedRepos: ["a/", "b/"], codeDirFlag: "b" }).config.loop.code_dir, "b");
});

test("no test command for the code repository: a note with the command that sets it", () => {
  const p = planLoopOn({ ...AUTOPPORTUNITY, config: { repos: {} }, nestedRepos: ["repo/"] });
  assert.match(p.notes.join(), /carja verify --repo repo --detect/);
});

test("off takes the project out of the Blueprint and the slices, and nothing else", () => {
  const on = planLoopOn(AUTOPPORTUNITY).config;
  const off = planLoopOff({ project: "km-workload-relief", config: on });
  assert.deepEqual([off.config.loop.blueprint, off.config.loop.slices], [[], []]);
  assert.equal(off.config.loop.code_dir, "repo");
  assert.match(planLoopOff({ project: "x", config: {} }).changes[0], /was not on/);
});

// ---- the command, through the real CLI ----------------------------------------

test("`carja loop on <project> --yes` writes the plan; without --yes and without a terminal it only shows it", () => {
  const REPO = new URL("..", import.meta.url).pathname;
  const root = mkdtempSync(join(tmpdir(), "loop-on-"));
  try {
    execFileSync("node", [join(REPO, "bin/carja.js"), "init", root, "--all", "--no-detect"], { stdio: "pipe" });
    execFileSync("git", ["init", "-q"], { cwd: root });
    const p = join(root, "carja/2-backlog/project-backlog/notes");
    for (const rel of ["genesis/problem-solar-system.md", "genesis/world-transformation.md", "genesis/functional-animator.md", "storyboard/main-character.md", "storyboard/storyboard.md"]) {
      mkdirSync(join(p, rel, ".."), { recursive: true });
      writeFileSync(join(p, rel), `# ${rel}\n\nWriters keep notes.\n`);
    }
    const run = (...a) => {
      try {
        return { code: 0, out: execFileSync("node", [join(REPO, "bin/carja.js"), "loop", ...a], { cwd: root, stdio: ["ignore", "pipe", "pipe"] }).toString() };
      } catch (e) {
        return { code: e.status, out: `${e.stdout}${e.stderr}` };
      }
    };
    const shown = run("on", "notes");
    assert.equal(shown.code, 2, shown.out);
    assert.match(shown.out, /The loop may write the Grand PRD, UX\/UI Brief, Technical Vision and Carve for notes/);
    assert.match(shown.out, /--yes/);
    assert.equal(JSON.parse(readFileSync(join(root, "carja.config.json"), "utf8")).loop?.blueprint, undefined, "nothing written without consent");

    const done = run("on", "notes", "--yes");
    assert.equal(done.code, 0, done.out);
    assert.deepEqual(JSON.parse(readFileSync(join(root, "carja.config.json"), "utf8")).loop.blueprint, ["notes"]);
    assert.equal(JSON.parse(readFileSync(join(root, "carja/1-workbench/loop-state.json"), "utf8")).autonomy_level, "L3");
    assert.match(done.out, /Next:/);

    const off = run("off", "notes");
    assert.equal(off.code, 0, off.out);
    assert.deepEqual(JSON.parse(readFileSync(join(root, "carja.config.json"), "utf8")).loop.blueprint, []);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
