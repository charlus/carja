// src/commands/models.js — `carja models [dir]`, `carja models use <preset> [dir]`,
// `carja models set <role> <model|default> [--effort <level>] [dir]`, `carja models rank <model>… [--dir <dir>]`,
// `carja models save <preset> [dir]`. The owner never edits JSON.
//
// Model roles (docs/roadmap/Model-Roles.md, D1–D4): shows the model and effort of
// each role, where each comes from, the project's rank, and how to run the
// interactive steps on them. `use` writes models.preset, so the owner never
// edits JSON to switch.

import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { ROLES, MODEL_RE, parseModels } from "../models.js";
import { configPath as configPathOf } from "../names.js";
import { exists } from "./loop.js";

const WHAT = {
  plan: "Spec-It, Technical Vision, Carve; the loop's spec and design beats",
  build: "Build; the loop's Maker",
  review: "the independent reviewer; the loop's Checker",
  bookkeeping: "the loop's Ship beat",
  escalate: "the loop's Maker after two rejections (unset: the build model)",
};

export async function readConfig(root) {
  const path = configPathOf(root);
  return { path, raw: (await exists(path)) ? JSON.parse(await readFile(path, "utf8")) : {} };
}

/** Write models.preset. Returns an error message, or null. */
export async function usePreset(root, name) {
  const { path, raw } = await readConfig(root);
  if (!parseModels(raw).presets[name]) return `No preset "${name}". Presets: ${Object.keys(parseModels(raw).presets).join(", ")}.`;
  raw.models = { ...(raw.models && typeof raw.models === "object" ? raw.models : {}), preset: name };
  // The 7.x setting would only shadow nothing now; drop it so one place decides.
  if (raw.loop && typeof raw.loop === "object") delete raw.loop.profile;
  await writeFile(path, `${JSON.stringify(raw, null, 2)}\n`, "utf8");
  return null;
}

/** Set one role (`default` unsets it). Returns an error message, or null. */
export async function setRole(root, role, model, effort = null) {
  if (!ROLES.includes(role)) return `unknown role '${role}' (roles: ${ROLES.join(", ")})`;
  if (model !== "default" && !MODEL_RE.test(model)) return `${JSON.stringify(model)} is not a model id or alias`;
  const { path, raw } = await readConfig(root);
  const block = raw.models && typeof raw.models === "object" ? { ...raw.models } : {};
  if (model === "default") delete block[role];
  else block[role] = effort ? { model, effort } : model;
  const err = parseModels({ models: block }).errors[0];
  if (err) return err;
  raw.models = block;
  await writeFile(path, `${JSON.stringify(raw, null, 2)}\n`, "utf8");
  return null;
}

/** Write models.rank, strongest first. Returns an error message, or null. */
export async function setRank(root, models) {
  const bad = models.find((m) => !MODEL_RE.test(m));
  if (!models.length || bad) return bad ? `${JSON.stringify(bad)} is not a model id or alias` : "Usage: carja models rank <strongest> <next> … [--dir <dir>]";
  const { path, raw } = await readConfig(root);
  raw.models = { ...(raw.models && typeof raw.models === "object" ? raw.models : {}), rank: models };
  await writeFile(path, `${JSON.stringify(raw, null, 2)}\n`, "utf8");
  return null;
}

/** Move the roles and rank set directly into a named preset, and use it. Returns an error message, or null. */
export async function savePreset(root, name) {
  if (!/^[a-z0-9][a-z0-9-]*$/i.test(name ?? "")) return "Usage: carja models save <preset> [dir] (letters, digits, dashes)";
  const { path, raw } = await readConfig(root);
  const block = raw.models && typeof raw.models === "object" ? { ...raw.models } : {};
  const preset = {};
  for (const key of [...ROLES, "rank"]) if (block[key] !== undefined) (preset[key] = block[key]), delete block[key];
  if (!ROLES.some((r) => preset[r] !== undefined)) return "No role is set to save: carja models set <role> <model> first";
  block.presets = { ...(block.presets ?? {}), [name]: preset };
  block.preset = name;
  raw.models = block;
  if (raw.loop && typeof raw.loop === "object") delete raw.loop.profile;
  await writeFile(path, `${JSON.stringify(raw, null, 2)}\n`, "utf8");
  return null;
}

