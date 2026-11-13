// src/loop/config.js
//
// The `loop` block of carja.config.json: per-project settings the operator
// owns and `carja upgrade` never overwrites (field report F2–F5).
//
//   forge            "gh" | "glab" — overrides the forge read from the origin host
//   setup            shell command run once per new worktree, before the first beat
//   allowed_domains  extra hosts merged into the cli-native sandbox network list
//   require_ready    true → only backlog items tagged `loop-ready` are harvested
//   priorities       ["P1", …] → only backlog items under these headings
//   inbox            false → inbox lines are not harvested
//   allow_nested_repo true → run even though a gitignored nested git repo exists
//   slices           ["<Project>"] | true → carved slices of these projects are loop work
//   blueprint        ["<Project>"] | true → these projects' Blueprint, after Discovery, is loop work
//   code_dir         "repo" → the code is this nested, gitignored repository (the outer layout)
//   blank_env        ["GEMINI_API_KEY", …] → set empty in every beat's environment (default: the
//                    common provider keys, minus the engine's own); [] turns it off
//   cost_aware       true → budget.max_cost_usd halts the run (off: cost is shown, never acts)
//   profile          7.x: "quality" | "balanced". Still read; the top-level models block
//                    (src/models.js) replaces it
//   models           7.x: { maker, maker_escalation, checker, spec, blueprint, ship } → one beat
//                    kind's model. Still read; a role set in the top-level models block wins
//   install          shell command the driver runs, outside the sandbox, after the dependency gate
//                    passed a new dependency (I4); a package registry is never in allowed_domains
//   dependency_min_age_days  a new dependency's version must be at least this old (default 7)
//   quota_max_wait_min  a beat that hit the agent CLI's usage limit waits for the announced reset when it
//                    is at most this far away (default 330); 0 stops the run at the limit as before (I2)
//
// The driver reads this file from the ROOT checkout only, never from a worktree,
// so a beat cannot widen its own sandbox or change its own setup. All helpers are
// pure; the IO lives in src/commands/loop.js.

import { DEFAULT_BLANK_ENV } from "./beat-env.js";
import { REGISTRY_HOSTS } from "./deps.js";
import { DEFAULT_QUOTA_MAX_WAIT_MIN } from "./quota.js";
import { BUILTIN_PRESETS, LOOP_ROLE, MODEL_RE, loopRoleModels } from "../models.js";

const FORGES = ["gh", "glab"];
// A hostname, optionally with one leading "*." wildcard label. No scheme, path,
// port or bare "*": a domain entry widens the sandbox, so it must be exact.
const ROLES = Object.keys(LOOP_ROLE);

// The 7.x profiles, as the loop's beat kinds: the built-in presets of src/models.js.
export const PROFILES = Object.freeze(
  Object.fromEntries(Object.entries(BUILTIN_PRESETS).map(([name, p]) => [name, Object.freeze(Object.fromEntries(Object.entries(LOOP_ROLE).map(([kind, role]) => [kind, p[role]])))]))
);

/** The model each beat kind runs on (src/models.js: models.<role>, loop.models, models.preset, loop.profile). {} when nothing is set. */
export function effectiveModels(cfg) {
  return { ...(cfg?.roleModels?.models ?? {}) };
}

