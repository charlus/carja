#!/usr/bin/env node
// test/evals/routing-eval.mjs
//
// E3 — the FIRST test in this repo that says something true about the agent
// layer. Everything else stubs the agent; this spawns a real `claude -p` and
// asks the question the framework actually depends on: given Carja's
// always-on context, does a fresh model route the request to the right place?
//
// Two suites, because two different artifacts are being graded:
//
//   --suite classifier   The AGENTS.md routing table IS the artifact. The
//                        fixture installs it, and a wrong answer means the
//                        table is wrong.
//   --suite descriptions The table is DELIBERATELY REMOVED and only the
//                        workflow/skill descriptions remain. This is the
//                        gstack lesson, learned the hard way in their repo: a
//                        fixture that ships the answer key cannot fail on a
//                        regressed description, because the lookup table
//                        rescues it. Removing the table is what makes this
//                        suite able to detect the regression it selects for.
//
// COST CONTROL. One turn per case, `--allowed-tools Read`, and the model is
// asked for a bare filename so grading is exact rather than a judge call.
// Cases run concurrently with a small cap. Every run prints wall-clock and the
// per-case verdict; no case is retried, so a flake shows up as a flake.
//
// Gated behind CARJA_EVALS=1 so it never runs in `npm run test:unit`:
// it costs real money and needs a live CLI.
//
//   CARJA_EVALS=1 npm run eval:routing
//   CARJA_EVALS=1 npm run eval:routing -- --suite descriptions
//   CARJA_EVALS=1 npm run eval:routing -- --case inbox-capture --verbose

import { mkdtemp, mkdir, writeFile, readFile, readdir, rm, cp } from "node:fs/promises";
import { spawn } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { buildFrameworkBlock, renderRootAgentsMd } from "../../src/agents-md.js";

const ROOT = new URL("../..", import.meta.url).pathname;
const TEMPLATES = join(ROOT, "templates");

// ---------------------------------------------------------------------------
// Cases. `expect` is the workflow file (or the literal ANSWER_DIRECTLY /
// INBOX sentinel). Negative controls matter as much as positives: a router
// that sends everything somewhere is as broken as one that sends nothing.
// ---------------------------------------------------------------------------
const CASES = [
  // --- positives: each Carja entry point -------------------------------
  { id: "genesis-idea", expect: "genesis.md",
    prompt: "I have an idea for a tool that helps restaurants manage their waitlist. Where do we start?" },
  { id: "grand-prd", expect: "grand-prd.md",
    prompt: "Let's write the Grand PRD for the waitlist product." },
  { id: "carve", expect: "carve.md",
    prompt: "The blueprint is done. Break it down into implementations I can build one at a time." },
  { id: "spec-it", expect: "spec-it.md",
    prompt: "Spec out the SMS notification feature before I build it." },
  { id: "build", expect: "build.md",
    prompt: "The implementation plan is ready. Let's code it." },
  { id: "ship", expect: "ship.md",
    prompt: "The feature works and tests pass. Audit it and ship it." },
  { id: "quick-path", expect: "quick-path.md",
    prompt: "This is a tiny well-understood change, just build it without the full ceremony." },
  { id: "retrospective", expect: "retrospective.md",
    prompt: "We just finished the release. Let's reflect on how it went." },
  { id: "unattended-loop", expect: "unattended-loop.md",
    prompt: "Set this up to run unattended overnight without me watching." },
  { id: "deepen", expect: "deepen.md",
    prompt: "The codebase architecture feels shallow. Find the modules that need deepening." },
  { id: "technical-vision", expect: "technical-vision.md",
    prompt: "We need the technical architecture and the ADRs for this product area." },
  { id: "storyboard", expect: "storyboard.md",
    prompt: "Let's storyboard the main character's journey through the product." },

  // --- the zero-judgment capture path (a deliberate non-workflow) ----------
  { id: "inbox-capture", expect: "INBOX",
    prompt: "Inbox: the export button is misaligned on Firefox" },

  // --- negative controls: these must NOT trigger a workflow ---------------
  { id: "neg-question", expect: "ANSWER_DIRECTLY",
    prompt: "What does the carja/2-backlog folder hold?" },
  { id: "neg-explain", expect: "ANSWER_DIRECTLY",
    prompt: "Explain how the Verification Iron Law differs from the Test-Driven Law." },
  { id: "neg-trivial", expect: "ANSWER_DIRECTLY",
    prompt: "What is the capital of Belgium?" },
];

