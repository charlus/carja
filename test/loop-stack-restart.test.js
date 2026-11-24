// test/loop-stack-restart.test.js
//
// Ctrl+C, then the same command again (owner, 2026-11-24): "I do CTRL+C and then
// close my laptop, go home and re-run the loop expecting it to resume where it
// got interrupted. But not close open MRs." On 2026-11-23 a restart closed four
// built, approved MRs of agentic-content-os and rebuilt them: the item below
// the first open one was merged, and the stack check compared against it.
// The real CLI in the outer layout, the stub engine (hanging in one Build beat
// so the test can stop it) and the stub `gh`. No model is called.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, writeFileSync, rmSync, existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { spawn, execFileSync } from "node:child_process";

import { REPO, G, layout, loop } from "./helpers/stacked-layout.js";

const prs = (l) => JSON.parse(readFileSync(l.db, "utf8")).prs;
const stack = (l) => JSON.parse(readFileSync(join(l.root, ".git/carja-loop-logs/runs/notes/stack.json"), "utf8"));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Start the loop as a terminal does (its own process group), stop it with Ctrl+C in slice `slice`'s Build beat. */
async function runAndInterrupt(l, slice, log) {
  const mark = join(l.base, `hang-${slice}`);
  const child = spawn("node", [join(REPO, "bin/carja.js"), "loop", "notes"], {
    cwd: l.root,
    detached: true,
    stdio: ["ignore", "pipe", "pipe"],
    env: { ...process.env, PATH: `${l.bin}:${process.env.PATH}`, STUB_LOG_DIR: join(l.base, log), STUB_CODE_DIR: "repo", STUB_SLICES: "3", STUB_FORGE_DB: l.db, CARJA_HOME: join(l.base, "home"), STUB_HANG: `${slice}:${mark}` },
  });
  let out = "";
  child.stdout.on("data", (d) => (out += d));
  child.stderr.on("data", (d) => (out += d));
  const exited = new Promise((r) => child.on("close", (code, signal) => r({ code, signal })));
  for (let i = 0; i < 1200 && !existsSync(mark); i++) await sleep(100);
  assert.ok(existsSync(mark), `the run never reached ${slice}'s Build beat:\n${out}`);
  const t0 = Date.now();
  process.kill(-child.pid, "SIGINT");
  const end = await exited;
  return { ...end, out, stopMs: Date.now() - t0 };
}

/** The owner merges `head` into `base` on the forge: a merge commit, as GitLab does. */
function forgeMerge(bare, base, head) {
  const env = { ...process.env, GIT_AUTHOR_NAME: "o", GIT_AUTHOR_EMAIL: "o@o", GIT_COMMITTER_NAME: "o", GIT_COMMITTER_EMAIL: "o@o" };
  const git = (...a) => execFileSync("git", ["--git-dir", bare, ...a], { env, stdio: "pipe" }).toString().trim();
  const commit = git("commit-tree", git("rev-parse", `${head}^{tree}`), "-p", `refs/heads/${base}`, "-p", head, "-m", `Merge ${head}`);
  git("update-ref", `refs/heads/${base}`, commit);
}

const specBeats = (l, slice) =>
  readdirSync(l.base)
    .filter((d) => d.startsWith("prompts"))
    .flatMap((d) => readdirSync(join(l.base, d)).filter((f) => f.endsWith(".txt")).map((f) => readFileSync(join(l.base, d, f), "utf8")))
    .filter((p) => p.includes("# Spec assignment (this beat)") && p.includes(slice)).length;

test("Ctrl+C in the middle of an item stops at once; the same command resumes it and closes nothing", async () => {
  const l = layout({ prefix: "stack-restart-" });
  try {
    const stopped = await runAndInterrupt(l, "02-slice-2", "prompts-1");
    assert.equal(stopped.code, 130, stopped.out);
    assert.ok(stopped.stopMs < 15000, `Ctrl+C took ${stopped.stopMs} ms`);
    const before = stack(l);
    assert.deepEqual(before.map((e) => e.title), ["the Carve", "slice 01-slice-1"]);

    const again = loop(l, ["notes"], "prompts-2");
    assert.equal(again.status, 0, again.stdout + again.stderr);
    assert.doesNotMatch(again.stdout, /builds? it again|closed without a merge|item below it changed/);
    const after = stack(l);
    assert.deepEqual(after.map((e) => e.title), ["the Carve", "slice 01-slice-1", "slice 02-slice-2", "slice 03-slice-3"]);
    for (const i of [0, 1]) assert.deepEqual(after[i].outer, before[i].outer, "built items kept as they were");
    // The interrupted item continues: its spec, written before Ctrl+C, is not written again.
    assert.equal(specBeats(l, "02-slice-2"), 1);
    assert.ok(!prs(l).some((p) => p.state === "CLOSED" || p.comments), "no MR closed or noted");
  } finally {
    rmSync(l.base, { recursive: true, force: true });
  }
});

test("a restart after the owner merged the items below keeps the stack built on the default branch (2026-11-23)", async () => {
  const l = layout({ prefix: "stack-restart-merged-" });
  try {
    const stopped = await runAndInterrupt(l, "02-slice-2", "prompts-1");
    assert.equal(stopped.code, 130, stopped.out);
    // At home, before the restart, the owner merges the Carve and slice 1.
    const s = stack(l);
    forgeMerge(join(l.base, "outer.git"), "master", s[1].outer.head);
    forgeMerge(join(l.base, "code.git"), "main", s[1].code.head);
    const db = JSON.parse(readFileSync(l.db, "utf8"));
    for (const p of db.prs) p.state = "MERGED";
    writeFileSync(l.db, JSON.stringify(db));

    // Restart: slices 2 and 3 are built on the default branch.
    const built = loop(l, ["notes"], "prompts-2");
    assert.equal(built.status, 0, built.stdout + built.stderr);
    const s2 = stack(l);
    assert.deepEqual(s2.map((e) => [e.title, Boolean(e.merged)]), [["the Carve", true], ["slice 01-slice-1", true], ["slice 02-slice-2", false], ["slice 03-slice-3", false]]);

    // Restart again (another Ctrl+C, another evening): nothing is rebuilt, nothing closed.
    const again = loop(l, ["notes"], "prompts-3");
    assert.equal(again.status, 0, again.stdout + again.stderr);
    assert.match(again.stdout, /^notes: nothing left to build\. On top of 2 item\(s\) already waiting for your merge\./m);
    assert.doesNotMatch(again.stdout, /builds? it again|item below it changed/);
    assert.deepEqual(stack(l).map((e) => e.outer), s2.map((e) => e.outer));
    assert.ok(!prs(l).some((p) => p.state === "CLOSED" || p.comments), "no MR closed or noted");
  } finally {
    rmSync(l.base, { recursive: true, force: true });
  }
});
