// src/commands/merge-stack.js
//
// `carja merge-stack [project] [dir] [--dry-run] [--confirm <n>] [--wait <min>]`:
// merge a stacked run's MRs in order, through the forge. The walk and the
// forges are src/loop/merge-stack.js; this file finds the stack, the forges and
// the default branches.

import { readdir } from "node:fs/promises";
import { existsSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";

import { runCli, liveLockPid, readRootConfig } from "./loop.js";
import { parseLoopConfig, resolveForge } from "../loop/config.js";
import { STACK_FILE } from "../loop/stack.js";
import { RUNS_DIR, runKey, positionals, looksLikeProject } from "../loop/scope.js";
import { BEAT_LOG_DIR } from "../loop/beat-log.js";
import { defaultBranchRef } from "../loop/reconcile.js";
import { walkStack, forgeAdapter } from "../loop/merge-stack.js";
import { isOldLayout, oldLayoutMessage } from "../names.js";

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

  // No project named: the one stack with MRs waiting.
  if (!project) {
    const names = existsSync(runsDir) ? await readdir(runsDir) : [];
    const waiting = names.filter((n) => (readStack(join(runsDir, n, STACK_FILE)) ?? []).some((e) => !e.merged));
    if (waiting.length !== 1) {
      stderr.write(waiting.length ? `Several projects have MRs waiting: ${waiting.join(", ")}. Name one: \`carja merge-stack <project>\`.\n` : "No `carja loop <project>` run has MRs waiting here.\n");
      return 1;
    }
    project = waiting[0];
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

  let loopConfig;
  try {
    loopConfig = parseLoopConfig(await readRootConfig(root));
  } catch (e) {
    stderr.write(`Could not parse carja.config.json: ${e.message}\n`);
    return 1;
  }
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
    (needsCode && !code.base && "the code repository has no default branch on origin");
  if (problem) {
    stderr.write(`${problem}.\n`);
    return 1;
  }

  const pollMs = Number(process.env.CARJA_MERGE_POLL_MS) >= 0 && process.env.CARJA_MERGE_POLL_MS !== undefined ? Number(process.env.CARJA_MERGE_POLL_MS) : 20_000;
  const r = await walkStack({
    project,
    entries,
    forges: { outer: outer.forge, code: code?.forge ?? null },
    defaults: { outer: outer.base, code: code?.base ?? null },
    confirm,
    dryRun: args.includes("--dry-run"),
    waitMs: waitMin * 60_000,
    pollMs,
  });
  stdout.write(`${r.lines.join("\n")}\n${r.next}\n`);
  return r.code;
}
