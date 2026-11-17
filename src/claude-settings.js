// src/claude-settings.js
//
// F7 (owner, 2026-11-17): "we need to get rid of these claude rules, it
// frustrates me, a lot." Claude Code's auto mode blocked the agent from writing
// the owner's answer in a question file, and asked the owner to edit it. An
// allow rule is decided before auto mode's classifier
// (code.claude.com/docs/en/permission-modes.md), and a project rule applies once
// the owner trusts the folder. `init` and `upgrade` add Carja's rules to the
// project's .claude/settings.json and keep everything the owner wrote there.
//
// The rules cover what Carja owns: the carja/ folder and the carja command.
// "/carja/**" is anchored to the project root, whatever the session's folder.

import { readFile, writeFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";

export const SETTINGS_REL = ".claude/settings.json";
export const CARJA_ALLOW = Object.freeze(["Edit(/carja/**)", "Write(/carja/**)", "Bash(carja *)"]);

/**
 * Pure: the settings with Carja's allow rules added. A rule the owner denies or
 * asks for is never added. Nothing else changes.
 * @returns {{settings: object, added: string[]}}
 */
export function mergeAllowRules(settings, rules = CARJA_ALLOW) {
  const out = JSON.parse(JSON.stringify(settings ?? {}));
  out.permissions = out.permissions && typeof out.permissions === "object" ? out.permissions : {};
  const allow = Array.isArray(out.permissions.allow) ? out.permissions.allow : [];
  const blocked = new Set([...(out.permissions.deny ?? []), ...(out.permissions.ask ?? [])]);
  const added = rules.filter((r) => !allow.includes(r) && !blocked.has(r));
  out.permissions.allow = [...allow, ...added];
  return { settings: out, added };
}

/**
 * Write the rules into <targetDir>/.claude/settings.json. A file that is not
 * valid JSON is left as it is.
 * @returns {Promise<{status: "written"|"current"|"invalid", added: string[]}>}
 */
export async function writeClaudeSettings(targetDir, { stdout = { write() {} } } = {}) {
  const path = join(targetDir, SETTINGS_REL);
  let current = {};
  if (existsSync(path)) {
    try {
      current = JSON.parse(await readFile(path, "utf8"));
    } catch {
      stdout.write(`  ⚠️  ${SETTINGS_REL} is not valid JSON: left as it is. Add these allow rules by hand: ${CARJA_ALLOW.join(", ")}\n`);
      return { status: "invalid", added: [] };
    }
  }
  const { settings, added } = mergeAllowRules(current);
  if (!added.length) return { status: "current", added };
  await mkdir(join(targetDir, ".claude"), { recursive: true });
  await writeFile(path, `${JSON.stringify(settings, null, 2)}\n`, "utf8");
  stdout.write(`  ✅ ${SETTINGS_REL}: Claude Code may edit carja/ and run carja without asking (${added.join(", ")})\n`);
  return { status: "written", added };
}
