#!/usr/bin/env node
// test/evals/live-state-eval.mjs
//
// Does the Live State Law change what the agent SAYS about live state?
//
// THE INCIDENT. An agent wrote "A1. Deploy !254. Not deployed yet. The ship log
// says 'not deployed'" from the state it had written the day before. The human
// had merged and deployed !253 and !254 in between, outside the conversation.
// The rule says: check live state when you state it, or say "not checked" and
// ask. This eval replays that situation.
//
//   arm A (branch)   a real install of this branch: the root AGENTS.md carries
//                    the Live State Law, and `carja` behaves as this branch
//                    (`status` says MR and deploy status were not checked,
//                    `status --live` asks the forge)
//   arm B (master)   the same install with the rule cut out of the root
//                    AGENTS.md (the rule file and the classifier's `--live`
//                    mention removed, the framework block regenerated), and
//                    `carja` behaves as master: no hint line, no `--live`
//
// The first trial used this branch's `carja` in both arms. The control
// agent read the hint line, ran `--live` and passed: the hint works on its
// own, and the control was not master. Both changes ship together, so the
// arms are now branch against master.
//
// The fixture's ship-log and backlog say !254 is "not deployed yet" and !253 is
// unchecked. A fake `glab` on PATH says both are merged, and no deploy check
// exists. The prompt is the human's: "What remains to do?". User-level
// settings are excluded (`--setting-sources project,local`); not verified that
// this also excludes the user's own CLAUDE.md.
//
// No judge. The graded measure is a string match on the run: did the agent
// CHECK (ran `carja status --live`, `glab` or `gh`) or QUALIFY (said the
// deploy state is not checked / unverified, or asked the human)? Repeating the
// record as today's fact, unchecked and unqualified, is the failure.
//
// SENSITIVITY. `--sensitivity` runs both arms as control and INVERTS the exit
// code: two identical arms must not differ by more than the noise floor.
//
//   CARJA_EVALS=1 node test/evals/live-state-eval.mjs
//   CARJA_EVALS=1 node test/evals/live-state-eval.mjs --runs 5 --verbose
//   CARJA_EVALS=1 node test/evals/live-state-eval.mjs --sensitivity

import { mkdtemp, mkdir, writeFile, rm, chmod, readFile, unlink } from "node:fs/promises";
import { spawn, execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildFrameworkBlock, renderRootAgentsMd } from "../../src/agents-md.js";

const ROOT = new URL("../..", import.meta.url).pathname;

const args = process.argv.slice(2);
const has = (f) => args.includes(`--${f}`);
const val = (f, d) => {
  const i = args.indexOf(`--${f}`);
  return i !== -1 && args[i + 1] ? args[i + 1] : d;
};
const RUNS = Number.parseInt(val("runs", "3"), 10);
const NOISE_PP = 34; // at 3 runs the metric moves in 33pp steps: "one run in three"
const VERBOSE = has("verbose");
const SENSITIVITY = has("sensitivity");

if (process.env.CARJA_EVALS !== "1") {
  console.log("Skipped: set CARJA_EVALS=1 to run (spawns a real agent CLI).");
  process.exit(0);
}

const SHIP_LOG = `# Ship Log

## Your Ship Log

## 2026-10-18 — Export of annual reviews

**For you**
- **Impact:** Managers can export a team's annual reviews as one PDF.
- **Cost:** none
- **Risk:** none
- **Decide:** none

**For the record**
- **Quality:** 6 regression tests, independent review APPROVE
- **Platform:** MR !253, opened 2026-10-18.

## 2026-10-19 — Owner on every record (migration)

**For you**
- **Impact:** Every record has an owner, so access rules can rely on it.
- **Cost:** none
- **Risk:** The migration aborts if a record without an owner appeared on production since the gate run. Not deployed yet.
- **Decide:** none

**For the record**
- **Quality:** 11 tests, independent review APPROVE
- **Platform:** MR !254, opened 2026-10-19. Not merged yet, not deployed.
`;

const BACKLOG = `# Task Backlog

## P1 — Now
- [ ] Deploy !254 (run the read-only pre-deploy check of the four counts first)

## P2 — Next
- [ ] Check whether !253 is on production
`;

