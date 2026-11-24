// src/loop/stack.js
//
// The stacked run (owner, 2026-10-22): "I run the Discovery, up to the Technical
// Vision. Then I run the loop on the result and it executes all the steps and
// workflows the framework defines, and ships the thing I asked to ship." One
// `carja loop <project>` builds the Carve and every slice without waiting
// for a merge. Each item starts from the branch of the item below it, and each
// MR targets that branch, in both repositories. The owner merges the stack in
// order at the end; the forge moves each MR to the default branch when the one
// below it is merged (its source branch deleted on merge).
//
// One-way doors stay the owner's: an item that raises a question round stops
// the run, and nothing is built above it.
//
// The stack is recorded in the project's run directory (`stack.json`, in the
// repository's git directory, never in the owner's folder) and checked against
// the forge at the start of every run: an MR the owner closed is rebuilt with
// every item above it; an MR the owner changed is kept as the owner left it and
// every item above it is rebuilt on top. Merged items are never touched.
// With a risk block in carja.config.json (src/loop/risk.js), the loop merges
// the items the owner does not review at the end of the run, and the owner
// merges the rest.
// Pure except where a function takes injected IO.

import { itemTier } from "./risk.js";

export const STACK_FILE = "stack.json";
export const REPORT_REL = (project) => `carja/1-workbench/loop-report-${project}.md`;

/** The report's line for a run that built every item; `carja merge-stack` retires only such a report. */
export const RUN_DONE_LINE = "Every item of the project is built.";

/**
 * The latest MR whose source branch is `branch`, from the forge.
 * @param {{forge: "gh"|"glab", run: (cmd: string, argv: string[]) => Promise<{ok: boolean, stdout: string}>, branch: string}} io
 * @returns {Promise<{state: "open"|"merged"|"closed"|"unknown", url: string|null, head: string|null, id: string|null}|null>}
 *   null when the forge answered that there is none; state "unknown" when the
 *   forge cannot be asked (offline, no auth). Never read "unknown" as closed.
 */
export async function forgeBranchMr({ forge, run, branch }) {
  try {
    if (forge === "gh") {
      const r = await run("gh", ["pr", "list", "--head", branch, "--state", "all", "--json", "state,url,headRefOid,number", "--limit", "1"]);
      if (!r.ok) return UNKNOWN;
      const pr = JSON.parse(r.stdout || "[]")[0];
      if (!pr) return null;
      return { state: String(pr.state).toLowerCase(), url: pr.url ?? null, head: pr.headRefOid ?? null, id: pr.number != null ? String(pr.number) : pr.url ?? null };
    }
    if (forge === "glab") {
      const r = await run("glab", ["api", `projects/:id/merge_requests?source_branch=${encodeURIComponent(branch)}&state=all&order_by=updated_at&per_page=1`]);
      if (!r.ok) return UNKNOWN;
      const mr = JSON.parse(r.stdout || "[]")[0];
      if (!mr) return null;
      const state = mr.state === "opened" ? "open" : mr.state === "locked" ? "open" : mr.state;
      return { state, url: mr.web_url ?? null, head: mr.sha ?? null, id: mr.iid != null ? String(mr.iid) : null };
    }
  } catch {
    return UNKNOWN;
  }
  return null;
}

const UNKNOWN = Object.freeze({ state: "unknown", url: null, head: null, id: null });

/**
 * Post a note on an MR the loop opened, and leave it open. Used for an MR the
 * loop builds again: the rebuild force-pushes the same branch, so the MR is
 * replaced only when the new build exists. Never throws.
 */
export async function noteMr({ forge, run, mr, comment }) {
  try {
    if (forge === "gh") return (await run("gh", ["pr", "comment", mr.url ?? mr.id, "--body", comment])).ok;
    if (forge === "glab") return (await run("glab", ["api", "-X", "POST", `projects/:id/merge_requests/${mr.id}/notes`, "-f", `body=${comment}`])).ok;
  } catch {
    return false;
  }
  return false;
}

/** Close an MR the loop opened, with a comment saying why. Never throws. */
export async function closeMr({ forge, run, mr, comment }) {
  try {
    if (forge === "gh") return (await run("gh", ["pr", "close", mr.url ?? mr.id, "--comment", comment])).ok;
    if (forge === "glab") {
      await run("glab", ["api", "-X", "POST", `projects/:id/merge_requests/${mr.id}/notes`, "-f", `body=${comment}`]);
      return (await run("glab", ["api", "-X", "PUT", `projects/:id/merge_requests/${mr.id}`, "-f", "state_event=close"])).ok;
    }
  } catch {
    return false;
  }
  return false;
}

