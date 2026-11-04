#!/usr/bin/env node
// test/evals/persona-eval.mjs
//
// Does an agent running Build actually load the Designer and DESIGN.md before
// it writes UI code, and does that change the code it writes?
//
// #53–#55 wired the personas into Build in prose (`carja personas`, then
// read what it lists) and moved the design rules into DESIGN.md. The unit
// suites prove the CLI maps paths correctly. They cannot prove an agent follows
// the steps: that is this eval.
//
//   arm A (master)  `master`'s framework. The same design rules sit in
//                   carja/4-context/design/design-system.md. No persona step.
//   arm B (branch)  this branch's framework. The design rules sit in DESIGN.md.
//
// Same app, same feature spec, same task: a real Build run of a small UI
// slice. The spec names neither the tokens nor an empty state, so a design
// system that is actually read is the only way either reaches the code.
//
// GRADED (process): before its first write under src/, did the agent read
// .agents/personas/designer.md AND the design rules file of its arm?
// REPORTED (outcome, not graded): the new stylesheet has no colour literal and
// uses the tokens; the component handles an empty list; status uses the
// status tokens. No judge: file reads and regexes only.
//
// SENSITIVITY. `--sensitivity` runs arm B against arm B with the persona step
// cut out of build.md, and expects the graded rate to drop by more than the
// noise threshold. If it does not, the eval cannot see the step it grades.
//
// Gated behind CARJA_EVALS=1: every run is a real Build session.
//
//   CARJA_EVALS=1 node test/evals/persona-eval.mjs
//   CARJA_EVALS=1 node test/evals/persona-eval.mjs --runs 1 --verbose
//   CARJA_EVALS=1 node test/evals/persona-eval.mjs --sensitivity
//   CARJA_EVALS=1 node test/evals/persona-eval.mjs --scenario drift

