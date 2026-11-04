// test/ship-log-status.test.js
//
// O5 — the ship-log's age is on the daily screen.
//
// The two-month gap in every project's ship-log (test/ship-tail.test.js) was
// found by hand: the last `## YYYY-MM-DD` heading against `git log --merges`
// since that date. Nobody runs that by hand twice, and `carja status`
// exists precisely so the daily question costs zero tokens. So the digest now
// carries the ship-log summary and the status screen shows it, and the same
// digest reports whether the push gate has a verify command at all (O6) —
// four of five live projects had none, so `pre-push` was skipping silently.
//
// Merges are counted in THE REPO STATUS IS RUN IN and labelled so. The
// maintainer keeps some projects' state in a wrapper repo with the team's
// code as a nested, ignored clone; there the count is the wrapper's own and
// reads as such. An unlabelled number there would mislead, a labelled one is
// honest, and the framework does not model the maintainer's layouts.
//
// Fixtures mirror the REAL ship-log shape the Ship workflow writes — dated
// `## ` headings, the waiver lines the hooks append, and the legacy pipe-table
// preamble the old template shipped — because tidy fixtures hid three shipped
// bugs before (see memory: tidy-fixtures-hide-bugs).

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import {
  SHIP_LOG_REL,
  summariseShipLog,
  buildState,
  collectState,
} from "../src/carja-state.js";
import { renderStatus } from "../src/view/status.js";

const DAY = 24 * 60 * 60 * 1000;

// The shape a live project actually has: the old template's table preamble,
// then Ship-written entries, then a hook-appended waiver line.
const REAL_SHAPE = `# Ship Log

## How to Use

| Date | Release Name | Type | Impact |
|------|--------------|------|--------|
| 2024-01-15 | Auth v1 | Feat | Users can now sign in |

## Your Ship Log

## 2026-07-10 — Handover Duplicate Obligations Fix (per-user)
- **What:** Applied the same dedup to handovers.
- **Quality:** \`tests/unit\` green (37).
- **Platform:** MR !31 merged to \`main\`.

## 2026-07-16 — Monthly Update: stale-ended obligations
- **What:** Stop nagging for ended engagements.
- **Platform:** MR !37 merged.

## 2026-07-15 — Define Use Cases Modal Top-Alignment Fix
- **What:** Follow-up to the merged portal fix.

- ⚠️ 2026-08-02T10:11:12Z TDD waived: generated migration — no test surface
`;

describe("summariseShipLog — the pure half", () => {
  test("counts dated entries and finds the LATEST date even when entries are out of order", () => {
    const now = Date.UTC(2026, 8, 15); // 2026-09-15
    const s = summariseShipLog(REAL_SHAPE, { now });
    assert.equal(s.entries, 3, "the table row and the waiver line are not entries");
    assert.equal(s.lastDate, "2026-07-16", "07-15 is listed last but 07-16 is the latest");
    assert.equal(s.ageDays, 61);
  });

  test("a log with no dated heading reports null, not zero", () => {
    const s = summariseShipLog("# Ship Log\n\n(nothing yet)\n", { now: Date.UTC(2026, 8, 15) });
    assert.equal(s.entries, 0);
    assert.equal(s.lastDate, null);
    assert.equal(s.ageDays, null);
  });

  test("an empty or missing log is handled the same way", () => {
    assert.deepEqual(summariseShipLog("", { now: 0 }), { entries: 0, lastDate: null, ageDays: null });
    assert.deepEqual(summariseShipLog(undefined, { now: 0 }), { entries: 0, lastDate: null, ageDays: null });
  });
});

describe("buildState — the digest carries ship-log and push-gate facts", () => {
  const now = Date.UTC(2026, 8, 15);
  const base = { root: "/repo", projectName: "repo", now };

  test("digest.shipLog has entries, lastDate, ageDays and the labelled merge count", () => {
    const s = buildState({ ...base, shipLogMd: REAL_SHAPE, mergesSinceShipLog: 103 });
    assert.deepEqual(s.digest.shipLog, {
      entries: 3,
      lastDate: "2026-07-16",
      ageDays: 61,
      mergesSince: 103,
      // A4: the real-shaped fixture predates the two-block entry, so it has no
      // `Decide` line and nothing is waiting on the human.
      openDecisions: [],
    });
  });

  test("digest.verify says whether the push gate has a command", () => {
    const off = buildState({ ...base, verifyCommand: null });
    assert.deepEqual(off.digest.verify, { state: "unset", configured: false, command: null });
    const on = buildState({ ...base, verifyCommand: "npm test" });
    assert.deepEqual(on.digest.verify, { state: "set", configured: true, command: "npm test" });
    const declared = buildState({ ...base, verifyCommand: "none" });
    assert.deepEqual(
      declared.digest.verify,
      { state: "none", configured: false, command: null },
      "a declared OFF is its own state — never a command to run, never a warning",
    );
    const blank = buildState({ ...base, verifyCommand: "   " });
    assert.equal(blank.digest.verify.configured, false, "whitespace is not a command");
  });

  test("defaults are honest nulls when nothing was read", () => {
    const s = buildState(base);
    assert.deepEqual(s.digest.shipLog, { entries: 0, lastDate: null, ageDays: null, mergesSince: null, openDecisions: [] });
    assert.deepEqual(s.digest.verify, { state: "unset", configured: false, command: null });
  });
});

