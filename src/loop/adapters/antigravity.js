// src/loop/adapters/antigravity.js
//
// The Antigravity platform adapter. Carja was originally Antigravity-first;
// the V5 stub hardcoded `antigravity run workflows/unattended-loop.md` inside the
// driver. Phase 2 demotes that to just another adapter behind the shared
// interface — the driver no longer knows any platform name.
//
// NB: the Antigravity CLI binary is `agy` (verified against agy 1.1.6), NOT
// `antigravity`, and there is no `run` subcommand — non-interactive execution is
// `agy --print "<prompt>"`. Its flag surface is claude-derived, so permission
// mode maps directly: claude `acceptEdits`/`plan` → agy `--mode accept-edits`/
// `plan`. This matters for the Checker: it must run write-capable or it can never
// write checker-verdict.json (the exact bug that bit the claude adapter live).
//
// Interface (shared by all adapters):
//   name, isAvailable(), runBeat({ promptPath, cwd, permissionMode, sandbox }), runChecker(...)

import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";

export const name = "antigravity";

/** D5: this engine takes a model and an effort per beat (`--model`, `--effort`). */
export const takesModel = true;

/** The actual CLI binary (the platform is "antigravity"; the binary is "agy"). */
export const CLI = "agy";

/** Map the shared permission mode onto agy's `--mode` values. Non-plan ⇒ writable
 *  (accept-edits) so makers AND checkers can write their signal/verdict files. */
export function mapMode(permissionMode) {
  return permissionMode === "plan" ? "plan" : "accept-edits";
}

/** Pure argv builder for one beat — unit-testable without spawning a process.
 *
 *  Headless (`--print`) mode cannot prompt for tool permissions, so a writable
 *  beat MUST auto-approve them or every command/write tool is silently denied and
 *  agy exits 0 having done NOTHING (verified live: "a tool required the 'command'
 *  permission that headless mode cannot prompt for, so it was auto-denied"). agy's
 *  own prescribed fix is `--dangerously-skip-permissions`; it is paired with agy's
 *  `--sandbox` (terminal-restricted) under the loop's L3 sandbox gate so
 *  "auto-approve" still runs confined — the same posture as agentctl's engines.
 *  `plan` stays strictly read-only (no auto-approve).
 *
 *  `addDir` is REQUIRED for the loop: agy's workspace is decoupled from the
 *  process cwd — without `--add-dir <worktree>` it writes to its own scratch
 *  project (~/.gemini/antigravity-cli/scratch/), so the maker's work would never
 *  land in the loop's git worktree (verified live: cwd alone → scratch;
 *  --add-dir → cwd). runBeat always passes the beat's cwd as addDir. */
export function beatArgs({ prompt, permissionMode = "acceptEdits", sandbox = false, addDir = null, model = null, effort = null } = {}) {
  const argv = ["--print", prompt, "--mode", mapMode(permissionMode)];
  if (model) argv.push("--model", model);
  if (effort) argv.push("--effort", effort);
  if (permissionMode !== "plan") argv.push("--dangerously-skip-permissions");
  if (addDir) argv.push("--add-dir", addDir);
  if (sandbox) argv.push("--sandbox");
  return argv;
}

/** True if the `agy` CLI is on PATH. */
export async function isAvailable() {
  return await new Promise((resolve) => {
    const p = spawn(CLI, ["--version"], { stdio: "ignore" });
    p.on("error", () => resolve(false));
    p.on("close", (code) => resolve(code === 0));
  });
}

/**
 * Run one beat: `agy --print "<prompt>" --mode <accept-edits|plan>` in `cwd`.
 * The prompt BODY is passed (agy has no workflow-file discovery), mirroring the
 * codex adapter. `sandbox: true` adds agy's `--sandbox` (terminal restrictions).
 */
export async function runBeat({ promptPath, cwd = process.cwd(), permissionMode = "acceptEdits", sandbox = false, model = null, effort = null, env = null }) {
  const prompt = await readFile(promptPath, "utf8");
  return await new Promise((resolve, reject) => {
    // addDir: cwd anchors agy's workspace to the loop's worktree (see beatArgs).
    const child = spawn(CLI, beatArgs({ prompt, permissionMode, sandbox, addDir: cwd, model, effort }), {
      cwd,
      env: env ?? process.env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (d) => (stdout += d.toString()));
    child.stderr.on("data", (d) => (stderr += d.toString()));
    child.on("error", reject);
    child.on("close", (exitCode) => {
      resolve({ exitCode: exitCode ?? 1, stdout, stderr, tokens: null, costUsd: null });
    });
  });
}

// Phase 3: a Checker in a separate fresh process for structural independence.
export async function runChecker(opts) {
  return runBeat(opts);
}
