/**
 * carja add <skill-name> [--registry <url>]
 *
 * Downloads a skill from the registry into .agents/skills/.
 */

import { join, resolve } from "node:path";
import { rm } from "node:fs/promises";
import {
  checkGlabAuth,
  resolveRegistry,
  fetchRegistryIndex,
  downloadSkill,
  readLocalSkills,
  exists,
} from "../registry.js";
import { scanSkillDir, formatFindings } from "../skill-scan.js";

function parseAddArgs(args) {
  const parsed = { skillName: null, registry: null, allowUnsafe: false };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--registry" && i + 1 < args.length) {
      parsed.registry = args[++i];
      continue;
    }
    if (arg === "--allow-unsafe") {
      parsed.allowUnsafe = true;
      continue;
    }
    if (arg.startsWith("-")) {
      throw new Error(`Unknown option: ${arg}`);
    }
    if (parsed.skillName) {
      throw new Error("Too many arguments. Usage: carja add <skill-name>");
    }
    parsed.skillName = arg;
  }

  if (!parsed.skillName) {
    throw new Error("Missing skill name. Usage: carja add <skill-name>");
  }

  return parsed;
}

export async function addCommand(args, { cwd, stdout, stderr }) {
  let parsed;
  try {
    parsed = parseAddArgs(args);
  } catch (err) {
    stderr.write(`${err.message}\n`);
    return 1;
  }

  const projectDir = resolve(cwd);
  const skillsDir = join(projectDir, ".agents", "skills");

  // Check .agents/skills/ exists
  if (!(await exists(skillsDir))) {
    stderr.write(
      "No .agents/skills/ directory found.\n" +
      'Run "carja init" first to set up the project.\n'
    );
    return 1;
  }

  // Resolve registry
  const { hostname, project } = await resolveRegistry(projectDir);

  // Check glab auth
  const auth = await checkGlabAuth(hostname);
  if (!auth.ok) {
    stderr.write(`${auth.error}\n`);
    return 1;
  }

  stdout.write(`🔍 Searching registry for "${parsed.skillName}"...\n`);

  // Fetch registry index
  let registry;
  try {
    registry = await fetchRegistryIndex(hostname, project);
  } catch (err) {
    stderr.write(`Failed to fetch registry: ${err.message}\n`);
    return 1;
  }

  // Find the skill
  const skill = registry.skills.find(
    (s) => s.name === parsed.skillName || s.name === parsed.skillName.toLowerCase()
  );

  if (!skill) {
    stderr.write(
      `Skill "${parsed.skillName}" not found in registry.\n` +
      `Run "carja search ${parsed.skillName}" to find similar skills.\n`
    );
    return 1;
  }

  // Check if already installed
  const localSkills = await readLocalSkills(skillsDir);
  const alreadyInstalled = localSkills.find((s) => s.name === skill.name);
  if (alreadyInstalled) {
    stderr.write(
      `Skill "${skill.name}" is already installed at .agents/skills/${alreadyInstalled.dir}/\n`
    );
    return 1;
  }

  // Download
  stdout.write(`📦 Downloading ${skill.name}@${skill.version}...\n`);

  // Convert skill name to directory name (Title-Case-Kebab)
  const dirName = skill.name
    .split("-")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join("-");

  try {
    await downloadSkill(hostname, project, dirName, skillsDir);
  } catch (err) {
    stderr.write(`Download failed: ${err.message}\n`);
    return 1;
  }

  // Validate the download
  const skillDir = join(skillsDir, dirName);
  const hasManifest = await exists(join(skillDir, "skill.json"));
  const hasSkillMd = await exists(join(skillDir, "SKILL.md"));

  if (!hasManifest || !hasSkillMd) {
    stderr.write(
      `⚠️  Skill downloaded but appears incomplete.\n` +
      `   skill.json: ${hasManifest ? "✅" : "❌"}\n` +
      `   SKILL.md:   ${hasSkillMd ? "✅" : "❌"}\n`
    );
    return 1;
  }

  // Supply-chain safety scan (rubric gap: registry downloads are an injection/secret
  // vector). Critical findings block install unless --allow-unsafe is passed.
  const scan = await scanSkillDir(skillDir);
  if (scan.findings.length > 0) {
    stdout.write(`\n🔍 Security scan flagged ${scan.criticalCount} critical, ${scan.warnCount} warning(s):\n`);
    stdout.write(formatFindings(scan.findings) + "\n");
    if (scan.criticalCount > 0 && !parsed.allowUnsafe) {
      await rm(skillDir, { recursive: true, force: true });
      stderr.write(
        `\n🛑 Install aborted — "${skill.name}" contains critical patterns and was removed.\n` +
        `   Review the source, then re-run with --allow-unsafe to install anyway.\n`
      );
      return 1;
    }
    if (scan.criticalCount > 0) {
      stdout.write(`\n⚠️  Installing despite critical findings (--allow-unsafe). You own this decision.\n`);
    }
  }

  stdout.write(`✅ Installed ${skill.name}@${skill.version}\n`);
  stdout.write(`   ${skill.description}\n`);
  stdout.write(`   Location: .agents/skills/${dirName}/\n`);
  return 0;
}
