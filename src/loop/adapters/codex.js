// src/loop/adapters/codex.js
//
// The Codex platform adapter (ADR-0001 Deferred track — "add Codex later"). Thin
// BYO-CLI wrapper like the others; owns only the CLI invocation. All loop
// guarantees live in the driver.
//
// Non-interactive execution is `codex exec <prompt>` (verified against codex-cli
// 0.145.0). Critically, `codex exec` sandboxes model-generated commands via
// `-s/--sandbox` with values {read-only, workspace-write, danger-full-access}. We
// map the shared permission mode onto it so the maker (and especially the Checker)
// can WRITE their signal/verdict files — running the default without a writable
// sandbox re-creates the read-only-Checker bug that bit the claude adapter live.
//
// Interface: name, isAvailable(), runBeat({promptPath,cwd,permissionMode}), runChecker(...)

import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";

export const name = "codex";

/** D5: this engine takes a model (`-m`) and an effort (`model_reasoning_effort`) per beat. */
export const takesModel = true;

/** The CLI binary. */
export const CLI = "codex";

/** Map the shared permission mode onto codex's `-s` sandbox policy. Non-plan ⇒
 *  workspace-write (may write within the working dir) so signal/verdict files
 *  land; `plan` ⇒ read-only. `danger-full-access` is intentionally never used. */
export function mapMode(permissionMode) {
  return permissionMode === "plan" ? "read-only" : "workspace-write";
}

/** Pure argv builder for one beat — unit-testable without spawning a process. */
export function beatArgs({ prompt, permissionMode = "acceptEdits", model = null, effort = null } = {}) {
  // Flags first, then `--`, then the prompt, so a dash-leading prompt is never an option.
  const argv = ["exec", "-s", mapMode(permissionMode)];
  if (model) argv.push("-m", model);
  // A TOML string: src/models.js admits only lowercase letters and dashes, so nothing to escape.
  if (effort) argv.push("-c", `model_reasoning_effort="${effort}"`);
  return [...argv, "--", prompt];
}

/** True if the `codex` CLI is on PATH. */
export async function isAvailable() {
  return await new Promise((resolve) => {
    const p = spawn(CLI, ["--version"], { stdio: "ignore" });
    p.on("error", () => resolve(false));
    p.on("close", (code) => resolve(code === 0));
  });
}

/** Run one beat: `codex exec <prompt> -s <read-only|workspace-write>` in `cwd`. */
export async function runBeat({ promptPath, cwd = process.cwd(), permissionMode = "acceptEdits", model = null, effort = null, env = null }) {
  const prompt = await readFile(promptPath, "utf8");
  return await new Promise((resolve, reject) => {
    const child = spawn(CLI, beatArgs({ prompt, permissionMode, model, effort }), { cwd, env: env ?? process.env, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (d) => (stdout += d.toString()));
    child.stderr.on("data", (d) => (stderr += d.toString()));
    child.on("error", reject);
    child.on("close", (exitCode) => resolve({ exitCode: exitCode ?? 1, stdout, stderr, tokens: null, costUsd: null }));
  });
}

export async function runChecker(opts) {
  return runBeat(opts);
}
