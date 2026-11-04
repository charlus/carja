// src/names.js
//
// The framework's two names after the rename from Conductor to Carja (7.0.0,
// docs/roadmap/Rename-To-Carja.md). Writers use CURRENT. Readers accept both,
// the new name first, through 7.x; the old names are removed in 8.0 (D1).
//
// Order matters: the new name is always looked for first. After the rename a
// `conductor/` folder may remain with Google Conductor's files in it, so
// `carja/` wins whenever it exists.

import { existsSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

/** The name writers use. */
export const CURRENT = "carja";

/** The name of 6.x installs, accepted by readers through 7.x. */
export const OLD = "conductor";

/** Every name readers accept, the new one first. */
export const MARKER_NAMES = Object.freeze([CURRENT, OLD]);

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

/** `rel` with its state-folder prefix (`carja/` or `conductor/`) set to the one `root` has. */
export function statePath(root, rel) {
  const m = /^(carja|conductor)(\/|$)/.exec(rel);
  return m ? stateDirName(root) + rel.slice(m[1].length) : rel;
}

/** True when `rel` lies in a state folder, under either name. */
export function isStatePath(rel) {
  return /^(carja|conductor)\//.test(rel);
}

/**
 * True when `root` is a 6.x install: our numbered folders under `conductor/`
 * and no `carja/`. `carja upgrade` moves it; the loop refuses it until then.
 */
export function isOldLayout(root) {
  if (isDir(join(root, CURRENT))) return false;
  const old = join(root, OLD);
  return ["0-compass", "1-workbench", "2-backlog"].some((n) => isDir(join(old, n)));
}

/** The refusal for commands that write state and run unattended, on a 6.x layout. */
export function oldLayoutMessage(root) {
  return `${root} is still on the 6.x layout (conductor/). Run \`carja upgrade\` there first: it moves conductor/ to carja/ in one commit.\n`;
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
 * The machine folder for trust consents, the evidence ledger and the review
 * store: `$CARJA_HOME`, else `~/.carja`, else an existing `~/.conductor` (a
 * machine set up under 6.x keeps its consents and records).
 */
export function machineHome(env = process.env) {
  if (env.CARJA_HOME) return env.CARJA_HOME;
  const home = env.HOME || homedir();
  const neu = join(home, `.${CURRENT}`);
  const old = join(home, `.${OLD}`);
  return !isDir(neu) && isDir(old) ? old : neu;
}

/** The folder of `loop-projects.json`: `$CARJA_HOME`, else `~/.config/carja`, else an existing `~/.config/conductor`. */
export function configHome(env = process.env) {
  if (env.CARJA_HOME) return env.CARJA_HOME;
  const base = join(env.HOME || homedir(), ".config");
  const neu = join(base, CURRENT);
  const old = join(base, OLD);
  return !isDir(neu) && isDir(old) ? old : neu;
}

/**
 * Copy each `CONDUCTOR_X` to `CARJA_X` when the new name is not set, so a 6.x
 * waiver or setting still works, here and in child processes. An explicit new
 * value wins. Returns the old names that were copied, for one notice.
 */
export function mirrorEnv(env = process.env) {
  const copied = [];
  for (const [key, value] of Object.entries(env)) {
    if (!key.startsWith("CONDUCTOR_")) continue;
    const neu = `CARJA_${key.slice("CONDUCTOR_".length)}`;
    if (env[neu] === undefined || env[neu] === "") {
      env[neu] = value;
      copied.push(key);
    }
  }
  return copied;
}

/** A regex source matching either marker prefix, for `<!-- <name>:… -->` comments. */
export const MARKER_PREFIX = "(?:carja|conductor)";
