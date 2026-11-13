// src/commands/loop-doctor.js
//
// `carja loop doctor [dir] [--beat]`: gather the facts `diagnose`
// (src/loop/doctor.js) judges. Read-only for the project, except one probe
// worktree under `.agents/.worktrees/`, where real loop worktrees live so a
// setup with relative paths behaves as in a run. The probe is always removed.
//
// --beat also runs one sandboxed agent beat that executes the verify command.
// It costs a beat, so it is opt-in. It is the only check that shows what the
// sandbox itself blocks (F6: the first prep notes were proven wrong only there).

import { readReady } from "../loop/ready-queue.js";
import { gitCommonDir } from "./loop-take.js";
import { readFile, writeFile, rm, mkdtemp } from "node:fs/promises";
import { join, dirname, relative, resolve, sep } from "node:path";
import { tmpdir } from "node:os";
import { normalizeState, resolveVerifyCommand, preflight, describeHalt } from "../loop/driver.js";
import { parseLoopConfig, resolveForge, mergeSandboxSettings, effectiveModels } from "../loop/config.js";
import { planMergeAction } from "../loop/merge.js";
import { harvestWorkQueue } from "../loop/harvester.js";
import { diagnose, renderDoctor, doctorExitCode } from "../loop/doctor.js";
import { instructionWarningsFor } from "../claude-instructions.js";
import { ignoredNestedRepos } from "../nested-repos.js";
import { packageVersion, readVersionStamp } from "../version.js";
import { exists, readJson, sh, runCli, hasNpmTestScript, configVerify, readSlices, readBlueprints } from "./loop.js";
import { harvestSlices } from "../loop/slices.js";
import { ensureWorktreesExcluded } from "../loop/worktree.js";
import { refusedNestedRepos, nestedSandboxWrites } from "../loop/nested.js";
import { readOnlyEnv } from "../loop/team-facing.js";
import { defaultBranchRef } from "../loop/reconcile.js";
import { harvestBlueprints } from "../loop/blueprint.js";
import { nextAfterDoctor } from "../next-step.js";
import { configPath as configPathOf } from "../names.js";
import { isOldLayout, oldLayoutMessage } from "../names.js";

const STATE_REL = "carja/1-workbench/loop-state.json";
const PROBE_REL = ".agents/.worktrees/carja-doctor-probe";

async function onPath(bin) {
  return (await runCli("sh", ["-c", `command -v ${bin}`], process.cwd())).ok;
}

function tail(text, lines = 8) {
  return String(text ?? "").trim().split("\n").slice(-lines).join(" | ");
}

/** The probe beat: one sandboxed claude beat that runs the verify command. */
async function probeBeat({ cwd, verifyCommand, settingsPath }) {
  const prompt =
    `Run exactly this command with the Bash tool, once, and do nothing else: ${verifyCommand}\n` +
    "Then reply with exactly two lines:\n" +
    "BEAT_EXIT=<the command's exit code, or none if it did not run>\n" +
    "BEAT_BLOCKED=<the exact refusal, approval request or sandbox denial you saw, or none>";
  const res = await runCli("claude", ["-p", prompt, "--output-format", "json", "--permission-mode", "acceptEdits", "--settings", settingsPath], cwd);
  let text = res.stdout;
  try {
    const obj = JSON.parse(res.stdout);
    if (obj && typeof obj.result === "string") text = obj.result;
  } catch {
    /* not JSON: keep raw */
  }
  const exit = text.match(/BEAT_EXIT=(\S+)/)?.[1];
  const blocked = text.match(/BEAT_BLOCKED=(.+)/)?.[1]?.trim();
  return {
    ran: true,
    exitCode: exit && /^\d+$/.test(exit) ? Number(exit) : 1,
    blocked: blocked && blocked.toLowerCase() !== "none" ? blocked : exit === "none" ? "the command did not run" : null,
    tail: tail(text, 4),
  };
}

/**
 * The Carja project that contains `path`, or null: the nearest folder above
 * it with a loop-state.json. `path` need not exist (a typo'd project name).
 */
