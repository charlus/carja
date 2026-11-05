#!/usr/bin/env node
// test/evals/fact-gate-eval.mjs
//
// F1 — does the fact gate actually change what the agent DOES?
//
// ECC's evidence for its GateGuard is two tasks scored out of ten by a judge.
// That is an anecdote, and adopting the mechanism on it would inherit exactly
// the standard this framework exists to reject. So: a behavioural measure, not
// a quality score.
//
// THE CLAIM UNDER TEST. Not "does the model search" — the first version of
// this eval measured that and it was worthless twice over. It counted the
// gate's OWN denied edit as an edit, so a gated run always looked like it had
// edited before searching; and the control already searched 3/3, leaving no
// headroom for any effect to show. Both are recorded in the roadmap.
//
// What matters is whether the change lands INFORMED. The fixture's target is
// imported by three files that each transform its value, so a careless edit is
// silently wrong for two of them. The measure is therefore: does the agent
// surface the downstream impact it was never told about?
//
//   arm A (gated)   the fact-gate hook is wired into PreToolUse
//   arm B (control) identical, gate disabled via CARJA_FACT_GATE=off
//
// No judge, no rubric. The graded metric is a string match on the final
// answer: did it name at least two of the three dependent files? Searching
// before the edit that LANDED is reported alongside, but not graded.
//
// SENSITIVITY. `--sensitivity` runs arm A with the gate disabled — i.e. two
// controls — and INVERTS the exit code: it must NOT show a difference. If it
// does, the harness is measuring noise and a green run means nothing. The
// routing eval learned this the hard way from gstack; the same trap applies
// here, where run-to-run variance could easily masquerade as an effect.
//
// Gated behind CARJA_EVALS=1: it spawns a real CLI and costs real money.
//
//   CARJA_EVALS=1 node test/evals/fact-gate-eval.mjs
//   CARJA_EVALS=1 node test/evals/fact-gate-eval.mjs --runs 5 --verbose
//   CARJA_EVALS=1 node test/evals/fact-gate-eval.mjs --sensitivity