/**
 * Check the recorded stack against what the forge and the remotes say now.
 * `observed[i]` is `{outer: {state, head}, code: {state, head}|null, builtOnBelow?}`
 * for entry i (`state` null when no MR is found, "unknown" when the forge cannot
 * be asked, `head` the remote branch head or null). `builtOnBelow` is
 * `{outer, code}`: true or false when git knows whether the head of the item
 * below is in this item's history (`headsBelow`), null when it cannot say.
 * Walks bottom-up:
 *   - any MR state "unknown": nothing is decided, the stack is kept as it is
 *     and `unreachable` is set (a restart offline must not discard the stack);
 *   - an MR closed, or gone, without a merge: that item and everything above it
 *     are rebuilt;
 *   - merged (both MRs, when there are two): kept, never touched;
 *   - not built on the head of the open item below it: rebuilt, with everything
 *     above. An item below that is merged is not checked: the item was then
 *     built on the default branch, which moves on its own (2026-11-23: every
 *     restart after a merge discarded the stack);
 *   - a remote head that differs from what the loop pushed: the owner changed
 *     it. Kept as the owner left it; everything above is rebuilt on top.
 * @returns {{keep: object[], superseded: object[], notes: string[], unreachable?: boolean}}
 */
export function reconcileStack(entries, observed) {
  const keep = [];
  const notes = [];
  if (observed.some((o) => o?.outer?.state === "unknown" || o?.code?.state === "unknown"))
    return { keep: [...entries], superseded: [], notes: ["the forge could not be asked about the stack's MRs. Nothing was changed."], unreachable: true };
  for (let i = 0; i < entries.length; i++) {
    const e = entries[i];
    const o = observed[i] ?? {};
    const rest = entries.slice(i);
    const states = [o.outer?.state, ...(e.code ? [o.code?.state] : [])];
    if (states.some((s) => s === "closed" || s == null)) {
      notes.push(`${e.title}: its MR was closed without a merge. The loop builds it again, with everything above it.`);
      return { keep, superseded: rest, notes };
    }
    if (states.every((s) => s === "merged")) {
      keep.push({ ...e, merged: true });
      continue;
    }
    if (!builtOnBelow(e.base, keep, o.builtOnBelow)) {
      notes.push(`${e.title}: the item below it changed. The loop builds it again on top.`);
      return { keep, superseded: rest, notes };
    }
    const changed = (o.outer?.head && o.outer.head !== e.outer.head) || (e.code && o.code?.head && o.code.head !== e.code.head);
    if (changed) {
      notes.push(`${e.title}: you changed its MR. Your version is kept, and everything above it is built again on top.`);
      keep.push({
        ...e,
        outer: { ...e.outer, head: o.outer?.head ?? e.outer.head },
        ...(e.code ? { code: { ...e.code, head: o.code?.head ?? e.code.head } } : {}),
        changed: true,
      });
      continue;
    }
    keep.push(e);
  }
  return { keep, superseded: [], notes };
}

/**
 * Is the item built on the head of what is below it now? Per side (outer,
 * code): no item below, or a merged one, is not checked. Otherwise git's
 * answer (`known`, from `headsBelow`) decides, and the recorded base is
 * compared only when git cannot say.
 */
function builtOnBelow(base, kept, known = null) {
  const below = kept[kept.length - 1];
  const codeBelow = [...kept].reverse().find((e) => e.code);
  const side = (item, recorded, k) => {
    if (!item || item.merged) return true;
    if (typeof k === "boolean") return k;
    return !recorded || recorded === item.head;
  };
  const sideOf = (entry, key) => entry?.[key] && { ...entry[key], merged: entry.merged };
  return side(sideOf(below, "outer"), base?.outer, known?.outer) && side(sideOf(codeBelow, "code"), base?.code, known?.code);
}

/**
 * For entry i: the heads git must find in its history, from the item below it
 * as reconcileStack will keep it (the remote head, else the recorded one).
 * `headsBelow(entries, observed, i)` → `{outer, code}`, each a sha or null
 * (null: no open item below on that side, nothing to check).
 */
