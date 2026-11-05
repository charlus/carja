// test/loop-stack.test.js
//
// The stacked run's pure parts (src/loop/stack.js): how the recorded stack is
// checked against the forge (S5), where the next item starts, the MR command
// for a stacked MR, the start gate (S8) and the final report (S6). The run
// itself, through the real CLI: test/loop-stacked-run.test.js.

import { test } from "node:test";
import assert from "node:assert/strict";
import { reconcileStack, stackTop, renderStackReport, forgeBranchMr, closeMr, summaryFromBody } from "../src/loop/stack.js";
import { prCommand } from "../src/loop/merge.js";
import { missingOwnerDocs } from "../src/loop/blueprint.js";

const entry = (n, { code = true, base = null } = {}) => ({
  id: `slice:p/0${n}`,
  title: `slice 0${n}`,
  outer: { branch: `b${n}`, head: `o${n}`, url: `https://x/state/${n}` },
  code: code ? { branch: `b${n}`, head: `c${n}`, url: `https://x/code/${n}` } : null,
  base,
});
const open = (o, c) => ({ outer: { state: "open", head: o }, code: c === undefined ? null : { state: "open", head: c } });

test("reconcile: an untouched stack is kept as it is", () => {
  const s = [entry(0, { code: false }), entry(1, { base: { outer: "o0" } }), entry(2, { base: { outer: "o1", code: "c1" } })];
  const r = reconcileStack(s, [open("o0"), open("o1", "c1"), open("o2", "c2")]);
  assert.equal(r.keep.length, 3);
  assert.deepEqual(r.superseded, []);
});

test("reconcile: a closed MR is rebuilt with everything above it; what is below stays", () => {
  const s = [entry(1), entry(2, { base: { outer: "o1", code: "c1" } }), entry(3, { base: { outer: "o2", code: "c2" } })];
  const r = reconcileStack(s, [open("o1", "c1"), { outer: { state: "closed", head: "o2" }, code: { state: "open", head: "c2" } }, open("o3", "c3")]);
  assert.deepEqual(r.keep.map((e) => e.id), ["slice:p/01"]);
  assert.deepEqual(r.superseded.map((e) => e.id), ["slice:p/02", "slice:p/03"]);
  assert.match(r.notes[0], /slice 02: its MR was closed without a merge/);
});

test("reconcile: an MR that is gone counts as closed", () => {
  const r = reconcileStack([entry(1)], [{ outer: { state: null, head: null }, code: { state: "open", head: "c1" } }]);
  assert.equal(r.keep.length, 0);
  assert.equal(r.superseded.length, 1);
});

test("reconcile: an MR the owner changed is kept with its new head; the items above are rebuilt", () => {
  const s = [entry(1), entry(2, { base: { outer: "o1", code: "c1" } })];
  const r = reconcileStack(s, [open("o1", "c1-owner"), open("o2", "c2")]);
  assert.equal(r.keep.length, 1);
  assert.equal(r.keep[0].code.head, "c1-owner");
  assert.equal(r.keep[0].changed, true);
  assert.deepEqual(r.superseded.map((e) => e.id), ["slice:p/02"]);
  assert.match(r.notes.join("\n"), /you changed its MR[\s\S]*the item below it changed/);
});

test("reconcile: merged items are never touched, and the items above them stay", () => {
  const s = [entry(1), entry(2, { base: { outer: "o1", code: "c1" } })];
  const r = reconcileStack(s, [{ outer: { state: "merged", head: null }, code: { state: "merged", head: null } }, open("o2", "c2")]);
  assert.deepEqual(r.keep.map((e) => [e.id, Boolean(e.merged)]), [["slice:p/01", true], ["slice:p/02", false]]);
  assert.deepEqual(r.superseded, []);
});

test("the next item starts from the top of the stack; an item with no code passes the code base through", () => {
  assert.deepEqual(stackTop([]), { outer: null, code: null });
  const s = [entry(1), entry(2, { code: false })];
  assert.deepEqual(stackTop(s), { outer: { branch: "b2", head: "o2" }, code: { branch: "b1", head: "c1" } });
  assert.deepEqual(stackTop([{ ...entry(1), merged: true }]), { outer: null, code: null });
});

test("a stacked MR targets the branch below, is not squashed on merge, and deletes its source branch on GitLab", () => {
  const [, glab] = prCommand("glab", { branch: "b2", title: "t", body: "x", base: "b1", stacked: true });
  assert.deepEqual(glab.slice(glab.indexOf("--target-branch"), glab.indexOf("--target-branch") + 2), ["--target-branch", "b1"]);
  assert.ok(glab.includes("--remove-source-branch"));
  assert.ok(!glab.includes("--squash-before-merge"));
  const [, gh] = prCommand("gh", { branch: "b2", title: "t", body: "x", base: "b1", stacked: true });
  assert.deepEqual(gh.slice(gh.indexOf("--base"), gh.indexOf("--base") + 2), ["--base", "b1"]);
  // A run that is not stacked is unchanged.
  const [, plain] = prCommand("glab", { branch: "b", title: "t", body: "x" });
  assert.ok(plain.includes("--squash-before-merge"));
  assert.ok(!plain.includes("--target-branch"));
});