describe("renderStatus — the screen shows both lines", () => {
  const now = Date.UTC(2026, 8, 15);
  const plain = (state) => renderStatus(state, { color: false });

  test("a stale log with merges since reads as a warning, with the repo label", () => {
    const s = buildState({ root: "/repo", projectName: "repo", now, shipLogMd: REAL_SHAPE, mergesSinceShipLog: 103 });
    const out = plain(s);
    assert.match(out, /Ship-log/);
    assert.match(out, /2026-07-16/);
    assert.match(out, /61d/);
    assert.match(out, /103 merges? in this repo since/i, "the merge count must be labelled as this repo's");
  });

  test("no dated entry is said plainly, and a missing verify command is a loud line", () => {
    const s = buildState({ root: "/repo", projectName: "repo", now, shipLogMd: "# Ship Log\n", verifyCommand: null });
    const out = plain(s);
    assert.match(out, /Ship-log\s+no dated entry/i);
    assert.match(out, /Push gate/);
    assert.match(out, /OFF/, "the line must say the gate is off, in one word");
    // Naming the key was not enough: measured 2026-09-16, the reader could not
    // act on it. The line now carries the command that fixes it.
    assert.match(out, /carja verify --set /, "the fix must be a command, not a key to find");
  });

  test("a configured verify command is shown verbatim", () => {
    const s = buildState({ root: "/repo", projectName: "repo", now, verifyCommand: ".venv/bin/python -m pytest -q" });
    assert.match(plain(s), /Push gate\s+\.venv\/bin\/python -m pytest -q/);
  });

  test("--json carries the same fields (the digest is the contract)", () => {
    const s = buildState({ root: "/repo", projectName: "repo", now, shipLogMd: REAL_SHAPE, verifyCommand: "npm test" });
    const j = JSON.parse(JSON.stringify(s.digest));
    assert.equal(j.shipLog.lastDate, "2026-07-16");
    assert.equal(j.verify.command, "npm test");
  });
});

describe("collectState — the IO half reads the real files and counts real merges", () => {
  const git = (cwd, ...args) =>
    execFileSync("git", args, { cwd, stdio: ["ignore", "pipe", "ignore"], env: { ...process.env, GIT_AUTHOR_DATE: "", GIT_COMMITTER_DATE: "" } })
      .toString()
      .trim();

  async function scaffold(shipLog, config) {
    const root = await mkdtemp(join(tmpdir(), "carja-shiplog-"));
    await mkdir(join(root, "carja", "0-compass"), { recursive: true });
    await mkdir(join(root, "carja", "1-workbench"), { recursive: true });
    await writeFile(join(root, "carja", "1-workbench", "inbox.md"), "# Inbox\n");
    if (shipLog !== null) await writeFile(join(root, SHIP_LOG_REL), shipLog);
    if (config !== null) await writeFile(join(root, "carja.config.json"), JSON.stringify(config));
    return root;
  }

  /** A repo with `n` merge commits dated `when` (ISO), after one base commit dated before the log. */
  function repoWithMerges(root, n, when) {
    git(root, "init", "-q", "-b", "main");
    git(root, "config", "user.email", "t@example.com");
    git(root, "config", "user.name", "t");
    git(root, "config", "commit.gpgsign", "false");
    const env = (date) => ({ ...process.env, GIT_AUTHOR_DATE: date, GIT_COMMITTER_DATE: date });
    const commit = (msg, date, file) => {
      execFileSync("sh", ["-c", `echo ${msg} >> ${file}`], { cwd: root });
      execFileSync("git", ["add", "."], { cwd: root });
      execFileSync("git", ["commit", "-q", "-m", msg], { cwd: root, env: env(date) });
    };
    commit("base", "2026-07-01T00:00:00Z", "a.txt");
    for (let i = 0; i < n; i++) {
      execFileSync("git", ["checkout", "-q", "-b", `f${i}`], { cwd: root });
      commit(`f${i}`, when, `f${i}.txt`);
      execFileSync("git", ["checkout", "-q", "main"], { cwd: root });
      execFileSync("git", ["merge", "-q", "--no-ff", "-m", `Merge f${i}`, `f${i}`], { cwd: root, env: env(when) });
    }
  }

  test("counts merges after the last entry date and reads the verify command", async () => {
    const root = await scaffold(REAL_SHAPE, { verify: "npm test" });
    repoWithMerges(root, 3, "2026-09-01T00:00:00Z");
    const { ok, state } = await collectState(root, { now: Date.UTC(2026, 8, 15) });
    assert.ok(ok);
    assert.equal(state.digest.shipLog.lastDate, "2026-07-16");
    assert.equal(state.digest.shipLog.mergesSince, 3);
    assert.deepEqual(state.digest.verify, { state: "set", configured: true, command: "npm test" });
  });

  test("merges BEFORE the last entry are not counted", async () => {
    const root = await scaffold(REAL_SHAPE, null);
    repoWithMerges(root, 2, "2026-07-10T00:00:00Z");
    const { state } = await collectState(root, { now: Date.UTC(2026, 8, 15) });
    assert.equal(state.digest.shipLog.mergesSince, 0);
    assert.deepEqual(state.digest.verify, { state: "unset", configured: false, command: null }, "no config file → not configured");
  });

  test("outside a git repo the count is null, never a fake zero", async () => {
    const root = await scaffold(REAL_SHAPE, { verify: "" });
    const { state } = await collectState(root, { now: Date.UTC(2026, 8, 15) });
    assert.equal(state.digest.shipLog.mergesSince, null);
    assert.equal(state.digest.verify.configured, false, "an empty string is not a command");
  });

  test("no ship-log file at all → nulls, and status still renders", async () => {
    const root = await scaffold(null, null);
    const { state } = await collectState(root, { now: Date.UTC(2026, 8, 15) });
    assert.deepEqual(state.digest.shipLog, { entries: 0, lastDate: null, ageDays: null, mergesSince: null, openDecisions: [] });
    assert.match(renderStatus(state, { color: false }), /Ship-log\s+no dated entry/i);
  });
});
