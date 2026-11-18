// src/review-rules.js
//
// F9 (docs/roadmap/Risk-Tiered-Merge.md): turn misses into rules, after the
// Claude Code team: a pattern becomes a candidate rule only when it occurs in
// at least two changes, and a human approves it in a PR. Here the changes are
// slices of the review log (carja/1-workbench/review-log.jsonl): a class of
// findings the author FIXED (so the reviewer was right) in two or more slices
// is a candidate for the architecture checklist, with a `check:` command when
// a diff can show it. Dismissed findings never make a rule. Pure.

/** [{category, detail, slices, count, examples}] most frequent first. */
export function ruleCandidates(records, { minSlices = 2 } = {}) {
  const groups = new Map();
  for (const r of records ?? []) {
    if (r?.action !== "fixed" || !r.slice) continue;
    const key = `${r.category}\u0000${String(r.detail ?? "").trim().toLowerCase()}`;
    const g = groups.get(key) ?? { category: r.category, detail: r.detail ?? null, slices: new Set(), count: 0, examples: [] };
    g.slices.add(r.slice);
    g.count += 1;
    const ex = { file: r.file ?? null, line: r.line ?? null, quote: r.quote ?? null };
    if (g.examples.length < 3 && !g.examples.some((e) => e.file === ex.file && e.line === ex.line)) g.examples.push(ex);
    groups.set(key, g);
  }
  return [...groups.values()]
    .filter((g) => g.slices.size >= minSlices)
    .map((g) => ({ ...g, slices: [...g.slices].sort() }))
    .sort((a, b) => b.count - a.count);
}
