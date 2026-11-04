// test/loop-crossing2.test.js
//
// Second unattended crossing (evalapp-v2, 2026-10-19):
//   F10 the MR title was the backlog item's whole first line, over GitLab's
//       255-character limit.
//   F11 GitLab answered "source branch does not exist" a moment after the push.
//   F12 `.agents/.worktrees/` was not ignored, so `git add -A` would sweep the
//       loop's worktrees into a commit.
//   and: when verify is red in a fresh worktree, point at the CI file, where
//       the project's own test recipe usually lives.

import { test } from "node:test";
import assert from "node:assert/strict";
import { prTitle, openPullRequest } from "../src/loop/merge.js";
import { diagnose } from "../src/loop/doctor.js";

const ITEM = "Carja task task:p3-cover: **P3 — Cover MR !49's coverage strip and advisory banner with a component test.** (loop-ready) *(AC1, the \"Not Observed\" tri-state's fresh-form default, was the third part of this item and is **verified** — see below. Retitled 2026-08-03 to what actually remains.)* Neither the strip nor the banner is pinned by anything that renders it, and both are **conditional**.";

test("prTitle keeps the item's first sentence, without markdown or tags, within 120 characters", () => {
  const t = prTitle(ITEM);
  assert.ok(t.length <= 120, `${t.length}: ${t}`);
  assert.doesNotMatch(t, /\*\*|loop-ready|Retitled/);
  assert.match(t, /^Carja task task:p3-cover: P3 — Cover MR !49's coverage strip and advisory banner/);
});

test("prTitle cuts a long sentence at a word, with an ellipsis", () => {
  const t = prTitle(`Fix ${"very ".repeat(60)}long thing`);
  assert.ok(t.length <= 120);
  assert.match(t, /very…$/);
  assert.equal(prTitle("Short title"), "Short title");
});

test("openPullRequest sends the short title", async () => {
  let argv = null;
  await openPullRequest({
    branch: "b", title: ITEM, forge: "glab",
    git: async () => ({ ok: true, stdout: "" }),
    run: async (_c, a) => ((argv = a), { ok: true, stdout: "https://mr/1" }),
  });
  assert.ok(argv[argv.indexOf("--title") + 1].length <= 120);
});

test("openPullRequest retries once when the forge has not yet seen the pushed branch", async () => {
  let calls = 0;
  let slept = 0;
  const res = await openPullRequest({
    branch: "b", title: "t", forge: "glab",
    git: async () => ({ ok: true, stdout: "" }),
    run: async (_c, a) => {
      if (a[0] === "mr" && a[1] === "list") return { ok: true, stdout: "" };
      calls += 1;
      return calls === 1
        ? { ok: false, stdout: "", stderr: "400 {message: {source_branch: [does not exist]}}" }
        : { ok: true, stdout: "https://mr/2" };
    },
    sleep: async (ms) => { slept += ms; },
  });
  assert.equal(res.ok, true);
  assert.equal(res.prUrl, "https://mr/2");
  assert.equal(calls, 2);
  assert.ok(slept > 0);
});

test("openPullRequest does not retry an unrelated failure", async () => {
  let calls = 0;
  const res = await openPullRequest({
    branch: "b", title: "t", forge: "glab",
    git: async () => ({ ok: true, stdout: "" }),
    run: async (_c, a) => (a[1] === "list" ? { ok: true, stdout: "" } : ((calls += 1), { ok: false, stderr: "403 Forbidden" })),
    sleep: async () => {},
  });
  assert.equal(res.ok, false);
  assert.equal(calls, 1);
});

test("a red verify in a fresh worktree points at the CI file when there is one", () => {
  const facts = {
    state: { phase: "execution", autonomy_level: "L3", sandbox: "none" },
    preflightHalt: null,
    probe: { ran: true, setup: { configured: true, ok: true }, verify: { command: "npm test", exitCode: 1, tail: "no such table" } },
    ciFile: ".gitlab-ci.yml",
  };
  const c = diagnose(facts).find((x) => x.id === "verify");
  assert.match(c.fix, /\.gitlab-ci\.yml/);
});

test("the loop keeps its worktrees out of git status (scratch repo, real git)", async () => {
  const { mkdtemp, rm, mkdir, writeFile } = await import("node:fs/promises");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const { execFileSync } = await import("node:child_process");
  const { ensureWorktreesExcluded } = await import("../src/loop/worktree.js");
  const dir = await mkdtemp(join(tmpdir(), "wt-exclude-"));
  try {
    execFileSync("git", ["init", "-q"], { cwd: dir });
    await mkdir(join(dir, ".agents/.worktrees/x"), { recursive: true });
    await writeFile(join(dir, ".agents/.worktrees/x/f"), "x");
    assert.match(execFileSync("git", ["status", "--porcelain"], { cwd: dir }).toString(), /\.agents\//);
    await ensureWorktreesExcluded(dir);
    await ensureWorktreesExcluded(dir); // idempotent
    assert.equal(execFileSync("git", ["status", "--porcelain"], { cwd: dir }).toString(), "");
    const exclude = execFileSync("git", ["rev-parse", "--git-path", "info/exclude"], { cwd: dir }).toString().trim();
    const text = (await import("node:fs")).readFileSync(join(dir, exclude), "utf8");
    assert.equal(text.split("\n").filter((l) => l === ".agents/.worktrees/").length, 1);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
