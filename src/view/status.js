// src/view/status.js
//
// The terminal renderer over the shared state — `carja status`.
//
// This is the surface that replaces "what's on our plate for today". It answers
// that question in one screen, instantly, for zero tokens and zero context: no
// agent turn, no `ls`, no `vim`. That cost difference is the reason state stays
// in the terminal while long documents go to the HTML view — asking an agent to
// summarise the backlog costs a whole turn every time, and it is the question
// asked most often.
//
// Reads the SAME state object `carja view` renders, on purpose. Two parsers
// would eventually disagree and then neither surface would be trusted.

import { stripInlineMarkdown } from "./markdown.js";
import { usageSummary } from "../loop/usage.js";

const ANSI = {
  reset: "\u001b[0m",
  dim: "\u001b[2m",
  bold: "\u001b[1m",
  red: "\u001b[31m",
  yellow: "\u001b[33m",
  green: "\u001b[32m",
  blue: "\u001b[34m",
  magenta: "\u001b[35m",
  cyan: "\u001b[36m",
};

const TYPE_COLOUR = { bugfix: "red", task: "blue", triage: "yellow", build: "magenta" };
const PRIORITY_COLOUR = { P1: "red", P2: "yellow", P3: "dim" };

/** Cap so the digest always fits one screen — the whole point of it. */
const MAX_QUEUE_ROWS = 6;
const MAX_STALE_ROWS = 3;

export function painter(enabled) {
  return (text, ...styles) => {
    if (!enabled || !styles.length) return String(text);
    const codes = styles.map((s) => ANSI[s] ?? "").join("");
    return `${codes}${text}${ANSI.reset}`;
  };
}

/**
 * Fit a title to a column. Inline markup is stripped first: a real backlog line
 * is `**DB-1: fix it.** Add \`pool_pre_ping\``, and a terminal cannot render
 * that, so showing the markers is just noise in the one view meant to be
 * scannable at a glance.
 */
function truncate(text, width) {
  const s = stripInlineMarkdown(text);
  return s.length <= width ? s : `${s.slice(0, width - 1)}…`;
}

/**
 * One line describing the loop, read from the REAL v2 `loop-state.json` shape.
 *
 * `phase` leads because it is the field that gates a run: the driver refuses to
 * start in `discovery` (the Scoping Barrier), so someone checking status wants
 * that before anything else. The beat counter lives at `iterations.current`,
 * not a top-level `beat` — an earlier version of this function read the latter
 * and never rendered, because its test fixture was invented rather than taken
 * from the shipped file. The test now loads the template itself.
 */
function loopLine(loop) {
  if (!loop) return "not started";
  const parts = [];
  if (loop.phase) parts.push(loop.phase);
  if (loop.status) parts.push(loop.status);
  const current = loop.iterations?.current;
  if (Number.isFinite(Number(current))) {
    const max = loop.iterations?.max_allowed;
    parts.push(`beat ${current}${Number.isFinite(Number(max)) ? `/${max}` : ""}`);
  }
  if (loop.autonomy_level) parts.push(loop.autonomy_level);
  // A14: what the last run cost, by role (a list-price estimate on a subscription).
  const cost = loop.budget ? usageSummary(loop) : "";
  if (cost) parts.push(cost);
  return parts.length ? parts.join(" · ") : "unknown";
}

/**
 * One line for the ship-log. The merge count is labelled "in this repo" on
 * purpose: status may be run in a state-only wrapper repo whose merges are not
 * the code's, and an unlabelled number there would mislead.
 */
function shipLogLine(shipLog, c) {
  if (!shipLog || !shipLog.lastDate) return c("no dated entry yet", "dim");
  const parts = [shipLog.lastDate, `${shipLog.ageDays}d ago`];
  let style = shipLog.ageDays >= 30 ? "yellow" : null;
  if (Number.isFinite(shipLog.mergesSince)) {
    const n = shipLog.mergesSince;
    parts.push(`${n} merge${n === 1 ? "" : "s"} in this repo since`);
    if (n > 0) style = "red";
  }
  const text = parts.join(" · ");
  return style ? c(text, style) : text;
}

/**
 * One line for the push gate: the command pre-push will run, a declared OFF, or
 * a loud gap that carries its own fix. The gap used to name a config key, which
 * left the reader to work out where that key lived and what a valid value was.
 */
function verifyLine(verify, c) {
  if (verify?.configured) return verify.command;
  if (verify?.state === "none") return c("off by choice — this project declares nothing to verify", "dim");
  return c('OFF — pushes run no test · fix: carja verify --set "<cmd>"', "red");
}

/**
 * One line for the git gates: armed, or why not and the fix. "Armed" is what
 * git will do, not what is installed — a lost executable bit or a foreign
 * hooksPath leaves every law as prose, and nothing else on screen says so.
 */
