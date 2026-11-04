// test/loop-ship-beat.test.js
//
// Unattended Lifecycle, build step 1 (docs/roadmap/Unattended-Lifecycle.md):
// the loop ran Build and then opened the MR itself, skipping Ship. Now a task
// that would open an MR gets a Ship beat that runs ship.md Phases 1–5 in its
// worktree, then verify and the Checker again (Ship's Phase 4 review), then the
// driver checks the evidence in code and opens the MR with Ship's own body.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { checkShipEvidence, shipBeatSection, renderShipAssignment, PR_BODY_REL } from "../src/loop/ship.js";
import { runSwarm, normalizeTask } from "../src/loop/swarm.js";
import { runLoop, normalizeState } from "../src/loop/driver.js";

const ROOT_LOG = "# Ship Log\n\n## 2026-10-01 — Older thing\n\n**For you**\n- **Impact:** a\n- **Cost:** none\n- **Risk:** none\n- **Decide:** none\n";
const NEW_ENTRY = "\n## 2026-10-20 — Cover the banner\n\n**For you**\n- **Impact:** the banner can no longer silently break\n- **Cost:** none\n- **Risk:** none\n- **Decide:** none\n\n**For the record**\n- **Platform:** branch `carja/loop/x` — MR opened by carja loop\n";
const BODY = "The banner is now pinned by tests.\n\n## What changes for you\nNothing visible.\n\n## Decisions I took alone\n- none\n\n## Evidence\n- 754 tests passed\n\n## What I need from you\nNothing blocking.\n";
const BACKLOG_BEFORE = "## Open\n\n- [ ] **Cover the banner with a test.** (loop-ready)\n";
const BACKLOG_AFTER = "## Open\n\n- [x] **Cover the banner with a test.** **Done 2026-10-20.**\n";

test("evidence passes with a new For-you entry, Ship's body and the item ticked", () => {
  const r = checkShipEvidence({ rootShipLog: ROOT_LOG, branchShipLog: ROOT_LOG + NEW_ENTRY, body: BODY, backlog: { title: "Cover the banner with a test.", after: BACKLOG_AFTER } });
  assert.deepEqual(r.reasons, []);
  assert.equal(r.ok, true);
});

test("evidence fails, with a reason each, when Ship's bookkeeping is missing", () => {
  const r = checkShipEvidence({ rootShipLog: ROOT_LOG, branchShipLog: ROOT_LOG, body: "", backlog: { title: "Cover the banner with a test.", after: BACKLOG_BEFORE } });
  assert.equal(r.ok, false);
  assert.ok(r.reasons.some((x) => /ship-log/.test(x)));
  assert.ok(r.reasons.some((x) => /MR body/.test(x)));
  assert.ok(r.reasons.some((x) => /not ticked/.test(x)));
});

test("a new entry without the For you block is not enough", () => {
  const r = checkShipEvidence({ rootShipLog: ROOT_LOG, branchShipLog: ROOT_LOG + "\n## 2026-10-20 — Thing\n- **What:** x\n", body: BODY });
  assert.ok(r.reasons.some((x) => /For you/.test(x)));
});

test("a body missing Ship's sections is not enough", () => {
  const r = checkShipEvidence({ rootShipLog: ROOT_LOG, branchShipLog: ROOT_LOG + NEW_ENTRY, body: "Done." });
  assert.ok(r.reasons.some((x) => /What changes for you/.test(x)));
});

