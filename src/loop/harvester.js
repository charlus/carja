// src/loop/harvester.js
//
// Fleet Bridge FB-1 + FB-4 (Loop-Robustness-Plan §5). Turns the ONE source of
// truth — the human's `./carja/` folder — into a typed work queue the swarm
// can drain, and maps each work type onto the workflow a beat should run. This is
// what makes the autonomous fleet (Client B) read from the same `carja/` that
// the interactive agent (Client A) reads and writes; there is no second database.
//
// All parsers are PURE (string in, work-items out) so they unit-test without a
// repo. The IO wrapper that reads the actual files lives in the command shell
// (src/commands/loop.js), which passes their contents here.

import { envelopeUntrusted } from "./untrusted.js";
import { rulingHint } from "./rulings.js";
import { stageWorkflowPath } from "./stages.js";
import { roundKey as roundKeyOf } from "./questions.js";

/** kebab-slug, bounded — mirrors worktree.slugify so ids/branches line up. */
export function slugify(text, fallback = "item") {
  const s = String(text ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
  return s || fallback;
}

/** Stable, human-readable task id from a work item. Stable across re-harvests
 * (idempotent claims depend on this) as long as the item's title is unchanged. */
export function workItemId(type, title) {
  return `${type}:${slugify(title)}`;
}

const BUG_RE = /\b(bug|fix|broken|crash|error|regression|fails?|failing|incorrect|wrong)\b/i;

/** Classify a backlog line into a work type. Bug-ish → bugfix; else a task. */
export function classifyBacklog(title) {
  return BUG_RE.test(title) ? "bugfix" : "task";
}

/**
 * Parse `1-workbench/inbox.md` into `triage` items. Every non-empty `- ` bullet
 * below the intro is an unprocessed thought the fleet should triage (decide its
 * home and file it). The template's empty `- ` placeholder is skipped.
 */
export function parseInbox(md) {
  const items = [];
  for (const raw of String(md ?? "").split("\n")) {
    const m = raw.match(/^\s*[-*]\s+(\S.*?)\s*$/);
    if (!m) continue;
    const title = m[1].trim();
    if (!title || title.startsWith(">")) continue;
    items.push({ type: "triage", title });
  }
  return items;
}

/**
 * Parse `2-backlog/task-backlog.md`. Open checkboxes (`- [ ]`) become work items,
 * tagged with the priority heading (`## P1 …`) they sit under; done (`- [x]`) is
 * skipped. Bug-ish titles route to `bugfix`, the rest to `task`. The lines
 * indented below an item (its context, its fix) are kept, dedented, as `details`.
 */
export function parseBacklog(md) {
  const items = [];
  const lines = String(md ?? "").split("\n");
  let priority = null;
  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i];
    const h = raw.match(/^#{1,6}\s+(P\d)\b/i);
    if (h) {
      priority = h[1].toUpperCase();
      continue;
    }
    const box = raw.match(/^(\s*)[-*]\s+\[( |x|X)\]\s+(\S.*?)\s*$/);
    if (!box) continue;
    if (box[2].toLowerCase() === "x") continue; // already done
    const title = stripClaim(box[3].trim());
    items.push({ type: classifyBacklog(title), title, priority, details: blockBelow(lines, i, box[1].length) });
  }
  return items;
}

/**
 * The item's own title, without the fleet's claim annotation
 * (`🤖 X (in progress: id)` → `X`). The id derives from the title, so a claimed
 * item must keep the title it was claimed under, or the next run dispatches it again.
 */
function stripClaim(title) {
  return title.replace(/^🤖\s+/u, "").replace(/\s+\(in progress:[^)]*\)$/, "");
}

/** The lines indented deeper than `indent` right below line `at`, dedented. */
function blockBelow(lines, at, indent) {
  const block = [];
  for (let j = at + 1; j < lines.length; j++) {
    const line = lines[j];
    if (!line.trim()) {
      block.push("");
      continue;
    }
    if (line.match(/^\s*/)[0].length <= indent) break;
    block.push(line);
  }
  while (block.length && block[block.length - 1] === "") block.pop();
  const depth = Math.min(...block.filter(Boolean).map((l) => l.match(/^\s*/)[0].length));
  return block.map((l) => l.slice(depth)).join("\n");
}

