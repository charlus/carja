// test/loop-run-lessons.test.js
//
// The lessons of the two stacked runs on autopportunity (owner, 2026-10-23),
// through the real CLI in the outer layout, with the stub engine and the stub
// forge (test/helpers/stacked-layout.js). No model, forge or registry is called:
// the dependency gate reads canned registry answers (CARJA_REGISTRY_FIXTURE).
//   I2  a usage limit with a reset time: the run waits and goes on
//   I3  a conflict only in Carja documents is merged; one in code stops
//   I4  a dependency the Technical Vision names passes and is installed; any other is a question
//   I5  a leftover folder at the worktree's path is moved aside, never deleted
//   I6  the owner's folder stays clean: `git status` shows nothing after a run
//   I1  the report names the owner's actions around each merge

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { REPO, G, layout, loop } from "./helpers/stacked-layout.js";

const P = "carja/2-backlog/project-backlog/notes";
const SLICE = "01-slice-1";
const report = (l) => readFileSync(join(l.root, "carja/1-workbench/loop-report-notes.md"), "utf8");
const events = (l) => readFileSync(join(l.root, ".git/carja-loop-logs/events.ndjson"), "utf8").split("\n").filter(Boolean).map((x) => JSON.parse(x));
const prs = (l) => (existsSync(l.db) ? JSON.parse(readFileSync(l.db, "utf8")).prs : []);
const clean = (l) => {
  assert.equal(G(l.root, "status", "--porcelain"), "", "the owner's folder is clean");
  assert.equal(G(l.code, "status", "--porcelain"), "", "the owner's code checkout is clean");
};

function withConfig(l, edit) {
  const p = join(l.root, "carja.config.json");
  const cfg = JSON.parse(readFileSync(p, "utf8"));
  edit(cfg);
  writeFileSync(p, JSON.stringify(cfg, null, 2));
  G(l.root, "commit", "-qam", "config");
  G(l.root, "push", "-q", "origin", "master");
}
function visionNames(l, text) {
  writeFileSync(join(l.root, P, "blueprint/technical-vision.md"), `# Technical Vision\n\n${text}\n`);
  G(l.root, "commit", "-qam", "vision");
  G(l.root, "push", "-q", "origin", "master");
}
function registry(l, routes) {
  const p = join(l.base, "registry.json");
  writeFileSync(p, JSON.stringify(routes));
  return p;
}
const OLD_CLEAN = (sys, name, v) => [
  [`api.deps.dev/v3/systems/${sys}/packages/${name}/versions/${v}`, { json: { publishedAt: "2024-10-07T17:47:46Z", isDeprecated: false } }],
  ["api.osv.dev", { body: `"${name}"`, json: {} }],
];

