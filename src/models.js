// src/models.js
//
// Model roles (docs/roadmap/Model-Roles.md, D1–D3). Carja names roles; the
// project names models, in one `models` block of carja.config.json that the
// interactive workflows and the loop both read:
//
//   "models": {
//     "preset": "frontier",                                 // optional
//     "plan":   "claude-fable-5-2",                         // or { "model": …, "effort": … }
//     "build":  { "model": "claude-opus-5-5", "effort": "xhigh" },
//     "review": …, "bookkeeping": …, "escalate": …,
//     "rank":   ["claude-fable-5-2", "claude-opus-5-5"],    // strongest first, optional
//     "presets": { "frontier": { "plan": …, "rank": […] } }
//   }
//
// Carja holds no model names except the two built-in presets, which use the
// engine's aliases so they never go stale on a version. It holds no ranking
// of its own and no price: the doctor ranks with the project's list, and costs
// come from the engine's report. A role left unset runs on the engine's default.
// Pure: no IO.

export const ROLES = Object.freeze(["plan", "build", "review", "bookkeeping", "escalate"]);

/** The loop's beat kinds and the role each one runs as. */
export const LOOP_ROLE = Object.freeze({
  maker: "build",
  maker_escalation: "escalate",
  checker: "review",
  spec: "plan",
  blueprint: "plan",
  ship: "bookkeeping",
});

// Owner decisions D1–D5 (2026-10-21), kept as presets: `quality` runs Opus
// everywhere; `balanced` writes code and bookkeeping on Sonnet, moves to Opus
// after two rejections, and plans and reviews on Opus.
export const BUILTIN_PRESETS = Object.freeze({
  quality: Object.freeze({ plan: "opus", build: "opus", review: "opus", bookkeeping: "opus", escalate: "opus", rank: Object.freeze(["opus"]) }),
  balanced: Object.freeze({ plan: "opus", build: "sonnet", review: "opus", bookkeeping: "sonnet", escalate: "opus", rank: Object.freeze(["opus", "sonnet"]) }),
});

// A model id or alias: `sonnet`, `claude-opus-5-5`, `claude-opus-5-5[1m]`. No
// spaces and no leading dash, so the value can never be read as another flag.
export const MODEL_RE = /^[A-Za-z0-9][A-Za-z0-9._:\[\]-]*$/;
// An effort level, passed as is: the engine knows its own levels.
const EFFORT_RE = /^[a-z][a-z-]*$/;
const KEYS = new Set([...ROLES, "preset", "presets", "rank"]);

/** One role's value: "model" or { model, effort }. Returns { model, effort } or an error string. */
function parseEntry(value, where) {
  if (typeof value === "string") return MODEL_RE.test(value) ? { model: value, effort: null } : `${where}: ${JSON.stringify(value)} is not a model id or alias`;
  if (value && typeof value === "object" && !Array.isArray(value)) {
    if (typeof value.model !== "string" || !MODEL_RE.test(value.model)) return `${where}.model: ${JSON.stringify(value.model)} is not a model id or alias`;
    if (value.effort !== undefined && value.effort !== null && (typeof value.effort !== "string" || !EFFORT_RE.test(value.effort)))
      return `${where}.effort: ${JSON.stringify(value.effort)} is not an effort level such as "high"`;
    return { model: value.model, effort: value.effort ?? null };
  }
  return `${where} must be a model id or { "model": …, "effort": … }`;
}

function parseRank(value, where, errors) {
  if (value === undefined || value === null) return null;
  if (Array.isArray(value) && value.every((m) => typeof m === "string" && MODEL_RE.test(m))) return [...value];
  errors.push(`${where} must be a list of model ids, strongest first`);
  return null;
}

/** Roles and rank of one block (the top level or a preset). */
function parseBlock(block, where, errors) {
  const roles = {};
  for (const [key, value] of Object.entries(block)) {
    if (!ROLES.includes(key)) continue;
    if (value === null) continue;
    const e = parseEntry(value, `${where}.${key}`);
    if (typeof e === "string") errors.push(e);
    else roles[key] = e;
  }
  return { roles, rank: parseRank(block.rank, `${where}.rank`, errors) };
}