async function enclosingProject(path) {
  for (let dir = dirname(path); dir !== dirname(dir); dir = dirname(dir)) {
    if (await exists(join(dir, STATE_REL))) return dir;
  }
  return null;
}

/** No loop-state.json at `root`: a path inside a project, or no install at all. */
async function notAProject(root, cwd) {
  const project = await enclosingProject(root);
  if (!project) {
    return [{ id: "state", level: "fail", title: `no ${STATE_REL}`, detail: "", fix: "Run `carja init` or `carja upgrade`." }];
  }
  // Relative only when the owner stands inside the project, as they usually do.
  const rel = relative(cwd, project);
  const shown = rel === "" ? "." : rel.split(sep).every((s) => s === "..") ? rel : project;
  // carja/2-backlog/project-backlog/<name>/…: they meant to choose that project.
  const [area, backlog, kind, name] = relative(project, root).split(sep);
  const named = area === "carja" && backlog === "2-backlog" && kind === "project-backlog" && name;
  const chooseOne = named && (await exists(join(project, "carja/2-backlog/project-backlog", name))) ? `carja loop on ${name}` : "carja loop on";
  return [
    {
      id: "state",
      level: "fail",
      title: `${root} is not the project folder`,
      detail: `the project folder is ${project}; doctor takes that folder, not a project inside it`,
      fix: `Run \`carja loop doctor ${shown}\`. To choose the project the loop works on: \`${chooseOne}\`.`,
    },
  ];
}

