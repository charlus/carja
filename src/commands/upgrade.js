import { access, cp, mkdir, rename, rm, readFile, writeFile } from "node:fs/promises";
import { constants as fsConstants } from "node:fs";
import { fileURLToPath } from "node:url";
import { join, resolve } from "node:path";
import { planUpdate, executeUpdate } from "../update.js";
import { renameRecursive, updateChecksumsKeys, renameNumberedFolders, renameFrameworkNames } from "../kebab.js";
import { generateClaudeCommands, generateClaudeSkills } from "../claude-commands.js";
import { installHooksCommand } from "./install-hooks.js";
import { ensureVerifyCommand } from "../verify-config.js";
import { normalizeState } from "../loop/driver.js";
import { packageVersion, readVersionStamp, writeVersionStamp, detectShape } from "../version.js";
import { createBackup, restoreBackup, ensureGitignore } from "../backup.js";
import { buildFrameworkBlock, renderRootAgentsMd, extractStubNotes, appendMovedNotes } from "../agents-md.js";
import { instructionWarningsFor } from "../claude-instructions.js";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { designMigrationHint } from "./design.js";
import { ensureUnionMerge } from "../gitattributes.js";
import { needsRename, renameInstall, renderRenameReport } from "../rename-migration.js";

const execFileAsync = promisify(execFile);

/**
 * The files an upgrade writes, and so the only files its commit may contain.
 * Anything outside this list is the user's, and is never swept in.
 */
const FRAMEWORK_PATHS = [
  ".agents", "AGENTS.md", "CLAUDE.md", "GEMINI.md", "CHANGELOG.md", ".claude/commands",
  "carja/5-templates", "carja/1-workbench/loop-state.json",
  "carja.config.json", ".gitignore", ".gitattributes",
];

async function git(args, cwd, env) {
  try {
    const { stdout } = await execFileAsync("git", args, {
      cwd, maxBuffer: 1 << 24, env: env ? { ...process.env, ...env } : process.env,
    });
    return { ok: true, stdout: stdout.trim() };
  } catch (e) {
    return { ok: false, stdout: String(e.stdout ?? "").trim(), stderr: String(e.stderr ?? "").trim() };
  }
}

/**
 * The repo's state BEFORE the upgrade writes anything, so the commit step can
 * tell the user's uncommitted edits from the upgrade's own.
 */
async function gitSnapshot(dir) {
  const inRepo = await git(["rev-parse", "--is-inside-work-tree"], dir);
  if (!inRepo.ok || inRepo.stdout !== "true") return { repo: false };
  const head = (await git(["rev-parse", "--verify", "-q", "HEAD"], dir)).ok;
  const busy = [];
  for (const marker of ["MERGE_HEAD", "CHERRY_PICK_HEAD", "REVERT_HEAD", "rebase-merge", "rebase-apply"]) {
    const where = (await git(["rev-parse", "--git-path", marker], dir)).stdout;
    if (where && (await exists(resolve(dir, where)))) busy.push(marker);
  }
  // F23: untrimmed and -z, so each entry is exact. git() trims its output, and
  // a trimmed ` M path` line lost the path's first letter to slice(3).
  const status = await execFileAsync("git", ["status", "--porcelain", "-z", "--", ...FRAMEWORK_PATHS], { cwd: dir, maxBuffer: 1 << 24 })
    .catch(() => ({ stdout: "" }));
  const records = String(status.stdout).split("\0");
  const dirty = [];
  for (let i = 0; i < records.length; i++) {
    const r = records[i];
    if (r.length < 4) continue;
    dirty.push(r.slice(3));
    if (r[0] === "R" || r[0] === "C") i++; // a rename's next record is its old path
  }
  // Each dirty file's content now, so the commit step can tell whether the upgrade touched it.
  const before = {};
  for (const p of dirty) before[p] = await contentId(dir, p);
  return { repo: true, head, busy, dirty, before };
}

/** The blob id of a file's content, or null when it is gone or is not a file. */
async function contentId(dir, p) {
  const r = await git(["hash-object", "--", p], dir);
  return r.ok ? r.stdout : null;
}

