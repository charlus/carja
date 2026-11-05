import { access, chmod, readdir } from "node:fs/promises";
import { constants as fsConstants } from "node:fs";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { join, resolve } from "node:path";
import { ignoredNestedRepos } from "../nested-repos.js";
import { writeInstalledHeartbeat } from "../heartbeat.js";

const execFileAsync = promisify(execFile);

const HOOKS_REL = ".agents/hooks";
// Files that must be executable and are safe to chmod (the git-hook entry points).
const EXECUTABLE_HOOKS = [
  "pre-commit",
  "pre-push",
  // Cleanup after `git pull`: removes merged `carja loop` worktrees.
  "post-merge",
  "verification-stop-hook.sh",
  // Opt-in Claude Code PreToolUse hook. Not wired by core.hooksPath (that is
  // git's), but it still needs the bit set for settings.json to invoke it.
  "pretooluse-no-bypass.sh",
  "pretooluse-fact-gate.sh",
  "lib.sh",
];

async function exists(path) {
  try {
    await access(path, fsConstants.F_OK);
    return true;
  } catch {
    return false;
  }
}

async function git(args, cwd) {
  try {
    const { stdout } = await execFileAsync("git", args, { cwd });
    return { ok: true, stdout: stdout.trim() };
  } catch (error) {
    return { ok: false, stdout: "", error };
  }
}

/** Hook files in the repository's own hooks folder that git would run (not `*.sample`). */
async function liveGitHooks(repoDir) {
  const dir = await git(["rev-parse", "--path-format=absolute", "--git-path", "hooks"], repoDir);
  if (!dir.ok) return [];
  let names;
  try {
    names = await readdir(dir.stdout);
  } catch {
    return [];
  }
  return names.filter((n) => !n.endsWith(".sample"));
}

/**
 * The outer layout: each gitignored nested code repository gets core.hooksPath
 * set to the outer `.agents/hooks` by absolute path, so the gates judge the
 * code commits too. The hooks then read the library, the config ("repos") and
 * the ship-log from the outer repository. Local git config only: nothing is
 * committed to the team's repository. A repository with its own hooks (a
 * foreign hooksPath, or live files in .git/hooks) is left alone and reported.
 *
 * @returns {Promise<Array<{repo: string, state: "wired"|"unwired"|"custom"|"own-hooks", detail?: string}>>}
 */
export async function wireNestedRepos(targetDir, { uninstall = false } = {}) {
  const ours = join(resolve(targetDir), HOOKS_REL);
  const results = [];
  for (const entry of await ignoredNestedRepos(targetDir)) {
    const repo = entry.replace(/\/+$/, "");
    const dir = join(targetDir, repo);
    const current = await git(["config", "--local", "--get", "core.hooksPath"], dir);
    const path = current.ok ? current.stdout.replace(/\/+$/, "") : "";
    if (uninstall) {
      if (path === ours) await git(["config", "--local", "--unset", "core.hooksPath"], dir);
      results.push({ repo, state: "unwired" });
    } else if (path && path !== ours) {
      results.push({ repo, state: "custom", detail: path });
    } else if (!path && (await liveGitHooks(dir)).length) {
      results.push({ repo, state: "own-hooks", detail: (await liveGitHooks(dir)).join(", ") });
    } else {
      const set = path === ours ? { ok: true } : await git(["config", "--local", "core.hooksPath", ours], dir);
      if (set.ok) await writeInstalledHeartbeat(dir);
      results.push({ repo, state: set.ok ? "wired" : "unwired" });
    }
  }
  return results;
}

