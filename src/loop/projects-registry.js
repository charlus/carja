// src/loop/projects-registry.js
//
// The watch tower (A4a, 2026-10-21): the products the loop works on, on this
// machine, so `carja watch --all` can show them on one screen. Machine
// state, never in a repository: `~/.config/carja/loop-projects.json` (`~/.config/conductor/` when only that exists), or
// `$CARJA_HOME/loop-projects.json`. `carja loop on` adds a product.

import { readFile, writeFile, mkdir } from "node:fs/promises";
import { join, resolve } from "node:path";
import { configHome } from "../names.js";

export function registryPath(env = process.env) {
  return join(configHome(env), "loop-projects.json");
}

/** The registered product folders, in the order they were added. Never throws. */
export async function listLoopProjects(env = process.env) {
  try {
    const d = JSON.parse(await readFile(registryPath(env), "utf8"));
    return Array.isArray(d.projects) ? d.projects.filter((p) => typeof p === "string") : [];
  } catch {
    return [];
  }
}

/** Add a product folder (absolute), once. */
export async function addLoopProject(dir, env = process.env) {
  const abs = resolve(dir);
  const list = await listLoopProjects(env);
  if (list.includes(abs)) return false;
  await mkdir(join(registryPath(env), ".."), { recursive: true });
  await writeFile(registryPath(env), `${JSON.stringify({ projects: [...list, abs] }, null, 2)}\n`, "utf8");
  return true;
}
