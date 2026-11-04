// src/commands/verify.js
//
// `carja verify` — the one command that answers "what does `git push` run
// here, and how do I change it?"
//
// WHY. The push gate is the framework's central enforcement bet, and until now
// the only way to configure it was to know that a `verify` key exists, in a file
// that `upgrade` did not always create. The maintainer — who helped build the
// feature — could not act on the warning. A safety switch nobody can find is
// not a safety switch.
//
// Setting a command RUNS it first. A gate configured with a command that cannot
// pass is worse than no gate: it blocks every push and teaches the operator to
// reach for CARJA_SKIP_VERIFY.

import { spawn } from "node:child_process";
import { statSync } from "node:fs";
import { join } from "node:path";
import { suggestVerifyCommand } from "../detect.js";
import { CONFIG_FILE, NONE, readGateState, writeVerify } from "../verify-config.js";

function parseArgs(args) {
  const opts = { dir: null, repo: null, set: null, none: false, detect: false, run: true };
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === "--set") opts.set = args[++i] ?? "";
    else if (arg === "--none" || arg === "--off") opts.none = true;
    else if (arg === "--detect") opts.detect = true;
    else if (arg === "--no-run") opts.run = false;
    else if (arg === "--repo") opts.repo = (args[++i] ?? "").replace(/\/+$/, "");
    else if (!arg.startsWith("-") && !opts.dir) opts.dir = arg;
  }
  return opts;
}

function isDirectory(path) {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
}

/** Run a command exactly as the hook will: through a shell, at the repo root. */
function runOnce(cmd, cwd) {
  return new Promise((resolve) => {
    const child = spawn(cmd, { cwd, shell: true, stdio: "inherit" });
    child.on("error", () => resolve(1));
    child.on("close", (code) => resolve(code ?? 1));
  });
}

function showState(gate, out) {
  if (gate.state === NONE) {
    out.write(
      "\n  Push gate: OFF, by declaration.\n" +
        `  This project states it has nothing to verify ("verify": "${NONE}" in ${CONFIG_FILE}).\n` +
        '\n  Turn it on:   carja verify --set "<command>"\n',
    );
    return;
  }
  if (gate.state === "set") {
    out.write(
      `\n  Push gate: ${gate.command}\n` +
        `  Source:    ${gate.source}\n` +
        "  Every `git push` runs this and blocks if it fails.\n" +
        '\n  Change it:    carja verify --set "<command>"\n' +
        "  Prove it now: run the command above, or set it again (it runs once first)\n",
    );
    return;
  }
  out.write(
    "\n  Push gate: OFF — `git push` runs no test in this project.\n" +
      "  Nothing could be derived from the files that are here.\n" +
      '\n  Set it:       carja verify --set "npm test"     (the command that proves this project works)\n' +
      "  Detect it:    carja verify --detect\n" +
      `  Nothing here: carja verify --none               (a docs or state repo — recorded in ${CONFIG_FILE})\n`,
  );
}

export async function verifyCommand(args, context) {
  const opts = parseArgs(args);
  const root = opts.dir ?? context.cwd;
  const { stdout, stderr } = context;
  // Outer layout: the gate of one nested code repository, stored as
  // repos.<dir>.verify and run inside that repository.
  const repo = opts.repo || null;
  const workDir = repo ? join(root, repo) : root;
  if (repo !== null && (repo.includes("/") || !isDirectory(workDir))) {
    stderr.write(`\n  --repo needs a code repository folder at the top of this project; '${opts.repo}' is not one.\n`);
    return 1;
  }

  if (opts.none) {
    await writeVerify(root, NONE, repo);
    stdout.write(
      `\n  Push gate: OFF, recorded in ${CONFIG_FILE}.\n` +
        "  Carja will stop asking. `git push` verifies nothing here.\n" +
        '\n  Changed your mind:  carja verify --set "<command>"\n',
    );
    return 0;
  }

  let command = opts.set;
  if (opts.detect) {
    command = await suggestVerifyCommand(workDir);
    if (!command) {
      stderr.write(
        "\n  Nothing derivable from this project's files.\n" +
          '  Set it by hand:  carja verify --set "<command>"\n' +
          "  Or declare it:   carja verify --none\n",
      );
      return 1;
    }
    stdout.write(`\n  Derived from this project's files: ${command}\n`);
  }

  if (command === null) {
    showState(await readGateState(root, repo), stdout);
    return 0;
  }

  if (!command.trim()) {
    stderr.write('\n  --set needs a command, e.g.  carja verify --set "npm test"\n');
    return 1;
  }

  if (opts.run) {
    stdout.write(`\n  Running it once to prove it works: ${command}\n\n`);
    const code = await runOnce(command, workDir);
    if (code !== 0) {
      stderr.write(
        `\n  ✗ Exit ${code}. Nothing was written — a gate that cannot pass blocks every push.\n` +
          "  Fix the command (or the project), then run this again.\n" +
          "  Meant to set it anyway:  carja verify --set \"…\" --no-run\n",
      );
      return 1;
    }
    stdout.write("\n  ✓ Passed.\n");
  }

  const { created } = await writeVerify(root, command, repo);
  stdout.write(
    `  Push gate: ${command}\n` +
      `  ${created ? "Created" : "Updated"} ${CONFIG_FILE}. Every \`git push\` runs it from now on.\n`,
  );
  return 0;
}