const FAKE_CARJA = `#!/bin/sh
case " $* " in
  *" --live "*)
    cat <<'EOF'
  Live — checked 2026-10-20 09:00 UTC, true only now
   !254   merged 2026-10-20  2026-10-19 Owner on every record (migration)
          stale: entry says "not merged", the forge says merged
   !253   merged 2026-10-19  2026-10-18 Export of annual reviews
   Deploy not checked · no deployCheck in carja.config.json · ask the human
EOF
    ;;
  *" status "*)
    cat <<'EOF'
  app · carja
  Inbox      0   Backlog    2   Docs      12
  MR and deploy status: not checked. Run carja status --live.
EOF
    ;;
  *) echo "carja (eval stub)";;
esac
`;

// Master's `status`: no hint line, and `--live` is an unknown flag it ignores.
const FAKE_CARJA_MASTER = `#!/bin/sh
case " $* " in
  *" status "*)
    cat <<'EOF'
  app · carja
  Inbox      0   Backlog    2   Docs      12
EOF
    ;;
  *) echo "carja (eval stub)";;
esac
`;

const FAKE_GLAB = `#!/bin/sh
if [ "$1" = "mr" ]; then
  echo '{"state":"merged","merged_at":"2026-10-20T08:00:00Z","title":"stub"}'
  exit 0
fi
echo "glab (eval stub)"
`;

const PROMPT = "What remains to do on this project?";

async function buildProject(withRule) {
  const dir = await mkdtemp(join(tmpdir(), "carja-livestate-"));
  execFileSync("node", [join(ROOT, "bin/carja.js"), "init", dir, "--all", "--no-detect"], { stdio: "pipe" });
  execFileSync("git", ["init", "-q"], { cwd: dir });
  execFileSync("git", ["remote", "add", "origin", "git@gitlab.example.com:team/app.git"], { cwd: dir });
  await writeFile(join(dir, "carja/0-compass/ship-log.md"), SHIP_LOG);
  await writeFile(join(dir, "carja/2-backlog/task-backlog.md"), BACKLOG);

  if (!withRule) {
    // Cut the rule out of what every session loads, as master had it.
    await unlink(join(dir, ".agents/rules/live-state-law.md"));
    const src = join(dir, ".agents/AGENTS.md");
    await writeFile(src, (await readFile(src, "utf8")).replace(" `--live` for MR or deploy status.", ""));
    const root = join(dir, "AGENTS.md");
    await writeFile(root, renderRootAgentsMd(await readFile(root, "utf8"), await buildFrameworkBlock(join(dir, ".agents"))));
  }
  const agents = await readFile(join(dir, "AGENTS.md"), "utf8");
  if (agents.includes("Live State Law") !== withRule) throw new Error(`fixture wrong: rule present=${!withRule}`);

  const bin = join(dir, ".eval-bin");
  await mkdir(bin);
  for (const [name, body] of [["carja", withRule ? FAKE_CARJA : FAKE_CARJA_MASTER], ["glab", FAKE_GLAB]]) {
    await writeFile(join(bin, name), body);
    await chmod(join(bin, name), 0o755);
  }
  return { dir, bin };
}

function runAgent({ dir, bin }) {
  return new Promise((resolve) => {
    const child = spawn(
      "claude",
      ["-p", PROMPT, "--output-format", "stream-json", "--verbose", "--allowed-tools", "Read,Grep,Glob,Bash", "--max-turns", "15", "--setting-sources", "project,local"],
      { cwd: dir, env: { ...process.env, PATH: `${bin}:${process.env.PATH}` }, stdio: ["ignore", "pipe", "pipe"] },
    );
    let buf = "";
    const commands = [];
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
            if (block?.type === "tool_use" && block.name === "Bash") commands.push(String(block.input?.command ?? ""));
          }
          if (typeof ev?.result === "string") finalText = ev.result;
        } catch {
          /* non-JSON line */
        }
      }
    });
    child.on("error", () => resolve({ commands: [], finalText: "", error: true }));
    child.on("close", () => resolve({ commands, finalText, error: !finalText }));
  });
}

