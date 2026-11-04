// src/loop/profiles.js
//
// `carja loop profile [quality|balanced] [dir]` (owner decisions D1–D5,
// 2026-10-21): pick the models by budget, never per role by hand. Without a
// name it shows the current profile, the model of each role and the last
// run's cost per role, so the switch is an informed one.

const LABELS = [
  ["maker", "Maker"],
  ["checker", "Checker"],
  ["spec", "Spec"],
  ["blueprint", "Blueprint"],
  ["ship", "Ship"],
];

/** "maker sonnet (opus after 2 rejections), checker opus, …" or a table. */
export function describeModels(models, { inline = false } = {}) {
  const rows = LABELS.filter(([k]) => models[k]).map(([k, label]) => {
    const m = k === "maker" && models.maker_escalation && models.maker_escalation !== models.maker ? `${models.maker} (${models.maker_escalation} after 2 rejections)` : models[k];
    return [label, m];
  });
  if (inline) return rows.map(([l, m]) => `${l.toLowerCase()} ${m}`).join(", ");
  return rows.map(([l, m]) => `    ${l.padEnd(10)} ${m}`).join("\n");
}

/** What the cost figures mean on this machine. */
export function costBasis(env = process.env) {
  return env.ANTHROPIC_API_KEY
    ? "Costs are at list price, which is what an API key pays."
    : "Costs are at list price. On a Claude subscription you do not pay them: they show how fast a run uses your quota.";
}
