// test/loop-stacked-run.test.js
//
// The stacked run (owner, 2026-10-22): "I run the Discovery up to the Technical
// Vision. Then I run the loop on the result and it executes all the steps and
// workflows, and ships the thing I asked to ship." The real CLI, in the outer
// layout (the code nested at repo/), with the stub engine and a stub `gh` that
// remembers its PRs (test/fixtures/stub-forge/gh). No model is called.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, writeFileSync, rmSync, existsSync } from "node:fs";
import { join } from "node:path";
import { execFileSync } from "node:child_process";

import { REPO, G, OWNER_DOCS, layout, loop } from "./helpers/stacked-layout.js";

const prs = (l) => JSON.parse(readFileSync(l.db, "utf8")).prs;
const stack = (l) => JSON.parse(readFileSync(join(l.root, ".git/carja-loop-logs/runs/notes/stack.json"), "utf8"));
const isCode = (pr) => pr.repo.endsWith("code.git");

test("S8: the loop starts only after the owner's approved Technical Vision, and names what is missing", () => {
  const l = layout({ docs: OWNER_DOCS.filter((d) => d !== "blueprint/technical-vision.md") });
  try {
    const r = loop(l, ["notes"]);
    assert.equal(r.status, 1, r.stdout + r.stderr);
    assert.match(r.stdout, /^notes: not started\. The loop starts after you approve the Technical Vision, and master does not have the Technical Vision yet/);
    assert.equal(existsSync(l.db), false, "nothing was opened");
  } finally {
    rmSync(l.base, { recursive: true, force: true });
  }
});

