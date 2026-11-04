/**
 * carja remove <skill-name> [--force]
 *
 * Removes a skill from .agents/skills/.
 */

import { rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import { readLocalSkills, exists } from "../registry.js";

function parseRemoveArgs(args) {
  const parsed = { skillName: null, force: false };

  for (const arg of args) {
    if (arg === "--force" || arg === "-f") {
      parsed.force = true;
      continue;
    }
    if (arg.startsWith("-")) {
      throw new Error(`Unknown option: ${arg}`);
    }
    if (parsed.skillName) {
      throw new Error("Too many arguments. Usage: carja remove <skill-name>");
    }
    parsed.skillName = arg;
  }

  if (!parsed.skillName) {
    throw new Error("Missing skill name. Usage: carja remove <skill-name>");
  }

  return parsed;
}

export async function removeCommand(args, { cwd, stdout, stderr }) {
  let parsed;
  try {
    parsed = parseRemoveArgs(args);
  } catch (err) {
    stderr.write(`${err.message}\n`);
    return 1;
  }

  const projectDir = resolve(cwd);
  const skillsDir = join(projectDir, ".agents", "skills");

  if (!(await exists(skillsDir))) {
    stderr.write("No .agents/skills/ directory found.\n");
    return 1;
  }

  // Find the skill locally
  const localSkills = await readLocalSkills(skillsDir);
  const skill = localSkills.find(
    (s) => s.name === parsed.skillName || s.name === parsed.skillName.toLowerCase()
  );

  if (!skill) {
    stderr.write(
      `Skill "${parsed.skillName}" is not installed.\n` +
      `Run "carja list" to see installed skills.\n`
    );
    return 1;
  }

  // Warn if core skill
  if (skill.manifest?.tier === "core" && !parsed.force) {
    stderr.write(
      `⚠️  "${skill.name}" is a core skill (bundled with Carja).\n` +
      `   Removing it may break workflows. It will be restored on upgrade.\n` +
      `   Use --force to remove anyway.\n`
    );
    return 1;
  }

  const skillPath = join(skillsDir, skill.dir);
  await rm(skillPath, { recursive: true, force: true });

  stdout.write(`✅ Removed "${skill.name}" from .agents/skills/${skill.dir}/\n`);
  return 0;
}