export async function loopDoctor(root, { stdout, beat = false, cwd = process.cwd() }) {
  if (isOldLayout(root)) {
    stdout.write(oldLayoutMessage(resolve(root)));
    return 1;
  }
  const statePath = join(root, STATE_REL);
  if (!(await exists(statePath))) {
    stdout.write(renderDoctor(await notAProject(resolve(root), cwd)));
    return 1;
  }
  const facts = {};
  let rawConfig = {};
  try {
    rawConfig = (await exists(configPathOf(root))) ? await readJson(configPathOf(root)) : {};
  } catch (e) {
    facts.configErrors = [`carja.config.json is not valid JSON: ${e.message}`];
  }
  const loopConfig = parseLoopConfig(rawConfig);
  facts.configErrors = [...(facts.configErrors ?? []), ...loopConfig.errors];
  facts.models = effectiveModels(loopConfig);
  facts.modelRank = loopConfig.modelRank;

  const state = normalizeState(await readJson(statePath));
  facts.state = state;
  // F12: never set up here: no work turned on, and loop-state.json still as init wrote it.
  const lb = rawConfig.loop ?? {};
  const workOn = ["blueprint", "slices", "require_ready", "code_dir"].some((k) => lb[k] !== undefined && lb[k] !== false && !(Array.isArray(lb[k]) && !lb[k].length));
  if (!workOn && state.phase === "discovery") {
    stdout.write(renderDoctor(diagnose({ notSetUp: true, state })));
    stdout.write("  Next: `carja loop on` (it lists your projects).\n");
    return 1;
  }
  const verifyCommand = resolveVerifyCommand({
    stateCommand: state.verification.command,
    configVerify: loopConfig.codeDir ? await configVerify(root, loopConfig.codeDir) : await configVerify(root),
    hasNpmTestScript: await hasNpmTestScript(root),
  });
  facts.preflightHalt = preflight(state, { verifyCommand });
  facts.preflightReason = facts.preflightHalt ? describeHalt(state, facts.preflightHalt) : null;

  facts.projectVersion = readVersionStamp(join(root, ".agents"))?.frameworkVersion ?? null;
  facts.cliVersion = packageVersion();

  const profilePath = join(root, ".agents/sandbox/claude-sandbox.settings.json");
  let profile = null;
  try {
    profile = await readJson(profilePath);
  } catch {
    profile = null;
  }
  facts.profile = {
    credentials: Boolean(profile?.sandbox?.credentials?.files?.length),
    strict: profile?.sandbox?.allowUnsandboxedCommands === false && (profile?.permissions?.allow ?? []).includes("Bash"),
  };
  facts.hostTools = { bwrap: await onPath("bwrap"), socat: await onPath("socat") };

  const claudeOk = await onPath("claude");
  facts.claude = { available: claudeOk, warnings: claudeOk ? await instructionWarningsFor(root) : [] };

  const needsPr = planMergeAction({ autonomyLevel: state.autonomy_level, phase: state.phase }) === "pr";
  if (needsPr) {
    const remote = await runCli("git", ["remote", "get-url", "origin"], root);
    const fi = resolveForge({ override: loopConfig.forge, remoteUrl: remote.ok ? remote.stdout : "" });
    let authOk = false;
    if (fi.forge) authOk = (await runCli(fi.forge, ["auth", "status", ...(fi.host ? ["--hostname", fi.host] : [])], root)).ok;
    facts.forge = { needed: true, forge: fi.forge ?? null, host: fi.host ?? null, error: fi.error ?? null, authOk };
  }

  facts.nestedRepos = loopConfig.allowNestedRepo ? [] : refusedNestedRepos(await ignoredNestedRepos(root), loopConfig.codeDir);
  // Step 7: the nested code repository, its default branch and its forge.
  const codeRoot = loopConfig.codeDir ? join(root, loopConfig.codeDir) : null;
  let codeBase = null;
  if (codeRoot) {
    const isRepo = await exists(join(codeRoot, ".git"));
    const codeGit = (a) => runCli("git", a, codeRoot);
    if (isRepo) {
      await runCli("git", ["fetch", "-q", "origin"], codeRoot);
      codeBase = await defaultBranchRef(codeGit);
    }
    const remote = isRepo ? await runCli("git", ["remote", "get-url", "origin"], codeRoot) : { ok: false };
    const fi = resolveForge({ override: loopConfig.forge, remoteUrl: remote.ok ? remote.stdout : "" });
    const authOk = fi.forge ? (await runCli(fi.forge, ["auth", "status", ...(fi.host ? ["--hostname", fi.host] : [])], codeRoot)).ok : false;
    facts.code = { dir: loopConfig.codeDir, isRepo, base: codeBase, forge: fi.forge ?? null, host: fi.host ?? null, authOk };
  }

  const read = async (rel) => ((await exists(join(root, rel))) ? readFile(join(root, rel), "utf8") : "");
  const queue = harvestWorkQueue({
    inboxMd: await read("carja/1-workbench/inbox.md"),
    backlogMd: await read("carja/2-backlog/task-backlog.md"),
    readyIds: new Set(gitCommonDir(root) ? (await readReady(gitCommonDir(root))).map((e) => e.id) : []),
    requireReady: loopConfig.requireReady,
    priorities: loopConfig.priorities,
    includeInbox: loopConfig.inbox,
  });
  const slices = loopConfig.slices === true || loopConfig.slices.length ? harvestSlices(await readSlices(root, loopConfig.slices)) : [];
  const blueprints = loopConfig.blueprint === true || loopConfig.blueprint.length ? harvestBlueprints(await readBlueprints(root, loopConfig.blueprint)) : [];
  facts.queue = { count: queue.length + slices.length + blueprints.length, requireReady: loopConfig.requireReady };

  // In the outer layout the tests run in the code repository: its .env is the one that matters.
  const envRoot = codeRoot ?? root;
  const dotenvPresent = await exists(join(envRoot, ".env"));
  const ignored = dotenvPresent && (await runCli("git", ["check-ignore", "-q", ".env"], envRoot)).ok;
  facts.dotenv = { present: Boolean(ignored), copiedBySetup: /\.env\b/.test(loopConfig.setup ?? ""), example: await exists(join(envRoot, ".env.example")) };

  for (const ci of [".gitlab-ci.yml", ".github/workflows", "bitbucket-pipelines.yml", ".circleci/config.yml"]) {
    if (await exists(join(codeRoot ?? root, ci))) {
      facts.ciFile = ci;
      break;
    }
  }

  // The probe: a fresh worktree where real loop worktrees live.
  await ensureWorktreesExcluded(root);
  const probe = join(root, PROBE_REL);
  await runCli("git", ["worktree", "remove", "--force", probe], root);
  // A test worker can write after its worktree is removed: clear what an earlier probe left.
  await rm(probe, { recursive: true, force: true });
  await runCli("git", ["worktree", "prune"], root);
  const added = await runCli("git", ["worktree", "add", "-q", "--detach", probe, "HEAD"], root);
  if (!added.ok) {
    facts.probe = { ran: true, setup: { configured: true, ok: false, reason: `could not create a worktree: ${tail(added.stderr)}` }, verify: null };
  } else {
    // Step 7: setup and verify run where a beat runs them, in a code worktree from the default branch.
    const codeProbe = codeRoot && codeBase ? join(probe, loopConfig.codeDir) : null;
    if (codeProbe) await runCli("git", ["worktree", "add", "-q", "--detach", codeProbe, codeBase], codeRoot);
    const where = codeProbe ?? probe;
    try {
      facts.probe = { ran: true, setup: { configured: Boolean(loopConfig.setup), ok: true }, verify: null };
      let setupOk = true;
      if (loopConfig.setup) {
        const t0 = Date.now();
        const r = await sh(`export CARJA_ROOT=${JSON.stringify(root)}${codeRoot ? ` CARJA_CODE_ROOT=${JSON.stringify(codeRoot)}` : ""}; ${loopConfig.setup}`, where);
        setupOk = r.exitCode === 0;
        facts.probe.setup = { configured: true, ok: setupOk, secs: Math.round((Date.now() - t0) / 1000), reason: setupOk ? null : `exit ${r.exitCode}: ${tail(r.output)}` };
      }
      if (setupOk && verifyCommand) {
        const t0 = Date.now();
        const v = await sh(verifyCommand, where);
        facts.probe.verify = { command: verifyCommand, exitCode: v.exitCode, secs: Math.round((Date.now() - t0) / 1000), tail: tail(v.output) };
        // The same command in the main checkout, where the owner pushes from.
        if (v.exitCode === 0) {
          // F8: the owner's checkout is left as it was found.
          const r = await sh(readOnlyEnv(verifyCommand), codeRoot ?? root);
          facts.rootVerify = { exitCode: r.exitCode, tail: tail(r.output) };
        }
      }
      if (beat && setupOk && verifyCommand && claudeOk && state.sandbox === "cli-native" && profile) {
        const dir = await mkdtemp(join(tmpdir(), "carja-doctor-"));
        const settingsPath = join(dir, "claude-sandbox.settings.json");
        const cg = codeRoot ? await runCli("git", ["rev-parse", "--path-format=absolute", "--git-common-dir"], codeRoot) : null;
        await writeFile(settingsPath, JSON.stringify(mergeSandboxSettings(profile, loopConfig.allowedDomains, cg?.ok ? nestedSandboxWrites(cg.stdout.trim()) : [])), "utf8");
        try {
          facts.beat = await probeBeat({ cwd: probe, verifyCommand, settingsPath });
        } finally {
          await rm(dir, { recursive: true, force: true });
        }
      }
    } finally {
      if (codeProbe) {
        await runCli("git", ["worktree", "remove", "--force", codeProbe], codeRoot);
        await runCli("git", ["worktree", "prune"], codeRoot);
      }
      await runCli("git", ["worktree", "remove", "--force", probe], root);
      await rm(probe, { recursive: true, force: true });
      await runCli("git", ["worktree", "prune"], root);
    }
  }

  const checks = diagnose(facts);
  stdout.write(renderDoctor(checks));
  if (!beat) stdout.write("  Add --beat to also run one sandboxed agent beat (costs one beat).\n");
  const code = doctorExitCode(checks);
  stdout.write(`  ${nextAfterDoctor(code === 0)}\n`);
  return code;
}