test("the forge's MR for a branch, on GitLab and GitHub; close says why", async () => {
  const calls = [];
  const glabRun = async (cmd, argv) => {
    calls.push([cmd, ...argv].join(" "));
    return { ok: true, stdout: JSON.stringify([{ iid: 7, state: "opened", web_url: "https://gl/mr/7", sha: "abc" }]) };
  };
  assert.deepEqual(await forgeBranchMr({ forge: "glab", run: glabRun, branch: "b 1" }), { state: "open", url: "https://gl/mr/7", head: "abc", id: "7" });
  assert.match(calls[0], /source_branch=b%201&state=all/);
  const ghRun = async () => ({ ok: true, stdout: JSON.stringify([{ number: 3, state: "MERGED", url: "https://gh/pr/3", headRefOid: "def" }]) });
  assert.equal((await forgeBranchMr({ forge: "gh", run: ghRun, branch: "b" })).state, "merged");
  assert.equal(await forgeBranchMr({ forge: "gh", run: async () => ({ ok: false, stdout: "" }), branch: "b" }), null);
  const closed = [];
  await closeMr({ forge: "glab", run: async (c, a) => (closed.push(a.join(" ")), { ok: true }), mr: { id: "7" }, comment: "why" });
  assert.match(closed.join("\n"), /merge_requests\/7\/notes -f body=why[\s\S]*state_event=close/);
});

test("S8: the owner's documents up to the Technical Vision, by plain name; a carved project is past the gate", () => {
  const docs = {
    "genesis/problem-solar-system.md": "x",
    "genesis/world-transformation.md": "x",
    "genesis/functional-animator.md": "x",
    "storyboard/main-character.md": "x",
    "storyboard/storyboard.md": "x",
    "blueprint/grand-prd.md": "x",
  };
  assert.deepEqual(missingOwnerDocs({ docs, templates: {} }).map((d) => d.name), ["UX/UI Design Brief", "Technical Vision"]);
  assert.deepEqual(missingOwnerDocs({ docs: {}, templates: {} }).map((d) => d.name), ["Genesis", "Storyboard", "Grand PRD", "UX/UI Design Brief", "Technical Vision"]);
  assert.deepEqual(missingOwnerDocs({ docs: {}, templates: {}, carved: true }), []);
});

test("S6: the report lists the open MRs in merge order, the decisions taken alone, where the run stopped, and the cost", () => {
  const e1 = { ...entry(1), summary: "the list", rulings: [{ risk: "high", decision: "sort by date", why: "the brief" }], cost_usd: 2.5 };
  const e2 = { ...entry(2), cost_usd: 1 };
  const text = renderStackReport({ project: "p", entries: [{ ...entry(0), merged: true }, e1, e2], stop: { status: "awaiting_answers", item: "slice 03", round: "carja/1-workbench/questions/" }, now: "2026-10-22T20:00:00Z" });
  assert.match(text, /Merge these MRs in this order \(2 items\)/);
  assert.match(text, /### 1\. slice 01\n\n- Code MR: https:\/\/x\/code\/1\n- Carja state MR: https:\/\/x\/state\/1\n- What it does: the list/);
  assert.match(text, /Decided for you \(overrule in the MR\):\n  - \*\*high\*\* sort by date: the brief/);
  assert.match(text, /### 2\. slice 02[\s\S]*Decided for you: nothing\./);
  assert.match(text, /slice 03 needs your decision on a one-way door[\s\S]*Nothing was built above it/);
  assert.match(text, /Total cost of the open items: ≈ \$3\.50/);
  assert.doesNotMatch(text, /slice 00/, "merged items are not listed");
});

test("the item's summary is the first line of the ship body's What changes for you", () => {
  assert.equal(summaryFromBody("## What changes for you\n- Writers see their notes by date.\n\n## Evidence\nx"), "Writers see their notes by date.");
  assert.equal(summaryFromBody(null), null);
});

test("I1: the report lists the Ship beat's owner actions and the driver's hints, without saying the same dependency twice", () => {
  const text = renderStackReport({
    project: "notes",
    entries: [{
      title: "slice 01",
      outer: { url: "https://x/2" },
      code: { url: "https://x/1" },
      ownerActions: ["Install the new dependency where the product runs: `pip install -r requirements.txt` (pins `holidays==0.58`)."],
      detected: [
        "Install the new dependency where the product runs: holidays 0.58 (pypi). The loop installed it in its own worktree only.",
        "Back up the database, then run the new migration where the product runs: `repo/alembic/versions/0042_x.py`.",
      ],
    }],
    stop: { status: "done" },
    now: "2026-10-23T08:12:00Z",
  });
  assert.match(text, /- Owner actions, around this merge:\n {2}- Install the new dependency where the product runs: `pip install -r requirements\.txt` \(pins `holidays==0\.58`\)\.\n {2}- Back up the database/);
  assert.equal((text.match(/Install the new dependenc/g) ?? []).length, 1);
});