test("one command builds the Carve and every slice, stacked; a closed MR is rebuilt with everything above it", () => {
  const l = layout();
  try {
    const outerMaster = G(l.root, "rev-parse", "master");
    const codeMain = G(l.code, "rev-parse", "main");
    const r = loop(l, ["notes"]);
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.match(r.stdout, /^notes: the Carve\.\nEach item starts from the one below it/);
    assert.match(r.stdout, /Budget: each item gets up to 20 beats and 10 minutes/);

    // Four items, in order: the Carve, then three slices.
    const s = stack(l);
    assert.deepEqual(s.map((e) => e.title), ["the Carve", "slice 01-slice-1", "slice 02-slice-2", "slice 03-slice-3"]);
    assert.equal(s[0].code, null, "the Carve has no code MR");
    // Each MR targets the branch of the item below it, in both repositories.
    const all = prs(l);
    const outer = all.filter((p) => !isCode(p));
    const code = all.filter(isCode);
    assert.equal(outer.length, 4);
    assert.equal(code.length, 3);
    assert.deepEqual(outer.map((p) => p.base), [null, s[0].outer.branch, s[1].outer.branch, s[2].outer.branch]);
    assert.deepEqual(code.map((p) => p.base), [null, s[1].code.branch, s[2].code.branch]);
    assert.match(outer[2].body, /Stacked run:\*\* this MR is built on https:\/\/example\.invalid\/pr\/\d+/);
    // Each slice's code is one commit on top of the slice below.
    G(l.code, "fetch", "-q", "origin");
    assert.equal(G(l.code, "rev-list", "--count", `origin/${s[1].code.branch}..origin/${s[2].code.branch}`), "1");
    assert.equal(G(l.code, "rev-list", "--count", `origin/main..origin/${s[1].code.branch}`), "1");
    // Slice 3 carries the code of slices 1 and 2.
    const files = G(l.code, "ls-tree", "-r", "--name-only", `origin/${s[3].code.branch}`).split("\n");
    for (const f of ["src/built.js", "src/built-2.js", "src/built-3.js"]) assert.ok(files.includes(f), `${f} in slice 3`);
    // Nothing on the owner's branches; nothing left in the folder.
    assert.equal(G(l.root, "rev-parse", "master"), outerMaster);
    assert.equal(G(l.code, "rev-parse", "main"), codeMain);
    const wts = join(l.root, ".agents/.worktrees");
    assert.deepEqual(existsSync(wts) ? readdirSync(wts) : [], []);
    // S6: one report, in merge order.
    const report = readFileSync(join(l.root, "carja/1-workbench/loop-report-notes.md"), "utf8");
    assert.match(report, /Merge these MRs in this order \(4 items\)[\s\S]*### 1\. the Carve[\s\S]*### 2\. slice 01-slice-1[\s\S]*### 4\. slice 03-slice-3/);
    assert.match(report, /Every item of the project is built/);

    // Run again: nothing to build, nothing opened.
    const again = loop(l, ["notes"], "prompts-2");
    assert.equal(again.status, 0, again.stdout + again.stderr);
    assert.match(again.stdout, /^notes: nothing left to build\. On top of 4 item\(s\) already waiting for your merge\./);
    assert.equal(prs(l).length, 7);

    // S5: the owner closes slice 2's state MR.
    const db = JSON.parse(readFileSync(l.db, "utf8"));
    db.prs.find((p) => p.url === s[2].outer.url).state = "CLOSED";
    writeFileSync(l.db, JSON.stringify(db));
    const rebuilt = loop(l, ["notes"], "prompts-3");
    assert.equal(rebuilt.status, 0, rebuilt.stdout + rebuilt.stderr);
    assert.match(rebuilt.stdout, /slice 02-slice-2: its MR was closed without a merge/);
    const after = prs(l);
    const byUrl = (u) => after.find((p) => p.url === u);
    // Slice 1 and the Carve untouched; slice 2's code MR and slice 3's MRs closed by the loop.
    for (const e of s.slice(0, 2)) assert.equal(byUrl(e.outer.url).state, "OPEN");
    assert.equal(byUrl(s[1].code.url).state, "OPEN");
    assert.equal(byUrl(s[2].code.url).state, "CLOSED");
    for (const u of [s[3].outer.url, s[3].code.url]) assert.equal(byUrl(u).state, "CLOSED");
    // Slices 2 and 3 built again, with new MRs on the same stack.
    const s2 = stack(l);
    assert.deepEqual(s2.map((e) => e.title), s.map((e) => e.title));
    assert.equal(s2[1].outer.url, s[1].outer.url);
    assert.notEqual(s2[2].outer.url, s[2].outer.url);
    assert.notEqual(s2[3].outer.url, s[3].outer.url);
    assert.equal(after.length, 11);
    assert.deepEqual(after.slice(7).filter((p) => !isCode(p)).map((p) => p.base), [s[1].outer.branch, s[2].outer.branch]);

    // The owner pushes a fix onto slice 2's code branch: it is kept, slice 3 is built again on top.
    const fix = join(l.base, "fix");
    execFileSync("git", ["clone", "-q", "-b", s2[2].code.branch, join(l.base, "code.git"), fix], { stdio: "pipe" });
    G(fix, "config", "user.email", "o@o");
    G(fix, "config", "user.name", "o");
    writeFileSync(join(fix, "owner-fix.py"), "fixed = True\n");
    G(fix, "add", "-A");
    G(fix, "commit", "-qm", "owner fix");
    G(fix, "push", "-q", "origin", s2[2].code.branch);
    const onTop = loop(l, ["notes"], "prompts-4");
    assert.equal(onTop.status, 0, onTop.stdout + onTop.stderr);
    assert.match(onTop.stdout, /slice 02-slice-2: you changed its MR\. Your version is kept/);
    const s3 = stack(l);
    assert.equal(s3[2].outer.url, s2[2].outer.url, "slice 2 kept");
    assert.notEqual(s3[3].code.url, s2[3].code.url, "slice 3 rebuilt");
    G(l.code, "fetch", "-q", "origin");
    assert.ok(G(l.code, "ls-tree", "-r", "--name-only", `origin/${s3[3].code.branch}`).split("\n").includes("owner-fix.py"), "slice 3 is built on the owner's fix");
  } finally {
    rmSync(l.base, { recursive: true, force: true });
  }
});
