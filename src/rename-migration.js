// src/rename-migration.js
//
// `carja upgrade` on a 6.x install: move it from the old name, Conductor, to
// Carja before the normal upgrade runs (docs/roadmap/Rename-To-Carja.md,
// "The upgrade migration"). Two commits, so each diff is reviewable:
//   1. `chore: rename conductor to carja`: the state folder, the config file,
//      and the framework's own lines in .gitattributes and .gitignore.
//   2. `chore: point carja/ knowledge at the renamed folder` (D2): the exact
//      pattern `conductor/<n>-<folder>/` inside the moved folder's files.
// Only our numbered folders move. Anything else in `conductor/` (Google
// Conductor's files) stays where it is and is named in the report.
//
// It refuses, and changes nothing, when the tree has uncommitted changes or a
// loop or work worktree exists (D3: finishing a run is cheaper than migrating it).

import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { existsSync, readdirSync, readFileSync, renameSync, rmdirSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { join, relative } from "node:path";
import { CURRENT, OLD, isOldLayout } from "./names.js";

const execFileAsync = promisify(execFile);

/** Our numbered folders, the only entries of the old folder that move. */
export const NUMBERED = ["0-compass", "1-workbench", "2-backlog", "3-product-areas", "4-context", "5-templates", "6-archive"];

// Any `conductor/<numbered>/`, also inside a longer path (`~/Workspace/app/conductor/…`,
// `../conductor/…`: links into the moved folder, found in four real projects).
// Never `.conductor/` (the V4 folder) or a longer name such as `my-conductor/`.
const OLD_PATH_RE = new RegExp(`(^|[^\\w.-])${OLD}/(${NUMBERED.join("|")})/`, "gm");

/** Machine state in the git dir, renamed so the new hooks and the loop find it. */
const GIT_DIR_FILES = ["heartbeat", "loop-logs", "loop-ready.json", "holder"].map((s) => [`${OLD}-${s}`, `${CURRENT}-${s}`]);

async function git(args, cwd, env) {
  try {
    const { stdout } = await execFileAsync("git", args, { cwd, maxBuffer: 1 << 24, env: env ? { ...process.env, ...env } : process.env });
    return { ok: true, stdout: stdout.trim() };
  } catch (e) {
    return { ok: false, stdout: String(e.stdout ?? "").trim(), stderr: String(e.stderr ?? "").trim() };
  }
}

/** True when `root` needs the rename: the old folder holds our numbered folders, or only the old config is there. */
export function needsRename(root) {
  if (isOldLayout(root)) return true;
  return existsSync(join(root, `${OLD}.config.json`)) && !existsSync(join(root, `${CURRENT}.config.json`)) && !existsSync(join(root, CURRENT));
}

/** Text with every `conductor/<numbered>/` path pointed at `carja/`. Exported for the test. */
export function rewritePaths(text) {
  return text.replace(OLD_PATH_RE, (_, pre, folder) => `${pre}${CURRENT}/${folder}/`);
}

// The project card in the root AGENTS.md (src/project-card.js): framework-written,
// so its paths, source-stamp keys and markers follow the rename. Text outside it
// is the owner's and stays as written (7.0.1, F6).
const CARD_RE = new RegExp(`<!-- (?:${CURRENT}|${OLD}):project-card:begin[\\s\\S]*?<!-- (?:${CURRENT}|${OLD}):project-card:end -->`);

/** `text` (a root AGENTS.md) with the project card pointed at carja/. */
export function rewriteCardBlock(text) {
  return text.replace(CARD_RE, (card) =>
    rewritePaths(card)
      .replace(new RegExp(`"${OLD}\\.config\\.json#`, "g"), `"${CURRENT}.config.json#`)
      .replace(new RegExp(`<!-- ${OLD}:project-card:`, "g"), `<!-- ${CURRENT}:project-card:`),
  );
}

/**
 * Give the 6.x machine files in a git dir their 7.x names, when the 7.x one is
 * not there yet. A clone that gets the rename by a pull never ran the rename
 * (7.0.1, F5). Never on a 6.x layout: its own hooks still write the old names.
 */
export function adoptOldGitFiles(gitCommonDir) {
  const moved = [];
  for (const [from, to] of GIT_DIR_FILES) {
    const src = join(gitCommonDir, from);
    if (!existsSync(src)) continue;
    const dest = join(gitCommonDir, to);
    if (!existsSync(dest)) {
      renameSync(src, dest);
      moved.push(to);
    } else if (to.endsWith("-heartbeat")) {
      // `install-hooks` wrote the new file first: the old history goes before it,
      // so the earlier `installed` floor still holds (7.0.2, F7).
      writeFileSync(dest, readFileSync(src, "utf8") + readFileSync(dest, "utf8"));
      rmSync(src);
      moved.push(to);
    }
  }
  return moved;
}

/** The reasons the rename cannot run now, [] when it can. */
async function blockers(root, repo) {
  const out = [];
  const taken = [...NUMBERED.map((n) => `${CURRENT}/${n}`), `${CURRENT}.config.json`].filter((p) => existsSync(join(root, p)));
  if (taken.length) out.push(`${taken.join(", ")} already exist${taken.length === 1 ? "s" : ""} beside the 6.x files. Merge ${taken.length === 1 ? "it" : "them"} by hand first`);
  if (!repo) return out;
  const status = await git(["status", "--porcelain"], root);
  if (status.stdout) out.push("the working tree has uncommitted changes. Commit or stash them first");
  const list = await git(["worktree", "list", "--porcelain"], root);
  const held = list.stdout.split("\n").filter((l) => new RegExp(`^branch refs/heads/${OLD}/(loop|work)/`).test(l));
  if (held.length) out.push(`${held.length} loop or work worktree${held.length === 1 ? "" : "s"} exist (${held.map((l) => l.replace("branch refs/heads/", "")).join(", ")}). Finish or remove ${held.length === 1 ? "it" : "them"} first`);
  for (const marker of ["MERGE_HEAD", "CHERRY_PICK_HEAD", "REVERT_HEAD", "rebase-merge", "rebase-apply"]) {
    const where = (await git(["rev-parse", "--git-path", marker], root)).stdout;
    if (where && existsSync(join(root, where))) out.push(`a ${marker} is in progress`);
  }
  return out;
}

const isTracked = async (root, rel) => Boolean((await git(["ls-files", "--", rel], root)).stdout);

/**
 * Move `from` to `to` (relative to root). Tracked content goes through `git mv`,
 * which renames the folder on disk with any untracked files in it. The parent
 * is created first: `git mv` into a missing parent fails, and with `-k` it
 * stages the rename without moving anything on disk.
 */
async function move(root, from, to, repo) {
  const src = join(root, from);
  const dst = join(root, to);
  if (!existsSync(src)) return;
  if (existsSync(dst)) throw new Error(`${to} already exists; move ${from} by hand, then run carja upgrade again`);
  mkdirSync(join(dst, ".."), { recursive: true });
  if (repo && (await isTracked(root, from))) {
    const r = await git(["mv", from, to], root);
    if (!r.ok) throw new Error(`git mv ${from} ${to} failed: ${r.stderr}`);
    return;
  }
  renameSync(src, dst);
}

/** Rewrite the framework's own lines in a root dot-file. Returns true when it changed. */
function rewriteLines(root, file, map) {
  const p = join(root, file);
  if (!existsSync(p)) return false;
  const before = readFileSync(p, "utf8");
  const after = before
    .split("\n")
    .map((line) => map(line))
    .join("\n");
  if (after === before) return false;
  writeFileSync(p, after);
  return true;
}

/** Every markdown or text file under `dir`, relative to root. */
function textFiles(root, dir) {
  const out = [];
  const walk = (d) => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      const p = join(d, e.name);
      if (e.isDirectory()) walk(p);
      else if (/\.(md|txt|json|jsonl|ya?ml)$/.test(e.name)) out.push(relative(root, p));
    }
  };
  if (existsSync(dir)) walk(dir);
  return out;
}

