// src/loop/adapters/claude.js
//
// The Claude Code platform adapter. It owns EXACTLY ONE thing: turning a beat
// request into a headless `claude -p` invocation and returning its raw result.
// Every guarantee (loop control, verification, stall, budget) lives in the
// driver — the adapter is deliberately minimal (BYO-CLI, "thin wrapper", D7).
//
// Interface (shared by all adapters):
//   runBeat({ promptPath, cwd, permissionMode, role, state }) -> { exitCode, stdout, tokens? }
//   runChecker(...)  // separate fresh process — Phase 3, not yet used

import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";

export const name = "claude";

/** D5: this engine takes a model and an effort per beat. */
export const takesModel = true;

/** True if the `claude` CLI is on PATH (used for default adapter auto-detect). */
export async function isAvailable() {
  return await new Promise((resolve) => {
    const p = spawn("claude", ["--version"], { stdio: "ignore" });
    p.on("error", () => resolve(false));
    p.on("close", (code) => resolve(code === 0));
  });
}

/**
 * Build the `claude` argv for one beat. Pure — extracted so the flag contract
 * is unit-testable without spawning a CLI.
 *
 * `--settings <file>` loads a Carja-supplied sandbox profile WITHOUT
 * touching the user's own .claude/settings.json. When it enables Anthropic's
 * bubblewrap sandbox with `failIfUnavailable: true`, an unsandboxed beat can't
 * silently happen: claude exits non-zero if the sandbox can't start.
 *
 * `--allowed-tools` is an ALLOWLIST, passed only for a run seeded by untrusted
 * input (E4, `src/loop/untrusted.js`). Every published bypass of this class of
 * agent defeated a *blocklist*, so there is deliberately no blocklist path here.
 *
 * `--model` and `--effort` are passed only when the project's `models` block sets
 * them for this role (src/models.js); without them the CLI's own defaults run.
 *
 * @param {{prompt: string, permissionMode?: string, settingsPath?: string|null,
 *          allowedTools?: string[]|null, model?: string|null, effort?: string|null}} opts
 * @returns {string[]}
 */
export function buildArgv({
  prompt,
  permissionMode = "acceptEdits",
  settingsPath = null,
  allowedTools = null,
  model = null,
  effort = null,
}) {
  // A14: the result carries the text plus tokens and cost (a list-price
  // estimate on a subscription login). parseClaudeResult turns it back into text.
  // Loop Monitor M3: the stream (`stream-json`, which needs `--verbose` with
  // -p) carries each step as it happens; its last line is the same result.
  // Every flag first, then `--`, then the prompt: a prompt that starts with a
  // dash (ship.md opens with its `---` frontmatter) was read as an option.
  const argv = ["-p", "--output-format", "stream-json", "--verbose", "--permission-mode", permissionMode];
  if (model) argv.push("--model", model);
  if (effort) argv.push("--effort", effort);
  if (settingsPath) argv.push("--settings", settingsPath);
  // An empty array is NOT passed: `--allowed-tools` with no values would be a
  // dangling flag that swallows the next argument.
  if (Array.isArray(allowedTools) && allowedTools.length > 0) {
    // `--allowed-tools` only pre-approves; the sandbox auto-allows Bash on its
    // own, so an untrusted run could still run it. `--tools` is the real
    // allowlist: a tool not named there does not exist for this beat.
    argv.push("--tools", ...allowedTools, "--allowed-tools", ...allowedTools);
  }
  argv.push("--", prompt);
  return argv;
}

/**
 * Read the final object of `claude -p --output-format json`. Returns
 * { text, tokens, costUsd, model, inputTokens, cacheReadTokens, apiErrorStatus }, or null when stdout is not a result object
 * (a crash, a usage-limit banner printed before any JSON). Null fails open: the
 * caller keeps the raw stdout and records the usage as unknown.
 */