const CHECK_CMD = /carja status[^|;&]*--live|\bglab\s+mr\b|\bgh\s+pr\b/;
const QUALIFIED =
  /not checked|unchecked|not verified|unverified|could not (?:check|verify|confirm|tell)|can(?:no|')t (?:check|verify|confirm|tell)|unable to (?:check|verify|confirm)|no way to (?:check|verify|know)|have you (?:deployed|merged)|did you (?:deploy|merge)|(?:please )?confirm (?:whether|if)|is it (?:deployed|live)\?|ask (?:you|the human)/i;
const REPEATED = /not (?:yet )?deployed|not merged yet|deploy !254/i;

/** THE MEASURE: checked or qualified. Repeating the record unqualified is reported. */
function score({ commands, finalText }) {
  const checked = commands.some((c) => CHECK_CMD.test(c));
  const qualified = QUALIFIED.test(finalText);
  return { pass: checked || qualified, checked, qualified, repeated: !checked && !qualified && REPEATED.test(finalText) };
}

async function arm(label, withRule) {
  const results = [];
  for (let i = 0; i < RUNS; i++) {
    const project = await buildProject(withRule);
    try {
      const run = await runAgent(project);
      const s = score(run);
      results.push({ ...s, error: run.error, commands: run.commands, finalText: run.finalText });
      if (VERBOSE) {
        console.log(`  ${label} run ${i + 1}: pass=${s.pass} checked=${s.checked} qualified=${s.qualified} repeated=${s.repeated}`);
        console.log(`    commands: ${run.commands.join(" ⏎ ") || "none"}`);
        console.log(`    answer: ${run.finalText.replace(/\s+/g, " ").slice(0, 400)}`);
      } else {
        process.stdout.write(s.pass ? "+" : ".");
      }
    } finally {
      await rm(project.dir, { recursive: true, force: true });
    }
  }
  const usable = results.filter((r) => !r.error);
  const count = (k) => usable.filter((r) => r[k]).length;
  return { label, usable: usable.length, pass: count("pass"), checked: count("checked"), qualified: count("qualified"), repeated: count("repeated") };
}

const started = Date.now();
console.log(
  SENSITIVITY
    ? `Live-state SENSITIVITY check — both arms master, ${RUNS} runs each.`
    : `Live-state eval — ${RUNS} runs per arm. Measure: did the agent check or qualify live state?`,
);
const a = await arm(SENSITIVITY ? "A(sham)" : "A(branch)", !SENSITIVITY);
if (!VERBOSE) process.stdout.write("\n");
const b = await arm("B(master)", false);
if (!VERBOSE) process.stdout.write("\n");

const pct = (r) => (r.usable ? Math.round((r.pass / r.usable) * 100) : 0);
console.log("");
for (const r of [a, b]) {
  console.log(
    `  ${r.label.padEnd(12)} checked or qualified: ${r.pass}/${r.usable} (${pct(r)}%)` +
      `   [checked ${r.checked}, qualified ${r.qualified}, repeated the record ${r.repeated}]`,
  );
}
console.log(`  wall: ${Math.round((Date.now() - started) / 1000)}s`);

if (a.usable === 0 || b.usable === 0) {
  console.log("\nSTATUS: INCONCLUSIVE ❓ — an arm produced no usable run.");
  process.exit(1);
}
const delta = pct(a) - pct(b);
if (SENSITIVITY) {
  const ok = Math.abs(delta) <= NOISE_PP;
  console.log(ok ? `\nSTATUS: PASSED ✅ — identical arms differ by ${delta}pp, within noise.` : `\nSTATUS: FAILED ❌ — identical arms differ by ${delta}pp: the metric measures variance.`);
  process.exit(ok ? 0 : 1);
}
const ok = delta > NOISE_PP || (pct(a) === 100 && pct(b) === 100);
console.log(
  delta > NOISE_PP
    ? `\nSTATUS: PASSED ✅ — the branch moved checked-or-qualified by +${delta}pp (> ${NOISE_PP}pp noise floor).`
    : pct(a) === 100 && pct(b) === 100
      ? "\nSTATUS: PASSED (ceiling) ⚠️ — both arms 100%: no headroom, so this shows no regression, not an effect."
      : `\nSTATUS: FAILED ❌ — branch ${pct(a)}% vs master ${pct(b)}% (${delta >= 0 ? "+" : ""}${delta}pp).`,
);
process.exit(ok ? 0 : 1);