/**
 * Run the rename. `commit` is false outside a git repo, or when the caller
 * prints the commands instead. Returns a report the caller prints, or
 * { refused: [reasons] } with nothing changed.
 */
export async function renameInstall(root, { version, dryRun = false, commit = true, gitCommonDir = null } = {}) {
  const repo = (await git(["rev-parse", "--is-inside-work-tree"], root)).stdout === "true";
  const refused = await blockers(root, repo);
  if (refused.length) return { refused };

  const oldDir = join(root, OLD);
  const moving = existsSync(oldDir) ? NUMBERED.filter((n) => existsSync(join(oldDir, n))) : [];
  const staying = existsSync(oldDir) ? readdirSync(oldDir).filter((n) => !NUMBERED.includes(n) && n !== ".views") : [];
  const report = { moved: moving.map((n) => `${OLD}/${n}/ → ${CURRENT}/${n}/`), staying: staying.map((n) => `${OLD}/${n}`), rewritten: [], commits: [] };
  if (existsSync(join(root, `${OLD}.config.json`))) report.moved.push(`${OLD}.config.json → ${CURRENT}.config.json`);
  if (dryRun) return report;

  const start = repo ? (await git(["rev-parse", "--verify", "-q", "HEAD"], root)).stdout || null : null;
  try {
    return await doRename(root, { report, moving, repo, commit, gitCommonDir, version });
  } catch (e) {
    await rollback(root, start);
    throw e;
  }
}