/**
 * Where the upgrade commit may go. A repository with a remote merges through
 * merge requests, so the commit goes on its own branch, cut from the default
 * branch, never on the default branch itself (it sat unpushed for a week) and
 * never on a feature branch (it rode that feature's merge request). Without a
 * remote, the current branch, as before.
 *
 * @returns {Promise<{mode: "here"} | {mode: "branch", branch: string} | {mode: "refuse", why: string}>}
 */
async function upgradeTarget(targetDir, version) {
  const remotes = (await git(["remote"], targetDir)).stdout.split("\n").filter(Boolean);
  if (!remotes.length) return { mode: "here" };
  const remote = remotes.includes("origin") ? "origin" : remotes[0];
  let main = (await git(["symbolic-ref", "--short", `refs/remotes/${remote}/HEAD`], targetDir)).stdout.replace(`${remote}/`, "");
  if (!main) {
    for (const candidate of ["main", "master"]) {
      if ((await git(["rev-parse", "--verify", "-q", `refs/remotes/${remote}/${candidate}`], targetDir)).ok) main = candidate;
    }
  }
  const current = (await git(["symbolic-ref", "--short", "-q", "HEAD"], targetDir)).stdout;
  if (!current) return { mode: "refuse", why: "HEAD is detached" };
  if (!main) return { mode: "here" };
  if (current !== main) {
    return {
      mode: "refuse",
      why:
        `you are on ${current}, so the upgrade would ride that branch's merge request. ` +
        `Switch to ${main} and run carja upgrade again: it commits on its own branch`,
    };
  }
  const branch = `chore/carja-${version}`;
  if ((await git(["rev-parse", "--verify", "-q", `refs/heads/${branch}`], targetDir)).ok) {
    return { mode: "refuse", why: `branch ${branch} already exists` };
  }
  return { mode: "branch", branch, remote };
}

/**
 * Commit exactly the framework files the upgrade wrote — with the protected-
 * path waiver set, so the gate still logs it — or, when that is not safe, print
 * the one command that does it.
 *
 * WHY. An upgrade rewrites the enforcement hooks, so its commit needs
 * CARJA_NO_PROTECTED. Making every user discover and type that was the
 * friction the maintainer asked to remove. The push needs nothing: pre-push
 * recognises the official pre-commit it ships with.
 */