/**
 * Parse the `models` block. Returns
 * { roles: { <role>: { model, effort, source } }, preset, rank, presets, errors }.
 * `roles` holds only what is set; the loop adds the 7.x settings (loop.profile,
 * loop.models) through loopRoleModels.
 */
export function parseModels(config) {
  const errors = [];
  const out = { roles: {}, preset: null, rank: [], presets: { ...BUILTIN_PRESETS }, errors };
  const raw = config && typeof config === "object" ? config.models : undefined;
  if (raw === undefined || raw === null) return out;
  if (typeof raw !== "object" || Array.isArray(raw)) {
    errors.push('models must be an object such as { "plan": "opus", "build": "sonnet" }');
    return out;
  }
  for (const key of Object.keys(raw)) if (!KEYS.has(key)) errors.push(`models: unknown key '${key}' (roles: ${ROLES.join(", ")}; also preset, presets, rank)`);

  if (raw.presets !== undefined && raw.presets !== null) {
    if (typeof raw.presets !== "object" || Array.isArray(raw.presets)) errors.push("models.presets must be an object of named presets");
    else
      for (const [name, block] of Object.entries(raw.presets)) {
        if (!block || typeof block !== "object" || Array.isArray(block)) {
          errors.push(`models.presets.${name} must be an object of roles`);
          continue;
        }
        const p = parseBlock(block, `models.presets.${name}`, errors);
        out.presets[name] = { ...Object.fromEntries(Object.entries(p.roles).map(([r, e]) => [r, e.effort ? e : e.model])), ...(p.rank ? { rank: p.rank } : {}) };
      }
  }

  let presetRank = null;
  if (raw.preset !== undefined && raw.preset !== null) {
    if (typeof raw.preset === "string" && out.presets[raw.preset]) {
      out.preset = raw.preset;
      const p = parseBlock(out.presets[raw.preset], `models.presets.${raw.preset}`, []);
      for (const [r, e] of Object.entries(p.roles)) out.roles[r] = { ...e, source: `preset ${raw.preset}` };
      presetRank = p.rank;
    } else errors.push(`models.preset: no preset ${JSON.stringify(raw.preset)} (presets: ${Object.keys(out.presets).join(", ")})`);
  }

  const top = parseBlock(raw, "models", errors);
  for (const [r, e] of Object.entries(top.roles)) out.roles[r] = { ...e, source: `models.${r}` };
  out.rank = top.rank ?? presetRank ?? [];
  return out;
}

/**
 * The model and effort of each loop beat kind. Order, first set wins:
 * models.<role>, loop.models.<kind> (7.x), models.preset, loop.profile (7.x).
 * Returns { models: { kind: id }, efforts: { kind: level }, rank }.
 */
export function loopRoleModels(config, { legacyProfile = null, legacyModels = {} } = {}) {
  const parsed = parseModels(config);
  const raw = config?.models && typeof config.models === "object" ? config.models : {};
  const legacyPreset = legacyProfile ? parseBlock(BUILTIN_PRESETS[legacyProfile] ?? {}, "loop.profile", []) : { roles: {}, rank: null };
  const models = {};
  const efforts = {};
  for (const [kind, role] of Object.entries(LOOP_ROLE)) {
    const explicit = raw[role] !== undefined && raw[role] !== null ? parsed.roles[role] : null;
    const fromPreset = parsed.roles[role] && !explicit ? parsed.roles[role] : null;
    const pick = explicit ?? (legacyModels[kind] ? { model: legacyModels[kind], effort: null } : null) ?? fromPreset ?? legacyPreset.roles[role] ?? null;
    if (!pick?.model) continue;
    models[kind] = pick.model;
    if (pick.effort) efforts[kind] = pick.effort;
  }
  const rank = parsed.rank.length ? parsed.rank : legacyPreset.rank ?? [];
  return { models, efforts, rank, errors: parsed.errors };
}