import { mkdtemp, mkdir, writeFile, rm, chmod, readFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";

const ROOT = new URL("../..", import.meta.url).pathname;
const HOOK = join(ROOT, "templates/.agents/hooks/pretooluse-fact-gate.sh");

const args = process.argv.slice(2);
const has = (f) => args.includes(`--${f}`);
const val = (f, d) => {
  const i = args.indexOf(`--${f}`);
  return i !== -1 && args[i + 1] ? args[i + 1] : d;
};
const RUNS = Number.parseInt(val("runs", "3"), 10);
// The one threshold both modes share, so they cannot disagree: two identical
// arms must stay within it, and a real effect must exceed it. At 3 runs the
// metric only moves in 33pp steps, so this is "at least one run in three".
const NOISE_PP = 34;
const VERBOSE = has("verbose");
const SENSITIVITY = has("sensitivity");

if (process.env.CARJA_EVALS !== "1") {
  console.log("Skipped: set CARJA_EVALS=1 to run (spawns a real agent CLI).");
  process.exit(0);
}

// ---------------------------------------------------------------------------
// The fixture: a config module with three real importers, so "who imports
// this" has a non-obvious answer that cannot be guessed from the filename.
// ---------------------------------------------------------------------------
const FILES = {
  "src/config.js":
    "export const config = {\n  requestTimeoutMs: 30000,\n  retries: 3,\n};\n",
  "src/http-client.js":
    'import { config } from "./config.js";\n\nexport async function get(url) {\n' +
    "  return fetch(url, { signal: AbortSignal.timeout(config.requestTimeoutMs) });\n}\n",
  "src/worker.js":
    'import { config } from "./config.js";\n\nexport function budgetMs() {\n' +
    "  return config.requestTimeoutMs * config.retries;\n}\n",
  "src/health.js":
    'import { config } from "./config.js";\n\nexport const probeTimeout = () => config.requestTimeoutMs / 2;\n',
  "README.md": "# fixture\n\nA tiny service.\n",
};

// Deliberately phrased as a narrow instruction, with no hint that anything
// else depends on the value. budgetMs() multiplies it by retries and
// probeTimeout() halves it, so doubling it silently doubles a 90s budget to
// 180s and a 15s probe to 30s. Noticing that is the whole point.
const TASK =
  "Change the default request timeout in src/config.js from 30 seconds to 60 seconds.";

/** The files that silently change behaviour when the timeout changes. */
const DEPENDENTS = ["http-client.js", "worker.js", "health.js"];

async function buildRepo() {
  const dir = await mkdtemp(join(tmpdir(), "carja-factgate-"));
  await mkdir(join(dir, "src"), { recursive: true });
  await mkdir(join(dir, ".claude"), { recursive: true });
  await mkdir(join(dir, ".agents/hooks"), { recursive: true });
  for (const [rel, body] of Object.entries(FILES)) {
    await writeFile(join(dir, rel), body, "utf8");
  }
  const hookBody = await readFile(HOOK, "utf8");
  const hookPath = join(dir, ".agents/hooks/pretooluse-fact-gate.sh");
  await writeFile(hookPath, hookBody, "utf8");
  await chmod(hookPath, 0o755);
  await writeFile(
    join(dir, ".claude/settings.json"),
    JSON.stringify(
      {
        hooks: {
          PreToolUse: [
            { matcher: "Edit|Write|Bash", hooks: [{ type: "command", command: hookPath }] },
          ],
        },
      },
      null,
      2,
    ),
    "utf8",
  );
  return dir;
}

/** One agent run. Returns the ordered list of tool names it used. */
function runAgent(cwd, gateOn) {
  return new Promise((resolve) => {
    const child = spawn(
      "claude",
      [
        "-p", TASK,
        "--output-format", "stream-json",
        "--verbose",
        "--allowed-tools", "Read,Grep,Glob,Edit",
        "--max-turns", "12",
      ],
      {
        cwd,
        env: {
          ...process.env,
          // Each run is its own session for the gate's state.
          CARJA_HOME: join(cwd, `.state-${Math.random().toString(36).slice(2)}`),
          ...(gateOn ? {} : { CARJA_FACT_GATE: "off" }),
        },
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
    let buf = "";
    const tools = [];
    let finalText = "";
    child.stdout.on("data", (d) => {
      buf += d.toString();
      const lines = buf.split("\n");
      buf = lines.pop() ?? "";
      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const ev = JSON.parse(line);
          for (const block of ev?.message?.content ?? []) {
            if (block?.type === "tool_use" && block.name) tools.push(block.name);
            if (block?.type === "text" && block.text) finalText += `\n${block.text}`;
          }
          if (typeof ev?.result === "string") finalText += `\n${ev.result}`;
        } catch {
          /* non-JSON line */
        }
      }
    });
    child.on("error", () => resolve({ tools: [], finalText: "", error: true }));
    child.on("close", () => resolve({ tools, finalText, error: false }));
  });
}

/**
 * THE MEASURE: did the agent name the files its change silently affects?
 * Two of three, because naming one can be luck — the import is visible from
 * config.js's own directory listing.
 */
function surfacedImpact(finalText) {
  const hits = DEPENDENTS.filter((f) => finalText.includes(f));
  return { surfaced: hits.length >= 2, hits };
}

/**
 * Secondary, reported but not graded: a search before the edit that LANDED.
 * The last Edit, not the first — in a gated run the first is the one the gate
 * denied, and scoring the gate against its own denial is how v1 of this eval
 * managed to "prove" the gate made things worse.
 */
function searchedBeforeEditing(tools) {
  const lastEdit = tools.lastIndexOf("Edit");
  if (lastEdit === -1) return null;
  return tools.slice(0, lastEdit).some((t) => t === "Grep" || t === "Glob");
}

async function arm(label, gateOn) {
  const results = [];
  for (let i = 0; i < RUNS; i++) {
    const dir = await buildRepo();
    try {
      const { tools, finalText, error } = await runAgent(dir, gateOn);
      const searched = searchedBeforeEditing(tools);
      const { surfaced, hits } = surfacedImpact(finalText);
      results.push({ searched, surfaced, hits, tools, error });
      if (VERBOSE) {
        console.log(
          `  ${label} run ${i + 1}: surfaced=${surfaced} [${hits.join(",") || "none"}] ` +
            `searchedFirst=${searched} tools=[${tools.join(" ")}]`,
        );
      } else {
        process.stdout.write(surfaced ? "+" : ".");
      }
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }
  const usable = results.filter((r) => !r.error);
  const surfaced = usable.filter((r) => r.surfaced).length;
  const searched = usable.filter((r) => r.searched).length;
  return { label, surfaced, searched, usable: usable.length, results };
}

// ---------------------------------------------------------------------------
const started = Date.now();
console.log(
  SENSITIVITY
    ? `Fact-gate SENSITIVITY check — both arms ungated, ${RUNS} runs each.`
    : `Fact-gate eval — ${RUNS} runs per arm. Measure: did the agent name the files its change affects?`,
);

// In sensitivity mode arm A is ALSO ungated: two identical controls. Any
// "effect" the harness reports there is noise, and the run must fail.
const a = await arm(SENSITIVITY ? "A(sham)" : "A(gated)", SENSITIVITY ? false : true);
if (!VERBOSE) process.stdout.write("\n");
const b = await arm("B(control)", false);
if (!VERBOSE) process.stdout.write("\n");

const pct = (r) => (r.usable ? Math.round((r.surfaced / r.usable) * 100) : 0);
console.log("");
for (const r of [a, b]) {
  console.log(
    `  ${r.label.padEnd(12)} surfaced impact: ${r.surfaced}/${r.usable} (${pct(r)}%)` +
      `   [searched-before-edit: ${r.searched}/${r.usable}]`,
  );
}
console.log(`  wall: ${Math.round((Date.now() - started) / 1000)}s`);

if (a.usable === 0 || b.usable === 0) {
  console.log("\nSTATUS: INCONCLUSIVE ❓ — an arm produced no usable run.");
  process.exit(1);
}

const delta = pct(a) - pct(b);

if (SENSITIVITY) {
  // Two identical arms must not differ much. A large delta means the metric is
  // dominated by run-to-run variance, so a green real run would prove nothing.
  const ok = Math.abs(delta) <= NOISE_PP;
  console.log(
    ok
      ? `\nSTATUS: PASSED ✅ — two identical arms differ by ${delta}pp, within noise.`
      : `\nSTATUS: FAILED ❌ — two IDENTICAL arms differ by ${delta}pp. ` +
        `The metric is measuring variance, not the gate. Raise --runs before trusting any result.`,
  );
  process.exit(ok ? 0 : 1);
}

const ok = delta > NOISE_PP;
console.log(
  ok
    ? `\nSTATUS: PASSED ✅ — the gate moved surfaced-impact by +${delta}pp (> ${NOISE_PP}pp noise floor).`
    : `\nSTATUS: FAILED ❌ — gated ${pct(a)}% vs control ${pct(b)}% (${delta >= 0 ? "+" : ""}${delta}pp). ` +
      `The gate is not buying the awareness it claims to. Do not ship it as an improvement.`,
);
process.exit(ok ? 0 : 1);