// ---------------------------------------------------------------------------
const args = process.argv.slice(2);
const flag = (name, dflt = null) => {
  const i = args.indexOf(`--${name}`);
  return i !== -1 ? args[i + 1] ?? true : dflt;
};
const SUITE = flag("suite", "classifier");
// --mutate <workflow.md>: deliberately blind the fixture to ONE workflow (its
// classifier row AND its description are removed). A green suite proves
// nothing unless it can go red; this is the sensitivity check. Used by
// `npm run eval:routing:sensitivity`, which INVERTS the exit code — the
// mutated case is expected to fail, and a mutation the eval still "passes"
// means the eval is not measuring routing at all.
const MUTATE = flag("mutate", null);
const ONLY = flag("case", null);
const VERBOSE = args.includes("--verbose");
const CONCURRENCY = Number(flag("concurrency", 4));
const CLI = process.env.CARJA_EVAL_CLI || "claude";

if (!process.env.CARJA_EVALS) {
  console.log(
    "routing-eval: skipped (set CARJA_EVALS=1 to run).\n" +
      "  This spawns a real agent CLI and costs money; it is deliberately not part of test:unit.",
  );
  process.exit(0);
}

/**
 * Build a throwaway project containing the framework and its root AGENTS.md,
 * generated exactly as `init` does (the classifier + the inline laws).
 *
 * The `descriptions` suite strips the routing table out of AGENTS.md and keeps
 * a GENERIC nudge, so only the workflow descriptions can carry the routing
 * load. With the table present a regressed description still routes correctly
 * and the suite cannot fail on the class it exists to catch.
 */
