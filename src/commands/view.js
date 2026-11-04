// src/commands/view.js
//
// `carja view` — render `carja/` into ONE self-contained HTML file.
//
// WHAT THIS IS FOR. The methodology's read path was built for an IDE: browse a
// file tree, read markdown in a rendered preview, edit in place. Working from a
// CLI agent removes all three. This command restores the reading half without
// touching the storage half: markdown files stay the single source of truth, and
// this is a projection of them.
//
// So the output is DERIVED and must never be committed. The command adds the
// ignore entry itself on every run, which also fixes installs that predate it.

import { writeFile, mkdir, readFile, stat } from "node:fs/promises";
import { spawn } from "node:child_process";
import { join, resolve } from "node:path";
import {
  collectState,
  ensureGitignoreEntry,
  openerFor,
  clickableUrl,
  VIEWS_REL,
} from "../carja-state.js";
import { renderPage, VIEW_FILENAME } from "../view/render.js";
import { statePath } from "../names.js";

function parseArgs(args) {
  const opts = { open: false, out: null, staleDays: 30, dir: null };
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === "--open" || arg === "-o") opts.open = true;
    else if (arg === "--out") opts.out = args[++i];
    else if (arg === "--stale-days") opts.staleDays = Number(args[++i]) || 30;
    else if (!arg.startsWith("-") && !opts.dir) opts.dir = arg;
  }
  return opts;
}

/**
 * Keep the derived views out of git. Done here rather than only in `init` so
 * that an existing install picks it up the first time it renders a view.
 */
async function ignoreViews(root, stdout) {
  const path = join(root, ".gitignore");
  let current = "";
  try {
    current = await readFile(path, "utf8");
  } catch {
    current = "";
  }
  const views = statePath(root, VIEWS_REL);
  const next = ensureGitignoreEntry(current, `${views}/`);
  if (next === current) return false;
  await writeFile(path, next, "utf8");
  stdout?.write(`  ✅ Added ${views}/ to .gitignore — the views are derived, never committed\n`);
  return true;
}

/**
 * Ask git whether a path is ignored. Returns the exit code, or `null` if git
 * could not be run at all.
 *
 * Asking git rather than reimplementing `.gitignore` semantics: exit 0 means
 * ignored, 1 means tracked-or-untracked but not ignored, 128 means not a repo.
 */
function gitCheckIgnore(path) {
  return new Promise((resolve) => {
    try {
      const child = spawn("git", ["check-ignore", "--quiet", path], {
        cwd: join(path, ".."),
        stdio: "ignore",
      });
      child.on("error", () => resolve(null));
      child.on("close", (code) => resolve(code));
    } catch {
      resolve(null);
    }
  });
}

/**
 * Whether to warn that an `--out` page could be committed, given git's answer.
 *
 * Pure so the policy is testable without a repo: warn ONLY when the path is
 * inside a git repo and not ignored. Outside a repo there is nothing to commit
 * it to, and if git could not be run we do not know — either way, stay quiet
 * rather than nag on a guess.
 *
 * @param {string} outPath
 * @param {number|null} checkIgnoreExitCode from `git check-ignore --quiet`
 * @returns {string|null}
 */
export function outPathWarning(outPath, checkIgnoreExitCode) {
  if (checkIgnoreExitCode !== 1) return null;
  return (
    `  ⚠  ${outPath} is inside a git repository and is not ignored.\n` +
    "     This page is derived from carja/ — regenerated whole on every run, and noise in a\n" +
    "     diff. Add it to .gitignore, or write it outside the repo, so it is never committed."
  );
}

function openInBrowser(file, stderr) {
  const opener = openerFor();
  try {
    const child = spawn(opener, [file], { detached: true, stdio: "ignore" });
    child.on("error", () => {
      stderr?.write(`  (could not run \`${opener}\` — open the file above yourself)\n`);
    });
    child.unref();
  } catch {
    stderr?.write(`  (could not run \`${opener}\` — open the file above yourself)\n`);
  }
}

export async function viewCommand(args, context) {
  const opts = parseArgs(args);
  const root = resolve(opts.dir ? opts.dir : context.cwd);

  const { ok, state } = await collectState(root, { staleDays: opts.staleDays });
  if (!ok) {
    context.stderr.write(
      `  No \`carja/\` folder in ${root}\n` +
        "  Scaffold one with:  npx github:charlus/carja init\n"
    );
    return 1;
  }

  const outPath = opts.out ? resolve(opts.out) : join(root, statePath(root, VIEWS_REL), VIEW_FILENAME);
  const html = renderPage(state);

  await mkdir(join(outPath, ".."), { recursive: true });
  await writeFile(outPath, html, "utf8");

  if (opts.out) {
    // `--out` is a deliberate override, so it does not get an ignore entry
    // written for it — but it is the one path where a derived page can reach a
    // commit, so say so when that is actually possible.
    const warning = outPathWarning(outPath, await gitCheckIgnore(outPath));
    if (warning) context.stderr.write(`${warning}\n`);
  } else {
    await ignoreViews(root, context.stdout);
  }

  const { size } = await stat(outPath);
  const kb = (size / 1024).toFixed(0);

  // Print a link the human's BROWSER can resolve, not just a path this process
  // can. On WSL those are different, so print the native path as well — it is
  // the one to hand to `cat` or an editor.
  const url = clickableUrl(outPath);
  const nativePath = `file://${outPath}`;
  context.stdout.write(
    `  ✅ ${state.digest.docCount} document${state.digest.docCount === 1 ? "" : "s"} rendered · ${kb} KB\n` +
      `     ${url}\n` +
      (url === nativePath ? "" : `     path: ${outPath}\n`)
  );

  if (opts.open) openInBrowser(outPath, context.stderr);
  else context.stdout.write(`     open it with:  carja view --open\n`);

  return 0;
}
