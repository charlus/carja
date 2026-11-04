// test/loop-questions.test.js
//
// Unattended Lifecycle step 4 (D1, D5): a stage that meets a one-way door does
// not stop the run and does not decide alone. It writes one round of numbered
// questions, each with options, a recommendation and the cost of a wrong
// choice; a fresh Checker confirms each is a real one-way door answerable cold;
// the item pauses while other work goes on; the owner answers by number; the
// next run resumes the item. `carja status` measures how often the owner
// takes the recommendation and overrules a ruling.

import { test } from "node:test";
import assert from "node:assert/strict";
import { parseRound, checkRound, roundAnswered, decisionStats, roundKey } from "../src/loop/questions.js";
import { runSwarm, normalizeTask } from "../src/loop/swarm.js";
import { renderAssignment } from "../src/loop/harvester.js";

const ROUND = `# Questions: slice:notes-app/02-sync (spec)

> Answer each question by writing an option number after \`Answer:\`, or \`your pick\`. Then run the loop again.

## Q1. Where do synced notes live?
Writers want their notes on every device. The spec does not say where the notes are stored between devices.

1. Our own server — every note reaches us; one more service to run and pay for.
2. The writer's own cloud drive — we store nothing; setup is harder for the writer.

**Recommendation:** 2, because the PRD promises "your notes stay yours".
**If wrong:** moving storage later means migrating every writer's notes.

Answer:

## Q2. Do deleted notes come back?
A deleted note can be kept for 30 days or removed at once.

1. Keep for 30 days — a writer can undo a mistake.
2. Remove at once — nothing lingers.

**Recommendation:** 1, because undo is cheap to offer and costly to add later.
**If wrong:** notes a writer wanted gone stay for a month.

Answer: 1
`;

test("parseRound reads each question, its options, recommendation, cost and answer", () => {
  const r = parseRound(ROUND);
  assert.equal(r.task, "slice:notes-app/02-sync");
  assert.equal(r.stage, "spec");
  assert.equal(r.questions.length, 2);
  assert.equal(r.questions[0].options.length, 2);
  assert.equal(r.questions[0].recommendation, "2");
  assert.match(r.questions[0].ifWrong, /migrating/);
  assert.equal(r.questions[0].answer, null);
  assert.equal(r.questions[1].answer, "1");
});

test("checkRound: a question without options, recommendation or cost fails the format, with a reason", () => {
  assert.deepEqual(checkRound(parseRound(ROUND)).reasons, []);
  const bad = parseRound("# Questions: t (build)\n\n## Q1. Which colour?\nPick one.\n\nAnswer:\n");
  const r = checkRound(bad);
  assert.equal(r.ok, false);
  assert.ok(r.reasons.some((x) => /options/.test(x)));
  assert.ok(r.reasons.some((x) => /Recommendation/.test(x)));
  assert.ok(r.reasons.some((x) => /If wrong/.test(x)));
  assert.equal(checkRound(parseRound("# nothing\n")).ok, false);
});

test("roundAnswered: every question needs a number or 'your pick'", () => {
  assert.equal(roundAnswered(parseRound(ROUND)), false);
  assert.equal(roundAnswered(parseRound(ROUND.replace("Answer:\n\n## Q2", "Answer: your pick\n\n## Q2"))), true);
  assert.equal(roundAnswered(parseRound(ROUND.replace("Answer:\n\n## Q2", "Answer: 7\n\n## Q2"))), false, "7 is not an option");
});

test("decisionStats counts overruled rulings and answers that took the recommendation", () => {
  const rulings =
    "- [2026-10-20 10:00] t · A · why: x · if wrong: low · y\n" +
    "- [2026-10-20 10:05] t · B · why: x · if wrong: high · y · overruled: users count don't as one word\n";
  // Q1 answered 1 against the recommendation 2; every other answer takes it ("your pick" included).
  const answered = [ROUND.replace("Answer:\n\n## Q2", "Answer: 1\n\n## Q2"), ROUND.replace("Answer:\n\n## Q2", "Answer: your pick\n\n## Q2")];
  const s = decisionStats({ rulingsText: rulings, answeredRounds: answered });
  assert.deepEqual(s, { rulings: 2, overruled: 1, answered: 4, tookRecommendation: 3 });
});

test("roundKey is a safe file name from the task id", () => {
  assert.equal(roundKey("slice:notes-app/02-sync"), "slice-notes-app-02-sync");
});