function reportNested(results, stdout) {
  for (const r of results) {
    if (r.state === "wired") stdout.write(`✅ ${r.repo}/: code commits and pushes are gated (core.hooksPath → outer ${HOOKS_REL}).\n`);
    else if (r.state === "custom")
      stdout.write(`⚠️  ${r.repo}/: core.hooksPath is already '${r.detail}'. Left as-is, so its code is NOT gated.\n`);
    else if (r.state === "own-hooks")
      stdout.write(
        `⚠️  ${r.repo}/: has its own git hooks (${r.detail}). Left as-is, so its code is NOT gated.\n` +
          `   To gate it anyway: git -C ${r.repo} config core.hooksPath <this folder>/${HOOKS_REL}\n`,
      );
  }
  if (results.some((r) => r.state === "wired"))
    stdout.write(
      `   Set each repository's push check in carja.config.json: carja verify --repo <dir> --set "<command>".\n` +
        "   The path is absolute: run `carja install-hooks` again if you move this folder.\n",
    );
}

/**
 * Install (or uninstall) Carja's deterministic git hooks by pointing
 * git's core.hooksPath at .agents/hooks. Never clobbers a foreign hooksPath.
 * In the outer layout, the nested code repositories are wired too.
 */
export async function installHooksCommand(args, { cwd, stdout, stderr }) {
  const uninstall = args.includes("--uninstall");
  const positional = args.find((a) => !a.startsWith("-"));
  const targetDir = resolve(cwd, positional || ".");

  const inRepo = await git(["rev-parse", "--is-inside-work-tree"], targetDir);
  if (!inRepo.ok || inRepo.stdout !== "true") {
    stderr.write("Not a git repository — nothing to wire. Run this inside your project's git repo.\n");
    return 1;
  }

  const hooksDir = join(targetDir, HOOKS_REL);
  if (!(await exists(hooksDir))) {
    stderr.write(`No ${HOOKS_REL}/ found. Run 'carja init' or 'carja upgrade' first.\n`);
    return 1;
  }

  const current = await git(["config", "--local", "--get", "core.hooksPath"], targetDir);
  const currentPath = current.ok ? current.stdout : "";

  if (uninstall) {
    if (currentPath === HOOKS_REL) {
      await git(["config", "--local", "--unset", "core.hooksPath"], targetDir);
      stdout.write("✅ Carja hooks disabled (core.hooksPath unset).\n");
    } else {
      stdout.write("ℹ️  Carja hooks were not the active hooksPath; nothing changed.\n");
    }
    for (const r of await wireNestedRepos(targetDir, { uninstall: true })) stdout.write(`✅ ${r.repo}/: hooks unwired.\n`);
    return 0;
  }

  // Make the hook entry points executable (copy may drop the bit).
  for (const name of EXECUTABLE_HOOKS) {
    const p = join(hooksDir, name);
    if (await exists(p)) {
      try {
        await chmod(p, 0o755);
      } catch {
        /* best-effort */
      }
    }
  }

  if (currentPath && currentPath !== HOOKS_REL) {
    stdout.write(
      `⚠️  core.hooksPath is already set to '${currentPath}'. Leaving it as-is.\n` +
        `   To use Carja's hooks, wire them into that path, or run:\n` +
        `     git config --local core.hooksPath ${HOOKS_REL}\n`
    );
    reportNested(await wireNestedRepos(targetDir), stdout);
    return 0;
  }

  const set = await git(["config", "--local", "core.hooksPath", HOOKS_REL], targetDir);
  if (!set.ok) {
    stderr.write("Failed to set core.hooksPath.\n");
    return 1;
  }
  // The floor for `carja status`: commits from before this are not judged.
  await writeInstalledHeartbeat(targetDir);

  const present = new Set(await readdir(hooksDir));
  const wired = ["pre-commit", "pre-push", "post-merge"].filter((h) => present.has(h));
  stdout.write(
    `✅ Carja enforcement hooks enabled (core.hooksPath → ${HOOKS_REL}): ${wired.join(", ")}\n` +
      `   Test-Driven Law on commit, Verification Iron Law on push${present.has("post-merge") ? ", merged loop worktrees cleaned up on pull" : ""}. Bypass is logged; see ${HOOKS_REL}/README.md.\n`
  );
  reportNested(await wireNestedRepos(targetDir), stdout);
  return 0;
}
