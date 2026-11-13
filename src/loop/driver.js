// src/loop/driver.js
//
// The deterministic DRIVER for the Carja autonomous loop (ADR-0001, V6).
//
// Design principle: "the host runner is the authority; the agent is a fallible
// worker." Everything that must ALWAYS happen — the iteration ceiling, stall
// detection, the Evidence Rule (verification exit code), the Scoping Barrier,
// and the wall-clock budget — lives here in code the agent cannot reason around.
//
// This module is intentionally PURE-ish: all IO (spawning an agent, running the
// verify command, reading git HEAD, the clock, persisting state) is injected via
// `deps`, so `node --test` can drive the whole state machine with a stub adapter
// and never spawn a `claude` process. See test/loop-driver.test.js.

import { createHash } from "node:crypto";
import { recordAttempt } from "./harvester.js";
import { costGate, costGateMessage } from "./usage.js";

/** Terminal statuses — once reached, the loop stops. Single source of truth. */
export const TERMINAL_STATUSES = Object.freeze([
  "completed",
  "awaiting_review",
  "stalled",
  "max_iterations_exceeded",
  "budget_exceeded",
  "usage_limit_reached",
  "auth_failed",
  "escalated",
  "awaiting_answers",
  "halted_scoping",
  "halted_no_verification",
  "halted_sandbox_required",
  "halted_autonomy",
  "halted_setup_failed",
  "halted_isolation",
]);

/** Autonomy slider (ADR-0001 D3). Higher rank = more autonomy. */
export const LEVELS = Object.freeze({ L0: 0, L1: 1, L2: 2, L3: 3 });

/**
 * Sandbox providers that satisfy the L3 isolation gate. `cli-native` (the
 * recommended default) uses the agent CLI vendor's OWN maintained sandbox —
 * Anthropic's bubblewrap+seccomp for `claude`, Google's hosted sandbox for `agy`,
 * OpenAI's for `codex` — so there is no image for this project to maintain.
 * `container` is the BYO-container path (defence-in-depth / unsupported hosts).
 * `none` never satisfies L3.
 */
export const SANDBOX_PROVIDERS = Object.freeze(["cli-native", "container"]);

export function levelRank(level) {
  return LEVELS[level] ?? LEVELS.L1;
}

/** Non-terminal working statuses the driver transitions between. */
export const WORKING_STATUSES = Object.freeze([
  "idle",
  "rejected_by_checker",
  "ready_for_check",
  "passed_by_checker",
]);

export const MAX_CONSECUTIVE_STALLS = 3;

export function isTerminal(status) {
  return TERMINAL_STATUSES.includes(status);
}

/** Stable hash of an arbitrary string (used for beat-progress + verify output). */
export function hashString(input) {
  return createHash("sha256").update(String(input ?? "")).digest("hex").slice(0, 16);
}

/**
 * Normalize verify output BEFORE hashing it for stall detection.
 *
 * The beat-progress hash must be deterministic across identical work, but every
 * common test/build runner prints a fresh timestamp + duration each run (vitest
 * `Start at …` / `Duration  Nms`, vite `built in Nms`, jest `Time: N s`). Left in,
 * those tokens rotated the hash every beat, so `stall.consecutive` reset to 0
 * forever and MAX_CONSECUTIVE_STALLS could never fire — the loop burned 47 dead
 * beats on a frozen git HEAD in the JuRaph session-limit incident. Stripping them
 * is engine-agnostic and fixes every project centrally (no per-project verify
 * massaging). A GENUINE change (a test flips red, a new failure line) still alters
 * the normalized text, so real progress is still observable.
 */
