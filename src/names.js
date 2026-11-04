// src/names.js
//
// The framework's two names, during the rename from Conductor to Carja
// (docs/roadmap/Rename-To-Carja.md). PR 1: every reader accepts both names,
// and nothing writes the new one yet. PR 2 flips CURRENT to "carja", which
// makes every writer below use the new name while 6.x installs still read.
//
// Order matters: the new name is always looked for first. After the rename a
// `conductor/` folder may remain with Google Conductor's files in it, so
// `carja/` wins whenever it exists.

import { existsSync, statSync } from "node:fs";
import { join } from "node:path";

/** The name writers use. */
export const CURRENT = "conductor";

/** Every name readers accept, the new one first. */
export const MARKER_NAMES = Object.freeze(["carja", "conductor"]);

const STATE_DIRS = MARKER_NAMES;
const CONFIG_FILES = MARKER_NAMES.map((n) => `${n}.config.json`);

/** The version stamp file names inside `.agents/`, the new one first. */
export const STAMP_FILES = Object.freeze(MARKER_NAMES.map((n) => `.${n}-version.json`));

const isDir = (p) => {
  try {
    return statSync(p).isDirectory();
  } catch {
    return false;
  }
};

/** The state folder of the project at `root`: the first that exists, else the current name. */
export function stateDirName(root) {
  return STATE_DIRS.find((n) => isDir(join(root, n))) ?? CURRENT;
}

/** `rel` with its state-folder prefix (`conductor/` or `carja/`) set to the one `root` has. */
export function statePath(root, rel) {
  const m = /^(carja|conductor)(\/|$)/.exec(rel);
  return m ? stateDirName(root) + rel.slice(m[1].length) : rel;
}

/** True when `rel` lies in a state folder, under either name. */
export function isStatePath(rel) {
  return /^(carja|conductor)\//.test(rel);
}

/** The config file name of the project at `root`: the first that exists, else the current name. */
export function configFileName(root) {
  return CONFIG_FILES.find((f) => existsSync(join(root, f))) ?? `${CURRENT}.config.json`;
}

/** Absolute path of the config file of the project at `root`. */
export function configPath(root) {
  return join(root, configFileName(root));
}

/**
 * Copy each `CARJA_X` to `CONDUCTOR_X` when the old name is not set, so every
 * reader of the old name sees the new one, here and in child processes. An
 * explicit old value wins: it was set on purpose. Mutates and returns `env`.
 */
export function mirrorEnv(env = process.env) {
  for (const [key, value] of Object.entries(env)) {
    if (!key.startsWith("CARJA_")) continue;
    const old = `CONDUCTOR_${key.slice("CARJA_".length)}`;
    if (env[old] === undefined || env[old] === "") env[old] = value;
  }
  return env;
}

/** A regex source matching either marker prefix, for `<!-- <name>:… -->` comments. */
export const MARKER_PREFIX = "(?:carja|conductor)";