async function commitUpgrade({ targetDir, version, snap, noCommit, structural, extraPaths = [], stdout, onBranch = null }) {
  if (!snap.repo) return;
  const existing = [];
  for (const p of FRAMEWORK_PATHS) {
    // A path the upgrade deleted (the old CLAUDE.md / GEMINI.md stubs) still
    // belongs in the commit while git tracks it, so the deletion is recorded.
    if (!(await exists(join(targetDir, p))) && !(await git(["ls-files", "--", p], targetDir)).stdout) continue;
    // An explicitly named ignored path makes `git add` fail outright.
    if ((await git(["check-ignore", "-q", "--", p], targetDir)).ok) continue;
    existing.push(p);
  }
  // Generated `.claude/skills/<name>` shims, one path each: never the whole
  // folder, which may hold the user's own skills. A removed shim counts only
  // if git tracks it, or `git add` would fail on the missing path.
  for (const p of extraPaths) {
    if ((await exists(join(targetDir, p))) || (await git(["ls-files", "--", p], targetDir)).stdout) existing.push(p);
  }
  const paths = existing.join(" ");
  const message = `chore: upgrade Carja to ${version}`;
  const manual = structural
    ? `git add -A && CARJA_NO_PROTECTED="carja upgrade" git commit -m "${message}"`
    : `git add -A -- ${paths} && CARJA_NO_PROTECTED="carja upgrade" git commit -m "${message}" -- ${paths}`;
  const printManual = (why) => {
    stdout.write(`\n   Commit it with one command${why ? ` (${why})` : ""}:\n`);
    stdout.write(`     ${manual}\n`);
    stdout.write("   The push needs no waiver.\n");
  };

  if (noCommit) return printManual("--no-commit");
  if (!snap.head) return printManual("the repo has no commits yet");
  if (snap.busy.length) return printManual(`a ${snap.busy.join("/")} is in progress`);
  if (structural) return printManual(structural);
  // F23: the owner's uncommitted files stay out of the commit. When the upgrade
  // left them as they were, it commits around them. When it changed them too,
  // their edit and the upgrade's are mixed: the owner looks first.
  const touched = [];
  for (const p of snap.dirty) if ((await contentId(targetDir, p)) !== snap.before[p]) touched.push(p);
  if (touched.length) {
    return printManual(
      `you had uncommitted changes in ${touched.join(", ")}, and the upgrade changed ${touched.length === 1 ? "it" : "them"} too. ` +
        "Check them first: the command commits them with the upgrade"
    );
  }
  const excluded = snap.dirty.map((p) => `:(exclude)${p}`);

  if (!existing.length) return;
  // The rename step (7.0.0) already switched to the upgrade's branch.
  const target = onBranch ?? (await upgradeTarget(targetDir, version));
  if (target.mode === "refuse") return printManual(target.why);
  if (target.mode === "branch" && !onBranch) {
    const sw = await git(["switch", "-q", "-c", target.branch], targetDir);
    if (!sw.ok) return printManual(`could not create branch ${target.branch}`);
  }
  const add = await git(["add", "-A", "--", ...existing, ...excluded], targetDir);
  if (!add.ok) return printManual(`git add failed: ${add.stderr.split("\n")[0]}`);
  if ((await git(["diff", "--cached", "--quiet", "--", ...existing, ...excluded], targetDir)).ok) {
    stdout.write("\n   Nothing to commit — the framework files were already current.\n");
    return;
  }
  // `-- paths` commits ONLY these paths, so anything else the user had staged
  // stays staged and out of this commit.
  // The waiver is recorded in the commit itself too: during the move to Carja
  // the 6.x hooks judge this commit and log it to a ship-log that has moved.
  const commit = await git(["commit", "-q", "-m", message, "-m", `Hook waiver (Protected): carja upgrade to ${version} rewrites the enforcement hooks.`, "--", ...existing, ...excluded], targetDir, {
    CARJA_NO_PROTECTED: `carja upgrade to ${version}`,
  });
  if (!commit.ok) {
    const why = (commit.stdout + "\n" + commit.stderr).split("\n").map((l) => l.trim()).filter(Boolean).slice(-1)[0];
    return printManual(`the commit was refused${why ? `: ${why}` : ""}`);
  }
  const sha = (await git(["rev-parse", "--short", "HEAD"], targetDir)).stdout;
  // F7: the upgrade does need the protected-path waiver. It sets and logs it
  // itself, so say that, instead of "No waiver needed" followed by a waiver commit.
  const waiverSha = await commitWaiverLine(targetDir, version);
  const waiverNote = waiverSha
    ? ` Its protected-path waiver is logged in the ship-log (commit ${waiverSha}): you type nothing.`
    : "";
  const leftOut = snap.dirty.length ? `   Your uncommitted changes in ${snap.dirty.join(", ")} stay uncommitted, out of this commit.\n` : "";
  if (target.mode === "branch") {
    stdout.write(
      `\n   ✅ Committed the upgrade as ${sha} on its own branch, ${target.branch}.${waiverNote}\n` + leftOut +
        `   Push it and open a merge request:  git push -u ${target.remote} ${target.branch}\n` +
        "   You are now on that branch. Start new work from the default branch once it is merged.\n",
    );
    return;
  }
  stdout.write(`\n   ✅ Committed the upgrade as ${sha}.${waiverNote} Push as usual.\n${leftOut}`);
}

/**
 * The upgrade commit runs with a waiver, and the hook logs that waiver to the
 * ship-log AFTER the commit is staged, so the line is left uncommitted. Commit
 * it, but only when it is the ship-log's sole change: anything else there is
 * the user's, and stays theirs.
 */