/**
 * Put the project back exactly as it was: the tree was clean before (blockers),
 * so a hard reset restores every tracked file. Ignored files went along with
 * `git mv`; they are moved back by hand, so no stray `carja/` is left for the
 * readers to prefer.
 */
async function rollback(root, start) {
  if (start) await git(["reset", "-q", "--hard", start], root);
  // Outside git, or with no commit yet: put the files back by hand.
  for (const [from, to] of [[`${CURRENT}.config.json`, `${OLD}.config.json`], [`.agents/.${CURRENT}-version.json`, `.agents/.${OLD}-version.json`]]) {
    if (existsSync(join(root, from)) && !existsSync(join(root, to))) renameSync(join(root, from), join(root, to));
  }
  const neu = join(root, CURRENT);
  for (const n of [...NUMBERED, ".views"]) {
    const from = join(neu, n);
    if (!existsSync(from)) continue;
    const back = (src, dst) => {
      for (const e of readdirSync(src, { withFileTypes: true })) {
        const a = join(src, e.name);
        const b = join(dst, e.name);
        if (!existsSync(b)) {
          mkdirSync(dst, { recursive: true });
          renameSync(a, b);
        } else if (e.isDirectory()) back(a, b);
      }
    };
    back(from, join(root, OLD, n));
  }
  if (existsSync(neu)) rmSync(neu, { recursive: true, force: true });
}

