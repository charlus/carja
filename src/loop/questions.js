// src/loop/questions.js
//
// Unattended Lifecycle step 4 (docs/roadmap/Unattended-Lifecycle.md, D1, D5).
// A stage that meets a one-way door (cannot be undone cheaply, contradicts an
// earlier decision, changes what the product costs to run) writes one round of
// questions instead of deciding alone or stopping the run:
//
//   # Questions: <task id> (<stage>)
//   ## Q1. <title>
//   <two sentences in user terms>
//   1. <option> — <consequence for a user>
//   2. <option> — <consequence>
//   **Recommendation:** <n>, because …
//   **If wrong:** <what a wrong choice costs>
//   Answer:
//
// The owner writes a number, or "your pick", after `Answer:`. All pure.

import { parseRulings } from "./rulings.js";

export const QUESTIONS_REL = "carja/1-workbench/questions";

/** A file-safe key for a task id: `slice:notes-app/02-sync` → `slice-notes-app-02-sync`. */
export function roundKey(id) {
  return String(id ?? "round").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}

/** Parse a round file. Unknown lines are ignored. */
export function parseRound(text) {
  const lines = String(text ?? "").split("\n");
  const head = lines.find((l) => /^# Questions:/.test(l)) ?? "";
  const hm = head.match(/^# Questions:\s*(.+?)\s*(?:\(([^)]*)\))?\s*$/);
  const round = { task: hm?.[1] ?? null, stage: hm?.[2] ?? null, questions: [] };
  let q = null;
  for (const line of lines) {
    const qm = line.match(/^## Q(\d+)\.?\s*(.*)$/);
    if (qm) {
      q = { n: Number(qm[1]), title: qm[2].trim(), options: [], recommendation: null, ifWrong: null, answer: null };
      round.questions.push(q);
      continue;
    }
    if (!q) continue;
    const om = line.match(/^\s*(\d+)\.\s+(.+)$/);
    if (om) q.options.push({ n: Number(om[1]), text: om[2].trim() });
    const rm = line.match(/^\*\*Recommendation:\*\*\s*(.+)$/);
    if (rm) q.recommendation = (rm[1].match(/^\s*(\d+)/)?.[1]) ?? null;
    const wm = line.match(/^\*\*If wrong:\*\*\s*(.+)$/);
    if (wm) q.ifWrong = wm[1].trim();
    const am = line.match(/^Answer:\s*(.*)$/);
    if (am) q.answer = am[1].trim() ? am[1].trim() : null;
  }
  return round;
}

/** The format, checked in code. The Checker judges the rest (D1's quality bar). */
export function checkRound(round) {
  const reasons = [];
  if (!round?.questions?.length) reasons.push("the round has no question (`## Q1. …`)");
  for (const q of round?.questions ?? []) {
    if (q.options.length < 2) reasons.push(`Q${q.n} has fewer than 2 options`);
    if (!q.recommendation) reasons.push(`Q${q.n} has no Recommendation`);
    else if (!q.options.some((o) => String(o.n) === q.recommendation)) reasons.push(`Q${q.n}'s Recommendation is not one of its options`);
    if (!q.ifWrong) reasons.push(`Q${q.n} has no If wrong line`);
  }
  return { ok: reasons.length === 0, reasons };
}

function validAnswer(q) {
  if (!q.answer) return false;
  if (/^your pick$/i.test(q.answer)) return true;
  const n = q.answer.match(/^(\d+)/)?.[1];
  return Boolean(n && q.options.some((o) => String(o.n) === n));
}

/** True when every question has a number of one of its options, or "your pick". */
export function roundAnswered(round) {
  return Boolean(round?.questions?.length) && round.questions.every(validAnswer);
}

/**
 * The measurement (D1): how often the owner overrules a ruling (they append
 * `· overruled: <why>` to its line) and how often an answer takes the
 * recommendation ("your pick" counts as taking it). Near-total acceptance means
 * the loop asks too much.
 */
export function decisionStats({ rulingsText = "", answeredRounds = [] }) {
  const rulings = parseRulings(rulingsText);
  let answered = 0;
  let took = 0;
  for (const text of answeredRounds) {
    for (const q of parseRound(text).questions) {
      if (!validAnswer(q)) continue;
      answered += 1;
      if (/^your pick$/i.test(q.answer) || q.answer.match(/^(\d+)/)?.[1] === q.recommendation) took += 1;
    }
  }
  return { rulings: rulings.length, overruled: rulings.filter((r) => /·\s*overruled\b/i.test(r.line)).length, answered, tookRecommendation: took };
}
