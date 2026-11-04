// src/commands/loop-on.js
//
// `carja loop on <project> [dir] [--code-dir <d>] [--yes] [--dry-run]` and
// `carja loop off <project> [dir]`. Reads the facts, shows the plan from
// src/loop/enable.js in plain words, asks once (or takes --yes), then writes
// carja.config.json and loop-state.json and runs the doctor.

import { readFile, writeFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { createInterface } from "node:readline/promises";
import { planLoopOn, planLoopOff } from "../loop/enable.js";
import { readBlueprints, exists, runCli } from "./loop.js";
import { discoveryDone, harvestBlueprints, BLUEPRINT_STAGES } from "../loop/blueprint.js";
import { ignoredNestedRepos } from "../nested-repos.js";
import { PROJECTS_REL } from "../loop/slices.js";
import { STATE_REL } from "../loop/state-sync.js";
import { configPath as configPathOf } from "../names.js";

const CONFIG = "carja.config.json";
const readJsonOr = async (p, fallback) => ((await exists(p)) ? JSON.parse(await readFile(p, "utf8")) : fallback);
const writeJson = (p, obj) => writeFile(p, `${JSON.stringify(obj, null, 2)}\n`, "utf8");

async function ask(question, { stdin = process.stdin, stdout }) {
  const rl = createInterface({ input: stdin, output: stdout });
  try {
    return /^y(es)?$/i.test((await rl.question(question)).trim());
  } finally {
    rl.close();
  }
}

export async function loopOnCommand(root, project, { args, stdout, stderr, confirm = null }) {
  const backlog = args.includes("--backlog");
  // D2: without a name, the projects and which ones it can turn on.
  if (!project && !backlog) {
    const { readProjects, renderProjects } = await import("../projects.js");
    const config = await readJsonOr(configPathOf(root), {});
    const list = await readProjects(root, { config, readBlueprints, exists });
    if (!list.length) {
      stdout.write("  No project in carja/2-backlog/project-backlog/ yet. Start one in your agent with /genesis.\n");
      return 0;
    }
    stdout.write(`\n${renderProjects(list)}\n\n`);
    const off = list.filter((p) => p.canTurnOn && p.loop === "loop off");
    stdout.write(off.length ? `  Next: \`carja loop on ${off[0].name}\` (it shows what changes first).\n` : "  Every project the loop can take is on.\n");
    return 0;
  }
  if (!(await exists(join(root, STATE_REL)))) {
    stderr.write(`No ${STATE_REL} found. Run 'carja init' or 'carja upgrade' first.\n`);
    return 1;
  }
  const config = await readJsonOr(configPathOf(root), {});
  const state = await readJsonOr(join(root, STATE_REL), {});
  const bp = await readBlueprints(root, [project]);
  const p = bp.projects.find((x) => x.name === project);
  const base = join(root, PROJECTS_REL);
  const projects = (await exists(base)) ? (await readdir(base, { withFileTypes: true })).filter((d) => d.isDirectory()).map((d) => d.name) : [];
  const nestedRepos = await ignoredNestedRepos(root);
  const flag = args.includes("--code-dir") ? args[args.indexOf("--code-dir") + 1] : null;
  const codeDir = config.loop?.code_dir ?? flag ?? (nestedRepos.length === 1 ? nestedRepos[0].replace(/\/$/, "") : nestedRepos.map((d) => d.replace(/\/$/, "")).find((d) => Object.keys(config.repos ?? {}).includes(d)));
  const envRoot = codeDir ? join(root, codeDir) : root;
  const envDirs = [];
  for (const d of [".venv", "venv", "node_modules"]) {
    if ((await exists(join(envRoot, d))) && !(await runCli("git", ["ls-files", "--error-unmatch", d], envRoot)).ok) envDirs.push(d);
  }
  const NAMES = { "grand-prd": "Grand PRD", "ux-ui-brief": "UX/UI Brief", "technical-vision": "Technical Vision", carve: "Carve" };
  const item = p ? harvestBlueprints({ projects: [p], optIn: [project], templates: bp.templates })[0] : null;
  const stagesDone = (item?.stages_done ?? []).filter((k) => BLUEPRINT_STAGES.some((s) => s.key === k)).map((k) => NAMES[k]);
  const plan = planLoopOn({
    stagesDone,
    backlog,
    project: project ?? null,
    projects,
    discoveryDone: p ? discoveryDone({ docs: p.docs, templates: bp.templates }) : false,
    carved: p?.carved ?? false,
    config,
    state,
    nestedRepos,
    envDirs,
    codeDirFlag: flag,
    claudeOnPath: (await runCli("sh", ["-c", "command -v claude"], root)).ok,
  });
  if (!plan.ok) {
    stderr.write(`⛔  ${plan.error}\n`);
    return 1;
  }
  stdout.write(`\n  carja loop on ${project ?? "--backlog"}\n\n`);
  for (const c of plan.changes) stdout.write(`  • ${c}\n`);
  for (const n of plan.notes) stdout.write(`  ⚠️  ${n}\n`);
  const prof = plan.config.loop?.profile;
  stdout.write(`  Models: ${prof ? `the ${prof} profile` : "the engine's default for every role"}. \`carja loop profile\` shows them and switches by budget.\n`);
  // The watch tower lists every product the loop is on, even one already set up.
  const { addLoopProject } = await import("../loop/projects-registry.js");
  await addLoopProject(root).catch(() => {});
  if (!plan.changes.length) return 0;
  if (args.includes("--dry-run")) {
    stdout.write("\n  Nothing written (dry run).\n");
    return 0;
  }
  let yes = args.includes("--yes");
  if (!yes) {
    const interactive = confirm ?? (process.stdin.isTTY ? (q) => ask(q, { stdout }) : null);
    if (!interactive) {
      stdout.write("\n  Nothing written: re-run with --yes to apply.\n");
      return 2;
    }
    yes = await interactive("\n  Apply these changes? [y/N] ");
  }
  if (!yes) {
    stdout.write("  Nothing written.\n");
    return 1;
  }
  await writeJson(configPathOf(root), plan.config);
  await writeJson(join(root, STATE_REL), plan.state);
  stdout.write(`\n  Written: ${CONFIG}, ${STATE_REL}. Commit them with your next change.\n`);
  const { loopDoctor } = await import("./loop-doctor.js");
  await loopDoctor(root, { stdout });
  return 0;
}

export async function loopOffCommand(root, project, { stdout, stderr }) {
  if (!project) {
    stderr.write("usage: carja loop off <project> [dir]\n");
    return 1;
  }
  const config = await readJsonOr(configPathOf(root), {});
  const plan = planLoopOff({ project, config });
  for (const c of plan.changes) stdout.write(`  • ${c}\n`);
  await writeJson(configPathOf(root), plan.config);
  return 0;
}