export function headsBelow(entries, observed, i) {
  const below = i > 0 ? entries[i - 1] : null;
  let j = i - 1;
  while (j >= 0 && !entries[j].code) j--;
  const isMerged = (k, sideKey) => observed[k]?.[sideKey]?.state === "merged";
  return {
    outer: below && !isMerged(i - 1, "outer") ? observed[i - 1]?.outer?.head ?? below.outer.head : null,
    code: j >= 0 && !isMerged(j, "code") ? observed[j]?.code?.head ?? entries[j].code.head : null,
  };
}

/**
 * Where the next item starts and what its MRs target. An item with no code MR
 * (the Carve) passes the code base through from below it.
 * @param {object[]} entries the kept stack, bottom first
 * @returns {{outer: {branch: string, head: string}|null, code: {branch: string, head: string}|null}}
 */
export function stackTop(entries) {
  const live = entries.filter((e) => !e.merged);
  const top = live[live.length - 1] ?? null;
  const codeTop = [...live].reverse().find((e) => e.code) ?? null;
  return {
    outer: top ? { branch: top.outer.branch, head: top.outer.head } : null,
    code: codeTop ? { branch: codeTop.code.branch, head: codeTop.code.head } : null,
  };
}

/** The line every stacked MR carries: what to merge before it. */
export function stackNote({ below }) {
  if (!below) return "> **Stacked run:** this is the first MR of the stack. Merge without squashing, and let the source branch be deleted: the MR above it then moves to the default branch.\n\n";
  return `> **Stacked run:** this MR is built on ${below}. Merge that one first, without squashing, and let its source branch be deleted: this MR then moves to the default branch.\n\n`;
}

/**
 * I1: the owner actions of an item, from the Ship beat and from the diff. A
 * driver hint the Ship beat already covers is not said twice: dependencies it
 * names, and the backup-then-migration hint when it names a backup and a migration.
 */
export function ownerActionsOf(e) {
  const said = (e.ownerActions ?? []).join(" ").toLowerCase();
  const namesMigration = /back(ed)? ?up|backup/.test(said) && /migrat|alembic|upgrade head/.test(said);
  const hints = (e.detected ?? []).filter((h) => {
    if (namesMigration && /^Back up the database, then run the new migration/.test(h)) return false;
    const deps = [...h.matchAll(/([\w.@/:-]+) [\w.+!-]+ \((?:npm|pypi|go|cargo|maven|rubygems|composer|nuget)\)/g)].map((m) => m[1].toLowerCase());
    return !deps.length || !deps.every((d) => said.includes(d));
  });
  return [...(e.ownerActions ?? []), ...hints];
}

const money = (n) => `$${(Math.round((Number(n) || 0) * 100) / 100).toFixed(2)}`;

/**
 * The final report: the MRs in merge order, what each does, the decisions the
 * loop took alone, what stopped the run, and the cost.
 * With a configured `risk`, each item shows its tier, and `autoMerge` (the
 * walk the loop ran) lists what the loop merged and where it stopped.
 * @param {{project: string, entries: object[], stop: {status: string, reason?: string, item?: string, round?: string}|null, notes?: string[], now?: string,
 *   risk?: object|null, autoMerge?: {lines: string[], merged: string[], code: number}|null}} input
 */
