// src/commands/loop-profile.js — `carja loop profile [<preset>] [dir]`.
//
// Since 7.4.0 (Model-Roles.md, D2) a profile is a preset of the models block:
// switching writes models.preset, exactly as `carja models use` does. This view
// keeps the loop's beat kinds and the last run's cost per role.

import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { parseLoopConfig, effectiveModels } from "../loop/config.js";
import { BUILTIN_PRESETS, parseModels } from "../models.js";
import { usePreset } from "./models.js";
import { describeModels, costBasis } from "../loop/profiles.js";
import { usageSummary } from "../loop/usage.js";
import { exists } from "./loop.js";
import { STATE_REL } from "../loop/state-sync.js";
import { configPath as configPathOf } from "../names.js";

const WHAT = {
  quality: "Opus for every role: the best measured quality, the highest cost per beat.",
  balanced: "Sonnet writes the code and the ship bookkeeping and moves to Opus after 2 rejections; Opus reviews and writes specs and designs. Cheaper per beat; measured studies show a few points of quality lost on code.",
};

export async function loopProfileCommand(root, name, { stdout, stderr }) {
  const cfgPath = configPathOf(root);
  if (name) {
    const err = await usePreset(root, name);
    if (err) {
      stderr.write(`⛔  ${err}\n`);
      return 1;
    }
  }
  const raw = (await exists(cfgPath)) ? JSON.parse(await readFile(cfgPath, "utf8")) : {};
  const cfg = parseLoopConfig(raw);
  const models = effectiveModels(cfg);
  const current = parseModels(raw).preset ?? cfg.profile;
  stdout.write(`\n  Model profile: ${current ?? "not set: every role uses the engine's default model"}${name ? " (written to carja.config.json as models.preset)" : ""}\n`);
  if (WHAT[current]) stdout.write(`  ${WHAT[current]}\n`);
  if (Object.keys(models).length) stdout.write(`\n${describeModels(models)}\n`);
  if (Object.keys(cfg.models).length) stdout.write(`\n  loop.models overrides: ${Object.entries(cfg.models).map(([r, m]) => `${r} ${m}`).join(", ")}\n`);
  try {
    const last = usageSummary(JSON.parse(await readFile(join(root, STATE_REL), "utf8")));
    if (last) stdout.write(`\n  Last run: ${last}\n`);
  } catch {
    /* no run yet */
  }
  stdout.write(`  ${costBasis()}\n`);
  const other = Object.keys(parseModels(raw).presets ?? BUILTIN_PRESETS).filter((p) => p !== current);
  stdout.write(`\n  Switch: ${other.map((p) => `carja loop profile ${p}`).join("  ·  ")}\n`);
  return 0;
}