test("the assignment tells a resumed Maker where its answers are", () => {
  const t = renderAssignment({ id: "slice:p/02-x", type: "slice", title: "02-x", answered_round: "carja/1-workbench/questions/answered/slice-p-02-x.md" });
  assert.match(t, /answered/i);
  assert.match(t, /questions\/answered\/slice-p-02-x\.md/);
});

// ---- the swarm ------------------------------------------------------------

function swarm(over = {}) {
  let clock = 0;
  const calls = [];
  const inbox = [];
  const state = {
    goal_description: "", autonomy_level: "L3", sandbox: "container", phase: "execution",
    iterations: { current: 0, max_allowed: 100 }, budget: { max_wall_clock_min: 120, started_at: null },
    concurrency: 1, roles: ["maker", "checker"],
    tasks: (over.tasks ?? [{ id: "task:a" }]).map((t) => normalizeTask(t)),
  };
  const deps = {
    verifyCommand: "t",
    runBeat: over.runBeat ?? (async ({ task }) => (calls.push(`build:${task.id}`), { exitCode: 0, signal: task.id === "task:a" ? { questions: true } : {} })),
    roundFor: over.roundFor ?? (async () => ({ state: "none" })),
    raiseRound: over.raiseRound ?? (async ({ task }) => (calls.push(`raise:${task.id}`), { ok: true, reasons: [], count: 2 })),
    runVerify: async () => ({ exitCode: 0, output: "green" }),
    runChecker: async ({ task, phase }) => (calls.push(`checker:${phase ?? "build"}:${task.id}`), { exitCode: 0 }),
    merge: async ({ task }) => (calls.push(`merge:${task.id}`), { ok: true, prUrl: "u" }),
    gitHead: async () => `h${calls.length}`,
    assignWorktree: async ({ task }) => ({ path: `/wt/${task.id}`, branch: `b/${task.id}` }),
    now: () => (clock += 1000), persist: async () => {}, audit: async () => {},
    writeInbox: async (_s, r, o) => inbox.push(o?.title ? `${o.title}: ${r}` : r), log: () => {},
  };
  return { state, deps, calls, inbox };
}

test("a Maker that raises questions pauses its item after the round passes its review; other work goes on", async () => {
  const { state, deps, calls, inbox } = swarm({ tasks: [{ id: "task:a" }, { id: "task:b" }] });
  const s = await runSwarm(state, deps);
  const a = s.tasks.find((t) => t.id === "task:a");
  assert.equal(a.status, "awaiting_answers");
  assert.ok(calls.includes("raise:task:a"));
  assert.ok(calls.includes("checker:questions:task:a"), "a fresh Checker reviews the round");
  assert.ok(!calls.includes("merge:task:a"));
  assert.ok(calls.includes("merge:task:b"), "the other item still ships");
  assert.ok(inbox.some((l) => /^Questions: /.test(l) && /task:a/.test(l) && /2 questions/.test(l)), "the inbox entry is titled as questions, not an escalation");
  assert.equal(s.status, "awaiting_answers");
});

test("a round that fails its format is a rejection with the reason, and the Maker tries again", async () => {
  let raised = 0;
  const { state, deps, calls } = swarm({
    raiseRound: async () => (raised += 1, raised === 1 ? { ok: false, reasons: ["Q1 has no Recommendation"] } : { ok: true, reasons: [], count: 1 }),
  });
  await runSwarm(state, deps);
  assert.equal(calls.filter((c) => c === "build:task:a").length, 2);
  assert.equal(state.tasks[0].status, "awaiting_answers");
});

test("an unanswered round keeps the item paused without a beat", async () => {
  const { state, deps, calls } = swarm({ roundFor: async () => ({ state: "unanswered", count: 2 }) });
  const s = await runSwarm(state, deps);
  assert.ok(!calls.some((c) => c.startsWith("build")));
  assert.equal(s.tasks[0].status, "awaiting_answers");
});

test("an answered round resumes the item, and the beat is told where the answers are", async () => {
  const seen = [];
  const { state, deps } = swarm({
    roundFor: async () => ({ state: "answered", path: "carja/1-workbench/questions/answered/task-a.md" }),
    runBeat: async ({ task }) => (seen.push(task.answered_round), { exitCode: 0, signal: { done: true } }),
  });
  const s = await runSwarm(state, deps);
  assert.equal(seen[0], "carja/1-workbench/questions/answered/task-a.md");
  assert.equal(s.tasks[0].status, "merged");
});

