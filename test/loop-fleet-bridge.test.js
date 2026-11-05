// test/loop-fleet-bridge.test.js
//
// Fleet Bridge (Loop-Robustness-Plan §5) regression guards: harvesting the
// ./carja/ source of truth into a typed work queue (FB-1), work-type→workflow
// routing (FB-4), and the claim/write-back transforms that reflect fleet progress
// back into the SAME carja/ files (FB-2/FB-3). All pure — no repo, no agent.

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  parseInbox,
  parseBacklog,
  classifyBacklog,
  harvestWorkQueue,
  workItemId,
  workflowForType,
  renderAssignment,
} from "../src/loop/harvester.js";
import {
  claimBacklogItem,
  markBacklogItemDone,
  removeInboxItem,
  applyClaim,
  applyDone,
} from "../src/loop/writeback.js";
import { normalizeTask } from "../src/loop/swarm.js";

const INBOX = `# Inbox

Dump anything here.

> No file browser? Just say \`Inbox: X\`.

---

- Investigate slow dashboard load
- Ask design about the new logo
- `;

const BACKLOG = `# Backlog

Small stuff.

---

## P1 - High Priority (Do Next)
- [ ] Fix login timeout bug on mobile
- [x] Update README with new installation steps

## P2 - Medium Priority
- [ ] Add "Clear All" button to notifications
`;

// ---- FB-1 parsing ----------------------------------------------------------

test("parseInbox: real bullets become triage items; placeholder/quote skipped", () => {
  const items = parseInbox(INBOX);
  assert.deepEqual(items.map((i) => i.title), [
    "Investigate slow dashboard load",
    "Ask design about the new logo",
  ]);
  assert.ok(items.every((i) => i.type === "triage"));
});

test("parseBacklog: open checkboxes only, tagged with priority; done skipped", () => {
  const items = parseBacklog(BACKLOG);
  assert.deepEqual(
    items.map((i) => `${i.priority}:${i.type}:${i.title}`),
    ["P1:bugfix:Fix login timeout bug on mobile", "P2:task:Add \"Clear All\" button to notifications"]
  );
});

test("classifyBacklog: bug-ish titles are bugfix, others task", () => {
  assert.equal(classifyBacklog("Fix crash on save"), "bugfix");
  assert.equal(classifyBacklog("Login is broken"), "bugfix");
  assert.equal(classifyBacklog("Add dark mode toggle"), "task");
});

// ---- FB-1 harvest queue ----------------------------------------------------

test("harvestWorkQueue: combines sources, bugfix ranks first, stable ids, routes set", () => {
  const q = harvestWorkQueue({ inboxMd: INBOX, backlogMd: BACKLOG });
  assert.equal(q.length, 4);
  // bugfix (P1) first, then task (P2), then the two triage items.
  assert.equal(q[0].type, "bugfix");
  assert.equal(q[0].title, "Fix login timeout bug on mobile");
  assert.equal(q[q.length - 1].type, "triage");
  // stable id + source pointer + route.
  assert.equal(q[0].id, workItemId("bugfix", "Fix login timeout bug on mobile"));
  assert.equal(q[0].source.kind, "backlog");
  assert.equal(q[0].route, ".agents/workflows/build.md");
  assert.ok(q.every((t) => t.status === "pending" && Array.isArray(t.deps)));
});

test("harvestWorkQueue: re-harvesting is idempotent (dedup by id)", () => {
  const twice = harvestWorkQueue({ inboxMd: INBOX + "\n- Investigate slow dashboard load", backlogMd: BACKLOG });
  const ids = twice.map((t) => t.id);
  assert.equal(new Set(ids).size, ids.length, "no duplicate ids across a re-harvest");
});

test("harvestWorkQueue: empty sources → empty queue (nothing-to-do path)", () => {
  assert.deepEqual(harvestWorkQueue({ inboxMd: "# Inbox\n\n---\n- ", backlogMd: "# Backlog\n---\n" }), []);
});

// ---- FB-4 routing / assignment --------------------------------------------

