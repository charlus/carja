#!/usr/bin/env node

import { runCli } from "../src/cli.js";
import { mirrorEnv } from "../src/names.js";

// CARJA_* settings reach every CONDUCTOR_* reader, here and in child processes.
mirrorEnv(process.env);

runCli(process.argv.slice(2))
  .then((exitCode) => {
    process.exitCode = exitCode;
  })
  .catch((error) => {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`${message}\n`);
    process.exitCode = 1;
  });