function gatesLine(gates, c) {
  switch (gates.hooks) {
    case "not-git":
      return c("not a git repository — nothing to wire", "dim");
    case "missing":
      return c("OFF — .agents/hooks/ is missing · fix: carja upgrade", "red");
    case "custom":
      return c(`not wired — core.hooksPath is '${gates.customPath}' · see .agents/hooks/README.md`, "yellow");
    case "on": {
      const names = [gates.guards?.bypass && "bypass blocker", gates.guards?.factGate && "fact gate"].filter(Boolean);
      const guards = names.length
        ? `agent guard${names.length > 1 ? "s" : ""}: ${names.join(", ")}`
        : "agent guards: none (opt-in)";
      const unguarded = (gates.nested || []).filter((n) => n.hooks !== "on").map((n) => `${n.repo}/`);
      if (unguarded.length)
        return c(`code NOT gated in ${unguarded.join(", ")} · fix: carja install-hooks`, "red");
      const scope = gates.nested?.length ? ` (${gates.nested.map((n) => `${n.repo}/`).join(", ")} too)` : "";
      return `on · commit + push${scope} · ${c(guards, "dim")}`;
    }
    default:
      return c("OFF — commits and pushes are not checked · fix: carja install-hooks", "red");
  }
}

/**
 * One line for the local commits and pushes that skipped the hooks, or null
 * when there are none or it cannot tell. "Gates on" is configuration; this is
 * what happened.
 */
function skippedLine(skipped, c) {
  if (!skipped || (!skipped.commits.length && !skipped.pushes)) return null;
  const n = skipped.commits.length;
  const parts = [];
  if (n) {
    const shown = skipped.commits.slice(0, 3).join(", ") + (n > 3 ? ", …" : "");
    parts.push(`${n} commit${n > 1 ? "s" : ""} skipped the hooks (${shown})`);
  }
  if (skipped.pushes) parts.push(`${skipped.pushes} push${skipped.pushes > 1 ? "es" : ""} skipped the hooks`);
  return c(`${parts.join(", ")} in ${skipped.days} days · --no-verify, CARJA_HOOKS=off or a git client that ignores hooks`, "yellow");
}

/** One line for the waivers logged in the window. A waived gate is not a gate. */
function waiversLine(waivers, c) {
  if (!waivers?.count) return c(`none in ${waivers?.days ?? 30} days`, "dim");
  const kinds = waivers.byKind.map((k) => `${k.kind} ×${k.count}`).join(", ");
  return c(`${waivers.count} in ${waivers.days} days · ${kinds}`, "yellow");
}

const MR_COLOUR = { merged: "green", open: "cyan", closed: "dim", unknown: "yellow" };
/** Entries whose merged MRs are listed one by one; older ones collapse. */
const MAX_LIVE_ENTRIES = 2;

/**
 * The live section of `carja status --live`: each MR the newest ship-log
 * entries name, as the forge reports it now, and the project's deploy check.
 * The check time leads, because this block is only true at that moment.
 *
 * @param {object} live from collectLive
 * @param {Function} c painter
 * @returns {string}
 */
export function renderLive(live, c) {
  const lines = [];
  lines.push(`  ${c("Live", "bold")} ${c(`— checked ${live.checkedAt.slice(0, 16).replace("T", " ")} UTC, true only now`, "dim")}`);
  if (!live.mrs.length) lines.push(`   ${c("no MR in the newest ship-log entries", "dim")}`);
  // One screen: a merged MR from an older entry is the expected case, so it
  // collapses. Open, unknown and stale ones always show; they are the point.
  const recent = [...new Set(live.mrs.map((m) => m.entryDate))].sort().reverse().slice(0, MAX_LIVE_ENTRIES);
  const shown = live.mrs.filter((m) => m.state !== "merged" || m.stale || recent.includes(m.entryDate));
  const hidden = live.mrs.length - shown.length;
  for (const mr of shown) {
    const state = mr.state === "unknown" ? `unknown · ${mr.reason}` : `${mr.state}${mr.at ? ` ${mr.at}` : ""}`;
    lines.push(`   ${mr.label.padEnd(6)} ${c(state, MR_COLOUR[mr.state] ?? "dim")}  ${c(`${mr.entryDate} ${mr.entryTitle}`, "dim")}`);
    if (mr.stale) lines.push(`          ${c(`stale: ${mr.stale}, the forge says ${mr.state}`, "red")}`);
  }
  if (hidden) lines.push(`   ${c(`${hidden} older MR${hidden === 1 ? "" : "s"} merged · carja status --live --json for all`, "dim")}`);
  if (live.deploy.state === "ask") {
    lines.push(`   ${"Deploy".padEnd(6)} ${c("not checked · no deployCheck in carja.config.json · ask the human", "yellow")}`);
  }
  for (const d of live.deploy.checks) {
    const where = d.repo ? ` (${d.repo}/)` : "";
    lines.push(`   ${"Deploy".padEnd(6)} ${c(`$ ${d.command}${where} · exit ${d.code}`, d.code === 0 ? "dim" : "red")}`);
    for (const l of d.output.split("\n").filter(Boolean)) lines.push(`          ${l}`);
  }
  return lines.join("\n");
}

