// src/main.js — the process entry shared by `carja` and its 6.x alias `conductor`.

import { runCli } from "./cli.js";
import { mirrorEnv } from "./names.js";

export function main(argv) {
  // 6.x settings and waivers (CONDUCTOR_*) still work, here and in child processes.
  const old = mirrorEnv(process.env);
  if (old.length) process.stderr.write(`Note: ${old.join(", ")} ${old.length === 1 ? "is" : "are"} read as CARJA_*. Rename ${old.length === 1 ? "it" : "them"} before 8.0.\n`);
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
