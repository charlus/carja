// src/commands/models.js — `carja models [dir]` and `carja models use <preset> [dir]`.
//
// Model roles (docs/roadmap/Model-Roles.md, D1–D4): shows the model and effort of
// each role, where each comes from, the project's rank, and how to run the
// interactive steps on them. `use` writes models.preset, so the owner never
// edits JSON to switch.

import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { ROLES, parseModels } from "../models.js";
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
  lines.push("", "  Switch: carja models use <preset>", "");
  return lines.join("\n");
}

export async function modelsCommand(args, { cwd, stdout, stderr }) {
  const rest = [...args];
  let name = null;
  if (rest[0] === "use") {
    rest.shift();
    name = rest.shift();
    if (!name) {
      stderr.write("Usage: carja models use <preset> [dir]\n");
      return 1;
    }
  }
  const root = resolve(cwd, rest[0] ?? ".");
  if (name) {
    const err = await usePreset(root, name);
    if (err) {
      stderr.write(`⛔  ${err}\n`);
      return 1;
    }
  }
  const { raw } = await readConfig(root);
  stdout.write(renderModels(raw));
  return parseModels(raw).errors.length ? 1 : 0;
}