/** The effort of each beat kind that has one. {} when none is set: the engine's default. */
export function effectiveEfforts(cfg) {
  return { ...(cfg?.roleModels?.efforts ?? {}) };
}
const DOMAIN_RE = /^(\*\.)?[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/i;

/** Parse and validate the `loop` block. Invalid values are reported, never dropped. */
export function parseLoopConfig(config) {
  const raw = config && typeof config === "object" && config.loop && typeof config.loop === "object" ? config.loop : {};
  const errors = [];
  const out = { forge: null, setup: null, allowedDomains: [], requireReady: false, priorities: [], inbox: true, allowNestedRepo: false, models: {}, profile: null, costAware: false, slices: [], blueprint: [], codeDir: null, blankEnv: DEFAULT_BLANK_ENV, install: null, dependencyMinAgeDays: 7, quotaMaxWaitMin: DEFAULT_QUOTA_MAX_WAIT_MIN, errors };

  if (raw.forge !== undefined && raw.forge !== null) {
    if (FORGES.includes(raw.forge)) out.forge = raw.forge;
    else errors.push(`loop.forge must be "gh" or "glab", got ${JSON.stringify(raw.forge)}`);
  }
  if (raw.setup !== undefined && raw.setup !== null) {
    if (typeof raw.setup === "string" && raw.setup.trim()) out.setup = raw.setup.trim();
    else errors.push("loop.setup must be a non-empty shell command string");
  }
  if (raw.allowed_domains !== undefined) {
    if (!Array.isArray(raw.allowed_domains)) errors.push("loop.allowed_domains must be an array of hostnames");
    else
      for (const d of raw.allowed_domains) {
        if (typeof d === "string" && REGISTRY_HOSTS.some((re) => re.test(d)))
          errors.push(`loop.allowed_domains: '${d}' is a package registry. A beat never reaches one: the loop checks new dependencies and installs them with loop.install. Remove it`);
        else if (typeof d === "string" && DOMAIN_RE.test(d)) out.allowedDomains.push(d.toLowerCase());
        else errors.push(`loop.allowed_domains: '${d}' is not a hostname (use e.g. "api.example.com" or "*.example.com")`);
      }
  }
  if (raw.require_ready !== undefined) {
    if (typeof raw.require_ready === "boolean") out.requireReady = raw.require_ready;
    else errors.push("loop.require_ready must be true or false");
  }
  if (raw.priorities !== undefined) {
    const parsed = parsePriorities(raw.priorities);
    if (parsed.error) errors.push(`loop.priorities: ${parsed.error}`);
    else out.priorities = parsed.priorities;
  }
  if (raw.allow_nested_repo !== undefined) {
    if (typeof raw.allow_nested_repo === "boolean") out.allowNestedRepo = raw.allow_nested_repo;
    else errors.push("loop.allow_nested_repo must be true or false");
  }
  if (raw.profile !== undefined && raw.profile !== null) {
    if (Object.keys(PROFILES).includes(raw.profile)) out.profile = raw.profile;
    else errors.push(`loop.profile must be one of ${Object.keys(PROFILES).join(", ")} (set it with carja loop profile <name>)`);
  }
  if (raw.models !== undefined && raw.models !== null) {
    if (typeof raw.models !== "object" || Array.isArray(raw.models)) errors.push('loop.models must be an object such as { "maker": "sonnet", "checker": "opus" }');
    else
      for (const [role, model] of Object.entries(raw.models)) {
        if (!ROLES.includes(role)) errors.push(`loop.models: unknown role '${role}' (use maker, maker_escalation, checker, spec, blueprint or ship)`);
        else if (model === null) continue;
        else if (typeof model === "string" && MODEL_RE.test(model)) out.models[role] = model;
        else errors.push(`loop.models.${role}: ${JSON.stringify(model)} is not a model id or alias`);
      }
  }
  if (raw.slices !== undefined) {
    if (raw.slices === true) out.slices = true;
    else if (Array.isArray(raw.slices) && raw.slices.every((p) => typeof p === "string" && p.trim())) out.slices = raw.slices.map((p) => p.trim());
    else errors.push('loop.slices must be true or a list of project folder names, such as ["evaluations"]');
  }
  if (raw.blueprint !== undefined) {
    if (raw.blueprint === true) out.blueprint = true;
    else if (Array.isArray(raw.blueprint) && raw.blueprint.every((p) => typeof p === "string" && p.trim())) out.blueprint = raw.blueprint.map((p) => p.trim());
    else errors.push('loop.blueprint must be true or a list of project folder names, such as ["evaluations"]');
  }
  if (raw.code_dir !== undefined) {
    const d = typeof raw.code_dir === "string" ? raw.code_dir.trim().replace(/\/+$/, "") : "";
    if (d && !d.startsWith("/") && !d.split("/").includes("..")) out.codeDir = d;
    else errors.push('loop.code_dir must be the relative path of the nested code repository, such as "repo"');
  }
  if (raw.blank_env !== undefined) {
    if (Array.isArray(raw.blank_env) && raw.blank_env.every((n) => typeof n === "string" && /^[A-Za-z_][A-Za-z0-9_]*$/.test(n))) out.blankEnv = [...raw.blank_env];
    else errors.push('loop.blank_env must be a list of environment variable names, such as ["GEMINI_API_KEY"], or [] to turn it off');
  }
  if (raw.cost_aware !== undefined) {
    if (typeof raw.cost_aware === "boolean") out.costAware = raw.cost_aware;
    else errors.push("loop.cost_aware must be true or false");
  }
  if (raw.inbox !== undefined) {
    if (typeof raw.inbox === "boolean") out.inbox = raw.inbox;
    else errors.push("loop.inbox must be true or false");
  }
  if (raw.install !== undefined && raw.install !== null) {
    if (typeof raw.install === "string" && raw.install.trim()) out.install = raw.install.trim();
    else errors.push("loop.install must be a non-empty shell command string, such as \".venv/bin/pip install -r requirements.txt\"");
  }
  const count = (key, field) => {
    if (raw[key] === undefined) return;
    if (Number.isFinite(raw[key]) && raw[key] >= 0) out[field] = raw[key];
    else errors.push(`loop.${key} must be a number, 0 or more`);
  };
  count("dependency_min_age_days", "dependencyMinAgeDays");
  count("quota_max_wait_min", "quotaMaxWaitMin");
  // Model roles (src/models.js): the top-level models block, then the 7.x loop.models and loop.profile.
  out.roleModels = loopRoleModels(config, { legacyProfile: out.profile, legacyModels: out.models });
  out.modelRank = out.roleModels.rank;
  errors.push(...out.roleModels.errors);
  return out;
}

/** `["p1","P2"]` or `"P1,P2"` → `["P1","P2"]`; anything not `P<digit>` is an error. */
export function parsePriorities(value) {
  const list = Array.isArray(value) ? value : typeof value === "string" ? value.split(",") : null;
  if (!list) return { error: "must be a list such as [\"P1\"]" };
  const priorities = [];
  for (const p of list) {
    const v = String(p).trim().toUpperCase();
    if (!/^P\d$/.test(v)) return { error: `'${p}' is not a priority (use P1, P2, …)` };
    if (!priorities.includes(v)) priorities.push(v);
  }
  return { priorities };
}

/** The host of a git remote URL (https, ssh:// or scp-like), or null. */
function remoteHost(url) {
  const u = String(url ?? "").trim();
  if (!u) return null;
  const withScheme = u.match(/^[a-z][a-z0-9+.-]*:\/\/(?:[^@/]*@)?([^/:]+)/i);
  if (withScheme) return withScheme[1].toLowerCase();
  const scp = u.match(/^(?:[^@/]+@)?([^/:]+):(?!\/)/);
  if (scp) return scp[1].toLowerCase();
  return null;
}

/** F4: github.com → gh, any other host → glab (self-hosted GitLab included). */
export function forgeFromRemote(url) {
  const host = remoteHost(url);
  if (!host) return null;
  return { forge: host === "github.com" ? "gh" : "glab", host };
}

/** The forge to open the PR/MR with: `loop.forge`, then the origin host. `host`
 *  scopes the pre-run auth check to the instance the PR will go to. */
export function resolveForge({ override, remoteUrl }) {
  const r = forgeFromRemote(remoteUrl);
  if (override) return { forge: override, source: "loop.forge", host: r?.host ?? null };
  if (r) return { forge: r.forge, source: `origin host ${r.host}`, host: r.host };
  return {
    forge: null,
    error: "cannot tell the forge from 'git remote get-url origin'. Set loop.forge to \"gh\" or \"glab\" in carja.config.json.",
  };
}

/** F3: the template sandbox settings plus the project's domains. Never mutates the template. */
export function mergeSandboxSettings(template, extraDomains = [], extraWrites = []) {
  const out = JSON.parse(JSON.stringify(template ?? {}));
  out.sandbox ??= {};
  out.sandbox.network ??= {};
  const base = Array.isArray(out.sandbox.network.allowedDomains) ? out.sandbox.network.allowedDomains : [];
  out.sandbox.network.allowedDomains = [...new Set([...base, ...extraDomains])];
  // Step 7, F15: paths outside the worktree a beat may write (the code repository's git store).
  if (extraWrites.length) {
    out.sandbox.filesystem ??= {};
    const w = Array.isArray(out.sandbox.filesystem.allowWrite) ? out.sandbox.filesystem.allowWrite : [];
    out.sandbox.filesystem.allowWrite = [...new Set([...w, ...extraWrites])];
  }
  return out;
}

/** The adapter with each loop role's model and effort passed to its beats. Returns
 *  the same calls unchanged when nothing is set: the engine's defaults run. */
export function withRoleModels(adapter, models = {}, efforts = {}) {
  const pass = (opts, kind) => ({ ...opts, ...(models[kind] ? { model: models[kind] } : {}), ...(efforts[kind] ? { effort: efforts[kind] } : {}) });
  const on = (kind) => (opts) => adapter.runBeat(pass(opts, kind));
  return {
    ...adapter,
    runBeat: (opts) => adapter.runBeat(pass(opts, opts?.escalateModel && models.maker_escalation ? "maker_escalation" : "maker")),
    runChecker: (opts) => adapter.runChecker(pass(opts, "checker")),
    // G1: specs and designs are their own roles, never the Maker's model by default.
    runSpecBeat: on("spec"),
    runBlueprintBeat: on("blueprint"),
    runShipBeat: on("ship"),
  };
}