test("the ship section in unattended-loop.md tells the beat what the driver does instead", () => {
  const text = readFileSync(new URL("../templates/.agents/workflows/unattended-loop.md", import.meta.url), "utf8");
  const section = shipBeatSection(text);
  assert.match(section, /Phase 4/);
  assert.match(section, /Phase 6/);
  assert.ok(section.includes(PR_BODY_REL));
  assert.doesNotMatch(section, /^## (?!Ship beat)/m, "only the ship section is extracted");
});

test("the ship assignment names the item to tick and the branch", () => {
  const t = renderShipAssignment({ id: "task:x", title: "**Cover the banner with a test.** (loop-ready)", source: { kind: "backlog" } }, { branch: "carja/loop/x" });
  assert.match(t, /Cover the banner with a test\./);
  assert.match(t, /- \[x\]/);
  assert.match(t, /carja\/loop\/x/);
});

// ---- swarm ----------------------------------------------------------------

function swarm(over = {}) {
  let clock = 0;
  const calls = [];
  const inbox = [];
  const state = {
    goal_description: "g", autonomy_level: "L3", sandbox: "container", phase: "execution",
    iterations: { current: 0, max_allowed: 100 }, budget: { max_wall_clock_min: 120, started_at: null },
    concurrency: 1, roles: ["maker", "checker"], tasks: [normalizeTask({ id: "a", title: "Cover the banner" })],
    ...over.state,
  };
  const deps = {
    verifyCommand: "t",
    runBeat: async () => (calls.push("build"), { exitCode: 0 }),
    runShip: async () => (calls.push("ship"), { exitCode: 0 }),
    runVerify: async () => (calls.push("verify"), { exitCode: 0, output: "green" }),
    runChecker: async ({ phase }) => (calls.push(`checker:${phase ?? "build"}`), { exitCode: 0 }),
    shipEvidence: over.shipEvidence ?? (async () => ({ ok: true, reasons: [], body: BODY })),
    merge: async ({ task }) => (calls.push(`merge:${task.ship?.body ? "ship-body" : "no-body"}`), { ok: true, prUrl: "u" }),
    gitHead: async () => `h${calls.length}`,
    assignWorktree: async ({ task }) => ({ path: `/wt/${task.id}`, branch: `b/${task.id}` }),
    now: () => (clock += 1000), persist: async () => {}, audit: async () => {},
    writeInbox: async (_s, r) => inbox.push(r), log: () => {},
    ...over.deps,
  };
  return { state, deps, calls, inbox };
}

test("swarm: an L3 task ships before its MR: Ship beat, verify, Checker again, MR with Ship's body", async () => {
  const { state, deps, calls } = swarm();
  const s = await runSwarm(state, deps);
  assert.equal(s.tasks[0].status, "merged");
  assert.deepEqual(calls, ["build", "verify", "checker:build", "ship", "verify", "checker:ship", "merge:ship-body"]);
});

test("swarm: missing bookkeeping sends a second Ship beat with the reasons, then fails to the inbox", async () => {
  const seen = [];
  const { state, deps, calls, inbox } = swarm({
    shipEvidence: async () => ({ ok: false, reasons: ["no new ship-log entry with a For you block"] }),
    deps: { runShip: async ({ task }) => (seen.push(task.attempts.length), calls.push("ship"), { exitCode: 0 }) },
  });
  const s = await runSwarm(state, deps);
  assert.equal(calls.filter((c) => c === "ship").length, 2);
  assert.equal(seen[1] > seen[0], true, "the second Ship beat sees the first one's rejection");
  assert.equal(s.tasks[0].status, "failed");
  assert.ok(!calls.some((c) => c.startsWith("merge")), "no MR without Ship's evidence");
  assert.ok(inbox.some((l) => /ship/i.test(l) && /For you/.test(l)));
});

test("swarm: below L3 there is no MR, so no Ship beat", async () => {
  const { state, deps, calls } = swarm({ state: { autonomy_level: "L1", sandbox: "container", concurrency: 1 } });
  await runSwarm(state, deps);
  assert.ok(!calls.includes("ship"));
});

// ---- pair -----------------------------------------------------------------

test("pair: a done goal at L3 ships before its MR, and the MR gets Ship's body", async () => {
  let clock = 0;
  const calls = [];
  const state = normalizeState({ phase: "execution", status: "idle", autonomy_level: "L3", sandbox: "container" });
  const final = await runLoop(state, {
    verifyCommand: "t",
    runBeat: async () => (calls.push("build"), { exitCode: 0 }),
    readMakerSignal: async () => ({ done: true }),
    runShip: async () => (calls.push("ship"), { exitCode: 0 }),
    shipEvidence: async () => ({ ok: true, reasons: [], body: BODY }),
    runVerify: async () => (calls.push("verify"), { exitCode: 0, output: "ok" }),
    runChecker: async ({ phase } = {}) => (calls.push(`checker:${phase ?? "build"}`), { exitCode: 0 }),
    merge: async ({ state: s }) => (calls.push(`merge:${s.ship?.body ? "ship-body" : "no-body"}`), { ok: true, prUrl: "u" }),
    gitHead: async () => `h${calls.length}`,
    branchHasWork: async () => true,
    now: () => (clock += 1000), persist: async () => {}, writeInbox: async () => {}, log: () => {},
  });
  assert.equal(final.status, "completed");
  assert.deepEqual(calls, ["build", "verify", "checker:build", "ship", "verify", "checker:ship", "merge:ship-body"]);
});

// Found by the first live Ship beat (2026-10-20): ship.md starts with its `---`
// frontmatter, the claude adapter passed the prompt as an argument, and the CLI
// read it as an option ("error: unknown option '---'"). Every flag goes first,
// then `--`, then the prompt.
test("a prompt that starts with a dash is never read as an option", async () => {
  const { buildArgv } = await import("../src/loop/adapters/claude.js");
  const claude = buildArgv({ prompt: "---\ndescription: Ship\n---", model: "sonnet", settingsPath: "/s.json", allowedTools: ["Read"] });
  assert.equal(claude[claude.length - 2], "--");
  assert.equal(claude[claude.length - 1], "---\ndescription: Ship\n---");
  assert.equal(claude.indexOf("-p"), 0);
  const { beatArgs } = await import("../src/loop/adapters/codex.js");
  const codex = beatArgs({ prompt: "---x" });
  assert.deepEqual(codex.slice(-2), ["--", "---x"]);
});

// Live run 2026-10-20: the cleaned title kept "`src/slug.js` ." and the tick
// was matched too exactly, which cost one Ship beat.
test("the tick is found from the item's leading words, whatever the Maker did to markdown and spacing", () => {
  const title = "**Add a `slugify(text)` helper in `src/slug.js` (loop-ready).** Lowercase, ASCII only.";
  const after = "- [x] **Add a slugify(text) helper in src/slug.js.** Lowercase, ASCII only. **Done 2026-10-20.**\n";
  assert.equal(checkShipEvidence({ rootShipLog: ROOT_LOG, branchShipLog: ROOT_LOG + NEW_ENTRY, body: BODY, backlog: { title, after } }).ok, true);
  const untouched = "- [ ] **Add a `slugify(text)` helper in `src/slug.js` (loop-ready).** Lowercase, ASCII only.\n";
  assert.equal(checkShipEvidence({ rootShipLog: ROOT_LOG, branchShipLog: ROOT_LOG + NEW_ENTRY, body: BODY, backlog: { title, after: untouched } }).ok, false);
  assert.doesNotMatch(renderShipAssignment({ title, source: { kind: "backlog" } }), / \./);
});