async function makeFixture(suite) {
  const dir = await mkdtemp(join(tmpdir(), `carja-routing-${suite}-`));
  await cp(join(TEMPLATES, ".agents"), join(dir, ".agents"), { recursive: true });

  if (MUTATE) {
    // Blind the fixture to this one workflow: drop its classifier row and
    // gut its own description, leaving the file present but unroutable.
    const agentsPath = join(dir, ".agents", "AGENTS.md");
    const stem = String(MUTATE).replace(/\.md$/, "");
    const agents = await readFile(agentsPath, "utf8");
    await writeFile(
      agentsPath,
      agents
        .split("\n")
        .filter((l) => !l.includes(`workflows/${stem}.md`))
        .join("\n"),
    );
    const wfPath = join(dir, ".agents", "workflows", `${stem}.md`);
    const wf = await readFile(wfPath, "utf8").catch(() => null);
    if (wf) {
      await writeFile(
        wfPath,
        wf.replace(/^---\r?\n[\s\S]*?\r?\n---/, "---\ndescription: (internal)\n---"),
      );
    }
    console.log(`  [mutated] ${stem}.md is unroutable in this fixture\n`);
  }

  let nudge;
  if (suite === "descriptions") {
    const agents = await readFile(join(dir, ".agents", "AGENTS.md"), "utf8");
    // Cut the classifier table: everything from the heading to the next H2.
    const stripped = agents.replace(/## Request Classifier[\s\S]*?(?=\n## )/, "");
    await writeFile(join(dir, ".agents", "AGENTS.md"), stripped);

    // Also list what is available WITHOUT saying which prompt maps to which —
    // the descriptions are the artifact under test.
    const wf = (await readdir(join(dir, ".agents", "workflows"))).filter((f) => f.endsWith(".md"));
    nudge =
      "## Routing\n\n" +
      "When a request matches one of the workflows in `.agents/workflows/`, run that workflow.\n" +
      "Choose it by reading the workflows' own descriptions — do not guess from the filename alone.\n\n" +
      `Available workflows: ${wf.join(", ")}\n`;
  } else {
    nudge = "";
  }
  // The root AGENTS.md, generated from the (possibly stripped) .agents/ — the
  // mechanism that ships. The descriptions nudge goes below, as user text.
  const agentsMd = renderRootAgentsMd(null, await buildFrameworkBlock(join(dir, ".agents")));
  await writeFile(join(dir, "AGENTS.md"), nudge ? `${agentsMd}\n${nudge}` : agentsMd);

  // Enough of carja/ to look like a real install.
  for (const d of ["0-compass", "1-workbench", "2-backlog"]) {
    await mkdir(join(dir, "carja", d), { recursive: true });
  }
  await writeFile(join(dir, "carja", "1-workbench", "inbox.md"), "# Inbox\n");
  return dir;
}

const ASK = [
  "",
  "---",
  "",
  "Do NOT start any work and do NOT ask me anything. Answer the routing question only.",
  "Reply with EXACTLY ONE LINE and nothing else:",
  "  - the filename of the workflow you would run (e.g. `build.md`), or",
  "  - `ANSWER_DIRECTLY` if this needs no workflow at all, or",
  "  - `INBOX` if this should be captured verbatim to the workbench inbox.",
].join("\n");

function runCase(c, cwd) {
  return new Promise((resolve) => {
    const started = Date.now();
    const prompt = `${c.prompt}${ASK}`;
    const child = spawn(
      CLI,
      ["-p", prompt, "--allowed-tools", "Read", "--permission-mode", "acceptEdits"],
      { cwd, stdio: ["ignore", "pipe", "pipe"] },
    );
    let out = "";
    let err = "";
    child.stdout.on("data", (d) => (out += d));
    child.stderr.on("data", (d) => (err += d));
    const timer = setTimeout(() => child.kill("SIGKILL"), 180_000);
    child.on("error", (e) => {
      clearTimeout(timer);
      resolve({ ...c, actual: null, ms: Date.now() - started, error: e.message });
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({
        ...c,
        actual: normalize(out),
        raw: out.trim(),
        ms: Date.now() - started,
        error: code === 0 ? null : err.trim().slice(0, 300) || `exit ${code}`,
      });
    });
  });
}

/** Pull the answer out of the reply. Exact-ish, so grading needs no judge. */
function normalize(text) {
  const t = String(text).trim();
  if (/ANSWER_DIRECTLY/i.test(t)) return "ANSWER_DIRECTLY";
  if (/\bINBOX\b/i.test(t)) return "INBOX";
  const m = t.match(/([a-z0-9-]+\.md)/i);
  return m ? m[1].toLowerCase() : t.split("\n").pop()?.slice(0, 60) ?? null;
}

async function main() {
  const cases = ONLY ? CASES.filter((c) => c.id === ONLY) : CASES;
  if (cases.length === 0) {
    console.error(`no case matching --case ${ONLY}`);
    process.exit(2);
  }

  const dir = await makeFixture(SUITE);
  console.log(`routing-eval · suite=${SUITE} · cases=${cases.length} · cli=${CLI}`);
  console.log(`fixture: ${dir}\n`);

  const started = Date.now();
  const results = [];
  const queue = [...cases];
  await Promise.all(
    Array.from({ length: Math.min(CONCURRENCY, queue.length) }, async () => {
      while (queue.length) {
        const c = queue.shift();
        const r = await runCase(c, dir);
        results.push(r);
        const pass = r.actual === r.expect;
        console.log(
          `  ${pass ? "PASS" : "FAIL"}  ${r.id.padEnd(18)} expected ${String(r.expect).padEnd(22)} ` +
            `got ${String(r.actual ?? "(none)").padEnd(22)} ${(r.ms / 1000).toFixed(1)}s` +
            (r.error ? `  [${r.error.slice(0, 80)}]` : ""),
        );
        if (VERBOSE && !pass) console.log(`        raw: ${JSON.stringify(r.raw ?? "")}\n`);
      }
    }),
  );

  results.sort((a, b) => CASES.findIndex((c) => c.id === a.id) - CASES.findIndex((c) => c.id === b.id));
  const passed = results.filter((r) => r.actual === r.expect);
  const negatives = results.filter((r) => r.id.startsWith("neg-"));
  const negPassed = negatives.filter((r) => r.actual === r.expect);

  console.log(
    `\n  ${passed.length}/${results.length} routed correctly ` +
      `(negative controls ${negPassed.length}/${negatives.length}) ` +
      `in ${((Date.now() - started) / 1000).toFixed(0)}s wall`,
  );

  // Written so a later run can be diffed against this one.
  const outFile = join(ROOT, "test", "evals", `last-run-${SUITE}.json`);
  await writeFile(
    outFile,
    `${JSON.stringify(
      {
        suite: SUITE,
        ts: new Date().toISOString(),
        passed: passed.length,
        total: results.length,
        results: results.map(({ id, expect, actual, ms, error }) => ({ id, expect, actual, ms, error })),
      },
      null,
      2,
    )}\n`,
  );
  console.log(`  wrote ${outFile}`);

  if (!process.env.CARJA_EVAL_KEEP) await rm(dir, { recursive: true, force: true });

  // A routing regression is a real failure, not a warning. Under --mutate the
  // contract inverts: the mutated case MUST fail, or the eval is not actually
  // measuring routing.
  const allPassed = passed.length === results.length;
  if (MUTATE) {
    if (allPassed) {
      console.log(
        `\n  SENSITIVITY FAILURE: ${MUTATE} was made unroutable and every case still passed.\n` +
          `  The eval is not measuring routing — fix the eval before trusting a green run.`,
      );
      process.exit(1);
    }
    console.log(`\n  sensitivity OK: blinding ${MUTATE} turned the suite red, as it must.`);
    process.exit(0);
  }
  process.exit(allPassed ? 0 : 1);
}

await main();