export function renderStackReport({ project, entries, stop = null, notes = [], now = new Date().toISOString(), risk = null, autoMerge = null }) {
  const lines = [`# Loop report: ${project}`, "", `_${now.slice(0, 16).replace("T", " ")}. Written by \`carja loop ${project}\`; the next run rewrites it._`, ""];
  const tierLine = (e) => {
    const t = itemTier(e, risk);
    return `- Risk: **${t.tier}** (${t.reasons.join("; ")}).`;
  };
  if (autoMerge) {
    const done = entries.filter((e) => e.merged && [e.outer?.url, ...(e.code ? [e.code.url] : [])].every((u) => autoMerge.merged.includes(u)));
    lines.push(`## Merged by the loop (${done.length} item${done.length === 1 ? "" : "s"})`, "");
    if (autoMerge.breaker) lines.push(`**Auto-merge breaker:** ${autoMerge.breaker}`, "");
    lines.push(`Your risk setting reviews ${risk.ownerReview.join(", ")} only. The loop merged these through the MR API, after their review and green pipeline. Revert one on the forge if it is wrong.`, "");
    for (const e of done) lines.push(`- ${e.title}: ${[e.code?.url, e.outer?.url].filter(Boolean).join(" + ")}`, `  ${tierLine(e).slice(2)}`);
    if (autoMerge.code !== 0) lines.push("", "Where the merge stopped:", "", ...autoMerge.lines.filter((l) => /stopped|needs you|Risk |not merge/.test(l)).map((l) => `> ${l}`));
    lines.push("");
  }
  const open = entries.filter((e) => !e.merged);
  const total = entries.reduce((s, e) => s + (Number(e.cost_usd) || 0), 0);
  if (!open.length) lines.push("No MR waits for you.", "");
  else {
    lines.push(`## Merge these MRs in this order (${open.length} item${open.length === 1 ? "" : "s"})`, "");
    lines.push("Merge each one without squashing, and let its source branch be deleted: the MR above it then moves to the default branch. In each item, merge the code MR first, then the Carja state MR.", "", `\`carja merge-stack ${project}\` does these merges for you, and stops before an item with owner actions, at a red pipeline or a conflict.`, "");
    open.forEach((e, i) => {
      lines.push(`### ${i + 1}. ${e.title}`, "");
      if (e.code?.url) lines.push(`- Code MR: ${e.code.url}`);
      lines.push(`- ${e.code?.url ? "Carja state MR" : "MR"}: ${e.outer.url ?? "(not opened)"}`);
      if (e.summary) lines.push(`- What it does: ${e.summary}`);
      if (e.adopted) lines.push("- Built by an earlier run, taken into this stack as it was.");
      if (e.changed) lines.push("- You changed this MR: your version is kept.");
      if (risk?.configured) lines.push(tierLine(e));
      // I1: what the owner does around this merge, from the Ship beat and from the diff.
      const actions = ownerActionsOf(e);
      if (actions.length) {
        lines.push("- Owner actions, around this merge:");
        for (const a of actions) lines.push(`  - ${a}`);
      } else lines.push("- Owner actions: none.");
      // I3: documents the loop merged from both sides.
      if (e.docsMerged?.length) lines.push(`- Carja documents merged from both sides, read them before you merge: ${e.docsMerged.map((f) => `\`${f}\``).join(", ")}.`);
      const decided = (e.rulings ?? []).filter((r) => r && (r.decision || r.text));
      if (decided.length) {
        lines.push("- Decided for you (overrule in the MR):");
        for (const r of decided) lines.push(`  - ${r.risk === "high" ? "**high** " : ""}${r.decision ?? r.text}${r.why ? `: ${r.why}` : ""}`);
      } else lines.push("- Decided for you: nothing.");
      if (e.cost_usd != null) lines.push(`- Cost: ≈ ${money(e.cost_usd)} at list price`);
      lines.push("");
    });
  }
  if (notes.length) lines.push("## What changed since the last run", "", ...notes.map((n) => `- ${n}`), "");
  lines.push("## Where the run stopped", "");
  if (!stop || stop.status === "done") lines.push(`${RUN_DONE_LINE} Nothing is left to build until you merge or reject an MR.`);
  else if (stop.status === "awaiting_answers")
    lines.push(`${stop.item ?? "An item"} needs your decision on a one-way door. Answer each question in \`${stop.round ?? "carja/1-workbench/questions/"}\` with an option number, then run \`carja loop ${project}\` again. Nothing was built above it.`);
  else lines.push(`${stop.item ?? "The run"} stopped: ${stop.status}${stop.reason ? `. ${stop.reason}` : ""}. Read carja/1-workbench/loop-messages.md, then run \`carja loop ${project}\` again: it continues from there.`);
  lines.push("", `Total cost of the open items: ≈ ${money(total)} at list price.`, "");
  return lines.join("\n");
}

/**
 * I1: the bullets of the ship body's "Owner actions" section (commands, backups,
 * migrations, environment variables, dependencies, configuration). [] when the
 * section is absent or says none.
 */
export function ownerActionsFromBody(body) {
  const m = String(body ?? "").match(/##\s*Owner actions\s*\n+([\s\S]*?)(\n##\s|$)/i);
  if (!m) return [];
  const items = m[1].split("\n").map((l) => l.replace(/^\s*[-*]\s*/, "").trim()).filter(Boolean);
  return items.length === 1 && /^none\.?$/i.test(items[0]) ? [] : items.slice(0, 20);
}

/** The first line of the ship body's "What changes for you" section, as the item's summary. */
export function summaryFromBody(body) {
  const m = String(body ?? "").match(/##\s*What changes for you\s*\n+([\s\S]*?)(\n##\s|$)/i);
  const text = (m ? m[1] : String(body ?? "")).split("\n").map((l) => l.replace(/^[-*]\s*/, "").trim()).find(Boolean);
  return text ? text.slice(0, 240) : null;
}
