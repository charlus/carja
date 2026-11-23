// src/commands/merge-stack.js
//
// `carja merge-stack [project] [dir] [--backlog] [--dry-run] [--confirm <n>] [--wait <min>]`:
// merge a stacked run's MRs in order, through the forge, or the MRs a backlog
// run opened (`--backlog`, or no project named and no project stack waiting).
// The walk and the forges are src/loop/merge-stack.js, the backlog items
// src/loop/backlog-mrs.js; this file finds the items, the forges and the
// default branches.

import { readdir, readFile } from "node:fs/promises";
import { existsSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";

import { runCli, liveLockPid, readRootConfig } from "./loop.js";
import { parseLoopConfig, resolveForge } from "../loop/config.js";
import { STACK_FILE } from "../loop/stack.js";
import { RUNS_DIR, runKey, positionals, looksLikeProject } from "../loop/scope.js";
import { BEAT_LOG_DIR } from "../loop/beat-log.js";
import { defaultBranchRef } from "../loop/reconcile.js";
import { walkStack, forgeAdapter, needsUnder } from "../loop/merge-stack.js";
import { parseRiskConfig } from "../loop/risk.js";
import { effectiveRisk, ledgerItems, recordAutoMerges } from "../loop/breaker.js";
import { isOldLayout, oldLayoutMessage, statePath } from "../names.js";
import { retireLoopFiles, MESSAGES_REL } from "../loop/owner-files.js";
import { backlogEntries, branchesOfStacks, mrNumber, branchFiles, takeDefaultKeepingDocs } from "../loop/backlog-mrs.js";

const readStack = (path) => {
  try {
    return existsSync(path) ? JSON.parse(readFileSync(path, "utf8")) : null;
  } catch {
    return null;
  }
};

export async function mergeStackCommand(args, { cwd, stdout, stderr }) {
  const flagValue = (name) => {
    const i = args.indexOf(name);
    return i >= 0 ? args[i + 1] : null;
  };
  const confirmRaw = flagValue("--confirm");
  const confirm = confirmRaw == null ? null : Number(confirmRaw);
  if (confirmRaw != null && !(Number.isInteger(confirm) && confirm > 0)) {
    stderr.write("--confirm takes the item number this command printed, for example `--confirm 2`.\n");
    return 1;
  }
  const waitRaw = flagValue("--wait");
  const waitMin = waitRaw == null ? 20 : Number(waitRaw);
  if (!(waitMin >= 0)) {
    stderr.write("--wait takes a number of minutes.\n");
    return 1;
  }
  const pos = positionals(args.filter((a, i) => !["--confirm", "--wait"].includes(args[i - 1])));
  const isDir = (t) => {
    try {
      return statSync(resolve(cwd, t)).isDirectory();
    } catch {
      return false;
    }
  };
  let project = looksLikeProject(pos[0], isDir) ? pos[0] : null;
  const root = resolve(cwd, (project ? pos[1] : pos[0]) || ".");
  if (isOldLayout(root)) {
    stderr.write(oldLayoutMessage(root));
    return 1;
  }
  const common = await runCli("git", ["rev-parse", "--path-format=absolute", "--git-common-dir"], root);
  if (!common.ok) {
    stderr.write(`${root} is not a git repository.\n`);
    return 1;
  }
  const runsDir = join(common.stdout, BEAT_LOG_DIR, RUNS_DIR);

  const backlog = args.includes("--backlog");
  if (backlog && project) {
    stderr.write(`--backlog merges the MRs of backlog runs, not a project: run \`carja merge-stack ${project}\` or \`carja merge-stack --backlog\`.\n`);
    return 1;
  }
  const names = existsSync(runsDir) ? await readdir(runsDir) : [];
  // No project named: the one stack with MRs waiting, else the backlog runs' MRs.
  if (!project && !backlog) {
    const waiting = names.filter((n) => (readStack(join(runsDir, n, STACK_FILE)) ?? []).some((e) => !e.merged));
    if (waiting.length > 1) {
      stderr.write(`Several projects have MRs waiting: ${waiting.join(", ")}. Name one: \`carja merge-stack <project>\`, or \`carja merge-stack --backlog\` for the MRs of backlog runs.\n`);
      return 1;
    }
    project = waiting[0] ?? null;
  }
  if (!project) {
    const stacks = names.map((n) => readStack(join(runsDir, n, STACK_FILE)) ?? []);
    return mergeBacklog({ root, args, confirm, waitMin, stacks, stdout, stderr });
  }
  const runDir = join(runsDir, runKey(project));
  const entries = readStack(join(runDir, STACK_FILE));
  if (!entries) {
    stderr.write(`No stacked run of ${project} here: \`carja loop ${project}\` writes the stack this command merges.\n`);
    return 1;
  }
  const pid = await liveLockPid(join(runDir, "loop.lock"));
  if (pid) {
    stderr.write(`⛔  \`carja loop ${project}\` is running (pid ${pid}) and pushes to these branches. Wait for it to end, then run this again.\n`);
    return 1;
  }

  let rootConfig;
  let loopConfig;
  try {
    rootConfig = await readRootConfig(root);
    loopConfig = parseLoopConfig(rootConfig);
  } catch (e) {
    stderr.write(`Could not parse carja.config.json: ${e.message}\n`);
    return 1;
  }
  const risk = parseRiskConfig(rootConfig);
  if (risk.errors.length) {
    stderr.write(`carja.config.json: ${risk.errors.join("; ")}.\n`);
    return 1;
  }
  const { forges, defaults, problem } = await stackForges(root, loopConfig, entries);
  if (problem) {
    stderr.write(`${problem}.\n`);
    return 1;
  }
  // A3: recent reverts of items merged without the owner give medium back to them.
  const inForce = risk.configured ? await riskInForce(root, loopConfig, risk) : { risk, gitCommonDir: null };
  if (inForce.risk.breaker) stdout.write(`${inForce.risk.breaker}\n`);
  const unreviewed = risk.configured ? entries.filter((e) => !e.merged && needsUnder(inForce.risk)(e).length === 0) : [];

  const pollMs = Number(process.env.CARJA_MERGE_POLL_MS) >= 0 && process.env.CARJA_MERGE_POLL_MS !== undefined ? Number(process.env.CARJA_MERGE_POLL_MS) : 20_000;
  const r = await walkStack({
    project,
    entries,
    forges,
    defaults,
    needsOf: needsUnder(inForce.risk),
    confirm,
    dryRun: args.includes("--dry-run"),
    waitMs: waitMin * 60_000,
    pollMs,
  });
  if (inForce.gitCommonDir && !args.includes("--dry-run")) await recordAutoMerges(inForce.gitCommonDir, ledgerItems(project, unreviewed, r.merged));
  // Every MR merged: a done run's report and messages leave the workbench, to the archive.
  if (r.code === 0 && !args.includes("--dry-run")) {
    const live = await anyLoopLive(root, runsDir, names);
    const gone = await retireLoopFiles(root, project, { messages: !live });
    if (gone.report) r.lines.push(`Archived the loop report: ${gone.report}${gone.messages ? `, and ${gone.messages} loop message${gone.messages === 1 ? "" : "s"}: ${gone.messagesArchive}` : ""}.${live ? ` Another loop runs here: ${MESSAGES_REL} is left as it is.` : ""}`);
  }
  stdout.write(`${r.lines.join("\n")}\n${r.next}\n`);
  return r.code;
}

/** True when any loop of this folder holds its lock: a project run or a backlog run. */
async function anyLoopLive(root, runsDir, names) {
  for (const n of names) if (await liveLockPid(join(runsDir, n, "loop.lock"))) return true;
  return Boolean(await liveLockPid(join(root, statePath(root, "carja/1-workbench/loop.lock"))));
}

const BACKLOG_CMD = "carja merge-stack --backlog";

/**
 * The MRs a plain `carja loop` run opened, one item per backlog task, each to
 * the default branch: found on the forge (src/loop/backlog-mrs.js), merged
 * oldest first with the same walk and gates as a stack. A state MR that
 * conflicts after another item's merge takes the default branch in, both sides
 * of each Carja document kept, and is pushed through the hooks.
 */
async function mergeBacklog({ root, args, confirm, waitMin, stacks, stdout, stderr }) {
  const dryRun = args.includes("--dry-run");
  const pid = await liveLockPid(join(root, statePath(root, "carja/1-workbench/loop.lock")));
  if (pid) {
    stderr.write(`⛔  \`carja loop\` is running here (pid ${pid}) and opens these MRs. Wait for it to end, then run this again.\n`);
    return 1;
  }
  let rootConfig;
  let loopConfig;
  try {
    rootConfig = await readRootConfig(root);
    loopConfig = parseLoopConfig(rootConfig);
  } catch (e) {
    stderr.write(`Could not parse carja.config.json: ${e.message}\n`);
    return 1;
  }
  const risk = parseRiskConfig(rootConfig);
  if (risk.errors.length) {
    stderr.write(`carja.config.json: ${risk.errors.join("; ")}.\n`);
    return 1;
  }
  const { forges, defaults, problem } = await stackForges(root, loopConfig, []);
  if (problem) {
    stderr.write(`${problem}.\n`);
    return 1;
  }
  const codeRoot = loopConfig.codeDir ? join(root, loopConfig.codeDir) : null;
  const outer = await forges.outer.listOpen(defaults.outer);
  const code = forges.code && defaults.code ? await forges.code.listOpen(defaults.code) : null;
  if (!outer || (forges.code && defaults.code && !code)) {
    stderr.write(`The forge did not list the open MRs of ${!outer ? "this repository" : "the code repository"}: check its login, then run \`${BACKLOG_CMD}\` again.\n`);
    return 1;
  }
  let tasks = [];
  try {
    tasks = JSON.parse(await readFile(join(root, statePath(root, "carja/1-workbench/loop-state.json")), "utf8")).tasks ?? [];
  } catch {
    tasks = [];
  }
  const { entries, orphans } = backlogEntries({ outer, code, stackBranches: branchesOfStacks(stacks), tasks });
  for (const url of orphans) stdout.write(`A code MR with no Carja state MR is left alone: ${url}.\n`);
  if (entries.length && entries.some((e) => e.code) && !forges.code) {
    stderr.write(`the code repository ${codeRoot ?? "(loop.code_dir)"} is missing.\n`);
    return 1;
  }
  // The files each item changes, for the risk block: what it adds to the default branch.
  const gitIn = (dir) => (argv) => runCli("git", argv, dir);
  for (const e of entries) {
    const o = await branchFiles(gitIn(root), defaults.outer, e.outer.branch);
    const c = e.code ? await branchFiles(gitIn(codeRoot), defaults.code, e.code.branch) : [];
    e.files = o && c ? { outer: o, code: c } : null;
  }

  const inForce = risk.configured ? await riskInForce(root, loopConfig, risk) : { risk, gitCommonDir: null };
  if (inForce.risk.breaker) stdout.write(`${inForce.risk.breaker}\n`);
  const unreviewed = risk.configured ? entries.filter((e) => needsUnder(inForce.risk)(e).length === 0) : [];
  const pollMs = Number(process.env.CARJA_MERGE_POLL_MS) >= 0 && process.env.CARJA_MERGE_POLL_MS !== undefined ? Number(process.env.CARJA_MERGE_POLL_MS) : 20_000;
  const r = await walkStack({
    project: "backlog",
    entries,
    forges,
    defaults,
    needsOf: needsUnder(inForce.risk),
    confirm,
    dryRun,
    waitMs: waitMin * 60_000,
    pollMs,
    cmd: BACKLOG_CMD,
    keyOf: (e) => mrNumber(e.outer.url),
    closedNext: `Next: reopen the MR, or close its pair too and take the item back into the backlog, then run \`${BACKLOG_CMD}\` again.`,
    doneNext: "Next: deploy and test the product. Then `git pull` in this folder (it removes the merged items' worktrees).",
    resolveConflict: ({ side, base }) => takeDefaultKeepingDocs({ root, git: (argv, dir = root) => runCli("git", argv, dir), branch: side.branch, base }),
  });
  if (inForce.gitCommonDir && !dryRun) await recordAutoMerges(inForce.gitCommonDir, ledgerItems("backlog", unreviewed, r.merged));
  stdout.write(`${r.lines.join("\n")}\n${r.next}\n`);
  return r.code;
}

/**
 * The forges and default branches a stack is merged through, or the problem
 * that stops it. Used by this command and by `carja loop <project>`'s merge of
 * the items the owner does not review.
 */
export async function stackForges(root, loopConfig, entries) {
  const codeRoot = loopConfig.codeDir ? join(root, loopConfig.codeDir) : null;
  const repoOf = async (dir) => {
    await runCli("git", ["fetch", "-q", "origin"], dir);
    const remote = await runCli("git", ["remote", "get-url", "origin"], dir);
    const { forge } = resolveForge({ override: loopConfig.forge, remoteUrl: remote.ok ? remote.stdout : "" });
    const ref = await defaultBranchRef((a) => runCli("git", a, dir));
    return { forge: forgeAdapter(forge, (c, argv) => runCli(c, argv, dir)), base: ref ? ref.replace(/^origin\//, "") : null };
  };
  const outer = await repoOf(root);
  const code = codeRoot && existsSync(join(codeRoot, ".git")) ? await repoOf(codeRoot) : null;
  const needsCode = entries.some((e) => !e.merged && e.code);
  const problem =
    (!outer.forge && "the forge of this repository is unknown: set loop.forge to \"gh\" or \"glab\" in carja.config.json") ||
    (!outer.base && "this repository has no default branch on origin") ||
    (needsCode && !code && `the code repository ${codeRoot ?? "(loop.code_dir)"} is missing`) ||
    (needsCode && !code.forge && "the forge of the code repository is unknown") ||
    (needsCode && !code.base && "the code repository has no default branch on origin") ||
    null;
  return { forges: { outer: outer.forge, code: code?.forge ?? null }, defaults: { outer: outer.base, code: code?.base ?? null }, problem };
}

/**
 * A3: the risk setting in force for a merge without the owner, tightened by the
 * auto-merge breaker (src/loop/breaker.js) when recent reverts say so.
 */
export async function riskInForce(root, loopConfig, risk) {
  const common = await runCli("git", ["rev-parse", "--path-format=absolute", "--git-common-dir"], root);
  if (!common.ok) return { risk, gitCommonDir: null };
  const repoOf = async (key, dir) => {
    const git = (argv) => runCli("git", argv, dir);
    return { key, git, ref: await defaultBranchRef(git) };
  };
  const codeRoot = loopConfig.codeDir ? join(root, loopConfig.codeDir) : null;
  const repos = [await repoOf("outer", root), ...(codeRoot && existsSync(join(codeRoot, ".git")) ? [await repoOf("code", codeRoot)] : [])];
  return { risk: await effectiveRisk({ gitCommonDir: common.stdout, repos, risk }), gitCommonDir: common.stdout };
}
