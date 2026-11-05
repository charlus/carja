// src/commands/status.js
//
// `carja status` — "what's on our plate for today", answered instantly.
//
// This replaces a chain of `ls`, `cd` and `vim` with one command, and it
// replaces asking the agent, which cost a whole turn plus context every time
// for the question asked most often in a day.

import { collectState } from "../carja-state.js";
import { collectLive } from "../live-state.js";
import { renderStatus, renderLive, painter } from "../view/status.js";
import { instructionWarningsFor } from "../claude-instructions.js";
import { cardState } from "./agents-md.js";
import { mergedLoopWorktrees } from "../loop/reconcile.js";
import { branchSafety } from "../work.js";
import { QUESTIONS_REL, decisionStats, parseRound, roundAnswered } from "../loop/questions.js";
import { nextAfterStatus } from "../next-step.js";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { configPath as configPathOf, statePath } from "../names.js";

function parseArgs(args) {
  const opts = { color: null, json: false, live: false, staleDays: 30, dir: null };
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === "--json") opts.json = true;
    else if (arg === "--live") opts.live = true;
    else if (arg === "--no-color" || arg === "--no-colour") opts.color = false;
    else if (arg === "--color" || arg === "--colour") opts.color = true;
    else if (arg === "--stale-days") opts.staleDays = Number(args[++i]) || 30;
    else if (!arg.startsWith("-") && !opts.dir) opts.dir = arg;
  }
  return opts;
}

/** True unless the caller asked otherwise, output is piped, or NO_COLOR is set. */
function wantsColour(opts, stdout, env) {
  if (opts.color !== null) return opts.color;
  if (env.NO_COLOR) return false;
  return Boolean(stdout.isTTY);
}

/** The slices and Blueprints the loop would take, from `loop.slices` and `loop.blueprint`. Never throws. */
export async function loopItems(root) {
  try {
    const { parseLoopConfig } = await import("../loop/config.js");
    const { readSlices, readBlueprints } = await import("./loop.js");
    const { harvestSlices } = await import("../loop/slices.js");
    const { harvestBlueprints } = await import("../loop/blueprint.js");
    const raw = JSON.parse(await readFile(configPathOf(root), "utf8"));
    const cfg = parseLoopConfig(raw);
    const items = [];
    if (cfg.slices === true || cfg.slices.length) items.push(...harvestSlices(await readSlices(root, cfg.slices)));
    if (cfg.blueprint === true || cfg.blueprint.length) items.push(...harvestBlueprints(await readBlueprints(root, cfg.blueprint)));
    return items.map((t) => t.title);
  } catch {
    return [];
  }
}

/** Projects in the backlog the loop is not on for. Never throws. */
export async function loopOffProjects(root) {
  try {
    const raw = JSON.parse(await readFile(configPathOf(root), "utf8")).loop ?? {};
    const on = (k) => raw[k] === true || (Array.isArray(raw[k]) ? raw[k] : []);
    if (on("blueprint") === true || on("slices") === true) return [];
    const names = (await readdir(join(root, statePath(root, "carja/2-backlog/project-backlog")), { withFileTypes: true })).filter((d) => d.isDirectory()).map((d) => d.name);
    return names.filter((n) => !on("blueprint").includes(n) && !on("slices").includes(n));
  } catch {
    return [];
  }
}

/** The question rounds in the root checkout: waiting for the owner, or answered and waiting for the loop. */
export async function readRounds(root) {
  const files = (await readdir(join(root, QUESTIONS_REL)).catch(() => [])).filter((f) => f.endsWith(".md"));
  const answered = await Promise.all(files.map(async (f) => roundAnswered(parseRound(await readFile(join(root, QUESTIONS_REL, f), "utf8")))));
  const waitingFiles = files.filter((_, i) => !answered[i]);
  const answeredFiles = files.filter((_, i) => answered[i]);
  return { waitingFiles, answeredFiles, waiting: waitingFiles.map((f) => `${QUESTIONS_REL}/${f}`), answered: answeredFiles };
}

