// src/loop/ship.js
//
// Unattended Lifecycle, build step 1 (docs/roadmap/Unattended-Lifecycle.md):
// the Ship beat. The loop used to run Build and then open the MR itself, with a
// one-line log and a stub body, skipping everything Ship does. Now a task bound
// for an MR gets one more fresh beat running ship.md Phases 1–5 in its worktree,
// as the owner would type `/ship`. The driver then re-runs verify and the
// Checker (Ship's Phase 4 review: Ship may change code), checks the evidence in
// code, and does Phase 6's mechanics itself: push and open the MR with the body
// the Ship beat wrote. The bookkeeping lives in the task's branch, so merging the
// MR is what records the ship.

import { classifyBeatResult } from "./driver.js";
import { recordAttempt } from "./harvester.js";

import { PR_BODY_REL } from "./state-sync.js";

/** The MR body the Ship beat writes: a driver file, hidden from git, never in the MR. */
export { PR_BODY_REL };
export const SHIP_ATTEMPTS = 2;
const BODY_SECTIONS = ["## What changes for you", "## Decisions I took alone", "## Evidence", "## What I need from you"];
const FOR_YOU_LINES = ["Impact", "Cost", "Risk", "Decide"];

/** The `## Ship beat` section of unattended-loop.md: the beat's unattended rules. */
export function shipBeatSection(text) {
  return sectionOf(text, "Ship beat");
}

/** A `## <heading>` section of a workflow file, up to the next `## ` heading. */
export function sectionOf(text, heading) {
  const lines = String(text ?? "").split("\n");
  const start = lines.findIndex((l) => l.startsWith(`## ${heading}`));
  if (start < 0) return "";
  let end = lines.findIndex((l, i) => i > start && /^## /.test(l));
  if (end < 0) end = lines.length;
  return lines.slice(start, end).join("\n").trim();
}

function cleanTitle(title) {
  return String(title ?? "")
    .replace(/^🤖\s+/u, "")
    .replace(/\(loop-ready\)/gi, "")
    .replace(/\s+\(in progress:[^)]*\)$/, "")
    .replace(/\*+/g, "")
    .replace(/\s+/g, " ")
    .replace(/\s+([.,;:!?])/g, "$1")
    .trim();
}