async function commitWaiverLine(targetDir, version) {
  const log = "carja/0-compass/ship-log.md";
  const diff = await git(["diff", "-U0", "--", log], targetDir);
  if (!diff.ok) return null;
  const changed = diff.stdout.split("\n").filter((l) => /^[+-]/.test(l) && !/^(\+\+\+|---) /.test(l));
  if (!changed.length || !changed.every((l) => /^\+- \[[\d-]+ [\d:]+\] Hook waiver \(/.test(l))) return null;
  const c = await git(["commit", "-q", "-m", `chore: log the Carja ${version} upgrade waiver`, "--", log], targetDir);
  if (!c.ok) return null;
  return (await git(["rev-parse", "--short", "HEAD"], targetDir)).stdout || null;
}

function getTemplateDir() {
  return fileURLToPath(new URL("../../templates", import.meta.url));
}

async function exists(path) {
  try {
    await access(path, fsConstants.F_OK);
    return true;
  } catch {
    return false;
  }
}

// Framework numbered folders that may sit at the project root in a very old (V4) install.
const ROOT_FOLDER_NAMES = [
  "0-Compass", "1-Workbench", "2-Backlog", "3-Product-Areas", "4-Context", "5-Templates", "6-Archive",
  "0-compass", "1-workbench", "2-backlog", "3-product-areas", "4-context", "5-templates", "6-archive",
];

function planCounts(plan) {
  const c = { COPY: 0, UPDATE: 0, KEEP: 0, AVAILABLE: 0, REMOVE: 0 };
  for (const item of plan) c[item.action] = (c[item.action] || 0) + 1;
  return c;
}

export async function upgradeCommand(args, { cwd, stdout, stderr }) {
  const dryRun = args.includes("--dry-run");
  const noBackup = args.includes("--no-backup");
  const noCommit = args.includes("--no-commit");
  const force = args.includes("--force");
  const positional = args.filter((a) => !a.startsWith("--"));
  const targetDir = resolve(cwd, positional[0] || ".");

  const agentsDir = join(targetDir, ".agents");
  const legacyAgentDir = join(targetDir, ".agent");
  const carjaDir = join(targetDir, "carja");
  const legacyConductorDir = join(targetDir, ".conductor");
  const templateDir = getTemplateDir();
  const sourceAgentsDir = join(templateDir, ".agents");
  const source5Templates = join(templateDir, "carja", "5-templates");
  const checksumPath = join(agentsDir, ".checksums.json");
  const target5Templates = join(carjaDir, "5-templates");
  const loopStateRel = join("carja", "1-workbench", "loop-state.json");

  try {
    // ---- Step R: a 6.x install moves from Conductor to Carja first ----
    // Everything below reads carja/ and carja.config.json, so this runs before
    // anything is read. Two commits of its own, on the upgrade's branch.
    let onBranch = null;
    let renamedUncommitted = false;
    if (needsRename(targetDir)) {
      const version = packageVersion();
      if (dryRun) {
        const plan = await renameInstall(targetDir, { version, dryRun: true });
        if (plan.refused) {
          stderr.write(`The rename to Carja cannot run now: ${plan.refused.join("; ")}.\nNothing was changed.\n`);
          return 1;
        }
        stdout.write(renderRenameReport(plan).replace("Step R: Rename", "Step R (dry run): would rename"));
      } else {
        const inRepo = (await git(["rev-parse", "--is-inside-work-tree"], targetDir)).stdout === "true";
        let commit = inRepo && !noCommit && (await git(["rev-parse", "--verify", "-q", "HEAD"], targetDir)).ok;
        if (commit) {
          const target = await upgradeTarget(targetDir, version);
          if (target.mode === "refuse") {
            stderr.write(`The rename to Carja cannot run now: ${target.why}.\nNothing was changed.\n`);
            return 1;
          }
          const pre = await renameInstall(targetDir, { version, dryRun: true });
          if (pre.refused) {
            stderr.write(`The rename to Carja cannot run now: ${pre.refused.join("; ")}.\nNothing was changed.\n`);
            return 1;
          }
          if (target.mode === "branch") {
            const sw = await git(["switch", "-q", "-c", target.branch], targetDir);
            if (!sw.ok) {
              stderr.write(`Could not create branch ${target.branch}. Nothing was changed.\n`);
              return 1;
            }
            onBranch = target;
          }
        }
        const common = inRepo ? (await git(["rev-parse", "--path-format=absolute", "--git-common-dir"], targetDir)).stdout : null;
        let report;
        try {
          report = await renameInstall(targetDir, { version, commit, gitCommonDir: common });
        } catch (e) {
          // renameInstall put the files back; the branch goes too.
          if (onBranch) {
            await git(["switch", "-q", "-"], targetDir);
            await git(["branch", "-q", "-D", onBranch.branch], targetDir);
          }
          stderr.write(`The rename to Carja failed and was undone, nothing changed: ${e.message}\n`);
          return 1;
        }
        if (report.refused) {
          stderr.write(`The rename to Carja cannot run now: ${report.refused.join("; ")}.\nNothing was changed.\n`);
          return 1;
        }
        stdout.write(renderRenameReport(report));
        if (!commit && inRepo) renamedUncommitted = "the project was renamed from conductor/ to carja/ and nothing is committed yet";
      }
    }

    const hasAgents = await exists(agentsDir);
    const hasLegacyAgent = await exists(legacyAgentDir);
    const hasCarja = await exists(carjaDir);
    const hasLegacyConductor = await exists(legacyConductorDir);
    const rootFolders = [];
    for (const f of ROOT_FOLDER_NAMES) if (await exists(join(targetDir, f))) rootFolders.push(f);
    const hasRootFolders = rootFolders.length > 0;

    if (!hasAgents && !hasLegacyAgent && !hasRootFolders && !hasLegacyConductor && !hasCarja) {
      stderr.write(
        "This doesn't look like a Carja project.\n" +
          "No .agents/, .agent/, or numbered folders found.\n" +
          'Run "carja init" to set up a new project instead.\n'
      );
      return 1;
    }

    // An `.agents/` folder alone does not make a Carja project: it is the
    // cross-tool convention, and some repos use it for their own agents. With
    // no carja/ layout and no version stamp, an upgrade would turn such a
    // repo into a full Carja install (workflows, hooks, a new carja/).
    if (!hasCarja && !hasLegacyConductor && !hasRootFolders && !readVersionStamp(agentsDir) && !force) {
      stderr.write(
        "This repo has .agents/ but no carja/ folder and no Carja version stamp.\n" +
          "It looks like an agent-only repo, not a Carja project.\n" +
          "Upgrading would install every workflow and the git hooks, create carja/,\n" +
          "and write a Carja framework block into the root AGENTS.md.\n" +
          "If that is what you want, re-run with --force. Nothing was changed.\n"
      );
      return 1;
    }

    const version = packageVersion();
    // Core/default skills always land on upgrade (like rules/workflows), so new
    // primitives arrive even if they postdate the user's .selections.json.
    let coreSkills = new Set();
    const retired = new Set(JSON.parse(await readFile(new URL("../retired-framework-files.json", import.meta.url), "utf8")).files);
    try {
      const reg = JSON.parse(await readFile(join(sourceAgentsDir, "registry.json"), "utf8"));
      coreSkills = new Set((reg.skills || []).filter((s) => s.default || s.category === "core").map((s) => s.dir));
    } catch { /* registry unreadable → fall back to selections only */ }

    const stamp = readVersionStamp(agentsDir);
    const shape = stamp ? `stamped ${stamp.frameworkVersion}` : detectShape(targetDir);
    const doesStructuralMigration = hasLegacyAgent || hasLegacyConductor || hasRootFolders;

    stdout.write(`🎼 Carja Framework — Upgrade${dryRun ? " (dry run)" : ""}\n\n`);
    stdout.write(`  Detected: ${shape}  →  target ${version}\n`);
    if (stamp && stamp.frameworkVersion === version && !doesStructuralMigration) {
      stdout.write(`  Already on ${version}; refreshing derived artifacts only.\n`);
    }

    // ---- Dry run: compute and print the plan, write nothing ----
    if (dryRun) {
      if (doesStructuralMigration) {
        stdout.write(`  Structural: normalize legacy layout (`);
        stdout.write([hasLegacyAgent && ".agent/", hasLegacyConductor && ".conductor/", hasRootFolders && "root numbered folders"].filter(Boolean).join(", "));
        stdout.write(")\n");
      }
      stdout.write(`  Backup:   .carja-backup/<ts>/ (.agents/${(await exists(target5Templates)) ? ", carja/5-templates/" : ""}${doesStructuralMigration ? ", legacy dirs" : ""})\n`);
      if (hasAgents) {
        const c = planCounts(planUpdate(sourceAgentsDir, agentsDir, checksumPath, { coreSkills, retired }));
        stdout.write(`  .agents/  REPLACE ${c.UPDATE} framework · ADD ${c.COPY} new · PRUNE ${c.REMOVE} dropped · CARRY ${c.KEEP} custom · ${c.AVAILABLE} optional (not selected)\n`);
      } else {
        stdout.write(`  .agents/  fresh install\n`);
      }
      if (await exists(target5Templates)) {
        const c5 = planCounts(planUpdate(source5Templates, target5Templates, ""));
        stdout.write(`  carja/5-templates/  REFRESH ${c5.UPDATE + c5.COPY} · CARRY ${c5.KEEP} custom\n`);
      }
      const lsPath = join(targetDir, loopStateRel);
      stdout.write(`  ${loopStateRel}  ${(await exists(lsPath)) ? "MIGRATE schema → v2" : "CREATE"}\n`);
      stdout.write(`  Preserve: carja/ knowledge (0-compass,2-backlog,3-product-areas,4-context,6-archive) untouched\n`);
      stdout.write(`  AGENTS.md: write the framework block (keep your text); move notes from CLAUDE.md/GEMINI.md into it, then remove them\n`);
      stdout.write(`  Then: regenerate .claude/commands, git hooks; stamp ${version}\n`);
      stdout.write(`\nNo changes written (dry run). Re-run without --dry-run to apply.\n`);
      return 0;
    }

    // Before anything is written: what in the framework files is already the
    // user's own uncommitted work? The commit step must never sweep it in.
    const snap = await gitSnapshot(targetDir);

    // ---- Backup first (unless opted out) ----
    let backup = null;
    let renamedKnowledge = 0;
    let skillPaths = [];
    const backupPaths = [];
    if (hasAgents) backupPaths.push(".agents");
    if (await exists(target5Templates)) backupPaths.push(join("carja", "5-templates"));
    if (await exists(join(targetDir, loopStateRel))) backupPaths.push(loopStateRel);
    for (const stub of ["AGENTS.md", "CLAUDE.md", "GEMINI.md"]) {
      if (await exists(join(targetDir, stub))) backupPaths.push(stub);
    }
    if (doesStructuralMigration) {
      if (hasLegacyAgent) backupPaths.push(".agent");
      if (hasLegacyConductor) backupPaths.push(".conductor");
      for (const f of rootFolders) backupPaths.push(f);
    }
    if (!noBackup && backupPaths.length) {
      backup = createBackup(targetDir, backupPaths);
      ensureGitignore(targetDir);
      stdout.write(`\nStep 0: Backed up ${backup.copied.length} path(s) → ${backup.backupRoot.replace(targetDir + "/", "")}\n`);
    }

    // Everything past here is restorable from the backup on failure.
    try {
      // ---- Step 1: Structural migrations (legacy layout → current) ----
      stdout.write("\nStep 1: Structural migrations...\n");
      if (hasLegacyAgent && !hasAgents) {
        await rename(legacyAgentDir, agentsDir);
        stdout.write("  📁 .agent/ → .agents/\n");
      } else if (hasLegacyAgent && hasAgents) {
        await rm(legacyAgentDir, { recursive: true, force: true });
      }
      if (hasLegacyConductor && !hasCarja) {
        await rename(legacyConductorDir, carjaDir);
        stdout.write("  📁 .conductor/ → carja/\n");
      } else if (hasLegacyConductor && hasCarja) {
        await rm(legacyConductorDir, { recursive: true, force: true });
      }
      if (hasRootFolders) {
        await mkdir(carjaDir, { recursive: true });
        for (const folder of rootFolders) {
          const src = join(targetDir, folder);
          const dst = join(carjaDir, folder);
          if (!(await exists(dst))) {
            await cp(src, dst, { recursive: true });
            await rm(src, { recursive: true, force: true });
            stdout.write(`  📁 ${folder}/ → carja/${folder}/\n`);
          } else {
            stdout.write(`  ⚠️  Left ${folder}/ at root (carja/${folder}/ already exists — merge manually)\n`);
          }
        }
      } else if (!(await exists(carjaDir))) {
        await cp(join(templateDir, "carja"), carjaDir, { recursive: true });
        stdout.write("  ✅ Created carja/ from templates\n");
      }

      // ---- Step 2: Normalize casing (framework names only) ----
      stdout.write("\nStep 2: Normalizing framework names to kebab-case...\n");
      await renameRecursive(agentsDir, stdout);        // all of .agents/ is framework
      await renameNumberedFolders(carjaDir, stdout); // only the numbered folders, no user files
      renamedKnowledge = await renameFrameworkNames(carjaDir, join(templateDir, "carja"), stdout);
      if (await exists(target5Templates)) await renameRecursive(target5Templates, stdout);
      await updateChecksumsKeys(checksumPath);

      // ---- Step 3: Replace .agents/ framework files (carry forward custom) ----
      stdout.write("\nStep 3: Upgrading .agents/ instructions...\n");
      const plan = planUpdate(sourceAgentsDir, agentsDir, checksumPath, { coreSkills, retired });
      const c = planCounts(plan);
      executeUpdate(plan, sourceAgentsDir, agentsDir, checksumPath);
      const retiredRemoved = plan.filter((i) => i.reason === "retired framework file").map((i) => i.relativePath);
      stdout.write(`  ✅ Replaced ${c.UPDATE} framework files, added ${c.COPY} new, pruned ${c.REMOVE} dropped upstream, carried ${c.KEEP} custom (${c.AVAILABLE} optional not installed).\n`);
      if (retiredRemoved.length) {
        stdout.write(`  🗑️  Removed ${retiredRemoved.length} framework file(s) Carja no longer ships (kept in the backup):\n`);
        for (const rel of retiredRemoved) stdout.write(`       .agents/${rel}\n`);
      }

      // ---- Step 4: Refresh carja/5-templates (framework scaffolding) ----
      stdout.write("\nStep 4: Refreshing carja/5-templates/...\n");
      await mkdir(target5Templates, { recursive: true });
      const plan5 = planUpdate(source5Templates, target5Templates, "");
      const c5 = planCounts(plan5);
      executeUpdate(plan5, source5Templates, target5Templates, "", { writeChecksums: false });
      stdout.write(`  ✅ Refreshed ${c5.UPDATE + c5.COPY} template files, carried ${c5.KEEP} custom.\n`);

      // ---- Step 5: Migrate loop-state.json schema (v1 → v2) ----
      stdout.write("\nStep 5: Loop-state schema...\n");
      const targetStateFile = join(carjaDir, "1-workbench", "loop-state.json");
      await mkdir(join(carjaDir, "1-workbench"), { recursive: true });
      if (await exists(targetStateFile)) {
        let raw = {};
        try { raw = JSON.parse(await readFile(targetStateFile, "utf8")); } catch { raw = {}; }
        const wasV2 = raw.schema_version === 2;
        const migrated = normalizeState(raw);
        await writeFile(targetStateFile, JSON.stringify(migrated, null, 2) + "\n");
        stdout.write(wasV2 ? "  ✅ loop-state.json already v2 (normalized).\n" : "  ✅ Migrated loop-state.json → schema v2.\n");
      } else {
        const templateStateFile = join(templateDir, "carja", "1-workbench", "loop-state.json");
        if (await exists(templateStateFile)) {
          await cp(templateStateFile, targetStateFile);
          stdout.write("  ✅ Created loop-state.json.\n");
        }
      }

      // ---- Step 6: Root AGENTS.md ----
      // The one instruction file every harness loads. Its framework block is
      // generated from the .agents/ just installed. The old CLAUDE.md / GEMINI.md
      // stubs go: Claude Code reads AGENTS.md only when no CLAUDE.md exists, and
      // a CLAUDE.md here would also hide a team repo's own AGENTS.md (F20). The
      // user's notes in them move into AGENTS.md; both were backed up in Step 0.
      stdout.write("\nStep 6: Root AGENTS.md...\n");
      const agentsMdPath = join(targetDir, "AGENTS.md");
      const hadAgentsMd = await exists(agentsMdPath);
      let agentsMd = renderRootAgentsMd(
        hadAgentsMd ? await readFile(agentsMdPath, "utf8") : null,
        await buildFrameworkBlock(join(targetDir, ".agents")),
      );
      for (const stub of ["CLAUDE.md", "GEMINI.md"]) {
        const stubPath = join(targetDir, stub);
        if (!(await exists(stubPath))) continue;
        const notes = extractStubNotes(await readFile(stubPath, "utf8"));
        agentsMd = appendMovedNotes(agentsMd, stub, notes);
        await rm(stubPath);
        stdout.write(`  ✅ Removed ${stub}${notes ? " — your notes moved to AGENTS.md (\"Notes moved from " + stub + "\")" : ""}\n`);
      }
      await writeFile(agentsMdPath, agentsMd, "utf8");
      stdout.write(`  ✅ AGENTS.md ${hadAgentsMd ? "framework block refreshed (your text kept)" : "created"}\n`);
      for (const w of await instructionWarningsFor(targetDir)) stdout.write(`  ⚠️  ${w}\n`);
      if (/project-card:begin status=draft/.test(agentsMd)) {
        stdout.write("  👉 The project card in AGENTS.md is a draft. Ask your agent to run the agents-md workflow (/agents-md in Claude Code).\n");
      }
      // CHANGELOG.md is the user's own project changelog — create only if absent.
      const changelogPath = join(targetDir, "CHANGELOG.md");
      if (!(await exists(changelogPath))) {
        await cp(join(templateDir, "CHANGELOG.md"), changelogPath);
        stdout.write("  ✅ Created CHANGELOG.md\n");
      } else {
        stdout.write("  ⏭️  CHANGELOG.md exists (kept yours — it's your changelog)\n");
      }

      // ---- Step 7: Claude Code slash commands ----
      stdout.write("\nStep 7: Claude Code slash commands...\n");
      const { written } = await generateClaudeCommands(targetDir, { stdout });
      if (written === 0) stdout.write("  ⏭️  No workflows found; skipped .claude/commands/\n");
      const shims = await generateClaudeSkills(targetDir, { stdout });
      skillPaths = [...shims.writtenNames, ...shims.removedNames].map((n) => `.claude/skills/${n}`);

      // ---- Step 8: Enforcement hooks ----
      stdout.write("\nStep 8: Enforcement hooks...\n");
      if (await exists(join(targetDir, ".git"))) {
        await installHooksCommand([targetDir], { cwd, stdout, stderr });
        if (ensureUnionMerge(targetDir)) stdout.write("  ✅ .gitattributes: the ship-log, inbox and review-log merge without conflicts (merge=union)\n");
      } else {
        stdout.write("  ⏭️  Not a git repo; skipped hook wiring.\n");
      }

      // ---- Step 9: Version stamp ----
      const stampWritten = writeVersionStamp(agentsDir);
      stdout.write(`\nStep 9: Stamped .agents/.carja-version.json → ${stampWritten.frameworkVersion}\n`);
    } catch (stepError) {
      if (backup) {
        stdout.write("\n⚠️  Upgrade failed mid-run — restoring from backup...\n");
        restoreBackup(targetDir, backup.backupRoot, backup.copied);
        stdout.write("  ✅ Restored. Your project is unchanged.\n");
      }
      throw stepError;
    }

    // An upgraded install with no verify command is one where the Iron Law is
    // still off. Derive it if the files allow, otherwise say so — never silently.
    await ensureVerifyCommand(targetDir, stdout);

    stdout.write("\n🎼 Upgrade complete!\n");
    const structural = renamedUncommitted
      ? renamedUncommitted
      : doesStructuralMigration
      ? "legacy folders were moved — check `git status` first"
      : renamedKnowledge > 0 ? "framework names in carja/ were renamed — check `git status` first" : false;
    await commitUpgrade({ targetDir, version, snap, noCommit, structural, extraPaths: skillPaths, stdout, onBranch });
    if (backup) stdout.write(`   Old instructions backed up in ${backup.backupRoot.replace(targetDir + "/", "")} (git-ignored).\n`);
    stdout.write("   Your carja/ project knowledge was preserved.\n");
    const designHint = await designMigrationHint(targetDir);
    if (designHint) stdout.write(designHint);
    stdout.write("   Verify: bash .agents/tests/check-carja.sh\n");
    stdout.write("   Autonomous loop: `carja loop --dry-run` (npm i -g github:charlus/carja) or `npx github:charlus/carja loop --dry-run`.\n");
    return 0;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    stderr.write(`Upgrade failed: ${message}\n`);
    return 1;
  }
}