test("a new run puts a paused item back in the queue, so the round is read again", async () => {
  const { startNewRun } = await import("../src/loop/resume.js");
  const state = {
    status: "awaiting_answers", iterations: { current: 3 }, budget: {},
    tasks: [{ id: "task:a", status: "awaiting_answers" }, { id: "task:b", status: "merged" }],
  };
  startNewRun(state);
  assert.equal(state.tasks[0].status, "pending");
  assert.equal(state.tasks[1].status, "merged");
});

test("carja status names waiting rounds and measures the owner's decisions", async () => {
  const { mkdtempSync, mkdirSync, writeFileSync, rmSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const { initCommand } = await import("../src/commands/init.js");
  const { statusCommand } = await import("../src/commands/status.js");
  const dir = mkdtempSync(join(tmpdir(), "questions-status-"));
  const sink = () => ({ text: "", write(s) { this.text += s; } });
  try {
    await initCommand([dir, "--all", "--no-detect"], { cwd: tmpdir(), stdout: sink(), stderr: sink() });
    const q = join(dir, "carja/1-workbench/questions");
    mkdirSync(join(q, "answered"), { recursive: true });
    writeFileSync(join(q, "slice-notes-app-02-sync.md"), ROUND);
    writeFileSync(join(q, "answered/task-old.md"), ROUND.replace("Answer:\n\n## Q2", "Answer: 1\n\n## Q2"));
    writeFileSync(join(dir, "carja/1-workbench/rulings.md"), "- [2026-10-20 10:00] t · A · why: x · if wrong: low · y · overruled: no\n");
    const out = sink();
    await statusCommand([dir, "--no-color"], { cwd: dir, stdout: out, stderr: sink() });
    assert.match(out.text, /1 question round waiting for you.*slice-notes-app-02-sync\.md/);
    assert.match(out.text, /took the recommendation 1 of 2 times.*overruled 1 of 1 ruling/);
    writeFileSync(join(q, "slice-notes-app-02-sync.md"), ROUND.replace("Answer:\n\n## Q2", "Answer: 2\n\n## Q2"));
    const after = sink();
    await statusCommand([dir, "--no-color"], { cwd: dir, stdout: after, stderr: sink() });
    assert.doesNotMatch(after.text, /waiting for you/, "an answered round waits for the loop, not for the owner");
    assert.match(after.text, /1 answered question round.*next loop run/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("F18: a task whose reviewed code has not changed since an interruption resumes at Ship, with no Build beat", async () => {
  const calls = [];
  const { state, deps } = swarm({
    tasks: [{ id: "task:a", reviewed_head: "h-reviewed" }],
    runBeat: async () => (calls.push("build"), { exitCode: 0, signal: { done: true } }),
  });
  deps.gitHead = async () => "h-reviewed";
  deps.runShip = async () => (calls.push("ship"), { exitCode: 0 });
  deps.shipEvidence = async () => ({ ok: true, reasons: [], body: "b" });
  const s = await runSwarm(state, deps);
  assert.ok(!calls.includes("build"), "no Build beat on code already reviewed");
  assert.ok(calls.includes("ship"));
  assert.equal(s.tasks[0].status, "merged");
});

test("F18: a passed review records the head it reviewed, and a new run carries it over", async () => {
  const { carryOver } = await import("../src/loop/blueprint.js");
  const { state, deps } = swarm({ tasks: [{ id: "task:b" }], runBeat: async () => ({ exitCode: 0, signal: { done: true } }) });
  deps.gitHead = async () => "h1";
  const s = await runSwarm(state, deps);
  assert.equal(s.tasks[0].reviewed_head, "h1");
  assert.equal(carryOver([{ id: "task:b", reviewed_head: "h1" }], [{ id: "task:b" }])[0].reviewed_head, "h1");
});

test("F20: resuming an interrupted run restarts its wall clock; the beats it spent still count", async () => {
  const { reviveForResume } = await import("../src/loop/resume.js");
  const state = { status: "running", iterations: { current: 3 }, budget: { started_at: "2026-10-20T14:19:08.000Z", max_wall_clock_min: 120 }, tasks: [{ id: "a", status: "in_progress" }] };
  reviveForResume(state);
  assert.equal(state.budget.started_at, null, "the night the laptop was closed does not count");
  assert.equal(state.iterations.current, 3);
});
