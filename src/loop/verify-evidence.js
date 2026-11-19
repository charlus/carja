// src/loop/verify-evidence.js
//
// The driver's verify, through the evidence ledger (src/evidence/ledger.js).
// A green run recorded on the same content (wtree), by the exact same command,
// with the same .env files, is reused instead of run again. Everything else
// runs, and the run is recorded under the label `verify`, the label the
// pre-push hook checks.
//
// The Evidence Rule holds: a reused verdict is the exit code of a real run on
// identical content, never a self-report. A ledger that cannot prove FRESH
// (missing, unreadable, another branch, another command, a run that changed
// files while it ran) grades STALE, and verify runs.

import { readdir } from "node:fs/promises";
import { recordRun, checkFreshness, rootEnvFiles } from "../evidence/ledger.js";

const LABEL = "verify";

/**
 * @returns {Promise<{exitCode:number, output:string, reused:boolean}>}
 */
export async function verifyWithEvidence(cmd, cwd, { home = null } = {}) {
  const envFiles = await rootEnvFiles(cwd);
  const fresh = await checkFreshness({ labels: [{ label: LABEL, expectCmd: cmd }], cwd, home, envFiles });
  const r = fresh.byLabel[LABEL];
  if (fresh.ok) {
    return {
      exitCode: 0,
      output: `verify reused: the run of ${r.ts} passed on this exact content with this command (${cmd})\n`,
      reused: true,
    };
  }
  let output = "";
  const sink = { write: (d) => (output += d.toString()) };
  const { exitCode } = await recordRun({ label: LABEL, command: cmd, cwd, home, envFiles, io: { stdout: sink, stderr: sink }, progressEveryMs: 0 });
  return { exitCode, output, reused: false };
}