export function parseClaudeResult(stdout) {
  // The stream's last `result` line, or the single object of `--output-format json`.
  let obj = null;
  for (const line of String(stdout ?? "").trim().split("\n").reverse()) {
    try {
      const o = JSON.parse(line);
      if (o && typeof o === "object" && !Array.isArray(o) && o.type === "result") {
        obj = o;
        break;
      }
    } catch {
      /* not a JSON line */
    }
  }
  if (!obj) {
    try {
      const o = JSON.parse(String(stdout ?? "").trim());
      if (o && o.type === "result") obj = o;
    } catch {
      /* no result object */
    }
  }
  if (!obj) return null;
  const u = obj.usage ?? {};
  const counts = [u.input_tokens, u.output_tokens, u.cache_creation_input_tokens, u.cache_read_input_tokens].filter(Number.isFinite);
  const inputs = [u.input_tokens, u.cache_creation_input_tokens, u.cache_read_input_tokens].filter(Number.isFinite);
  return {
    text: typeof obj.result === "string" ? obj.result : "",
    tokens: counts.length ? counts.reduce((a, b) => a + b, 0) : null,
    // All input, and the part served from the prompt cache: a low share means
    // something rewrites the start of the prompt and every beat pays full price.
    inputTokens: inputs.length ? inputs.reduce((a, b) => a + b, 0) : null,
    cacheReadTokens: Number.isFinite(u.cache_read_input_tokens) ? u.cache_read_input_tokens : null,
    // Set when the call itself failed (401 on a refused login): the driver halts on it.
    apiErrorStatus: obj.is_error === true && Number.isFinite(obj.api_error_status) ? obj.api_error_status : null,
    costUsd: Number.isFinite(obj.total_cost_usd) ? obj.total_cost_usd : null,
    model: obj.modelUsage && typeof obj.modelUsage === "object" ? Object.keys(obj.modelUsage)[0] ?? null : null,
  };
}

/** The lines of stdout that are not JSON: what a crash or a usage-limit banner printed. */
function plainLines(stdout) {
  return String(stdout ?? "")
    .split("\n")
    .filter((l) => {
      try {
        JSON.parse(l);
        return false;
      } catch {
        return l.trim() !== "";
      }
    })
    .join("\n");
}

const DETAIL_KEYS = ["file_path", "command", "pattern", "path", "url", "query", "description", "prompt"];

/** One tool step from a stream line, `{tool, detail}` with the detail cut at 120 characters, or null. */
export function stepOf(line) {
  let o;
  try {
    o = JSON.parse(line);
  } catch {
    return null;
  }
  if (o?.type !== "assistant") return null;
  const use = (o.message?.content ?? []).find((c) => c?.type === "tool_use");
  if (!use) return null;
  const key = DETAIL_KEYS.find((k) => typeof use.input?.[k] === "string");
  return { tool: use.name, detail: key ? use.input[key].replace(/\s+/g, " ").slice(0, 120) : "" };
}

/**
 * Run one beat: `claude -p "<prompt>" --permission-mode <mode>` in `cwd`.
 * The agent re-reads the workflow prompt each beat (the soft layer); the driver
 * wraps this call with all deterministic guards.
 */
export async function runBeat({
  promptPath,
  cwd = process.cwd(),
  permissionMode = "acceptEdits",
  settingsPath = null,
  allowedTools = null,
  model = null,
  effort = null,
  onStep = null, // ({tool, detail}) → void: each tool step, while the beat runs (Loop Monitor M3)
  env = null, // the beat's environment (src/loop/beat-env.js); null inherits the driver's
}) {
  const prompt = await readFile(promptPath, "utf8");
  return await new Promise((resolve, reject) => {
    const argv = buildArgv({ prompt, permissionMode, settingsPath, allowedTools, model, effort });
    const child = spawn("claude", argv, { cwd, env: env ?? process.env, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    let pending = "";
    child.stdout.on("data", (d) => {
      const chunk = d.toString();
      stdout += chunk;
      if (!onStep) return;
      pending += chunk;
      const lines = pending.split("\n");
      pending = lines.pop();
      for (const line of lines) {
        const step = stepOf(line);
        if (step) {
          try {
            onStep(step);
          } catch {
            /* a monitor never fails a beat */
          }
        }
      }
    });
    child.stderr.on("data", (d) => (stderr += d.toString()));
    child.on("error", reject);
    child.on("close", (exitCode) => {
      const parsed = parseClaudeResult(stdout);
      resolve({
        exitCode: exitCode ?? 1,
        // The verdict and usage-limit checks read the same text as before. With
        // no result line (R3), only what was not JSON: a banner, never the stream.
        stdout: parsed ? parsed.text : plainLines(stdout),
        stderr,
        tokens: parsed?.tokens ?? null,
        costUsd: parsed?.costUsd ?? null,
        model: parsed?.model ?? null,
        inputTokens: parsed?.inputTokens ?? null,
        cacheReadTokens: parsed?.cacheReadTokens ?? null,
        apiErrorStatus: parsed?.apiErrorStatus ?? null,
      });
    });
  });
}

// Phase 3: a Checker in a separate fresh process for structural independence.
export async function runChecker(opts) {
  return runBeat(opts);
}
