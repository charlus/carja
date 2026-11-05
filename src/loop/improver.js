// src/loop/improver.js
//
// Cross-run self-improvement (P2.1) — Carja's answer to agentctl's
// `process_improver`. After a run, mine the DURABLE, cross-run failure trail (the
// ship-log, appended every run) for patterns that recur >= a threshold, and
// surface them as a review doc proposing project-specific rules. The `.agents/
// rules/*.md` files auto-load every beat, so a recurring failure that a rule
// could prevent is exactly the leverage point.
//
// Deliberately PROPOSE, don't auto-mutate: a rule changes EVERY future beat, so
// an auto-generated one landing unreviewed could quietly derail the whole fleet.
// Detection is deterministic + pure here; a human (or a gated agent step) decides
// what actually becomes a rule. Guarded by agentctl's >=2-occurrence threshold so
// a one-off blip never becomes a rule.
//
// Pure: parse/cluster/render take strings and return values. loop.js does the IO.

/** Ship-log lines look like: `- [<iso>] [loop] <message>`. Extract the messages. */
export function parseShipLogMessages(shipLogMd) {
  const out = [];
  for (const raw of String(shipLogMd ?? "").split("\n")) {
    const m = raw.match(/^\s*-\s*\[([^\]]+)\]\s*\[loop\]\s*(\S.*?)\s*$/);
    if (m) out.push({ ts: m[1], message: m[2] });
  }
  return out;
}

// Each matcher turns a failure message into a typed signal. Success/among-info
// lines (shipped, harvested, claim, auto-captured-clean) are intentionally NOT
// signals — we mine what went WRONG.
const SIGNAL_MATCHERS = [
  // Infra outage (Checker never ran/emitted a verdict) — matched BEFORE the
  // content-rejection signal so an outage never clusters as a missing acceptance
  // criterion. A rule addressed to an agent cannot fix a beat where none ran.
  { kind: "checker-infra", re: /^checker infra-failure:\s*(.+)$/i, reason: (m) => m[1] },
  { kind: "checker-rejection", re: /^checker rejected:\s*(.+)$/i, reason: (m) => m[1] },
  { kind: "task-failure", re: /^task\s+\S+:\s*failed\s*\((.+)\)\s*$/i, reason: (m) => m[1] },
  { kind: "merge-failure", re: /merge failed(?::|\s*→)\s*(.*)$/i, reason: (m) => m[1] || "unknown" },
  { kind: "halt", re: /(?:pre-flight\s+)?halt:\s*(\S+)\s*—\s*(.+)$/i, reason: (m) => `${m[1]}: ${m[2]}` },
  { kind: "hook-bypass", re: /commit hook bypassed/i, reason: () => "a commit hook rejected the maker's commit (bypassed with --no-verify)" },
];

/** Classify one ship-log message into a failure signal, or null if it isn't one. */
export function classifyMessage(message) {
  for (const { kind, re, reason } of SIGNAL_MATCHERS) {
    const m = String(message ?? "").match(re);
    if (m) return { kind, reason: reason(m).trim(), raw: message };
  }
  return null;
}

/**
 * Normalize a reason so DIFFERENT-BUT-SAME failures cluster together: lowercase,
 * blank out the run-specific specifics (backticked tokens, task ids, paths,
 * numbers) that would otherwise split one recurring pattern into many singletons.
 */
export function normalizeReason(reason) {
  return String(reason ?? "")
    .toLowerCase()
    .replace(/`[^`]*`/g, "‹token›")
    .replace(/\btask:[a-z0-9._-]+/gi, "‹task›")
    .replace(/\b[\w./-]+\.(?:js|ts|jsx|tsx|py|go|rs|java|rb|md|json)\b/gi, "‹path›")
    .replace(/\b\d+\b/g, "#")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Mine a ship-log into recurring failure patterns.
 * @returns {Array<{kind,key,count,reason,samples:string[]}>} count-desc, count >= threshold.
 */
export function mineRecurringFailures(shipLogMd, { threshold = 2 } = {}) {
  const clusters = new Map();
  for (const { message } of parseShipLogMessages(shipLogMd)) {
    const sig = classifyMessage(message);
    if (!sig) continue;
    const key = `${sig.kind}::${normalizeReason(sig.reason)}`;
    if (!clusters.has(key)) clusters.set(key, { kind: sig.kind, key, count: 0, reason: sig.reason, samples: [] });
    const c = clusters.get(key);
    c.count += 1;
    if (c.samples.length < 3) c.samples.push(sig.raw);
  }
  return [...clusters.values()]
    .filter((c) => c.count >= threshold)
    .sort((a, b) => b.count - a.count);
}

/** A short, human-actionable rule suggestion per failure kind. */
function suggestionFor(kind) {
  switch (kind) {
    case "checker-infra":
      return "This is an INFRASTRUCTURE/outage signal — the Checker process could not run or write a verdict (e.g. an agent-CLI usage/session limit or crash), NOT a content gap. Do NOT write a `.agents/rules/` rule for it: a rule addressed to an agent cannot fix a beat where no agent ran. Investigate the driver/adapter/CLI instead (see docs/roadmap/Loop-Deadbeat-Robustness.md).";
    case "checker-rejection":
      return "The Checker keeps rejecting for the same reason — encode the missing acceptance criterion as a rule so the Maker satisfies it up front (e.g. a Definition-of-Done check the beat must meet before signaling done).";
    case "task-failure":
      return "Tasks keep failing the same way — add a rule capturing the precondition or step the Maker keeps missing for this class of work.";
    case "merge-failure":
      return "PRs keep failing to open — add a rule/checklist item for the merge preconditions (branch pushed, remote reachable, no divergent stale branch).";
    case "halt":
      return "The loop keeps halting on the same guard — fix the Spine/config precondition (phase, verification command, sandbox, autonomy) so runs stop being refused.";
    case "hook-bypass":
      return "The Maker's commits keep tripping a commit hook — add a rule to run the hook's check (lint/format/test) as part of the beat so commits pass cleanly instead of being bypassed.";
    default:
      return "Recurring failure — consider a project rule to prevent it.";
  }
}

/**
 * Render the review doc for carja/1-workbench/loop-improvements.md. Returns
 * null when there is nothing to propose (so loop.js can skip writing entirely).
 */
export function renderImprovementReport(patterns, { nowIso, threshold = 2 } = {}) {
  if (!patterns || patterns.length === 0) return null;
  const lines = [
    "# Loop Self-Improvement — proposed rules",
    "",
    `> Auto-generated by \`carja loop\` (P2.1). Mined from the loop's audit trail (\`.git/carja-loop-logs/audit.md\`, and \`[loop]\` lines older ship-logs hold); a failure listed here recurred **≥ ${threshold} times** across runs.`,
    "> These are PROPOSALS, not active rules. Review each, and promote the good ones into `.agents/rules/<name>.md` (they auto-load every beat). Delete this file once triaged.",
  ];
  if (nowIso) lines.push(">", `> Generated: ${nowIso}`);
  lines.push("");
  patterns.forEach((p, i) => {
    lines.push(
      `## ${i + 1}. ${p.kind} — seen ${p.count}×`,
      "",
      `**Representative reason:** ${p.reason}`,
      "",
      `**Suggested rule:** ${suggestionFor(p.kind)}`,
      "",
      "<details><summary>evidence</summary>",
      "",
      ...p.samples.map((s) => `- ${s}`),
      "",
      "</details>",
      ""
    );
  });
  return lines.join("\n") + "\n";
}
