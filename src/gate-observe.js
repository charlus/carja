// src/gate-observe.js
//
// F8 (docs/roadmap/Risk-Tiered-Merge.md): a gate in observe mode
// (gates.<name> = "observe" in carja.config.json) logs each commit it would
// have blocked to <git common dir>/carja-gate-observe.log, one tab-separated
// line: date, gate, branch, HEAD. `carja status` counts them, so the owner
// judges a gate's false positives before switching it to enforce. Pure.

export const OBSERVE_LOG = "carja-gate-observe.log";

/** Lines of the last `days` days, counted per gate: {count, days, byGate: [{gate, count}]}. */
export function summariseObserved(text, { now = Date.now(), days = 30 } = {}) {
  const since = now - days * 86400000;
  const by = new Map();
  let count = 0;
  for (const line of String(text ?? "").split("\n")) {
    const [at, gate] = line.split("\t");
    if (!gate) continue;
    const t = Date.parse(String(at).replace(" ", "T"));
    if (!Number.isFinite(t) || t < since) continue;
    count += 1;
    by.set(gate, (by.get(gate) ?? 0) + 1);
  }
  return { count, days, byGate: [...by].map(([gate, n]) => ({ gate, count: n })).sort((a, b) => b.count - a.count) };
}