test("workflowForType + renderAssignment: bugfix carries the reproduce-first brief", () => {
  assert.equal(workflowForType("triage"), null);
  assert.equal(workflowForType("bugfix"), ".agents/workflows/build.md");
  const a = renderAssignment({ id: "bugfix:x", type: "bugfix", title: "Fix X", source: { kind: "backlog", title: "Fix X" } });
  assert.match(a, /Task id:\*\* bugfix:x/);
  assert.match(a, /reproduce/i);
  assert.match(a, /build\.md/);
});

// ---- FB-1 metadata survives the swarm normalizer ---------------------------

test("normalizeTask preserves harvested title/source/route (not dropped)", () => {
  const t = normalizeTask({
    id: "task:add-dark-mode",
    type: "task",
    title: "Add dark mode",
    source: { kind: "backlog", title: "Add dark mode" },
    route: ".agents/workflows/build.md",
    priority: "P2",
  });
  assert.equal(t.title, "Add dark mode");
  assert.equal(t.source.kind, "backlog");
  assert.equal(t.route, ".agents/workflows/build.md");
  assert.equal(t.priority, "P2");
  assert.equal(t.status, "pending");
});

// ---- FB-2/FB-3 claim + write-back transforms -------------------------------

test("claimBacklogItem: annotates an open item once, idempotently", () => {
  const claimed = claimBacklogItem(BACKLOG, "Fix login timeout bug on mobile", "bugfix:fix-login");
  assert.match(claimed, /- \[ \] 🤖 Fix login timeout bug on mobile \(in progress: bugfix:fix-login\)/);
  // claiming again is a no-op (already claimed → regex won't re-match).
  assert.equal(claimBacklogItem(claimed, "Fix login timeout bug on mobile", "bugfix:fix-login"), claimed);
});

test("markBacklogItemDone: ticks a claimed OR unclaimed item, dropping the annotation", () => {
  const claimed = claimBacklogItem(BACKLOG, "Fix login timeout bug on mobile", "t1");
  const done = markBacklogItemDone(claimed, "Fix login timeout bug on mobile");
  assert.match(done, /- \[x\] Fix login timeout bug on mobile/);
  assert.ok(!done.includes("🤖"), "claim annotation removed on completion");
  // idempotent.
  assert.equal(markBacklogItemDone(done, "Fix login timeout bug on mobile"), done);
});

test("removeInboxItem: drops the processed thought, leaves others", () => {
  const after = removeInboxItem(INBOX, "Ask design about the new logo");
  assert.ok(!after.includes("Ask design about the new logo"));
  assert.ok(after.includes("Investigate slow dashboard load"));
});

test("applyClaim/applyDone: dispatch by source kind", () => {
  const backlogTask = { id: "t1", source: { kind: "backlog", title: "Add \"Clear All\" button to notifications" } };
  assert.match(applyClaim(BACKLOG, backlogTask), /🤖 Add "Clear All"/);
  assert.match(applyDone(BACKLOG, backlogTask), /- \[x\] Add "Clear All"/);
  const inboxTask = { id: "t2", source: { kind: "inbox", title: "Ask design about the new logo" } };
  assert.ok(!applyDone(INBOX, inboxTask).includes("Ask design about the new logo"));
  // inbox items are not claimed mid-flight (removed on completion instead).
  assert.equal(applyClaim(INBOX, inboxTask), INBOX);
});

// ---- Field report F5: task selection + the full item block ------------------

const RICH_BACKLOG = `# Backlog

## P1 - High Priority (Do Next)
- [ ] T1 Export invoices to CSV loop-ready
  - Context: finance asks for a monthly export.
  - Fix: add GET /invoices.csv, reuse the list query.

    Acceptance: the file opens in Excel.
- [ ] ⛔ BLOCKED T2 Migrate auth to SSO loop-ready
  - Waiting on the client IdP.
- [ ] T3 Pick a charting library NEEDS_DECISION
- [ ] T4 Rename settings page
## P2 - Medium Priority
- [ ] T5 Tidy CSS variables loop-ready
`;