const NOT_READY_RE = /\bBLOCKED\b|\bNEEDS[_ ]DECISION\b/;
const READY_RE = /(^|[\s[(#])loop-ready\b/i;

/**
 * Should the loop take this backlog item? Never one marked BLOCKED or
 * NEEDS_DECISION. With `requireReady`, only one tagged `loop-ready` or given
 * with `carja loop take` (its id in `readyIds`). With `priorities`, only one
 * under those headings.
 */
export function isHarvestable(item, { requireReady = false, priorities = [], readyIds = new Set() } = {}) {
  if (NOT_READY_RE.test(item.title)) return false;
  if (requireReady && !READY_RE.test(item.title) && !readyIds.has(workItemId(item.type, item.title))) return false;
  if (priorities.length && !priorities.includes(item.priority)) return false;
  return true;
}

/**
 * Combine parsed sources into a normalized, deterministically-ordered work queue.
 * Priority order: bugfix > task (backlog) then triage (inbox); within a source,
 * input order is preserved. Each item gets a stable id, a `source` pointer for
 * write-back, and the workflow route for the beat. Duplicate ids are dropped
 * (first wins) so re-harvesting is idempotent.
 *
 * @param {{inboxMd?:string, backlogMd?:string, requireReady?:boolean, priorities?:string[], includeInbox?:boolean, readyIds?:Set<string>}} sources
 * @returns {Array<{id,type,title,priority,source,route,status,deps}>}
 */
export function harvestWorkQueue({ inboxMd = "", backlogMd = "", requireReady = false, priorities = [], includeInbox = true, readyIds = new Set() } = {}) {
  const backlog = parseBacklog(backlogMd)
    .filter((it) => isHarvestable(it, { requireReady, priorities, readyIds }))
    .map((it) => ({ ...it, sourceKind: "backlog" }));
  // Inbox lines are raw thoughts: never loop-ready and never under a priority, so
  // either filter excludes them, as does includeInbox=false.
  const takeInbox = includeInbox && !requireReady && priorities.length === 0;
  const inbox = (takeInbox ? parseInbox(inboxMd) : []).map((it) => ({ ...it, sourceKind: "inbox" }));
  const rank = { bugfix: 0, task: 1, triage: 2 };
  const ordered = [...backlog, ...inbox].sort((a, b) => (rank[a.type] ?? 9) - (rank[b.type] ?? 9));

  const seen = new Set();
  const queue = [];
  for (const it of ordered) {
    const id = workItemId(it.type, it.title);
    if (seen.has(id)) continue;
    seen.add(id);
    queue.push({
      id,
      type: it.type,
      title: it.title,
      priority: it.priority ?? null,
      details: it.details ?? "",
      source: { kind: it.sourceKind, title: it.title },
      route: workflowForType(it.type),
      status: "pending",
      deps: [], // harvested items are independent; carve produces real DAGs
    });
  }
  return queue;
}

/** FB-4: map a work type onto the workflow (and any skill) a beat should run. */
export const ROUTING = Object.freeze({
  triage: {
    workflow: null,
    brief:
      "Triage this inbox thought: decide its home (a backlog task, a product-area note, a new Implementation, or discard) and file it there. Do not implement.",
  },
  task: { workflow: ".agents/workflows/build.md", brief: "Implement this backlog task end-to-end following the Build workflow (per-task TDD)." },
  bugfix: {
    workflow: ".agents/workflows/build.md",
    brief:
      "Fix this bug: first reproduce it with a failing test (systematic-debugging skill), then make it pass following the Build workflow. Never claim fixed without a reproduction that now passes.",
  },
  build: { workflow: ".agents/workflows/build.md", brief: "Build this Implementation's next steps following the Build workflow (per-task TDD)." },
  slice: {
    workflow: stageWorkflowPath("build"),
    brief:
      "Build this slice following the Build workflow, from implementation-plan.md and feature-spec.md in its folder, one task per TDD cycle. Commit each task with its task number in the subject: `git log` since the branch base is your memory across beats. Write task-tracker.md once, when the slice is done. Write `{ \"done\": true }` only when the whole slice is ship-ready; until then end each beat with every finished task committed and no signal.",
  },
});

export function workflowForType(type) {
  // Known types keep their workflow verbatim — including triage's intentional
  // `null` (no workflow, brief only). Only an UNKNOWN type falls back to Build.
  if (type in ROUTING) return ROUTING[type].workflow;
  return ".agents/workflows/build.md";
}

/** How many rejected attempts a beat is shown, and how much of each. */
export const ATTEMPTS_KEPT = 3;
const TAIL_LINES = 40;
const TAIL_BYTES = 4096;
const FINDINGS_KEPT = 10;

/** The last 40 lines of verify output, at most 4 KB. */
export function verifyTail(output) {
  const lines = String(output ?? "").trimEnd().split("\n").slice(-TAIL_LINES).join("\n");
  return lines.length > TAIL_BYTES ? lines.slice(-TAIL_BYTES) : lines;
}

/** Append one rejected attempt, keeping only the last ATTEMPTS_KEPT. Mutates `holder`. */
export function recordAttempt(holder, { beat, verifyExit, verifyOutput = "", checkerReasons = [], checkerFindings = [], files = [] }) {
  const attempts = Array.isArray(holder.attempts) ? holder.attempts : [];
  attempts.push({
    beat,
    verify_exit: verifyExit,
    verify_tail: verifyTail(verifyOutput),
    checker_reason: checkerReasons.length ? checkerReasons.join(" | ").slice(0, 1500) : null,
    checker_findings: (checkerFindings ?? []).slice(0, FINDINGS_KEPT),
    files: (files ?? []).slice(0, 50),
  });
  holder.attempts = attempts.slice(-ATTEMPTS_KEPT);
  return holder.attempts;
}

function findingLine(f) {
  if (!f || typeof f !== "object") return `- ${String(f).slice(0, 200)}`;
  const head = [f.severity, f.class ?? f.category].filter(Boolean).join(" ");
  const text = f.summary ?? f.message ?? f.issue ?? f.quote ?? JSON.stringify(f);
  const doubt = f.ungrounded ? "(quote not found in the file: check it before you act on it) " : "";
  return `- ${head ? `${head}: ` : ""}${doubt}${String(text).replace(/\s+/g, " ").slice(0, 200)}`;
}

/**
 * What the next beat must know about the beats that were rejected before it.
 * The driver writes this, never the agent. Verify output and Checker text are
 * repository and model output, so they reach the Maker inside the untrusted
 * envelope. Empty string when there is nothing to tell.
 */
export function renderAttempts(attempts) {
  const kept = (attempts ?? []).slice(-ATTEMPTS_KEPT);
  if (!kept.length) return "";
  const body = kept
    .map((a) => {
      const parts = [`### Beat ${a.beat}: verify exit ${a.verify_exit}${a.checker_reason ? ", rejected by the Checker" : ""}`];
      if (a.checker_reason) parts.push(`Checker: ${a.checker_reason}`);
      if (a.checker_findings?.length) parts.push(a.checker_findings.map(findingLine).join("\n"));
      if (a.files?.length) parts.push(`Files changed in that beat: ${a.files.join(", ")}`);
      if (a.verify_tail) parts.push(`Verify output (tail):\n${verifyTail(a.verify_tail)}`);
      return parts.join("\n\n");
    })
    .join("\n\n");
  return [
    "## Previous attempts were rejected",
    "",
    "Read why before you start, and fix what they name. Do not repeat an approach that already failed.",
    "",
    envelopeUntrusted(body, { source: "earlier loop beats (verify output and Checker verdicts)" }),
  ].join("\n");
}

/** The escalate instruction every beat carries (F3). */
export const ESCALATE_HINT =
  "If you cannot go on without something only a human can give (an approval, access, a decision), write " +
  "`carja/1-workbench/maker-signal.json` `{ \"escalate\": true, \"reason\": \"<what you need, at most 1500 characters>\" }` " +
  "and stop. The driver ends the run and puts your reason in the inbox. Retrying a beat you know is blocked only burns budget.";

/** Render the per-beat assignment a fleet agent reads to know its work item. */
export function renderAssignment(task) {
  const route = ROUTING[task.type] ?? ROUTING.task;
  return [
    "# Loop Assignment (this beat)",
    "",
    "> The driver assigned you ONE work item from `./carja/` this beat. Do exactly this, commit, then write `carja/1-workbench/maker-signal.json` `{ \"done\": true }` only if the whole item is complete.",
    "",
    `- **Task id:** ${task.id}`,
    `- **Type:** ${task.type}`,
    `- **Item:** ${task.title}`,
    `- **Source:** ${task.source?.kind ?? "carja"} (\`${task.source?.title ?? task.title}\`)`,
    ...(task.source?.path ? [`- **Folder:** \`${task.source.path}\` (read your inputs from here)`] : []),
    `- **Questions file:** \`carja/1-workbench/questions/${roundKeyOf(task.id)}.md\` (only for a one-way door: see the loop workflow)`,
    ...(task.answered_round ? [`- **Your questions were answered:** read \`${task.answered_round}\` first, apply each answer, and record it as a decision in the stage's document.`] : []),
    route.workflow ? `- **Run workflow:** \`${route.workflow}\`` : "- **Run workflow:** (none — follow the brief)",
    ...(task.details ? ["", "**Item details** (from the backlog, verbatim):", "", task.details] : []),
    "",
    `**Brief:** ${route.brief}`,
    "",
    `**Blocked?** ${ESCALATE_HINT}`,
    "",
    `**Deciding alone?** ${rulingHint(task.id)}`,
    ...(task.attempts?.length ? ["", renderAttempts(task.attempts)] : []),
  ].join("\n");
}
