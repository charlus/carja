// src/commands/trust-verify.js
//
// `conductor trust-verify` — record the operator's consent for this repo's
// declared verification command (E4).
//
// WHY THIS EXISTS. The Stop hook (`.agents/hooks/verification-stop-hook.sh`)
// runs the project's verification command, and git hooks BYPASS the agent's
// permission system: nothing prompts, nothing asks. The command itself is read
// from a file inside the repo (`conductor.config.json` → `verify`, else the
// `test` npm script), so a cloned, forked or contributed repo can name any
// command it likes. Installing Conductor's hooks would otherwise mean granting
// silent execution to a string somebody else controls.
//
// So the stop gate stays inactive until the operator has looked at the command
// once and recorded it here. Trust is keyed on realpath(repo root) plus the
// sha256 of the exact command string, so editing the command invalidates it and
// the operator has to look again.
//
// Deliberately NOT gated: `pre-push`. There the operator typed `git push`, so a
// human action is already in the chain.

import { access, mkdir, readFile, writeFile, rename, appendFile, chmod } from "node:fs/promises";
import { constants as fsConstants } from "node:fs";
import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { join, dirname } from "node:path";
import { homedir } from "node:os";
import { configPath as configPathOf } from "../names.js";

const execFileAsync = promisify(execFile);

const TAB = "\t";

/** Where the trust store lives. Mirrors lib.sh's `conductor_trust_store`. */
export function trustStorePath(env = process.env) {
  const home = env.CONDUCTOR_HOME || join(env.HOME || homedir(), ".conductor");
  return join(home, "verify-trust");
}

export function commandHash(cmd) {
  return createHash("sha256").update(String(cmd)).digest("hex");
}

/**
 * Resolve the repo's declared verification command, using the same precedence
 * as `conductor_verify_cmd` in lib.sh: conductor.config.json `verify`, then a
 * package.json `test` script.
 * @returns {Promise<{cmd: string|null, from: string|null}>}
 */
export async function resolveDeclaredVerify(root) {
  try {
    const raw = JSON.parse(await readFile(configPathOf(root), "utf8"));
    if (typeof raw.verify === "string" && raw.verify.trim()) {
      return { cmd: raw.verify.trim(), from: "conductor.config.json (verify)" };
    }
  } catch {
    /* absent or unparseable → fall through */
  }
  try {
    const pkg = JSON.parse(await readFile(join(root, "package.json"), "utf8"));
    if (pkg?.scripts?.test) return { cmd: "npm test", from: "package.json (test script)" };
  } catch {
    /* absent or unparseable → no command */
  }
  return { cmd: null, from: null };
}

/** Parse the flat "path<TAB>hash" store into a Map. Missing file → empty. */
async function readStore(path) {
  const map = new Map();
  try {
    const text = await readFile(path, "utf8");
    for (const line of text.split("\n")) {
      if (!line.trim()) continue;
      const i = line.indexOf(TAB);
      if (i < 0) continue;
      map.set(line.slice(0, i), line.slice(i + 1).trim());
    }
  } catch {
    /* no store yet */
  }
  return map;
}

/** Atomic 0600 rewrite, so a crashed write can never leave a half store. */
async function writeStore(path, map) {
  await mkdir(dirname(path), { recursive: true });
  const body = [...map.entries()].map(([p, h]) => `${p}${TAB}${h}`).join("\n") + "\n";
  const tmp = `${path}.tmp.${process.pid}`;
  await writeFile(tmp, body, { mode: 0o600 });
  await rename(tmp, path);
  await chmod(path, 0o600).catch(() => {});
}

export async function trustVerifyCommand(argv, context) {
  const { cwd, stdout, stderr } = context;
  const revoke = argv.includes("--revoke");
  const list = argv.includes("--list");

  const storePath = trustStorePath(process.env);

  if (list) {
    const store = await readStore(storePath);
    if (store.size === 0) {
      stdout.write("No verification commands are trusted yet.\n");
      return 0;
    }
    stdout.write(`Trusted verification commands (${storePath}):\n`);
    for (const [p, h] of store) stdout.write(`  ${p}  ${h.slice(0, 12)}…\n`);
    return 0;
  }

  let root;
  try {
    const { stdout: out } = await execFileAsync("git", ["rev-parse", "--show-toplevel"], { cwd });
    root = out.trim();
  } catch {
    stderr.write("conductor trust-verify: not inside a git repository.\n");
    return 1;
  }
  // Symlink-stable key, matching lib.sh's `conductor_trust_key` (pwd -P).
  const realRoot = await execFileAsync("sh", ["-c", "pwd -P"], { cwd: root })
    .then(({ stdout: o }) => o.trim())
    .catch(() => root);

  const store = await readStore(storePath);

  if (revoke) {
    if (!store.delete(realRoot)) {
      stdout.write(`Nothing to revoke — ${realRoot} was not trusted.\n`);
      return 0;
    }
    await writeStore(storePath, store);
    stdout.write(`Revoked verification trust for ${realRoot}.\n`);
    return 0;
  }

  const { cmd, from } = await resolveDeclaredVerify(root);
  if (cmd === "none") {
    stderr.write(
      "conductor trust-verify: this repo declares it has nothing to verify.\n" +
        '  There is no command to trust. Give it one:  conductor verify --set "<command>"\n',
    );
    return 1;
  }
  if (!cmd) {
    stderr.write(
      "conductor trust-verify: this repo declares no verification command.\n" +
        '  Set one first:  conductor verify --set "<command>"\n',
    );
    return 1;
  }

  // Show it before recording. The whole point is that a human reads the string.
  stdout.write(`Repo:    ${realRoot}\n`);
  stdout.write(`Source:  ${from}\n`);
  stdout.write(`Command: ${cmd}\n`);

  const hash = commandHash(cmd);
  if (store.get(realRoot) === hash) {
    stdout.write("Already trusted — nothing to do.\n");
    return 0;
  }

  store.set(realRoot, hash);
  await writeStore(storePath, store);

  // A grant is never invisible: append an audit line next to the store.
  const log = join(dirname(storePath), "verify-trust-grants.log");
  await appendFile(
    log,
    `${new Date().toISOString()}${TAB}${realRoot}${TAB}${hash}${TAB}${cmd}\n`,
    { mode: 0o600 },
  ).catch(() => {});

  stdout.write(
    "\nTrusted. The Stop hook may now run this command for this repo.\n" +
      "Change the command and it must be trusted again. Revoke with --revoke.\n",
  );
  return 0;
}

export async function pathExists(p) {
  try {
    await access(p, fsConstants.F_OK);
    return true;
  } catch {
    return false;
  }
}
