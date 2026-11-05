// src/loop/rulings.js
//
// A12 (docs/roadmap/Superlite-Imports.md): the ruling log. An unattended Maker
// decides product questions alone; before this, only its diff showed what it
// chose. It appends one line per decision the spec did not settle to
// carja/1-workbench/rulings.md:
//
//   - [YYYY-MM-DD HH:MM] <task id> · <decision> · why: <reason> · if wrong: low|medium|high · <what breaks>
//
// The driver reads the lines a beat added. Every ruling goes in the PR body; a
// `high` one also goes to the inbox and the run continues (owner D4); the
// Checker receives them as review input. Code cannot force a Maker to log a
// decision: the format is parsed, and completeness could only be measured by an
// eval. All functions are pure.

import { envelopeUntrusted } from "./untrusted.js";

export const RULINGS_REL = "carja/1-workbench/rulings.md";
export const RULING_FORMAT =
  "- [YYYY-MM-DD HH:MM] <task id> · <decision> · why: <reason> · if wrong: low|medium|high · <what breaks>";

const LINE_RE = /^\s*-\s*\[([^\]]+)\]\s*(.+?)\s*·\s*(.+?)\s*·\s*why:\s*(.+?)\s*·\s*if wrong:\s*([A-Za-z]+)\s*·\s*(.+?)\s*$/;
const RISKS = ["low", "medium", "high"];

/** Every well-formed ruling line in `text`. An unknown risk counts as high. */
export function parseRulings(text) {
  const out = [];
  for (const line of String(text ?? "").split("\n")) {
    const m = line.match(LINE_RE);
    if (!m) continue;
    const risk = m[5].toLowerCase();
    out.push({
      at: m[1].trim(),
      task: m[2].trim(),
      decision: m[3].trim(),
      why: m[4].trim(),
      risk: RISKS.includes(risk) ? risk : "high",
      breaks: m[6].trim(),
      line: line,
    });
  }
  return out;
}

/** The rulings in `after` whose line was not already in `before`. */
export function newRulings(before, after) {
  const seen = new Set(String(before ?? "").split("\n"));
  return parseRulings(after).filter((r) => !seen.has(r.line));
}

/** One inbox line per `high` ruling (D4: the owner sees it before the merge). */
export function rulingInboxLines(rulings) {
  return (rulings ?? [])
    .filter((r) => r.risk === "high")
    .map((r) => `high-risk ruling by the Maker (${r.task}): ${r.decision}. Why: ${r.why}. If wrong: ${r.breaks}.`);
}

function bullet(r) {
  return `- **${r.risk}** · ${r.decision} — why: ${r.why} — if wrong: ${r.breaks}`;
}

/** The PR body: `base`, then every ruling, high first. */
export function rulingsPrBody(rulings, base) {
  const list = [...(rulings ?? [])].sort((a, b) => RISKS.indexOf(b.risk) - RISKS.indexOf(a.risk));
  if (!list.length) return base;
  return `${base}\n\n## Decisions the Maker made alone (${list.length})\n\n${list.map(bullet).join("\n")}\n`;
}

/** The Checker's extra input: the rulings as data, and what to do with them. */
export function rulingsForChecker(rulings) {
  if (!rulings?.length) return "";
  return [
    "# Decisions the Maker made alone",
    "",
    "The Maker logged these decisions, which the spec did not settle. A ruling that contradicts the spec or an acceptance criterion is a finding. A ruling that changes what a user sees or does, rated low, is a finding too: say so.",
    "",
    envelopeUntrusted(rulings.map(bullet).join("\n"), { source: "the Maker's ruling log (carja/1-workbench/rulings.md)" }),
  ].join("\n");
}

/** The instruction a beat carries, with its task id filled in. */
export function rulingHint(taskId = "<task id>") {
  return (
    `When you decide something the spec does not settle, append one line to \`${RULINGS_REL}\`: ` +
    `\`- [YYYY-MM-DD HH:MM] ${taskId} · <decision> · why: <reason> · if wrong: low|medium|high · <what breaks>\`. ` +
    "Rate `high` anything a user would notice or that is hard to undo. The PR lists every ruling, and a `high` one goes to the owner's inbox."
  );
}