test("I2 + I5 + I6: a usage limit is waited out, a leftover folder is moved aside, and the owner's folder stays clean", () => {
  const l = layout({ carved: 1, prefix: "lessons-a-" });
  try {
    // Tonight's leftover: a plain folder with carja/ files where the slice's worktree goes.
    const leftover = join(l.root, ".agents/.worktrees/loop-slice-notes-01-slice-1/carja/1-workbench");
    mkdirSync(leftover, { recursive: true });
    writeFileSync(join(leftover, "loop-state.json"), '{"left":"over"}\n');
    const r = loop(l, ["notes"], "prompts", { STUB_LIMIT_ONCE: join(l.base, "limit-hit"), CARJA_QUOTA_MARGIN_S: "0" });
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.match(r.stdout, /usage limit reached\. Waiting until \d\d:\d\d for it to reset, then the same beat runs again/);
    assert.ok(events(l).some((e) => e.type === "quota_wait"), "the wait is in the event log for watch");
    assert.match(r.stdout, /a leftover folder sat where its worktree goes\. Moved aside to .*carja-loop-logs\/leftovers\//);
    const moved = readdirSync(join(l.root, ".git/carja-loop-logs/leftovers"));
    assert.equal(moved.length, 1);
    assert.equal(readFileSync(join(l.root, ".git/carja-loop-logs/leftovers", moved[0], "carja/1-workbench/loop-state.json"), "utf8"), '{"left":"over"}\n');
    assert.equal(prs(l).length, 2, "the slice's code and state MRs");
    assert.match(report(l), /Every item of the project is built/);
    // I7: watch says where the project is, and why the run stopped.
    const w = spawnSync("node", [join(REPO, "bin/carja.js"), "watch", "--once"], { cwd: l.root, encoding: "utf8" });
    assert.match(w.stdout, /notes: slice 01-slice-1 — 1 of 1/);
    assert.match(w.stdout, /Last stop \d\d:\d\d: every item is built: merge the MRs in the order of the loop report\./);
    clean(l);
  } finally {
    rmSync(l.base, { recursive: true, force: true });
  }
});

test("I4 + I1: a dependency the Technical Vision names is checked and installed, and the report says to install it", () => {
  const l = layout({ carved: 1, prefix: "lessons-b-" });
  try {
    visionNames(l, "Public holidays come from the `holidays` package.");
    withConfig(l, (c) => (c.loop.install = "touch installed-by-the-gate"));
    const fixture = registry(l, OLD_CLEAN("pypi", "holidays", "0.58"));
    const r = loop(l, ["notes"], "prompts", { STUB_DEP: "requirements.txt:holidays==0.58", CARJA_REGISTRY_FIXTURE: fixture });
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.match(r.stdout, /holidays 0\.58 passed the dependency gate\. Installing with loop\.install \(outside the sandbox\)/);
    assert.ok(events(l).some((e) => e.type === "dependency" && e.name === "holidays" && e.ok), "the check is recorded");
    assert.match(report(l), /Owner actions, around this merge:\n {2}- Install the new dependency where the product runs: holidays 0\.58 \(pypi\)/);
    clean(l);
  } finally {
    rmSync(l.base, { recursive: true, force: true });
  }
});

test("I4: a dependency the Technical Vision does not name stops the slice with a question; allowed, the run goes on", () => {
  const l = layout({ carved: 1, prefix: "lessons-c-" });
  try {
    withConfig(l, (c) => (c.loop.install = "touch installed-by-the-gate"));
    const fixture = registry(l, OLD_CLEAN("pypi", "left-pad", "1.3.0"));
    const env = { STUB_DEP: "requirements.txt:left-pad==1.3.0", CARJA_REGISTRY_FIXTURE: fixture };
    const r = loop(l, ["notes"], "prompts", env);
    assert.equal(r.status, 0, r.stdout + r.stderr);
    const round = join(l.root, "carja/1-workbench/questions/slice-notes-01-slice-1.md");
    const text = readFileSync(round, "utf8");
    assert.match(text, /## Q1\. New dependency: pypi left-pad/);
    assert.match(text, /pypi\.org\/project\/left-pad\/1\.3\.0/);
    assert.equal(prs(l).length, 0, "nothing opened before the owner answers");
    assert.match(report(l), /needs your decision on a one-way door/);
    clean(l);
    // The owner allows it.
    writeFileSync(round, text.replace(/^Answer:\s*$/m, "Answer: 1"));
    const again = loop(l, ["notes"], "prompts-2", env);
    assert.equal(again.status, 0, again.stdout + again.stderr);
    assert.match(again.stdout, /left-pad 1\.3\.0 passed the dependency gate/);
    assert.equal(prs(l).length, 2);
    clean(l);
  } finally {
    rmSync(l.base, { recursive: true, force: true });
  }
});

test("I3: another project's change to a Carja document is merged with both sides kept; a code conflict stops", () => {
  const l = layout({ carved: 1, prefix: "lessons-d-" });
  try {
    const r = loop(l, ["notes"], "prompts", { STUB_RACE_OUTER: join(l.base, "outer.git") });
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.equal(prs(l).length, 2, "the MRs open");
    assert.match(report(l), /Carja documents merged from both sides, read them before you merge: `carja\/4-context\/meta\/glossary\.md`/);
    const s = JSON.parse(readFileSync(join(l.root, ".git/carja-loop-logs/runs/notes/stack.json"), "utf8"));
    G(l.root, "fetch", "-q", "origin");
    const doc = G(l.root, "show", `origin/${s[0].outer.branch}:carja/4-context/meta/glossary.md`);
    assert.match(doc, /KM: knowledge manager, written by this slice\n- CoP: a community of practice, written by another project/);
    clean(l);
  } finally {
    rmSync(l.base, { recursive: true, force: true });
  }
  const c = layout({ carved: 1, prefix: "lessons-e-" });
  try {
    const r = loop(c, ["notes"], "prompts", { STUB_RACE_CODE: join(c.base, "code.git") });
    assert.equal(r.status, 1, r.stdout + r.stderr);
    assert.match(readFileSync(join(c.root, "carja/1-workbench/loop-messages.md"), "utf8"), /would conflict on merge — repo\/app\.py/);
    assert.equal(prs(c).length, 0);
    clean(c);
  } finally {
    rmSync(c.base, { recursive: true, force: true });
  }
});
