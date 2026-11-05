/**
 * registry.js — Shared utility for skills registry operations.
 *
 * Uses `glab api` to interact with the GitLab-hosted skills registry.
 * Requires GitLab CLI (`glab`) to be installed and authenticated.
 */

import { execFile } from "node:child_process";
import { access, mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { constants as fsConstants } from "node:fs";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import { configPath as configPathOf } from "./names.js";

const exec = promisify(execFile);

// No hardcoded defaults — registry must be configured via carja.config.json

/**
 * Check if glab CLI is installed and authenticated for the target hostname.
 * @returns {{ ok: boolean, error?: string }}
 */
export async function checkGlabAuth(hostname = DEFAULT_HOSTNAME) {
  try {
    const { stdout } = await exec("glab", ["auth", "status", "--hostname", hostname], {
      timeout: 10_000,
    });
    // glab auth status outputs to stderr on success, stdout may be empty
    return { ok: true };
  } catch (err) {
    // glab auth status exits non-zero if not authenticated
    const message = err.stderr || err.message || "Unknown error";
    if (message.includes("not found") || err.code === "ENOENT") {
      return { ok: false, error: "GitLab CLI (glab) is not installed. Install it: https://gitlab.com/gitlab-org/cli" };
    }
    return { ok: false, error: `Not authenticated to ${hostname}. Run: glab auth login --hostname ${hostname}` };
  }
}

/**
 * Resolve registry settings from carja.config.json.
 * Throws if no config is found — registry must be explicitly configured.
 * @param {string} projectDir - The project root directory
 * @returns {{ project: string, hostname: string }}
 */
export async function resolveRegistry(projectDir) {
  const configPath = configPathOf(projectDir);
  let raw;
  try {
    raw = await readFile(configPath, "utf-8");
  } catch {
    throw new Error(
      "No carja.config.json found.\n" +
      "Create one with your registry URL:\n\n" +
      '  { "registry": "https://your-gitlab.com/group/skills-registry" }\n'
    );
  }

  const config = JSON.parse(raw);
  if (!config.registry) {
    throw new Error(
      'carja.config.json is missing the "registry" field.\n' +
      "Add your registry URL:\n\n" +
      '  { "registry": "https://your-gitlab.com/group/skills-registry" }\n'
    );
  }

  const url = new URL(config.registry);
  return {
    hostname: url.hostname,
    project: url.pathname.replace(/^\//, "").replace(/\/$/, ""),
  };
}

/**
 * Fetch the registry.json index from GitLab.
 * @returns {object} Parsed registry index
 */
export async function fetchRegistryIndex(hostname, project) {
  const encodedProject = encodeURIComponent(project);
  const endpoint = `projects/${encodedProject}/repository/files/registry.json/raw?ref=main`;

  const { stdout } = await exec("glab", [
    "api", endpoint,
    "--hostname", hostname,
  ], { timeout: 30_000 });

  return JSON.parse(stdout);
}

/**
 * Download a single skill folder from the registry.
 * Uses GitLab's Tree API to list files, then downloads each via raw file endpoint.
 * @param {string} hostname - GitLab hostname
 * @param {string} project - Project path (e.g., "carja/skills-registry")
 * @param {string} skillName - Skill directory name in the registry
 * @param {string} targetDir - Where to extract (e.g., ".agents/skills")
 * @returns {string} Path to the installed skill
 */
export async function downloadSkill(hostname, project, skillName, targetDir) {
  const encodedProject = encodeURIComponent(project);
  const skillPath = `skills/${skillName}`;
  const encodedPath = encodeURIComponent(skillPath);

  // 1. List files in the skill directory via Tree API
  const { stdout: treeJson } = await exec("glab", [
    "api", `projects/${encodedProject}/repository/tree?path=${encodedPath}&ref=main&recursive=true`,
    "--hostname", hostname,
  ], { timeout: 30_000 });

  const tree = JSON.parse(treeJson);
  const files = tree.filter((entry) => entry.type === "blob");

  if (files.length === 0) {
    throw new Error(`No files found in registry at ${skillPath}`);
  }

  // 2. Create target directory
  const skillTargetDir = join(targetDir, skillName);
  await mkdir(skillTargetDir, { recursive: true });

  // 3. Download each file via raw file endpoint
  for (const file of files) {
    const encodedFilePath = encodeURIComponent(file.path);
    const { stdout: content } = await exec("glab", [
      "api", `projects/${encodedProject}/repository/files/${encodedFilePath}/raw?ref=main`,
      "--hostname", hostname,
    ], { timeout: 30_000, maxBuffer: 5 * 1024 * 1024 });

    // Compute relative path within the skill folder
    const relativePath = file.path.replace(`${skillPath}/`, "");
    const targetPath = join(skillTargetDir, relativePath);

    // Create subdirectories if needed (for skills with nested files)
    const targetSubDir = join(skillTargetDir, ...relativePath.split("/").slice(0, -1));
    if (relativePath.includes("/")) {
      await mkdir(targetSubDir, { recursive: true });
    }

    await writeFile(targetPath, content);
  }

  return skillTargetDir;
}

/**
 * Read locally installed skills from .agents/skills/.
 * @param {string} skillsDir - Path to .agents/skills/
 * @returns {Array<{ name: string, dir: string, manifest: object|null }>}
 */
export async function readLocalSkills(skillsDir) {
  let entries;
  try {
    entries = await readdir(skillsDir, { withFileTypes: true });
  } catch {
    return [];
  }

  const skills = [];
  for (const entry of entries) {
    if (!entry.isDirectory() || entry.name.startsWith(".")) continue;

    let manifest = null;
    try {
      const raw = await readFile(join(skillsDir, entry.name, "skill.json"), "utf-8");
      manifest = JSON.parse(raw);
    } catch {
      // No manifest — legacy skill
    }

    skills.push({
      name: manifest?.name || entry.name.toLowerCase(),
      dir: entry.name,
      manifest,
    });
  }

  return skills.sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * Check if a path exists.
 */
export async function exists(path) {
  try {
    await access(path, fsConstants.F_OK);
    return true;
  } catch {
    return false;
  }
}