async function doRename(root, { report, moving, repo, commit, gitCommonDir, version }) {
  const oldDir = join(root, OLD);
  // What git tracks before anything moves: the rename commit may hold only these.
  const trackedBefore = repo ? new Set((await git(["ls-files"], root)).stdout.split("\n")) : new Set();
  // 1. Move the folders and the config.
  for (const n of moving) await move(root, `${OLD}/${n}`, `${CURRENT}/${n}`, repo);
  if (existsSync(join(oldDir, ".views"))) await move(root, `${OLD}/.views`, `${CURRENT}/.views`, false);
  if (existsSync(oldDir) && readdirSync(oldDir).length === 0) rmdirSync(oldDir);
  if (existsSync(join(root, `${OLD}.config.json`))) await move(root, `${OLD}.config.json`, `${CURRENT}.config.json`, repo);
  // The version stamp keeps its install date; Step 9 of the upgrade refreshes it.
  if (existsSync(join(root, `.agents/.${OLD}-version.json`)) && !existsSync(join(root, `.agents/.${CURRENT}-version.json`))) {
    await move(root, `.agents/.${OLD}-version.json`, `.agents/.${CURRENT}-version.json`, repo);
  }

  // The framework's own lines: union-merge paths, the derived views, the backup folder.
  const numbered = new RegExp(`^${OLD}/(${NUMBERED.join("|")}|\\.views)/`);
  if (rewriteLines(root, ".gitattributes", (l) => l.replace(numbered, `${CURRENT}/$1/`))) report.rewritten.push(".gitattributes");
  // Every ignore rule that names the old folder gets a twin for the new one, and
  // keeps the old (Google Conductor's files may stay there). Without the twin, a
  // folder ignored as a whole (`conductor/`) would be committed in full by the
  // rename (independent review F1, reproduced on a real 6.54.0 install).
  const namesOld = new RegExp(`(^|/)${OLD}(/|$)`);
  const twin = (l) => (!l.startsWith("#") && namesOld.test(l) ? `${l}\n${l.replace(new RegExp(`(^|/)${OLD}(?=/|$)`, "g"), `$1${CURRENT}`)}` : l);
  if (rewriteLines(root, ".gitignore", (l) => (l === `.${OLD}-backup/` ? `${l}\n.${CURRENT}-backup/` : twin(l)))) report.rewritten.push(".gitignore");
  if (gitCommonDir) rewriteLines(gitCommonDir, "info/exclude", twin);
  // A 6.x `loop.setup` names $CONDUCTOR_ROOT or $CONDUCTOR_CODE_ROOT; 7.x exports CARJA_* (review F5).
  const cfg = join(root, `${CURRENT}.config.json`);
  if (existsSync(cfg)) {
    const text = readFileSync(cfg, "utf8");
    const next = text.replace(new RegExp(`\\b${OLD.toUpperCase()}_`, "g"), "CARJA_");
    if (next !== text) {
      writeFileSync(cfg, next);
      report.rewritten.push(`${CURRENT}.config.json: $${OLD.toUpperCase()}_* → $CARJA_*`);
    }
  }

  // The 6.x hooks judge these commits. Their content gates (a spec's Brief
  // check, the ship-log's report) read a moved or path-rewritten file as new
  // work, so both commits carry the waivers, under both names. The 6.x hooks
  // log a waiver to conductor/0-compass/ship-log.md, which has just moved, so
  // the commit message records them instead (eurassistant, 2026-11-04).
  const why = `carja upgrade to ${version}: mechanical rename`;
  const env = {};
  for (const k of ["NO_PROTECTED", "NO_BRIEF", "NO_REPORT"]) env[`CARJA_${k}`] = env[`${OLD.toUpperCase()}_${k}`] = why;
  const waived = "\n\nHook waivers (Protected, Brief, Report): a mechanical rename by carja upgrade, no new content.";
  if (repo && commit) {
    // The tree was clean before the rename (blockers), so every change is the rename's.
    await git(["add", "-A"], root);
    // The rename commit may only hold files git already tracked, under their new
    // name. Anything else was hidden by an ignore rule the twin did not cover.
    const added = (await git(["diff", "--cached", "--name-only", "--diff-filter=A", "--no-renames"], root)).stdout.split("\n").filter(Boolean);
    const oldName = (f) => f.replace(new RegExp(`^${CURRENT}/`), `${OLD}/`).replace(`${CURRENT}.config.json`, `${OLD}.config.json`).replace(`.${CURRENT}-version.json`, `.${OLD}-version.json`);
    const stray = added.filter((f) => !trackedBefore.has(oldName(f)));
    if (stray.length) {
      throw new Error(`the rename would commit ${stray.length} file${stray.length === 1 ? "" : "s"} git did not track before (${stray.slice(0, 3).join(", ")}${stray.length > 3 ? ", …" : ""}): an ignore rule names ${OLD}/ but not ${CURRENT}/. Add the same rule for ${CURRENT}/, then run carja upgrade again`);
    }
    if (!(await git(["diff", "--cached", "--quiet"], root)).ok) {
      const c = await git(["commit", "-q", "-m", `chore: rename conductor to carja${waived}`], root, env);
      if (!c.ok) throw new Error(`the rename commit was refused: ${(c.stderr || c.stdout).split("\n").filter(Boolean).slice(-1)[0] ?? ""}`);
      report.commits.push((await git(["rev-parse", "--short", "HEAD"], root)).stdout);
    }
  }

  // 2. D2: path references inside the moved folder, in their own commit.
  const changed = [];
  for (const rel of textFiles(root, join(root, CURRENT))) {
    const p = join(root, rel);
    const before = readFileSync(p, "utf8");
    const after = rewritePaths(before);
    if (after !== before) {
      writeFileSync(p, after);
      changed.push(rel);
    }
  }
  report.knowledge = changed;
  // Ignored files are rewritten on disk too, but only tracked ones go in the commit.
  const trackedNow = repo ? new Set((await git(["ls-files", "--", CURRENT], root)).stdout.split("\n")) : new Set();
  const toCommit = changed.filter((f) => trackedNow.has(f));
  if (repo && commit && toCommit.length) {
    await git(["add", "--", ...toCommit], root);
    const c = await git(["commit", "-q", "-m", `chore: point ${CURRENT}/ knowledge at the renamed folder${waived}`, "--", ...toCommit], root, env);
    if (!c.ok) throw new Error(`the path-rewrite commit was refused: ${(c.stderr || c.stdout).split("\n").filter(Boolean).slice(-1)[0] ?? ""}`);
    report.commits.push((await git(["rev-parse", "--short", "HEAD"], root)).stdout);
  }
  // Machine state in the git dir follows the new names (never committed), last,
  // so a refused commit leaves it as it was.
  if (gitCommonDir) {
    adoptOldGitFiles(gitCommonDir);
  }
  return report;
}

/** The report as the upgrade prints it. */
export function renderRenameReport(r) {
  const lines = ["\nStep R: Rename Conductor to Carja..."];
  for (const m of r.moved) lines.push(`  📁 ${m}`);
  for (const f of r.rewritten ?? []) lines.push(`  ✏️  ${f}: the framework's lines now name ${CURRENT}/`);
  if (r.knowledge?.length) lines.push(`  ✏️  ${r.knowledge.length} file${r.knowledge.length === 1 ? "" : "s"} in ${CURRENT}/ named ${OLD}/<folder>/ paths: rewritten (their own commit)`);
  for (const s of r.staying) lines.push(`  ⏭️  Left ${s}: not Carja's (Google Conductor uses the same folder)`);
  if (r.commits?.length) lines.push(`  ✅ Committed as ${r.commits.join(", ")}`);
  return lines.join("\n") + "\n";
}
