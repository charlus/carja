// src/loop/risk.js
//
// The risk block of carja.config.json (owner, 2026-11-18): "low and medium: no
// human review. High: human review. The agent tends to categorize medium for
// things I don't personally care (other users might, but not me)."
//
//   "risk": {
//     "owner_review": ["high"],             // the tiers that wait for the owner
//     "high_means": "Data loss, security, billing.",  // replaces the built-in rule in the beat and Checker prompts
//     "high_paths": ["**/billing/**"],      // always high
//     "low_paths": ["docs/**"]              // low when nothing else raises it
//   }
//
// Without the block, every tier waits for the owner: nothing changes for a
// project that does not opt in. Whatever the block says, `high` always waits,
// an item that changes the gates or this config is high (a change never merges
// an edit to its own checks), and an item Carja has no record of is high
// (fail safe). Pure.

export const TIERS = Object.freeze(["low", "medium", "high"]);

/** Paths that are high in any repository: the gates, the harness settings, and this config. */
export const ALWAYS_HIGH = Object.freeze([".agents/**", ".claude/**", ".github/workflows/**", ".gitlab-ci.yml", "carja.config.json", ".husky/**", ".pre-commit-config.yaml"]);

const BUILT_IN_RULE = "Rate `high` anything a user would notice or that is hard to undo.";

/** `**` matches across folders (and none), `*` within one, `?` one character. */
export function globMatch(glob, path) {
  let re = "";
  const g = String(glob);
  for (let i = 0; i < g.length; i++) {
    const c = g[i];
    if (c === "*" && g[i + 1] === "*") {
      i++;
      if (g[i + 1] === "/") {
        i++;
        re += "(?:.*/)?";
      } else re += ".*";
    } else if (c === "*") re += "[^/]*";
    else if (c === "?") re += "[^/]";
    else re += c.replace(/[.+^${}()|[\]\\]/g, "\\$&");
  }
  return new RegExp(`^${re}$`).test(String(path));
}

const isStringList = (v) => Array.isArray(v) && v.every((x) => typeof x === "string" && x.trim());

/** The `risk` block, checked. */
export function parseRiskConfig(config) {
  const raw = config && typeof config === "object" ? config.risk : undefined;
  const out = { configured: false, ownerReview: [...TIERS], highMeans: null, highPaths: [], lowPaths: [], errors: [], notes: [] };
  if (raw === undefined || raw === null) return out;
  if (typeof raw !== "object" || Array.isArray(raw)) {
    out.errors.push('risk must be an object such as { "owner_review": ["high"] }');
    return out;
  }
  out.configured = true;
  if (raw.owner_review !== undefined) {
    if (Array.isArray(raw.owner_review) && raw.owner_review.every((t) => TIERS.includes(t))) {
      out.ownerReview = TIERS.filter((t) => raw.owner_review.includes(t));
      if (!out.ownerReview.includes("high")) {
        out.ownerReview.push("high");
        out.notes.push("risk.owner_review: high always waits for you, so it was added.");
      }
    } else out.errors.push('risk.owner_review must be a list of tiers: "low", "medium", "high"');
  }
  if (raw.high_means !== undefined && raw.high_means !== null) {
    if (typeof raw.high_means === "string" && raw.high_means.trim()) out.highMeans = raw.high_means.trim();
    else out.errors.push("risk.high_means must be a sentence that says what high risk is for you");
  }
  // A3: the auto-merge breaker (src/loop/breaker.js).
  for (const [key, field] of [["breaker_reverts", "breakerReverts"], ["breaker_days", "breakerDays"]]) {
    if (raw[key] === undefined) continue;
    if (Number.isInteger(raw[key]) && raw[key] >= 0) out[field] = raw[key];
    else out.errors.push(`risk.${key} must be a whole number, 0 or more`);
  }
  for (const [key, field] of [["high_paths", "highPaths"], ["low_paths", "lowPaths"]]) {
    if (raw[key] === undefined) continue;
    if (isStringList(raw[key])) out[field] = raw[key].map((s) => s.trim());
    else out.errors.push(`risk.${key} must be a list of path patterns, such as ["docs/**"]`);
  }
  return out;
}

const MEDIUM_HINT = /^Install the new dependenc/;

/**
 * The tier of one stacked item and why.
 * `entry.files` = {outer: string[], code: string[]}, paths relative to each repository.
 * @returns {{tier: "low"|"medium"|"high", reasons: string[]}}
 */
export function itemTier(entry, risk) {
  const high = [];
  const medium = [];
  const files = entry?.files;
  if (entry?.adopted) high.push("taken from an earlier run, so Carja has no record of its review");
  if (!files || !Array.isArray(files.outer) || !Array.isArray(files.code)) high.push("Carja has no record of the files it changes");
  const all = files && Array.isArray(files.outer) && Array.isArray(files.code) ? [...files.outer, ...files.code] : [];
  const hit = (globs) => all.filter((f) => globs.some((g) => globMatch(g, f)));
  const gates = hit(ALWAYS_HIGH);
  if (gates.length) high.push(`changes a gate or the Carja config: ${gates.join(", ")}`);
  const highPaths = hit(risk.highPaths);
  if (highPaths.length) high.push(`touches a path you rate high: ${highPaths.join(", ")}`);
  for (const r of entry?.rulings ?? []) {
    const t = TIERS.includes(r?.risk) ? r.risk : "high";
    const what = r?.decision ?? r?.text ?? "a decision";
    if (t === "high") high.push(`the Maker rated a decision high: ${what}`);
    else if (t === "medium") medium.push(`the Maker rated a decision medium: ${what}`);
  }
  for (const a of entry?.ownerActions ?? []) high.push(`an owner action: ${a}`);
  for (const h of entry?.detected ?? []) {
    // A migration, a new environment variable, a deployment change, or a hint not known here: high.
    if (MEDIUM_HINT.test(h)) medium.push("adds a dependency that passed the dependency gate");
    else high.push(h);
  }
  if (entry?.docsMerged?.length) medium.push(`Carja documents merged from both sides: ${entry.docsMerged.join(", ")}`);
  if (high.length) return { tier: "high", reasons: high };
  if (medium.length) return { tier: "medium", reasons: medium };
  if (all.length && risk.lowPaths.length && all.every((f) => risk.lowPaths.some((g) => globMatch(g, f)))) return { tier: "low", reasons: ["only paths you rate low"] };
  return { tier: "medium", reasons: ["an ordinary change"] };
}

/** [] when the item merges without the owner, else one line that says why it waits. */
export function needsOwnerReview(entry, risk) {
  const t = itemTier(entry, risk);
  if (!risk.ownerReview.includes(t.tier)) return [];
  return [`Risk ${t.tier}, which waits for your review: ${t.reasons.join("; ")}.`];
}

/** May the dependency gate approve a dependency that passed every check, without a question round? */
export const autoApprovesDependencies = (risk) => risk.configured && !risk.ownerReview.includes("medium");

/** How a beat rates a ruling: the owner's definition when there is one. */
export function rulingRule(highMeans) {
  if (!highMeans) return BUILT_IN_RULE;
  return `Rate \`high\` only what the owner defines as high: ${highMeans} Rate anything else \`medium\` or \`low\`. This rule replaces the built-in one.`;
}
