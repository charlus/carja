// src/verify-config.js
//
// The push gate's configuration: read it, write it, and say what it is in words
// the reader can act on. Shared by `init`, `upgrade`, `conductor verify`,
// `conductor status` and the pre-push hook's message.
//
// WHY. The Verification Iron Law is enforced by `pre-push` running the `verify`
// command from `conductor.config.json`. Measured 2026-09-15 across the
// maintainer's five live projects: ONE had a command. Everywhere else the hook
// printed a one-line "Skipping verify." and the framework's central enforcement
// bet was not running — and nobody noticed, because the message read as
// informational.
//
// Measured again 2026-09-16, after the first fix: the message now named the key
// and the file, and it was STILL unactionable, because `upgrade` never created
// the file it named, and because "nothing to verify" was not a state the config
// could express — so a docs/state repo got the same warning forever. Three
// rules now:
//   1. derive when the files make it deterministic, never guess;
//   2. every message names a command you can paste, not a key you must find;
//   3. OFF can be DECLARED (`"verify": "none"`), so the warning only ever fires
//      at a project that has not decided.

import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { suggestVerifyCommand } from "./detect.js";
import { configPath as configPathOf } from "./names.js";

export const CONFIG_FILE = "conductor.config.json";

/** The one spelling of a deliberately disabled gate. Never handed to a shell. */
export const NONE = "none";

export const NO_VERIFY_WARNING =
  "\n⚠️  Push gate OFF — `git push` will not run any test in this project.\n" +
  "   Conductor could not work out how to verify it from the files that are here.\n" +
  "   Decide in one command:\n" +
  '     conductor verify --set "npm test"   ← the command that proves this project works\n' +
  "     conductor verify --none             ← nothing to verify here (docs/state repo)\n" +
  "   Until then the Verification Iron Law is not enforced on push.\n";

/**
 * The gate's state from the two files that can define it. Pure, so the CLI, the
 * status digest and the tests all read it the same way — and it mirrors
 * `lib.sh`'s `conductor_verify_cmd` priority exactly, so the hook can never
 * disagree with what `conductor status` printed.
 *
 * @param {string|null} configRaw contents of conductor.config.json
 * @param {string|null} pkgRaw contents of package.json
 * @returns {{state: "set"|"none"|"unset", command: string|null, source: string|null}}
 */
export function gateStateFrom(configRaw, pkgRaw) {
  let configured = "";
  try {
    const cfg = configRaw ? JSON.parse(configRaw) : null;
    configured = typeof cfg?.verify === "string" ? cfg.verify.trim() : "";
  } catch {
    /* unreadable config → fall through to the package.json fallback */
  }
  if (configured.toLowerCase() === NONE) {
    return { state: NONE, command: null, source: CONFIG_FILE };
  }
  if (configured) return { state: "set", command: configured, source: CONFIG_FILE };

  try {
    const pkg = pkgRaw ? JSON.parse(pkgRaw) : null;
    if (pkg?.scripts?.test) return { state: "set", command: "npm test", source: "package.json" };
  } catch {
    /* unreadable package.json → no command */
  }
  return { state: "unset", command: null, source: null };
}

async function readIfPresent(path) {
  try {
    return await readFile(path, "utf-8");
  } catch {
    return null;
  }
}

/**
 * `gateStateFrom` for a directory on disk. With `repo` (outer layout), the gate
 * of that nested code repository: `repos.<repo>.verify`, then its own
 * package.json, the same order as lib.sh `conductor_verify_cmd`.
 */
export async function readGateState(targetDir, repo = null) {
  if (!repo) {
    return gateStateFrom(
      await readIfPresent(configPathOf(targetDir)),
      await readIfPresent(join(targetDir, "package.json")),
    );
  }
  let verify;
  try {
    verify = JSON.parse((await readIfPresent(configPathOf(targetDir))) ?? "{}")?.repos?.[repo]?.verify;
  } catch {
    verify = undefined;
  }
  return gateStateFrom(JSON.stringify({ verify }), await readIfPresent(join(targetDir, repo, "package.json")));
}

/**
 * Write `verify` into conductor.config.json, CREATING the file when it is
 * missing. Every other key is preserved.
 *
 * Creating it matters: the old warning named a file that `upgrade` never wrote,
 * so the reader was told to edit something that was not there.
 *
 * @returns {Promise<{created: boolean, path: string}>}
 */
export async function writeVerify(targetDir, command, repo = null) {
  const cfgPath = configPathOf(targetDir);
  const raw = await readIfPresent(cfgPath);
  let cfg = {};
  try {
    const parsed = raw ? JSON.parse(raw) : null;
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) cfg = parsed;
  } catch {
    cfg = {};
  }
  if (repo) {
    const repos = cfg.repos && typeof cfg.repos === "object" ? cfg.repos : {};
    cfg.repos = { ...repos, [repo]: { ...(repos[repo] || {}), verify: command } };
  } else {
    cfg.verify = command;
  }
  await writeFile(cfgPath, `${JSON.stringify(cfg, null, 2)}\n`);
  return { created: raw === null, path: cfgPath };
}

/**
 * Read conductor.config.json, fill `verify` from the project's files when it is
 * empty and derivable, and report. Never overwrites a decision already made —
 * a command, or a declared `none`.
 *
 * @param {string} targetDir project root
 * @param {{write: (s: string) => void}} stdout
 * @returns {Promise<{command: string, source: "configured"|"derived"|"declared-none"|"none"}>}
 */
export async function ensureVerifyCommand(targetDir, stdout) {
  const gate = await readGateState(targetDir);

  if (gate.state === NONE) {
    stdout.write(
      "\n🔓 Push gate: OFF by declaration (\"verify\": \"none\").\n" +
        '   Turn it on whenever there is something to run:  conductor verify --set "<command>"\n',
    );
    return { command: "", source: "declared-none" };
  }

  if (gate.state === "set") {
    stdout.write(
      `\n🔒 Push gate: ${gate.command}\n` +
        `   From ${gate.source}. Change it:  conductor verify --set "<command>"\n`,
    );
    // A package.json fallback works, but it is invisible until something breaks.
    // Pin it so the gate is stated, not inferred.
    if (gate.source === "package.json") await writeVerify(targetDir, gate.command);
    return { command: gate.command, source: "configured" };
  }

  const derived = await suggestVerifyCommand(targetDir);
  if (derived) {
    await writeVerify(targetDir, derived);
    stdout.write(
      `\n🔒 Push gate set to: ${derived}\n` +
        `   Derived from this project's files. Wrong?  conductor verify --set "<command>"\n`,
    );
    return { command: derived, source: "derived" };
  }

  // Leave the key behind, empty, so the file the warning names exists and the
  // reader can see the shape of what is missing.
  await writeVerify(targetDir, "");
  stdout.write(NO_VERIFY_WARNING);
  return { command: "", source: "none" };
}