import { mkdtemp, mkdir, writeFile, readFile, chmod } from "node:fs/promises";
import { spawn, execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { existsSync } from "node:fs";

const ROOT = new URL("../..", import.meta.url).pathname;
const args = process.argv.slice(2);
const has = (f) => args.includes(`--${f}`);
const val = (f, d) => {
  const i = args.indexOf(`--${f}`);
  return i !== -1 && args[i + 1] ? args[i + 1] : d;
};
const RUNS = Number.parseInt(val("runs", "3"), 10);
const MAX_TURNS = val("max-turns", "60");
const TIMEOUT_MS = Number.parseInt(val("timeout-min", "15"), 10) * 60_000;
const NOISE_PP = 34; // at 3 runs the rate moves in 33pp steps: "more than one run in three"
const VERBOSE = has("verbose");
const SENSITIVITY = has("sensitivity");
// `rules`: the design rules are written down (DESIGN.md, or design-system.md on
// master). Grades whether the Designer and the rules are LOADED.
// `drift`: nothing is written down, and the existing stylesheet mostly uses
// literal colours although tokens.css exists, the state that produced the ugly
// UI. Grades the OUTCOME: does the new stylesheet use the tokens and no literal?
const SCENARIO = val("scenario", "rules");

if (process.env.CARJA_EVALS !== "1") {
  console.log("Skipped: set CARJA_EVALS=1 to run (spawns real Build sessions).");
  process.exit(0);
}

// ---------------------------------------------------------------------------
// The app: a product list that already uses the tokens, with one stray literal
// (#555) the way real codebases drift. Tokens live in src/styles/tokens.css.
// ---------------------------------------------------------------------------
const APP = {
  "package.json": JSON.stringify({ name: "shop", type: "module", scripts: { test: "node --test" } }, null, 2) + "\n",
  "src/styles/tokens.css":
    ":root {\n  --color-primary: #0077b6;\n  --color-text: #1b1f24;\n  --color-muted: #5b6470;\n" +
    "  --color-surface: #ffffff;\n  --color-border: #d9dee4;\n  --color-success: #1a7f37;\n" +
    "  --color-warning: #9a6700;\n  --color-danger: #cf222e;\n  --space-1: 4px;\n  --space-2: 8px;\n" +
    "  --space-3: 16px;\n  --space-4: 24px;\n  --radius-md: 8px;\n  --font-body: 'Inter', sans-serif;\n}\n",
  "src/styles/product-list.css":
    ".product-list { display: grid; gap: var(--space-3); padding: var(--space-4); }\n" +
    ".product-card { border: 1px solid var(--color-border); border-radius: var(--radius-md); padding: var(--space-3); }\n" +
    ".product-card .price { color: #555; }\n",
  "src/components/product-list.js":
    "export function renderProductList(products) {\n" +
    "  const items = products.map((p) => `<li class=\"product-card\">${p.name} <span class=\"price\">${p.price}</span></li>`);\n" +
    "  return `<ul class=\"product-list\">${items.join(\"\")}</ul>`;\n}\n",
  "test/product-list.test.js":
    'import { test } from "node:test";\nimport assert from "node:assert/strict";\n' +
    'import { renderProductList } from "../src/components/product-list.js";\n\n' +
    'test("renders each product", () => {\n  assert.match(renderProductList([{ name: "Mug", price: "9" }]), /Mug/);\n});\n',
};

// The design rules, identical in both arms. Only their location differs.
const DESIGN_RULES = `# Design System: Shop

## Visual Theme & Atmosphere

Calm and dense. One primary action per screen. Secondary information is muted, never smaller than 14px.

## Colour Palette & Roles

Every colour is a token from \`src/styles/tokens.css\`. Never write a hex value in a component stylesheet.

| Token | Role |
|-------|------|
| --color-primary | the one primary action |
| --color-text / --color-muted | body text / secondary text |
| --color-success / --color-warning / --color-danger | status badges: done / pending / failed |

## Layout & Spacing

Spacing uses --space-1 to --space-4 only. Cards use --radius-md and a 1px --color-border.

## Component Styling

### Lists
Every list has an empty state: one muted line saying what is missing, and the primary action that fills it.

### Status badges
A status is a badge coloured with the status tokens, never plain text.

## Tokens

\`src/styles/tokens.css\`. It wins over this document if they differ.
`;

const SPEC = `# Feature Spec: Orders list

## Summary
Shoppers see their past orders.

## User Stories

### As a shopper, I see my past orders
- [ ] Each order shows its date, its total and its status.
- [ ] Orders are sorted newest first.

## Brief check
- **C1 contradicts an earlier decision:** None found.
- **C2 breaks existing users:** None found.
- **C3 cost or duration mismatch:** None found.
- **C4 missing data, access or rights:** None found.

## Out of Scope
Order detail pages.
`;

const PLAN = `# Implementation Plan: Orders list

## Files & Components Affected
- \`src/components/orders-list.js\` (new): \`renderOrdersList(orders)\` returns an HTML string
- \`src/styles/orders-list.css\` (new): styles for the list
- \`test/orders-list.test.js\` (new)

## Testing Decisions
One seam: \`renderOrdersList\`, tested on its HTML output with \`node --test\`.

### - [ ] Phase 1: Orders list
1. Create \`renderOrdersList(orders)\` in \`src/components/orders-list.js\`. An order is \`{ id, date, total, status }\`, status one of \`done\`, \`pending\`, \`failed\`.
2. Style it in \`src/styles/orders-list.css\`.

Verification: \`npm test\`
`;

// The drift scenario's stylesheet: tokens.css exists, but the code that is
// there to imitate ignores it.
const DRIFTED = {
  "src/styles/product-list.css":
    ".product-list { display: grid; gap: 16px; padding: 24px; }\n" +
    ".product-card { border: 1px solid #ddd; border-radius: 6px; padding: 14px; background: #fff; }\n" +
    ".product-card .name { color: #222; font-weight: 600; }\n" +
    ".product-card .price { color: #555; }\n" +
    ".product-card .buy { background: #1e88e5; color: white; border-radius: 4px; padding: 6px 12px; }\n",
};

const IMPL = "carja/2-backlog/project-backlog/Shop/implementations/01-orders-list";
const TASK =
  `Run the Build workflow (.agents/workflows/build.md) for ${IMPL}. ` +
  "You are running unattended: treat every confirmation the workflow asks for as given and do not stop to ask. " +
  "Skip the independent review subagent. Stop after Phase 3.";

// ---------------------------------------------------------------------------

let masterTree = null;
async function masterFramework() {
  if (masterTree) return masterTree;
  masterTree = await mkdtemp(join(tmpdir(), "carja-master-"));
  execFileSync("sh", ["-c", `git -C "${ROOT}" archive master | tar -x -C "${masterTree}"`]);
  return masterTree;
}

/** arm: "master" | "branch" | "mutated" (branch with the persona step cut from build.md). */
async function buildRepo(arm) {
  const dir = await mkdtemp(join(tmpdir(), `carja-persona-${arm}-`));
  const framework = arm === "master" ? await masterFramework() : ROOT;
  execFileSync("node", [join(framework, "bin/carja.js"), "init", dir, "--all", "--no-detect"], { stdio: "pipe" });

  for (const [rel, body] of Object.entries(APP)) {
    await mkdir(join(dir, rel, ".."), { recursive: true });
    await writeFile(join(dir, rel), SCENARIO === "drift" && DRIFTED[rel] ? DRIFTED[rel] : body);
  }
  await mkdir(join(dir, IMPL), { recursive: true });
  await writeFile(join(dir, IMPL, "feature-spec.md"), SPEC);
  await writeFile(join(dir, IMPL, "implementation-plan.md"), PLAN);

  if (SCENARIO === "drift") {
    // nothing written down: master keeps its empty design-system.md template
  } else if (arm === "master") {
    await mkdir(join(dir, "carja/4-context/design"), { recursive: true });
    await writeFile(join(dir, "carja/4-context/design/design-system.md"), DESIGN_RULES);
  } else {
    await writeFile(join(dir, "DESIGN.md"), DESIGN_RULES);
  }
  if (arm === "mutated") {
    const p = join(dir, ".agents/workflows/build.md");
    const kept = (await readFile(p, "utf8"))
      .split("\n")
      .filter((l) => !/carja personas|Design system first/.test(l))
      .join("\n");
    await writeFile(p, kept);
  }

  // `carja` on PATH, bound to the arm's own framework version.
  await mkdir(join(dir, ".eval-bin"));
  const shim = join(dir, ".eval-bin", "carja");
  await writeFile(shim, `#!/bin/sh\nexec node "${join(framework, "bin/carja.js")}" "$@"\n`);
  await chmod(shim, 0o755);
  await writeFile(join(dir, ".gitignore"), ".eval-bin/\n");

  const git = (...a) => execFileSync("git", a, { cwd: dir, stdio: "pipe" });
  git("init", "-q", "-b", "main");
  git("add", "-A");
  git("-c", "user.email=eval@x", "-c", "user.name=eval", "commit", "-q", "-m", "fixture");
  return dir;
}

/** One Build session. Returns the ordered tool calls and the final text. */
function runAgent(cwd) {
  return new Promise((resolve) => {
    const child = spawn(
      "claude",
      [
        "-p", TASK,
        "--output-format", "stream-json",
        "--verbose",
        "--max-turns", MAX_TURNS,
        "--allowed-tools",
        "Read,Grep,Glob,Edit,Write,Bash(carja:*),Bash(node:*),Bash(npm:*),Bash(git:*),Bash(ls:*)",
      ],
      {
        cwd,
        env: { ...process.env, PATH: `${join(cwd, ".eval-bin")}:${process.env.PATH}`, GIT_AUTHOR_NAME: "eval", GIT_AUTHOR_EMAIL: "eval@x", GIT_COMMITTER_NAME: "eval", GIT_COMMITTER_EMAIL: "eval@x" },
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
    const timer = setTimeout(() => child.kill("SIGTERM"), TIMEOUT_MS);
    let buf = "";
    const calls = [];
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
            if (block?.type === "tool_use") calls.push({ name: block.name, input: block.input ?? {} });
          }
          if (typeof ev?.result === "string") finalText = ev.result;
        } catch {
          /* non-JSON line */
        }
      }
    });
    child.on("error", () => { clearTimeout(timer); resolve({ calls: [], finalText: "", error: true }); });
    child.on("close", (code) => { clearTimeout(timer); resolve({ calls, finalText, error: code !== 0 }); });
  });
}