export async function statusCommand(args, context) {
  const opts = parseArgs(args);
  const root = opts.dir ? opts.dir : context.cwd;
  const env = process.env;

  const { ok, state } = await collectState(root, { staleDays: opts.staleDays });

  if (!ok) {
    context.stderr.write(
      `  No \`carja/\` folder in ${root}\n` +
        "  Scaffold one with:  npx github:charlus/carja init\n"
    );
    return 1;
  }

  // MR and deploy status are live: the human changes them outside any
  // conversation, so they are fetched on request and never read from the files.
  const live = opts.live ? await collectLive(root, { run: context.run }) : null;

  if (opts.json) {
    const digest = live ? { ...state.digest, live } : state.digest;
    context.stdout.write(`${JSON.stringify(digest, null, 2)}\n`);
    return 0;
  }

  const colour = wantsColour(opts, context.stdout, env);
  context.stdout.write(`${renderStatus(state, { color: colour })}\n`);
  // D1: every project, its stage as the loop reads it, and whether the loop is on.
  {
    const { readProjects, renderProjects } = await import("../projects.js");
    const { readBlueprints, exists } = await import("./loop.js");
    const config = JSON.parse(await readFile(configPathOf(root), "utf8").catch(() => "{}"));
    const block = renderProjects(await readProjects(root, { config, readBlueprints, exists }));
    if (block) context.stdout.write(`${block}\n\n`);
  }
  if (live) context.stdout.write(`${renderLive(live, painter(colour))}\n\n`);
  else context.stdout.write("  MR and deploy status: not checked. Run carja status --live.\n");
  // The project card: every session loads it, so a draft or stale card is worth a line.
  const card = await cardState(root);
  if (card === "draft") context.stdout.write("  ⚠️  Project card in AGENTS.md is a draft. Run the agents-md workflow (/agents-md).\n");
  else if (card?.stale) context.stdout.write(`  ⚠️  Project card in AGENTS.md is stale: ${card.stale.join(", ")} changed. Run the agents-md workflow (/agents-md).\n`);
  // D9: anything that makes Claude Code skip the root AGENTS.md, and so the framework.
  for (const w of await instructionWarningsFor(root)) context.stdout.write(`  ⚠️  ${w}\n`);
  // Unattended Lifecycle step 2: status reports, it never deletes. The cleanup
  // runs on `git pull` (post-merge hook) and at the start of a loop run.
  const git = async (a) => {
    const r = spawnSync("git", a, { cwd: root, encoding: "utf8" });
    return { ok: r.status === 0, stdout: (r.stdout || "").trim() };
  };
  // Interactive work is branch-safe too (2026-10-22): the owner's folder and its
  // code repositories stay on their default branch; merged worktrees, the
  // loop's and the interactive items', are named here and removed elsewhere.
  const gitIn = (cwd) => async (a) => {
    const r = spawnSync("git", a, { cwd, encoding: "utf8" });
    return { ok: r.status === 0, stdout: (r.stdout || "").trim() };
  };
  const safety = await branchSafety({ root, git: gitIn }).catch(() => ({ off: [], leftovers: [] }));
  for (const o of safety.off) {
    context.stdout.write(`  ⚠️  ${o.label === "." ? "Your folder" : `Code repository ${o.label}`} is on ${o.branch}, not on its default branch ${o.want}. Work happens in item worktrees (carja work <item>); switch back with: git -C ${o.label === "." ? "." : o.label} switch ${o.want}\n`);
  }
  const merged = safety.leftovers.length ? safety.leftovers : await mergedLoopWorktrees({ git });
  if (merged.length) {
    context.stdout.write(
      `  ℹ️  ${merged.length} merged worktree${merged.length === 1 ? "" : "s"} (${merged.map((w) => w.branch).join(", ")}): removed on your next \`git pull\`, loop run or \`carja work clean\`.\n`
    );
  }
  // Step 4 (D1): rounds waiting for the owner, and how often the owner agrees.
  const md = async (d) => (await readdir(join(root, d)).catch(() => [])).filter((f) => f.endsWith(".md"));
  const { waitingFiles: waiting, answeredFiles: ready } = await readRounds(root);
  if (ready.length) {
    context.stdout.write(`  ℹ️  ${ready.length} answered question round${ready.length === 1 ? "" : "s"}: the next loop run resumes ${ready.length === 1 ? "its item" : "their items"}.\n`);
  }
  if (waiting.length) {
    context.stdout.write(
      `  ❓ ${waiting.length} question round${waiting.length === 1 ? "" : "s"} waiting for you: ${waiting.map((f) => `${QUESTIONS_REL}/${f}`).join(", ")}. Answer each by number, then run the loop again.\n`
    );
  }
  // I6: the loop's messages live outside git; the newest one is named here.
  const { readLoopMessages, MESSAGES_REL } = await import("../loop/owner-files.js");
  const messages = await readLoopMessages(root);
  if (messages.length) {
    const last = messages.at(-1);
    context.stdout.write(`  📬 ${messages.length} loop message${messages.length === 1 ? "" : "s"} in ${MESSAGES_REL}. Newest: ${last.title}${last.text ? `: ${last.text.slice(0, 160)}${last.text.length > 160 ? "…" : ""}` : ""}\n`);
  }
  const reports = (await readdir(join(root, statePath(root, "carja/1-workbench"))).catch(() => [])).filter((f) => /^loop-report-.+\.md$/.test(f));
  if (reports.length) context.stdout.write(`  📋 Loop report${reports.length === 1 ? "" : "s"}: ${reports.map((f) => `${statePath(root, "carja/1-workbench")}/${f}`).join(", ")}. Merge with /merge-stack <project>.\n`);
  const answeredRounds = await Promise.all((await md(`${QUESTIONS_REL}/answered`)).map((f) => readFile(join(root, QUESTIONS_REL, "answered", f), "utf8")));
  const rulingsText = await readFile(join(root, statePath(root, "carja/1-workbench/rulings.md")), "utf8").catch(() => "");
  const st = decisionStats({ rulingsText, answeredRounds });
  if (st.answered || st.rulings) {
    context.stdout.write(`  ℹ️  Loop decisions: you took the recommendation ${st.tookRecommendation} of ${st.answered} times, and overruled ${st.overruled} of ${st.rulings} ruling${st.rulings === 1 ? "" : "s"}.\n`);
  }
  const next = nextAfterStatus({
    waitingRounds: waiting.map((f) => `${QUESTIONS_REL}/${f}`),
    answeredRounds: ready.length,
    verifyConfigured: state.digest?.verify?.state !== "unset",
    inboxCount: state.digest?.inboxCount ?? 0,
    queueLength: state.digest?.queueLength ?? 0,
    loopItems: await loopItems(root),
    loopOffProjects: await loopOffProjects(root),
  });
  context.stdout.write(`\n  ${next}\n`);
  return 0;
}
