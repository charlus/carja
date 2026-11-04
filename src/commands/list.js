/**
 * carja list [--remote] [--tier <core|tech-vision|domain>]
 *
 * Lists installed skills or remote registry skills.
 */

import { join, resolve } from "node:path";
import {
  checkGlabAuth,
  resolveRegistry,
  fetchRegistryIndex,
  readLocalSkills,
  exists,
} from "../registry.js";

function parseListArgs(args) {
  const parsed = { remote: false, tier: null };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--remote" || arg === "-r") {
      parsed.remote = true;
      continue;
    }
    if (arg === "--tier" && i + 1 < args.length) {
      parsed.tier = args[++i];
      continue;
    }
    if (arg.startsWith("-")) {
      throw new Error(`Unknown option: ${arg}`);
    }
  }

  return parsed;
}

function tierLabel(tier) {
  const labels = {
    core: "core",
    "tech-vision": "tech",
    domain: "domain",
  };
  return labels[tier] || tier || "—";
}

export async function listCommand(args, { cwd, stdout, stderr }) {
  let parsed;
  try {
    parsed = parseListArgs(args);
  } catch (err) {
    stderr.write(`${err.message}\n`);
    return 1;
  }

  if (parsed.remote) {
    return listRemote(parsed, { cwd, stdout, stderr });
  }
  return listLocal(parsed, { cwd, stdout, stderr });
}

async function listLocal(parsed, { cwd, stdout, stderr }) {
  const projectDir = resolve(cwd);
  const skillsDir = join(projectDir, ".agents", "skills");

  if (!(await exists(skillsDir))) {
    stderr.write("No .agents/skills/ directory found.\n");
    return 1;
  }

  let skills = await readLocalSkills(skillsDir);

  if (parsed.tier) {
    skills = skills.filter((s) => s.manifest?.tier === parsed.tier);
  }

  if (skills.length === 0) {
    stdout.write("No skills installed");
    if (parsed.tier) stdout.write(` with tier "${parsed.tier}"`);
    stdout.write(".\n");
    return 0;
  }

  stdout.write(`\n  Installed Skills (${skills.length})\n\n`);

  // Column formatting
  const nameWidth = Math.max(20, ...skills.map((s) => s.name.length + 2));

  for (const skill of skills) {
    const name = skill.name.padEnd(nameWidth);
    const tier = tierLabel(skill.manifest?.tier).padEnd(8);
    const desc = skill.manifest?.description || "(no manifest)";
    stdout.write(`  ${name} ${tier} ${desc}\n`);
  }

  stdout.write("\n");
  return 0;
}

async function listRemote(parsed, { cwd, stdout, stderr }) {
  const projectDir = resolve(cwd);
  const { hostname, project } = await resolveRegistry(projectDir);

  const auth = await checkGlabAuth(hostname);
  if (!auth.ok) {
    stderr.write(`${auth.error}\n`);
    return 1;
  }

  stdout.write("📡 Fetching registry...\n");

  let registry;
  try {
    registry = await fetchRegistryIndex(hostname, project);
  } catch (err) {
    stderr.write(`Failed to fetch registry: ${err.message}\n`);
    return 1;
  }

  let skills = registry.skills;

  if (parsed.tier) {
    skills = skills.filter((s) => s.tier === parsed.tier);
  }

  if (skills.length === 0) {
    stdout.write("No skills in registry");
    if (parsed.tier) stdout.write(` with tier "${parsed.tier}"`);
    stdout.write(".\n");
    return 0;
  }

  // Check which are locally installed
  const skillsDir = join(projectDir, ".agents", "skills");
  const localSkills = await readLocalSkills(skillsDir);
  const localNames = new Set(localSkills.map((s) => s.name));

  stdout.write(`\n  Registry Skills (${skills.length})\n\n`);

  const nameWidth = Math.max(20, ...skills.map((s) => s.name.length + 2));

  for (const skill of skills) {
    const installed = localNames.has(skill.name) ? " ✓" : "  ";
    const name = skill.name.padEnd(nameWidth);
    const tier = tierLabel(skill.tier).padEnd(8);
    stdout.write(`${installed} ${name} ${tier} ${skill.description}\n`);
  }

  stdout.write("\n");
  stdout.write(`  ✓ = installed locally\n\n`);
  return 0;
}