/** The role table and the interactive hint, as text. */
export function renderModels(raw) {
  const m = parseModels(raw);
  const legacy = raw?.loop?.profile || (raw?.loop?.models && Object.keys(raw.loop.models).length);
  const rows = ROLES.map((r) => {
    const e = m.roles[r];
    return [r, e?.model ?? "engine default", e?.effort ?? (e ? "default" : ""), e?.source ?? "", WHAT[r]];
  });
  const w = [0, 1, 2, 3].map((i) => Math.max(...rows.map((row) => row[i].length)));
  const lines = ["", `  Models${m.preset ? ` (preset ${m.preset})` : ""}`, ""];
  for (const row of rows) lines.push(`  ${row.slice(0, 4).map((c, i) => c.padEnd(w[i])).join("  ")}  ${row[4]}`.replace(/ +$/, ""));
  lines.push("", `  Rank:    ${m.rank.length ? m.rank.join(" > ") : "not set: the loop doctor cannot tell whether the reviewer is as strong as the builder (models.rank, strongest first)"}`);
  lines.push(`  Presets: ${Object.keys(m.presets).map((p) => (p === m.preset ? `${p} (in use)` : p)).join(", ")}`);
  const plan = m.roles.plan?.model;
  const build = m.roles.build?.model;
  if (plan || build) {
    lines.push("", "  Interactive (Claude Code):");
    if (plan) lines.push(`    /model ${plan}   then /spec-it, /technical-vision or /carve`);
    if (build) lines.push(`    /model ${build}   then /build`);
    if (m.roles.review?.model) lines.push(`    The reviewer subagent runs on ${m.roles.review.model}.`);
  }
  if (legacy) lines.push("", "  The loop also reads loop.profile and loop.models (7.x). A role set here wins over them.");
  if (m.errors.length) lines.push("", ...m.errors.map((e) => `  ⛔ ${e}`));
  lines.push("", "  Change: carja models use <preset>  ·  carja models set <role> <model|default> [--effort <level>]  ·  carja models rank <strongest> <next> …  ·  carja models save <preset>", "");
  return lines.join("\n");
}

export async function modelsCommand(args, { cwd, stdout, stderr }) {
  const rest = [...args];
  const take = (flag) => {
    const i = rest.indexOf(flag);
    if (i < 0) return null;
    const v = rest[i + 1];
    rest.splice(i, 2);
    return v ?? null;
  };
  const sub = ["use", "set", "rank", "save"].includes(rest[0]) ? rest.shift() : null;
  let err = null;
  let root;
  if (sub === "use") {
    const name = rest.shift();
    root = resolve(cwd, rest[0] ?? ".");
    err = name ? await usePreset(root, name) : "Usage: carja models use <preset> [dir]";
  } else if (sub === "save") {
    const name = rest.shift();
    root = resolve(cwd, rest[0] ?? ".");
    err = await savePreset(root, name);
  } else if (sub === "set") {
    const effort = take("--effort");
    const [role, model, dir] = rest;
    root = resolve(cwd, dir ?? ".");
    err = role && model ? await setRole(root, role, model, effort) : "Usage: carja models set <role> <model|default> [--effort <level>] [dir]";
  } else if (sub === "rank") {
    const dir = take("--dir");
    // A trailing path (starts with / or .) is the project folder; model ids never do.
    const last = rest[rest.length - 1];
    let d = dir;
    if (!d && last && (last.startsWith("/") || last.startsWith("."))) d = rest.pop();
    root = resolve(cwd, d ?? ".");
    err = await setRank(root, rest);
  } else root = resolve(cwd, rest[0] ?? ".");
  if (err) {
    stderr.write(`⛔  ${err}\n`);
    return 1;
  }
  const { raw } = await readConfig(root);
  stdout.write(renderModels(raw));
  return parseModels(raw).errors.length ? 1 : 0;
}