/** Letters and digits only, lowercased: survives markdown and spacing edits. */
function matchKey(text) {
  return cleanTitle(text).toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

/** What this Ship beat ships, and the one bookkeeping step only it can name. */
export function renderShipAssignment(task, { branch } = {}) {
  const lines = ["# Ship assignment (this beat)", ""];
  if (task?.title) {
    lines.push(`- **Item:** ${cleanTitle(task.title)}`);
    if (task.source?.kind === "backlog") {
      lines.push(
        "- **Tick it in this branch:** in `carja/2-backlog/task-backlog.md`, change its `- [ ]` to `- [x]`, remove `(loop-ready)` and any `🤖` marker, and add **Done YYYY-MM-DD** with one line on what shipped. Merging the MR is what makes it done."
      );
    }
  }
  if (task?.source?.kind === "slice" && task.source.path) {
    lines.push(`- **Archive it in this branch:** move \`${task.source.path}\` to \`carja/6-archive/completed-implementations/${task.source.slice}\` (ship.md Phase 5).`);
  }
  if (branch) lines.push(`- **Branch:** \`${branch}\`. In the ship-log entry write \`Platform: branch ${branch} — MR opened by carja loop\`.`);
  return lines.join("\n");
}

function headingsOf(log) {
  return String(log ?? "")
    .split("\n")
    .filter((l) => /^## \d{4}-\d{2}-\d{2}/.test(l));
}

function entryBody(log, heading) {
  const lines = String(log ?? "").split("\n");
  const i = lines.indexOf(heading);
  if (i < 0) return "";
  let j = lines.findIndex((l, k) => k > i && /^## /.test(l));
  if (j < 0) j = lines.length;
  return lines.slice(i, j).join("\n");
}

/**
 * Did the Ship beat do Ship's bookkeeping? Pure: the caller reads the files.
 * @returns {{ok:boolean, reasons:string[]}}
 */
/** The MR body the driver opens the MR with: present, with Ship's sections. */
export function prBodyReasons(body) {
  const text = String(body ?? "");
  if (!text.trim()) return [`no MR body in ${PR_BODY_REL}`];
  const missing = BODY_SECTIONS.filter((s) => !text.includes(s));
  return missing.length ? [`the MR body lacks Ship's sections: ${missing.join(", ")}`] : [];
}

export function checkShipEvidence({ rootShipLog, branchShipLog, body, backlog = null, slice = null }) {
  const reasons = [];
  const seen = new Set(headingsOf(rootShipLog));
  const added = headingsOf(branchShipLog).filter((h) => !seen.has(h)).sort();
  if (!added.length) {
    reasons.push("no new ship-log entry with a For you block");
  } else {
    const entry = entryBody(branchShipLog, added[added.length - 1]);
    const complete = /\*\*For you\*\*/.test(entry) && FOR_YOU_LINES.every((k) => new RegExp(`\\*\\*${k}:\\*\\*`).test(entry));
    if (!complete) reasons.push("the new ship-log entry has no complete For you block (Impact, Cost, Risk, Decide)");
  }
  reasons.push(...prBodyReasons(body));
  if (backlog?.title) {
    // The item's leading words, letters and digits only: the Maker may rewrite
    // markdown, spacing and the rest of the line when it ticks it.
    const want = matchKey(backlog.title).split(" ").slice(0, 8).join(" ");
    const line = String(backlog.after ?? "")
      .split("\n")
      .find((l) => /^\s*- \[[ xX]\]/.test(l) && matchKey(l.replace(/^\s*- \[[ xX]\]\s*/, "")).startsWith(want));
    if (!line || !/^\s*- \[[xX]\]/.test(line)) reasons.push(`the backlog item is not ticked: ${cleanTitle(backlog.title)}`);
  }
  if (slice && (slice.stillInBacklog || !slice.archived)) {
    reasons.push("the slice folder is not archived to carja/6-archive/completed-implementations/ (ship.md Phase 5)");
  }
  return { ok: reasons.length === 0, reasons };
}

/**
 * The ship stage, shared by pair and swarm. `holder` is the task (swarm) or the
 * run state (pair): it receives `attempts` (A13) and, on success, `ship.body`.
 * Each callback is bound by the caller to its own mode. Up to SHIP_ATTEMPTS
 * Ship beats; each rejected one tells the next why.
 * @returns {Promise<{ok:boolean, outcome?:string, reason?:string, verdict?:object}>}
 */
export async function runShipStage(holder, { runShip, verify, check, evidence, charge = () => {}, beatNo = () => 0, audit = () => {} }) {
  let last = "";
  for (let i = 0; i < SHIP_ATTEMPTS; i++) {
    charge();
    const r = await runShip();
    const dead = classifyBeatResult(r);
    if (dead.dead) return { ok: false, outcome: "dead", verdict: dead };
    if (r?.signal?.escalate === true) {
      const reason = String(r.signal.reason ?? "").replace(/\s+/g, " ").trim().slice(0, 1500) || "the Ship beat escalated without a reason";
      return { ok: false, outcome: "escalated", reason };
    }
    const v = await verify();
    if (v.exitCode !== 0) {
      recordAttempt(holder, { beat: beatNo(), verifyExit: v.exitCode, verifyOutput: v.output, checkerReasons: ["verify is red after the Ship beat"] });
      last = `verify exit ${v.exitCode} after the Ship beat`;
      await audit(`ship beat: ${last}`);
      continue;
    }
    const c = await check();
    if ((c?.exitCode ?? 1) !== 0) {
      recordAttempt(holder, { beat: beatNo(), verifyExit: 0, checkerReasons: c?.reasons ?? ["the Checker rejected the shipped state"], checkerFindings: c?.findings ?? [] });
      last = `Checker rejected the shipped state${c?.reasons?.length ? `: ${c.reasons.join(" | ")}` : ""}`;
      await audit(`ship beat: ${last}`);
      continue;
    }
    const e = await evidence();
    if (!e.ok) {
      recordAttempt(holder, { beat: beatNo(), verifyExit: 0, checkerReasons: e.reasons.map((x) => `ship evidence: ${x}`) });
      last = e.reasons.join("; ");
      await audit(`ship beat: missing ${last}`);
      continue;
    }
    holder.ship = { body: e.body ?? null };
    await audit("ship beat: bookkeeping in the branch, MR body written");
    return { ok: true };
  }
  return { ok: false, outcome: "failed", reason: last };
}