export function normalizeVerifyOutput(output) {
  return (
    String(output ?? "")
      // ANSI colour/cursor escapes (nondeterministic across TTY/CI).
      .replace(/\[[0-9;]*[A-Za-z]/g, "")
      // Runner wall-clock lines: vitest "Start at HH:MM:SS", jest "Time: N s".
      .replace(/^\s*(?:start at|time:)\s.*$/gim, "")
      // Duration/elapsed tokens: "Duration  986ms (…)", "built in 1243ms", "1.23 s".
      .replace(/\b(?:duration|built in|elapsed|ran in|finished in)\b[^\n]*/gi, "")
      .replace(/\b\d+(?:\.\d+)?\s?m?s\b/gi, "‹t›")
      // Bare clock timestamps HH:MM(:SS)(am/pm).
      .replace(/\b\d{1,2}:\d{2}(?::\d{2})?(?:\s?[ap]m)?\b/gi, "‹clock›")
      .replace(/[ \t]+/g, " ")
      .replace(/\n{2,}/g, "\n")
      .trim()
  );
}

/**
 * The beat-progress hash — DRIVER-OBSERVABLE state only (git HEAD + verify
 * output). The V5 `last_tool+args` component is deliberately excluded: it lives
 * inside the agent process and is not observable without agent self-report,
 * which is exactly what the driver removes.
 */
export function computeStallHash({ gitHead, verifyOutput }) {
  return hashString(`${gitHead ?? ""}::${verifyOutput ?? ""}`);
}

/**
 * The Evidence Rule floor: a non-zero verification exit ALWAYS forces a reject;
 * exit 0 is necessary-but-not-sufficient (Phase 1 passes directly; Phase 3 will
 * additionally consult the independent Checker before `passed_by_checker`).
 */
export function statusAfterVerify(exitCode) {
  return exitCode === 0 ? "passed_by_checker" : "rejected_by_checker";
}

/**
 * Agent-CLI usage/session-limit banners. Kept specific (anchored to the "hit your
 * … limit" phrasing the vendors print) so ordinary maker output that merely
 * mentions "rate limit" in code or prose does not trip a false terminal halt.
 */
export const USAGE_LIMIT_PATTERNS = Object.freeze([
  /you've hit your (?:session|usage) limit/i,
  /\bhit your (?:session|usage) limit\b/i,
  /\busage limit reached\b/i,
  // Claude Code 2026-11: "You've hit your 5-hour limit", "... your weekly limit".
  /\bhit your (?:\d+-hour|weekly) limit\b/i,
  // The result event's machine field, when the stream-json line is in the output.
  /"api_error"\s*:\s*"usage_limit_reached"/,
]);

/**
 * Classify a beat's raw adapter result to catch a DEAD beat — one where the agent
 * CLI never really ran. The driver otherwise reads only `result.tokens` and treats
 * a `claude -p` that printed "hit your session limit" in 3s as a successful beat,
 * charging it to the iteration counter (the JuRaph incident: 47 such beats, then a
 * misleading `max_iterations_exceeded`). A usage limit is external and terminal:
 * no other beat will fare better, so the loop must stop with a truthful status and
 * surface the reset time — not spend its remaining budget on dead beats.
 *
 * Pure: takes the adapter's {exitCode, stdout, stderr} and returns a verdict.
 */
export function classifyBeatResult(result) {
  const text = `${result?.stdout ?? ""}\n${result?.stderr ?? ""}`;
  if (USAGE_LIMIT_PATTERNS.some((re) => re.test(text))) {
    const m = text.match(/resets?\s+(?:at\s+)?(\d{1,2}:\d{2}\s*(?:[ap]m)?)/i);
    return { dead: true, kind: "usage_limit", resetHint: m ? m[1].replace(/\s+/g, "") : null, note: result?.quotaNote ?? null };
  }
  // An engine that cannot log in fails every beat the same way. Only on a failed
  // exit, so Maker output that mentions a 401 never halts the run. A 5xx is
  // transient and stays with the stall detector.
  if (result?.exitCode) {
    const status = AUTH_STATUSES.includes(result.apiErrorStatus) ? result.apiErrorStatus : Number(text.match(AUTH_FAILURE_PATTERN)?.[1]);
    if (AUTH_STATUSES.includes(status)) return { dead: true, kind: "auth_failed", status, resetHint: null };
  }
  return { dead: false };
}

/** HTTP statuses that mean the engine CLI is not logged in or not allowed. */
const AUTH_STATUSES = Object.freeze([401, 403]);
/** `codex exec` (0.163.0) prints this line when its key or login is refused. */
const AUTH_FAILURE_PATTERN = /^ERROR: unexpected status (401|403)\b/m;

/** The terminal status for a dead beat. */
export function deadBeatStatus(verdict) {
  return verdict?.kind === "auth_failed" ? "auth_failed" : "usage_limit_reached";
}

/** The inbox line for a dead beat; `where` names the beat, e.g. "during task a's Ship beat". */
export function deadBeatMessage(verdict, where = "") {
  const at = where ? ` ${where}` : "";
  if (verdict?.kind === "auth_failed") {
    return `the agent CLI could not log in (HTTP ${verdict.status})${at}. No work was done; log the CLI in again, then re-run to resume.`;
  }
  const resetNote = verdict?.resetHint ? ` — resets ${verdict.resetHint}` : "";
  // I2: why the run did not wait for the reset.
  const why = verdict?.note ? ` The loop did not wait: ${verdict.note}.` : "";
  return `agent CLI reported a usage/session limit${resetNote}${at}.${why} No work was done; raise the limit or wait, then re-run to resume.`;
}

/**
 * Resolve the verification command, mirroring hooks/lib.sh `carja_verify_cmd`
 * byte-for-byte so interactive (pre-push) and headless (driver) enforcement agree.
 * Pure: the command layer gathers the three inputs and passes them in.
 *   state.verification.command → config "verify" → `npm test` iff declared → null
 */
export function resolveVerifyCommand({ stateCommand, configVerify, hasNpmTestScript }) {
  const fromState = (stateCommand ?? "").trim();
  if (fromState) return fromState;
  const fromConfig = (configVerify ?? "").trim();
  if (fromConfig) return fromConfig;
  if (hasNpmTestScript) return "npm test";
  return null;
}

/** Ensure a loaded state object has every v2 field the driver relies on. */
export function normalizeState(raw) {
  const s = raw && typeof raw === "object" ? raw : {};
  return {
    schema_version: 2,
    goal_description: s.goal_description ?? "",
    phase: s.phase ?? "discovery",
    autonomy_level: s.autonomy_level ?? "L1",
    platform: s.platform ?? null,
    sandbox: s.sandbox ?? "none",
    status: s.status ?? "idle",
    current_worker: s.current_worker ?? null,
    maker_reported_done: s.maker_reported_done ?? false,
    iterations: {
      current: s.iterations?.current ?? 0,
      max_allowed: s.iterations?.max_allowed ?? 20,
    },
    budget: {
      max_beats: s.budget?.max_beats ?? s.iterations?.max_allowed ?? 20,
      max_wall_clock_min: s.budget?.max_wall_clock_min ?? 120,
      // v1 → v2 migration: telemetry.tokens_spent folds into budget.
      tokens_spent: s.budget?.tokens_spent ?? s.telemetry?.tokens_spent ?? 0,
      started_at: s.budget?.started_at ?? null,
      // A14: cost per run and per role; max_cost_usd acts only with loop.cost_aware.
      cost_usd_spent: s.budget?.cost_usd_spent ?? 0,
      usage: s.budget?.usage ?? {},
      max_cost_usd: s.budget?.max_cost_usd ?? null,
      cost_warned: s.budget?.cost_warned ?? false,
    },
    verification: {
      command: s.verification?.command ?? "",
      last_exit_code: s.verification?.last_exit_code ?? null,
      last_output_hash: s.verification?.last_output_hash ?? null,
    },
    stall: {
      // v1 → v2 migration: telemetry.consecutive_stalls folds into stall.
      consecutive: s.stall?.consecutive ?? s.telemetry?.consecutive_stalls ?? 0,
      last_beat_hash: s.stall?.last_beat_hash ?? null,
    },
    // A13: the last rejected attempts, shown to the next Maker beat.
    attempts: Array.isArray(s.attempts) ? s.attempts : [],
    rejected_beats: s.rejected_beats ?? 0,
    // A12: decisions the Maker logged in rulings.md during this run.
    rulings: Array.isArray(s.rulings) ? s.rulings : [],
    ship: s.ship ?? null,
    tasks: Array.isArray(s.tasks) ? s.tasks : [],
    roles: Array.isArray(s.roles) ? s.roles : ["maker", "checker"],
    concurrency: s.concurrency ?? 1,
    tdd_split: s.tdd_split === true, // opt-in test-author→implementer split (swarm only)
    checker_votes: s.checker_votes ?? 1, // multi-vote adversarial Checker (N skeptics)
    merge: s.merge ?? null, // { branch, pr_url } once a PR is opened (L3)
    last_trigger: s.last_trigger ?? null, // { source, received_at, ... } — set by an external trigger (src/loop/trigger.js)
    history: Array.isArray(s.history) ? s.history : [],
  };
}

/** The beat ceiling: the lower of iterations.max_allowed and budget.max_beats. */
export function beatCeiling(state) {
  const caps = [state.iterations?.max_allowed, state.budget?.max_beats].filter(Number.isFinite);
  return caps.length ? Math.min(...caps) : 20;
}

/**
 * Autonomy-slider enforcement (Phase 4 — pair; swarm deferred behind an evidence
 * gate). Returns a terminal status if the level does not permit this run, else null.
 *   L0  — interactive only; the headless loop does not run.
 *   L1  — single beat, any permitted phase, no merge (human reviews after).
 *   L2  — multi-beat blueprint only; no code merged.
 *   L3  — multi-beat execution in a sandbox; merges via a PR (never a direct push).
 * Concurrency > 1 (swarm) is refused everywhere: the scheduler is not built yet.
 */
export function autonomyPreflight(state) {
  const rank = levelRank(state.autonomy_level);
  if (rank === LEVELS.L0) return "halted_autonomy"; // interactive-only
  const concurrency = state.concurrency ?? 1;
  if (concurrency > 1) {
    // The swarm (parallel Makers) is opt-in and only at L3, and needs a task graph.
    if (rank < LEVELS.L3) return "halted_autonomy";
    if (!(Array.isArray(state.tasks) && state.tasks.length > 0)) return "halted_autonomy";
  }
  if (state.autonomy_level === "L2" && state.phase === "execution") {
    return "halted_autonomy"; // L2 is blueprint-only; execution needs L3
  }
  return null;
}

/** Human-readable reason for a terminal halt (for logs + inbox). */
export function describeHalt(state, status) {
  switch (status) {
    case "halted_scoping":
      return "phase is 'discovery' — the Scoping Barrier forbids headless discovery. Define requirements with a human first.";
    case "halted_no_verification":
      return "no verification command could be resolved (state.verification.command, carja.config.json 'verify', or an npm test script). Refusing to run without a real success signal.";
    case "halted_sandbox_required":
      return "autonomy_level L3 requires an isolating sandbox — set sandbox='cli-native' (the agent CLI's own vendor sandbox, e.g. Anthropic's bubblewrap; no Docker) or 'container' (BYO). See .agents/sandbox/. Refusing unattended execution without isolation.";
    case "halted_autonomy": {
      const rank = levelRank(state.autonomy_level);
      const concurrency = state.concurrency ?? 1;
      if (rank === LEVELS.L0)
        return "autonomy_level L0 is interactive-only; raise it to run the loop headless.";
      if (concurrency > 1 && rank < LEVELS.L3)
        return "concurrency>1 (swarm) requires autonomy_level L3.";
      if (concurrency > 1 && !(Array.isArray(state.tasks) && state.tasks.length > 0))
        return "concurrency>1 (swarm) requires a task graph in tasks[] — carve the work into tasks first.";
      if (state.autonomy_level === "L2" && state.phase === "execution")
        return "autonomy_level L2 is blueprint-only; use L3 for headless execution.";
      return "autonomy policy refused this run.";
    }
    default:
      return status;
  }
}

/**
 * Pre-flight guards that must pass BEFORE any beat runs. Returns a terminal
 * status string if the loop must not start, else null.
 *   - Scoping Barrier: discovery phase is never headless.
 *   - Evidence Rule precondition: no resolvable verify command → fail safe.
 */
export function preflight(state, { verifyCommand }) {
  // Order: scoping (never headless) → safety (sandbox) → autonomy policy → config.
  if (state.phase === "discovery") return "halted_scoping";
  // L3 (unattended execution) is only permitted inside an isolating sandbox.
  // Refuse unsafe autonomy before quibbling about config. Any recognized provider
  // (cli-native = the engine vendor's own sandbox; or a BYO container) qualifies;
  // 'none' does not.
  if (state.autonomy_level === "L3" && !SANDBOX_PROVIDERS.includes(state.sandbox)) {
    return "halted_sandbox_required";
  }
  const autonomyHalt = autonomyPreflight(state);
  if (autonomyHalt) return autonomyHalt;
  if (!verifyCommand) return "halted_no_verification";
  return null;
}

/**
 * Run the deterministic control loop to a terminal status.
 *
 * @param {object} state     normalized v2 loop state (mutated + returned)
 * @param {object} deps
 *   @param {(o)=>Promise<{exitCode:number,stdout?:string,tokens?:number}>} deps.runBeat
 *          spawn one agent beat (the ONLY thing the platform adapter owns)
 *   @param {(cmd)=>Promise<{exitCode:number,output:string}>} deps.runVerify
 *          run the verify command, capture exit code + output
 *   @param {()=>string|Promise<string>} deps.gitHead  current git HEAD sha
 *   @param {()=>number} deps.now                        epoch ms (injectable clock)
 *   @param {(state)=>void|Promise<void>} deps.persist   atomic state write (each transition)
 *   @param {(o)=>Promise<{exitCode:number}>} [deps.runChecker]  Phase 3: independent
 *          Checker in a SEPARATE process; exit 0 approves a green diff, non-zero rejects.
 *          Omit for deterministic-only mode (green verify passes directly).
 *   @param {(o)=>Promise<{ok:boolean,branch?:string,prUrl?:string,reason?:string}>} [deps.merge]
 *          Phase 4: PR-gated merge at L3 execution completion. Never a direct push.
 *   @param {(msg:string)=>void|Promise<void>} [deps.audit]  append to the ship-log trail
 *   @param {(msg)=>void} [deps.log]
 *   @param {string} deps.verifyCommand                  pre-resolved verify command
 *   @param {(state,reason)=>void|Promise<void>} [deps.writeInbox]  escalation note
 */
export async function runLoop(state, deps) {
  const {
    runBeat,
    runVerify,
    gitHead,
    now,
    persist,
    verifyCommand,
    runChecker = null, // Phase 3: independent Checker in a separate process
    readMakerDone = null, // maker's completion signal, read from a file (never trust in-memory)
    readMakerSignal = null, // the whole signal: { done, escalate, reason }; wins over readMakerDone
    changedFiles = null, // ({from}) → string[]: the files a beat changed (A13), optional
    costAware = false, // loop.cost_aware: only then does budget.max_cost_usd act
    runShip = null, // (o) → beat result: the Ship beat before the MR (Unattended Lifecycle step 1)
    shipEvidence = null, // () → {ok, reasons, body}: Ship's bookkeeping, checked in code
    merge = null, // Phase 4: PR-gated merge at L3 (async → { ok, branch, prUrl, reason })
    branchHasWork = null, // (state)=>bool: does the branch carry committed work to ship?
    audit = () => {}, // Phase 4: append to the human-auditable ship-log trail
    log = () => {},
    writeInbox = () => {},
  } = deps;

  const halt = preflight(state, { verifyCommand });
  if (halt) {
    state.status = halt;
    await persist(state);
    const reason = describeHalt(state, halt);
    log(`[CARJA LOOP] Pre-flight halt: ${halt} — ${reason}`);
    await audit(`pre-flight halt: ${halt} — ${reason}`);
    return state;
  }
  await audit(`run start: phase=${state.phase} autonomy=${state.autonomy_level} sandbox=${state.sandbox}`);

  if (!state.budget.started_at) state.budget.started_at = new Date(now()).toISOString();

  while (!isTerminal(state.status)) {
    // ---- Guardrails the driver owns, checked BEFORE dispatching a beat ----
    if (state.iterations.current >= beatCeiling(state)) {
      state.status = "max_iterations_exceeded";
      await writeInbox(state, "iteration ceiling reached");
      await persist(state);
      break;
    }
    const elapsedMin = (now() - Date.parse(state.budget.started_at)) / 60000;
    if (elapsedMin >= state.budget.max_wall_clock_min) {
      state.status = "budget_exceeded";
      await writeInbox(state, "wall-clock budget exhausted");
      await persist(state);
      break;
    }
    // A14: the cost ceiling, only with loop.cost_aware. Checked between beats.
    const gate = costGate(state, { costAware });
    if (gate) await writeInbox(state, costGateMessage(state, gate));
    if (gate === "halt") {
      state.status = "budget_exceeded";
      await persist(state);
      break;
    }

    switch (state.status) {
      case "idle":
      case "rejected_by_checker": {
        // Maker's turn. A maker attempt IS a beat → driver increments the counter.
        state.iterations.current += 1;
        state.current_worker = "maker";
        await persist(state);

        const beforeHead = await gitHead();
        state.beat_base = beforeHead;
        const result = await runBeat({ role: "maker", state, escalateModel: state.rejected_beats >= 2 });
        // Tokens and cost are recorded once, by the command layer's beat wrapper
        // (src/loop/usage.js), for Maker and Checker alike.

        // Dead-beat guard: a beat where the agent CLI never really ran (a usage
        // limit, a refused login) is external and terminal — stop truthfully instead of burning the
        // remaining budget. Refund the iteration we just charged: it did no work.
        const outcome = classifyBeatResult(result);
        if (outcome.dead) {
          state.iterations.current -= 1;
          state.current_worker = null;
          state.status = deadBeatStatus(outcome);
          const resetNote = outcome.resetHint ? ` — resets ${outcome.resetHint}` : "";
          await writeInbox(state, deadBeatMessage(outcome));
          await audit(`beat ${state.iterations.current + 1}: dead (${outcome.kind}) → ${state.status}${resetNote}`);
          await persist(state);
          break;
        }
        // A non-zero CLI exit that ISN'T a usage limit (crash/auth/network) is not
        // its own terminal state — surface it for diagnosis; repeated no-progress
        // beats are now bounded by the (fixed) stall detector.
        if (result?.exitCode) {
          log(`[CARJA LOOP] beat ${state.iterations.current}: agent CLI exited ${result.exitCode}`);
          await audit(`beat ${state.iterations.current}: agent CLI exited ${result.exitCode}`);
        }

        // The maker's "goal complete" claim is read from a file it writes, never
        // from the driver's in-memory state (which the agent process can't touch)
        // — symmetric with the Checker's verdict file. Absent ⇒ not claimed.
        const signal = readMakerSignal
          ? (await readMakerSignal()) ?? {}
          : readMakerDone
            ? { done: await readMakerDone() }
            : { done: state.maker_reported_done }; // no reader wired (unit harness)
        // F3: a Maker that says it is blocked ends the run now. No verify, no
        // Checker: no further beat can get what only a human can give.
        if (signal.escalate === true) {
          const reason = String(signal.reason ?? "").replace(/\s+/g, " ").trim().slice(0, 1500) || "the Maker escalated without a reason";
          state.current_worker = null;
          state.status = "escalated";
          await writeInbox(state, `the Maker escalated at beat ${state.iterations.current}: ${reason}`);
          await audit(`beat ${state.iterations.current}: escalated by the Maker — ${reason}`);
          await persist(state);
          break;
        }
        state.maker_reported_done = signal.done === true;

        // Stall detection: driver-observable progress only.
        const head = await gitHead();
        const beatHash = computeStallHash({
          gitHead: head,
          verifyOutput: state.verification.last_output_hash,
        });
        if (beatHash === state.stall.last_beat_hash) {
          state.stall.consecutive += 1;
        } else {
          state.stall.consecutive = 0;
        }
        state.stall.last_beat_hash = beatHash;
        state.current_worker = null;

        if (state.stall.consecutive >= MAX_CONSECUTIVE_STALLS) {
          state.status = "stalled";
          await writeInbox(state, "no progress across 3 consecutive beats");
          await persist(state);
          break;
        }

        state.status = "ready_for_check";
        state.history.push({
          beat: state.iterations.current,
          status: "ready_for_check",
          evidence: null,
          ts: new Date(now()).toISOString(),
        });
        await audit(`beat ${state.iterations.current}: maker → ready_for_check`);
        await persist(state);
        break;
      }

      case "ready_for_check": {
        // The Evidence Rule, in code — the driver runs verify itself (the FLOOR).
        const { exitCode, output } = await runVerify(verifyCommand);
        state.verification.last_exit_code = exitCode;
        // Hash the NORMALIZED output so nondeterministic runner timings don't
        // rotate the stall hash every beat (see normalizeVerifyOutput).
        state.verification.last_output_hash = hashString(normalizeVerifyOutput(output));

        let checkerExit = null;
        let checkerResult = null;
        if (exitCode !== 0) {
          // Red floor: forced reject, no Checker consulted.
          state.status = "rejected_by_checker";
        } else if (runChecker) {
          // Green is necessary-but-not-sufficient: an INDEPENDENT Checker in a
          // separate fresh process reviews the diff (Phase 3). Its exit code is
          // the verdict — the driver reads a signal, never a self-report.
          state.current_worker = "checker";
          await persist(state);
          const cr = await runChecker({ role: "checker", state });
          checkerResult = cr;
          checkerExit = cr?.exitCode ?? 1;
          state.current_worker = null;
          state.status = checkerExit === 0 ? "passed_by_checker" : "rejected_by_checker";
        } else {
          // No Checker injected (Phase 1 / unit harness): green passes directly.
          state.status = "passed_by_checker";
        }

        if (state.status === "rejected_by_checker") {
          state.rejected_beats += 1;
          let files = [];
          if (changedFiles) {
            try {
              files = (await changedFiles({ from: state.beat_base })) ?? [];
            } catch {
              files = [];
            }
          }
          recordAttempt(state, {
            beat: state.iterations.current,
            verifyExit: exitCode,
            verifyOutput: output,
            checkerReasons: checkerResult?.reasons ?? [],
            checkerFindings: checkerResult?.findings ?? [],
            files,
          });
        }
        state.history.push({
          beat: state.iterations.current,
          status: state.status,
          evidence: {
            exit_code: exitCode,
            output_hash: state.verification.last_output_hash,
            checker_exit: checkerExit,
          },
          ts: new Date(now()).toISOString(),
        });
        // L1 (single-beat): one Maker→Checker cycle, then hand off to the human
        // for review/merge — regardless of pass or fail.
        if (levelRank(state.autonomy_level) === LEVELS.L1) {
          state.status = "awaiting_review";
        }
        log(
          `[CARJA LOOP] verify exit=${exitCode}` +
            (checkerExit !== null ? `, checker exit=${checkerExit}` : "") +
            ` → ${state.status}`
        );
        await audit(
          `beat ${state.iterations.current}: verify exit=${exitCode}` +
            (checkerExit !== null ? `, checker exit=${checkerExit}` : "") +
            ` → ${state.status}`
        );
        await persist(state);
        break;
      }

      case "passed_by_checker": {
        // Advance. The driver owns STOPPING; the agent owns the positive "done"
        // signal (it cannot be deterministically derived for a fuzzy goal).
        if (!state.maker_reported_done) {
          state.status = "idle"; // more work to do → next beat (L2/L3 multi-beat)
          await persist(state);
          break;
        }
        // Goal reported complete. How we finish depends on the autonomy level.
        if (state.phase === "execution" && levelRank(state.autonomy_level) >= LEVELS.L3) {
          // Empty done-claim guard (defense-in-depth, independent of the Checker):
          // verify is green and the Checker approved, but if the branch carries NO
          // committed work (the maker changed nothing and the P0.1 auto-capture found
          // nothing to commit) there is nothing to ship — opening a PR would be empty.
          // Clear the false "done" and re-prompt a maker beat; the stall detector
          // bounds a maker that keeps claiming done with nothing to show.
          if (branchHasWork && !(await branchHasWork(state))) {
            state.maker_reported_done = false;
            state.status = "idle";
            await audit(
              `beat ${state.iterations.current}: done claimed but branch has no committed work → re-prompting maker`
            );
            await persist(state);
            break;
          }
          // Unattended Lifecycle step 1: ship before the MR, as the owner would
          // type `/ship`. The Ship beat writes the bookkeeping into this branch
          // and the MR body; verify and the Checker run again; the evidence is
          // checked in code. No MR without it.
          if (runShip && !state.ship) {
            const { runShipStage } = await import("./ship.js");
            const s = await runShipStage(state, {
              runShip: () => runShip({ role: "ship", state }),
              verify: () => runVerify(verifyCommand),
              check: () => (runChecker ? runChecker({ role: "checker", state, phase: "ship" }) : { exitCode: 0 }),
              evidence: () => (shipEvidence ? shipEvidence({ state }) : { ok: true, reasons: [] }),
              charge: () => {
                state.iterations.current += 1;
              },
              beatNo: () => state.iterations.current,
              audit,
            });
            if (!s.ok) {
              if (s.outcome === "dead") {
                state.status = deadBeatStatus(s.verdict);
                await writeInbox(state, deadBeatMessage(s.verdict, "during the Ship beat"));
              } else if (s.outcome === "escalated") {
                state.status = "escalated";
                await writeInbox(state, `the Ship beat escalated: ${s.reason}`);
              } else {
                state.status = "awaiting_review";
                await writeInbox(state, `the Ship beat did not complete Ship's bookkeeping: ${s.reason}. Branch kept, no MR opened.`);
              }
              await persist(state);
              break;
            }
          }
          // L3 execution: never a silent push to a protected branch — open a PR,
          // gated by the green floor + Checker approval already established above.
          if (merge) {
            const m = await merge({ state });
            if (m?.ok) {
              state.merge = { branch: m.branch ?? null, pr_url: m.prUrl ?? null };
              state.status = "completed";
              await audit(`merge: PR opened ${m.prUrl ?? "(url n/a)"} for ${m.branch ?? "branch"}`);
            } else {
              state.status = "awaiting_review";
              await writeInbox(state, `PR-gated merge failed: ${m?.reason ?? "unknown"}`);
              await audit(`merge failed: ${m?.reason ?? "unknown"} → awaiting_review`);
            }
          } else {
            // No merge capability wired — cannot open a PR; hand off to the human.
            state.status = "awaiting_review";
            await writeInbox(state, "goal complete but no merge/PR capability available");
          }
        } else {
          // L2 blueprint completion (or any non-execution done): specs are ready
          // for the design-time sign-off. No code merge.
          state.status = "awaiting_review";
        }
        await persist(state);
        break;
      }

      default:
        // Unknown non-terminal status — fail safe rather than spin.
        log(`[CARJA LOOP] Unknown status '${state.status}' — halting.`);
        state.status = "stalled";
        await writeInbox(state, `unknown status '${state.status}'`);
        await persist(state);
        break;
    }
  }

  log(`[CARJA LOOP] Terminal status: ${state.status}`);
  await audit(`terminal: ${state.status}`);
  return state;
}
