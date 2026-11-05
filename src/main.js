// src/main.js — the process entry shared by `carja` and its 6.x alias `conductor`.

import { runCli } from "./cli.js";
import { spawnSync } from "node:child_process";
import { isAbsolute, join } from "node:path";
import { isOldLayout, mirrorEnv } from "./names.js";
import { adoptOldGitFiles } from "./rename-migration.js";

// A clone that got the rename by a pull still has .git/conductor-*: the loop
// logs, the ready queue and the hook heartbeats. Adopt them once (7.0.1, F5).
function adoptGitFiles() {
  const r = spawnSync("git", ["rev-parse", "--show-toplevel", "--git-common-dir"], { encoding: "utf8" });
  if (r.status !== 0) return;
  const [top, common] = r.stdout.trim().split("\n");
  if (!top || !common || isOldLayout(top)) return;
  try {
    adoptOldGitFiles(isAbsolute(common) ? common : join(process.cwd(), common));
  } catch {
    // Machine state only: never block a command over it.
  }
}

export function main(argv) {
  // 6.x settings and waivers (CONDUCTOR_*) still work, here and in child processes.
  const old = mirrorEnv(process.env);
  if (old.length) process.stderr.write(`Note: ${old.join(", ")} ${old.length === 1 ? "is" : "are"} read as CARJA_*. Rename ${old.length === 1 ? "it" : "them"} before 8.0.\n`);
  adoptGitFiles();
  runCli(argv)
    .then((exitCode) => {
      process.exitCode = exitCode;
    })
    .catch((error) => {
      const message = error instanceof Error ? error.message : String(error);
      process.stderr.write(`${message}\n`);
      process.exitCode = 1;
    });
}
