// src/loop/usage.js
//
// A14 (docs/roadmap/Superlite-Imports.md): what a loop run costs. One accounting
// point for every beat, Maker and Checker, pair and swarm, so nothing is counted
// twice. The numbers come from the adapter (the claude adapter reads them from
// `claude -p --output-format json`); an adapter that cannot tell reports null,
// which is recorded as unknown, never as zero.
//
// On a subscription login the cost is a list-price estimate, not a charge. So by
// owner decision (D2, D3) cost is recorded and shown, and acts on nothing unless
// `loop.cost_aware` is on and `budget.max_cost_usd` is set. All functions are pure
// over the state object they are given.

const ROLES = ["maker", "checker", "spec", "ship"];

/** Add one beat's usage to its role and to the run totals. Mutates `state.budget`. */
export function recordUsage(state, { role, result }) {
  const b = state.budget;
  b.usage ??= {};
  const key = ROLES.includes(role) ? role : "maker";
  const u = (b.usage[key] ??= { beats: 0, tokens: 0, cost_usd: 0, unknown: 0 });
  u.beats += 1;
  const tokens = Number.isFinite(result?.tokens) ? result.tokens : null;
  const cost = Number.isFinite(result?.costUsd) ? result.costUsd : null;
  if (tokens === null && cost === null) u.unknown += 1;
  if (tokens !== null) {
    u.tokens += tokens;
    b.tokens_spent = (b.tokens_spent ?? 0) + tokens;
  }
  if (cost !== null) {
    u.cost_usd = round(u.cost_usd + cost);
    b.cost_usd_spent = round((b.cost_usd_spent ?? 0) + cost);
  }
  // The prompt-cache share: a cache break costs several times more and shows nowhere else.
  if (Number.isFinite(result?.inputTokens) && Number.isFinite(result?.cacheReadTokens)) {
    u.input_tokens = (u.input_tokens ?? 0) + result.inputTokens;
    u.cache_read_tokens = (u.cache_read_tokens ?? 0) + result.cacheReadTokens;
  }
  return state;
}

/**
 * The cost ceiling, only with `loop.cost_aware`: "warn" once at 70% of
 * `budget.max_cost_usd`, "halt" at 100%, else null. Marks the warning as given.
 */
export function costGate(state, { costAware = false } = {}) {
  const b = state.budget ?? {};
  const max = Number(b.max_cost_usd);
  if (!costAware || !Number.isFinite(max) || max <= 0) return null;
  const spent = Number(b.cost_usd_spent ?? 0);
  if (spent >= max) return "halt";
  if (spent >= 0.7 * max && !b.cost_warned) {
    b.cost_warned = true;
    return "warn";
  }
  return null;
}

/** The inbox line for a cost gate, or null. */
export function costGateMessage(state, gate) {
  const spent = money(state.budget?.cost_usd_spent ?? 0);
  const max = money(state.budget?.max_cost_usd ?? 0);
  if (gate === "halt") return `cost ceiling reached: ${spent} of ${max} (loop.cost_aware) — the run stopped between beats`;
  if (gate === "warn") return `cost at 70% of the ceiling: ${spent} of ${max} (loop.cost_aware)`;
  return null;
}

/** One line for `carja status` and the run log, or "" before any beat. */
export function usageSummary(state) {
  const usage = state?.budget?.usage ?? {};
  const parts = ROLES.filter((r) => usage[r]?.beats).map((r) => {
    const u = usage[r];
    const unknown = u.unknown ? `, ${u.unknown} unknown` : "";
    const cached = u.input_tokens > 0 ? `, ${cacheShare(u.cache_read_tokens, u.input_tokens)}% cached` : "";
    return `${r} ${u.beats} beat${u.beats === 1 ? "" : "s"} ${money(u.cost_usd)}${cached}${unknown}`;
  });
  if (!parts.length) return "";
  return `≈ ${money(state.budget.cost_usd_spent ?? 0)} at list price (${parts.join(", ")})`;
}

/** Percent of input read from the prompt cache, rounded down. */
export function cacheShare(cacheRead, input) {
  return input > 0 ? Math.floor((100 * (cacheRead ?? 0)) / input) : null;
}

function round(n) {
  return Math.round(n * 1e6) / 1e6;
}

function money(n) {
  return `$${Number(n).toFixed(2)}`;
}
