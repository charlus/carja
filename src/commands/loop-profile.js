// src/commands/loop-profile.js — `conductor loop profile [quality|balanced] [dir]`.

import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { PROFILES, parseLoopConfig, effectiveModels } from "../loop/config.js";
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
  const raw = (await exists(cfgPath)) ? JSON.parse(await readFile(cfgPath, "utf8")) : {};
  if (name) {
    if (!PROFILES[name]) {
      stderr.write(`⛔  No profile "${name}". Profiles: ${Object.keys(PROFILES).join(", ")}.\n`);
      return 1;
    }
    raw.loop = { ...(raw.loop ?? {}), profile: name };
    await writeFile(cfgPath, `${JSON.stringify(raw, null, 2)}\n`, "utf8");
  }
  const cfg = parseLoopConfig(raw);
  const models = effectiveModels(cfg);
  stdout.write(`\n  Model profile: ${cfg.profile ?? "not set: every role uses the engine's default model"}${name ? " (written to conductor.config.json)" : ""}\n`);
  if (cfg.profile) stdout.write(`  ${WHAT[cfg.profile]}\n`);
  if (Object.keys(models).length) stdout.write(`\n${describeModels(models)}\n`);
  if (Object.keys(cfg.models).length) stdout.write(`\n  loop.models overrides: ${Object.entries(cfg.models).map(([r, m]) => `${r} ${m}`).join(", ")}\n`);
  try {
    const last = usageSummary(JSON.parse(await readFile(join(root, STATE_REL), "utf8")));
    if (last) stdout.write(`\n  Last run: ${last}\n`);
  } catch {
    /* no run yet */
  }
  stdout.write(`  ${costBasis()}\n`);
  const other = Object.keys(PROFILES).filter((p) => p !== cfg.profile);
  stdout.write(`\n  Switch: ${other.map((p) => `conductor loop profile ${p}`).join("  ·  ")}\n`);
  return 0;
}