/**
 * Render the digest.
 *
 * @param {object} state from buildState
 * @param {{color?: boolean, width?: number}} [opts]
 * @returns {string}
 */
export function renderStatus(state, { color = true, width = 78 } = {}) {
  const c = painter(color);
  const d = state.digest;
  const p = d.byPriority ?? {};
  const lines = [];
  const titleWidth = Math.max(24, width - 30);

  lines.push("");
  lines.push(
    `  ${c(state.projectName, "bold")} ${c("· carja", "dim")}` +
      `  ${c(new Date(state.generatedAt).toLocaleString(), "dim")}`
  );
  lines.push("");

  const stat = (label, value, style) =>
    `${c(label.padEnd(9), "dim")}${c(String(value).padStart(3), ...(style ? [style, "bold"] : ["bold"]))}`;

  lines.push(
    `  ${stat("Inbox", d.inboxCount, d.inboxCount ? "cyan" : null)}   ` +
      `${stat("Backlog", d.backlogOpen)}   ${stat("Docs", d.docCount)}`
  );
  lines.push(
    `  ${stat("P1", p.P1 ?? 0, p.P1 ? "red" : null)}   ` +
      `${stat("P2", p.P2 ?? 0, p.P2 ? "yellow" : null)}   ${stat("P3", p.P3 ?? 0)}`
  );
  lines.push(`  ${c("Loop".padEnd(9), "dim")}${loopLine(d.loop)}`);
  lines.push(`  ${c("Ship-log".padEnd(10), "dim")}${shipLogLine(d.shipLog, c)}`);
  lines.push(`  ${c("Push gate".padEnd(10), "dim")}${verifyLine(d.verify, c)}`);
  if (d.gates) {
    lines.push(`  ${c("Gates".padEnd(10), "dim")}${gatesLine(d.gates, c)}`);
    const skipped = d.gates.hooks === "on" ? skippedLine(d.gates.skipped, c) : null;
    if (skipped) lines.push(`  ${c("Skipped".padEnd(10), "dim")}${skipped}`);
    if (d.gates.hooks !== "not-git") {
      lines.push(`  ${c("Waivers".padEnd(10), "dim")}${waiversLine(d.gates.waivers, c)}`);
    }
  }

  // Leads everything below the digest: across several products this is the
  // only line that cannot be answered by anyone else. Absent when empty — an
  // empty heading trains the eye to skip the section that matters most.
  const waiting = d.shipLog?.openDecisions ?? [];
  if (waiting.length) {
    lines.push("");
    lines.push(`  ${c("Waiting on you", "bold")} ${c("— raised by a ship, still unanswered", "dim")}`);
    for (const w of waiting.slice(0, MAX_QUEUE_ROWS)) {
      lines.push(`   ${c(w.date, "dim")}  ${c(w.title, "cyan")}`);
      lines.push(`            ${w.question}`);
    }
  }

  if (state.queue.length) {
    lines.push("");
    lines.push(`  ${c("Next up", "bold")} ${c("— the order the loop would drain it", "dim")}`);
    state.queue.slice(0, MAX_QUEUE_ROWS).forEach((item, i) => {
      const type = c(item.type.padEnd(7), TYPE_COLOUR[item.type] ?? "blue");
      // Titles are padded to a fixed column so the priorities line up and the
      // eye can read down them — the thing a raw markdown list cannot do.
      const title = truncate(item.title, titleWidth).padEnd(titleWidth);
      const priority = item.priority
        ? c(item.priority, PRIORITY_COLOUR[item.priority] ?? "dim")
        : "";
      lines.push(`   ${c(String(i + 1).padStart(2), "dim")}  ${type} ${title} ${priority}`.trimEnd());
    });
    if (state.queue.length > MAX_QUEUE_ROWS) {
      lines.push(`   ${c(`   … ${state.queue.length - MAX_QUEUE_ROWS} more`, "dim")}`);
    }
  }

  if (state.stale.length) {
    lines.push("");
    lines.push(`  ${c("Not touched in a while", "bold")}`);
    state.stale.slice(0, MAX_STALE_ROWS).forEach((item) => {
      lines.push(
        `   ${c("·", "dim")}  ${truncate(item.title, titleWidth)} ${c(`${item.ageDays}d`, "dim")}`
      );
    });
  }

  if (!d.docCount && !d.inboxCount && !d.backlogOpen) {
    lines.push("");
    lines.push(`  ${c("Nothing here yet.", "bold")}`);
    lines.push(`  Capture an idea:  ${c('carja inbox add "…"', "cyan")}   ${c("or /inbox in chat", "dim")}`);
    lines.push(`  Start something:  ${c("/genesis", "cyan")}`);
  }

  lines.push("");
  lines.push(
    `  ${c("carja view --open", "cyan")}  ${c("full dashboard (rendered docs, search, backlinks)", "dim")}`
  );
  lines.push("");

  return lines.join("\n");
}