const pathOf = (c) => String(c.input.file_path ?? c.input.path ?? "");

/** THE GRADED MEASURE: designer.md and the design rules read before the first write under src/. */
function loadedBeforeWriting(calls, arm) {
  const rules = arm === "master" ? "4-context/design" : "DESIGN.md";
  const firstWrite = calls.findIndex((c) => (c.name === "Write" || c.name === "Edit") && /\/src\//.test(pathOf(c)));
  const before = firstWrite === -1 ? calls : calls.slice(0, firstWrite);
  const read = (re) =>
    before.some((c) => (c.name === "Read" && re.test(pathOf(c))) || (c.name === "Bash" && re.test(String(c.input.command ?? ""))));
  return {
    designer: read(/personas\/designer\.md/),
    rules: read(new RegExp(rules.replace(".", "\\."))),
    personasCmd: calls.some((c) => c.name === "Bash" && /carja personas/.test(String(c.input.command ?? ""))),
    wroteSrc: firstWrite !== -1,
  };
}

/** Reported, not graded: what the design rules should have changed in the code. */
async function outcome(dir) {
  const css = await readFile(join(dir, "src/styles/orders-list.css"), "utf8").catch(() => null);
  const js = await readFile(join(dir, "src/components/orders-list.js"), "utf8").catch(() => null);
  return {
    built: css != null && js != null,
    noLiterals: css != null && !/#[0-9a-f]{3,8}\b|rgba?\(/i.test(css),
    usesTokens: css != null && (css.match(/var\(--/g) ?? []).length >= 2,
    statusTokens: css != null && /--color-(success|warning|danger)/.test(css),
    designMd: existsSync(join(dir, "DESIGN.md")),
    emptyState: js != null && /length\s*===?\s*0|!\s*[\w.]+\.length|\.length\s*<\s*1|empty/i.test(js),
  };
}

async function oneRun(arm, i) {
  const dir = await buildRepo(arm);
  const t0 = Date.now();
  const { calls, finalText, error } = await runAgent(dir);
  const g = loadedBeforeWriting(calls, arm);
  const o = await outcome(dir);
  const secs = Math.round((Date.now() - t0) / 1000);
  const pass = SCENARIO === "drift" ? o.noLiterals && o.usesTokens : g.designer && g.rules;
  console.log(
    `  ${arm} #${i + 1}: ${pass ? "LOADED" : "skipped"}  designer=${g.designer} rules=${g.rules} ` +
      `personas-cmd=${g.personasCmd}  | built=${o.built} no-literals=${o.noLiterals} tokens=${o.usesTokens} ` +
      `status-tokens=${o.statusTokens} empty-state=${o.emptyState} design-md=${o.designMd}  (${calls.length} tools, ${secs}s${error ? ", exit≠0" : ""})`,
  );
  if (VERBOSE) console.log(`    dir: ${dir}\n    final: ${finalText.slice(0, 400).replace(/\n/g, " ")}`);
  return { arm, pass, ...g, ...o, dir };
}

async function arm(label) {
  console.log(`\n${label}:`);
  return Promise.all(Array.from({ length: RUNS }, (_, i) => oneRun(label, i)));
}

const rate = (rs, k) => Math.round((100 * rs.filter((r) => r[k]).length) / rs.length);
function report(label, rs) {
  const keys = ["pass", "personasCmd", "built", "noLiterals", "usesTokens", "statusTokens", "emptyState", "designMd"];
  console.log(`  ${label.padEnd(8)} ` + keys.map((k) => `${k}=${rate(rs, k)}%`).join("  "));
}

if (has("fixture-only")) {
  for (const armName of ["master", "branch", "mutated"]) console.log(`${armName}: ${await buildRepo(armName)}`);
  process.exit(0);
}

const [a, b] = SENSITIVITY
  ? await Promise.all([arm("branch"), arm("mutated")])
  : await Promise.all([arm("branch"), arm("master")]);
const results = { at: new Date().toISOString(), scenario: SCENARIO, runs: RUNS, sensitivity: SENSITIVITY, a, b };
await writeFile(join(ROOT, "test/evals", `last-run-persona-${SCENARIO}${SENSITIVITY ? "-sensitivity" : ""}.json`), JSON.stringify(results, null, 2));

console.log("\nRates:");
report(a[0].arm, a);
report(b[0].arm, b);
const delta = rate(a, "pass") - rate(b, "pass");
const ok = delta > NOISE_PP;
if (SENSITIVITY) {
  console.log(
    ok
      ? `\nSTATUS: PASSED ✅ — cutting the persona step from build.md drops loading by ${delta}pp: the eval sees the step.`
      : `\nSTATUS: FAILED ❌ — cutting the step changed loading by only ${delta}pp: the eval cannot see what it grades.`,
  );
} else {
  console.log(
    ok
      ? `\nSTATUS: PASSED ✅ — ${SCENARIO === "drift" ? "the branch writes token-only CSS" : "the branch loads the Designer and its design rules"} ${delta}pp more often than master.`
      : `\nSTATUS: FAILED ❌ — branch ${rate(a, "pass")}% vs master ${rate(b, "pass")}% (${delta}pp, threshold ${NOISE_PP}pp). Read the runs.`,
  );
}
process.exit(ok ? 0 : 1);
