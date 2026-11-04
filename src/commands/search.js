/**
 * carja search <query> [--tag <tag>] [--tier <tier>]
 *
 * Searches the remote registry for skills matching a query.
 */

import { join, resolve } from "node:path";
import {
  checkGlabAuth,
  resolveRegistry,
  fetchRegistryIndex,
  readLocalSkills,
  exists,
} from "../registry.js";

function parseSearchArgs(args) {
  const parsed = { query: null, tag: null, tier: null };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--tag" && i + 1 < args.length) {
      parsed.tag = args[++i];
      continue;
    }
    if (arg === "--tier" && i + 1 < args.length) {
      parsed.tier = args[++i];
      continue;
    }
    if (arg.startsWith("-")) {
      throw new Error(`Unknown option: ${arg}`);
    }
    if (parsed.query) {
      // Allow multi-word queries
      parsed.query += ` ${arg}`;
    } else {
      parsed.query = arg;
    }
  }

  if (!parsed.query && !parsed.tag && !parsed.tier) {
    throw new Error("Missing search query. Usage: carja search <query> [--tag <tag>]");
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

export async function searchCommand(args, { cwd, stdout, stderr }) {
  let parsed;
  try {
    parsed = parseSearchArgs(args);
  } catch (err) {
    stderr.write(`${err.message}\n`);
    return 1;
  }

  const projectDir = resolve(cwd);
  const { hostname, project } = await resolveRegistry(projectDir);

  const auth = await checkGlabAuth(hostname);
  if (!auth.ok) {
    stderr.write(`${auth.error}\n`);
    return 1;
  }

  stdout.write("🔍 Searching registry...\n");

  let registry;
  try {
    registry = await fetchRegistryIndex(hostname, project);
  } catch (err) {
    stderr.write(`Failed to fetch registry: ${err.message}\n`);
    return 1;
  }

  const query = parsed.query?.toLowerCase();

  // Filter skills by query, tag, and tier
  const matches = registry.skills.filter((skill) => {
    // Tier filter
    if (parsed.tier && skill.tier !== parsed.tier) return false;

    // Tag filter
    if (parsed.tag && !skill.tags.includes(parsed.tag.toLowerCase())) return false;

    // Text search across name, description, and tags
    if (query) {
      const haystack = [
        skill.name,
        skill.description,
        ...skill.tags,
        ...(skill.techStack || []),
      ]
        .join(" ")
        .toLowerCase();
      return haystack.includes(query);
    }

    return true;
  });

  if (matches.length === 0) {
    stdout.write(`No skills found matching "${parsed.query || parsed.tag || parsed.tier}".\n`);
    return 0;
  }

  // Check which are locally installed
  const skillsDir = join(projectDir, ".agents", "skills");
  const localSkills = await readLocalSkills(skillsDir);
  const localNames = new Set(localSkills.map((s) => s.name));

  stdout.write(`\n  ${matches.length} result${matches.length > 1 ? "s" : ""}\n\n`);

  const nameWidth = Math.max(20, ...matches.map((s) => s.name.length + 2));

  for (const skill of matches) {
    const installed = localNames.has(skill.name) ? " ✓" : "  ";
    const name = skill.name.padEnd(nameWidth);
    const tier = tierLabel(skill.tier).padEnd(8);
    stdout.write(`${installed} ${name} ${tier} ${skill.description}\n`);
    if (skill.tags.length > 0) {
      stdout.write(`     tags: ${skill.tags.join(", ")}\n`);
    }
  }

  stdout.write("\n");
  stdout.write(`  ✓ = installed locally\n`);
  stdout.write(`  Install with: carja add <skill-name>\n\n`);
  return 0;
}