test("F5: parseBacklog keeps the indented block of each item as details", () => {
  const t1 = parseBacklog(RICH_BACKLOG).find((i) => i.title.startsWith("T1"));
  assert.equal(
    t1.details,
    "- Context: finance asks for a monthly export.\n- Fix: add GET /invoices.csv, reuse the list query.\n\n  Acceptance: the file opens in Excel."
  );
  assert.equal(parseBacklog(RICH_BACKLOG).find((i) => i.title.startsWith("T4")).details, "");
});

test("F5: harvest skips BLOCKED and NEEDS_DECISION items by default", () => {
  const titles = harvestWorkQueue({ backlogMd: RICH_BACKLOG }).map((t) => t.title);
  assert.ok(!titles.some((t) => t.includes("T2")));
  assert.ok(!titles.some((t) => t.includes("T3")));
  assert.ok(titles.some((t) => t.includes("T4")));
});

test("F5: requireReady takes only loop-ready items", () => {
  const titles = harvestWorkQueue({ backlogMd: RICH_BACKLOG, requireReady: true }).map((t) => t.title);
  assert.deepEqual(titles.map((t) => t.split(" ")[0]), ["T1", "T5"]);
});

test("F5: priorities filter and includeInbox=false", () => {
  const q = harvestWorkQueue({ inboxMd: INBOX, backlogMd: RICH_BACKLOG, priorities: ["P1"], includeInbox: false });
  assert.ok(q.every((t) => t.priority === "P1"));
  assert.ok(q.every((t) => t.source.kind === "backlog"));
  assert.ok(q.some((t) => t.title.startsWith("T1")));
});

test("F5: renderAssignment hands the agent the item details", () => {
  const [task] = harvestWorkQueue({ backlogMd: RICH_BACKLOG, requireReady: true, priorities: ["P1"] });
  const text = renderAssignment(task);
  assert.match(text, /Fix: add GET \/invoices\.csv/);
  assert.match(text, /Acceptance: the file opens in Excel\./);
});

test("F5: normalizeTask keeps details, so the swarm beat still sees them", () => {
  const [task] = harvestWorkQueue({ backlogMd: RICH_BACKLOG, requireReady: true, priorities: ["P1"] });
  assert.match(renderAssignment(normalizeTask(task)), /Acceptance: the file opens in Excel\./);
});

// ---- F10: a claimed item keeps its id across re-harvests --------------------
//
// The claim rewrites the line to `🤖 X (in progress: id)`. Parsed raw, that gave
// a new title and a new id, so the next run dispatched the item again and the
// done write-back could not find it.

test("F10: re-harvesting a claimed backlog item yields the same id and clean title", () => {
  const md = "## P1\n- [ ] Rename settings page\n  - Fix: rename the route too.\n";
  const [first] = harvestWorkQueue({ backlogMd: md });
  const claimed = applyClaim(md, first);
  assert.match(claimed, /🤖 Rename settings page \(in progress: /);
  const [again] = harvestWorkQueue({ backlogMd: claimed });
  assert.equal(again.id, first.id);
  assert.equal(again.title, "Rename settings page");
  assert.equal(again.source.title, "Rename settings page");
  assert.equal(again.details, "- Fix: rename the route too.");
});

test("F10: done write-back still finds a claimed item harvested on a later run", () => {
  const md = "## P1\n- [ ] Rename settings page\n";
  const claimed = applyClaim(md, harvestWorkQueue({ backlogMd: md })[0]);
  const [again] = harvestWorkQueue({ backlogMd: claimed });
  assert.equal(applyDone(claimed, again), "## P1\n- [x] Rename settings page\n");
});

test("F10: claim and done keep the blank line after the item", () => {
  const md = "## P1\n- [ ] A\n\n## P2\n- [ ] B\n";
  const [a] = harvestWorkQueue({ backlogMd: md });
  const claimed = applyClaim(md, a);
  assert.equal(claimed, `## P1\n- [ ] 🤖 A (in progress: ${a.id})\n\n## P2\n- [ ] B\n`);
  assert.equal(applyDone(claimed, a), "## P1\n- [x] A\n\n## P2\n- [ ] B\n");
});
