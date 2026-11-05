// src/commands/design.js
//
// `carja design migrate [dir] [--repo <path>] [--dry-run]`
//
// Combines everything in carja/4-context/design/ into one DESIGN.md at the
// code repository root: the nested repository in the outer layout, or `dir`
// itself. Refuses to overwrite an existing DESIGN.md. Each migrated text file
// becomes a pointer to DESIGN.md; other files (images) stay as they are.

import { readFile, readdir, writeFile, stat } from "node:fs/promises";
import { join, resolve, relative, sep } from "node:path";
import { readFileSync } from "node:fs";
import { buildDesignMd, pointerStub } from "../design-md.js";
import { ignoredNestedRepos } from "../nested-repos.js";

const SOURCE_REL = "carja/4-context/design";
const LEGACY = JSON.parse(
  readFileSync(new URL("../retired-design-templates.json", import.meta.url), "utf8"),
).files;

function parseArgs(args) {
  const opts = { sub: null, dir: null, repo: null, dryRun: false };
  for (let i = 0; i < args.length; i += 1) {
    const a = args[i];
    if (a === "--dry-run") opts.dryRun = true;
    else if (a === "--repo") opts.repo = args[++i];
    else if (a.startsWith("-")) continue;
    else if (!opts.sub) opts.sub = a;
    else if (!opts.dir) opts.dir = a;
  }
  return opts;
}

async function listFiles(dir, base = dir, acc = []) {
  for (const e of await readdir(dir, { withFileTypes: true })) {
    const full = join(dir, e.name);
    if (e.isDirectory()) await listFiles(full, base, acc);
    else if (e.isFile()) acc.push(relative(base, full).split(sep).join("/"));
  }
  return acc;
}

async function isDir(p) {
  try {
    return (await stat(p)).isDirectory();
  } catch {
    return false;
  }
}

/**
 * The line `carja upgrade` prints when the old design folder still holds
 * something that is not a pointer, or null. Upgrade never touches carja/,
 * so it only says what to run.
 */
export async function designMigrationHint(root) {
  const dir = join(root, SOURCE_REL);
  if (!(await isDir(dir))) return null;
  const files = {};
  for (const n of (await listFiles(dir)).filter((f) => /\.(md|markdown|txt)$/i.test(f))) {
    const text = await readFile(join(dir, n), "utf8").catch(() => "");
    if (!text.startsWith("# Moved to `DESIGN.md`")) files[n] = text;
  }
  // Untouched templates hold nothing to carry over: no hint for them.
  const { migrated } = buildDesignMd(files, { legacy: LEGACY, source: SOURCE_REL });
  if (!migrated.length) return null;
  return `   Design: ${SOURCE_REL}/ is replaced by one DESIGN.md. Run \`carja design migrate\` to combine it.\n`;
}

export async function designCommand(args, { cwd, stdout, stderr }) {
  const opts = parseArgs(args);
  if (opts.sub !== "migrate") {
    stderr.write("usage: carja design migrate [dir] [--repo <path>] [--dry-run]\n");
    return opts.sub ? 1 : 0;
  }
  const root = resolve(cwd, opts.dir || ".");
  const sourceDir = join(root, SOURCE_REL);
  if (!(await isDir(sourceDir))) {
    stdout.write(`Nothing to migrate: ${SOURCE_REL}/ does not exist.\n`);
    return 0;
  }

  let codeRoot = root;
  if (opts.repo) codeRoot = resolve(root, opts.repo);
  else {
    const nested = (await ignoredNestedRepos(root)).map((d) => d.replace(/\/$/, ""));
    if (nested.length > 1) {
      stderr.write(`Several code repositories here (${nested.join(", ")}). Name one with --repo <path>.\n`);
      return 1;
    }
    if (nested.length === 1) codeRoot = join(root, nested[0]);
  }
  const target = join(codeRoot, "DESIGN.md");
  if (!opts.dryRun) {
    try {
      await stat(target);
      stderr.write(`${relative(root, target) || "DESIGN.md"} already exists. Nothing written: merge by hand.\n`);
      return 1;
    } catch {
      /* absent: go on */
    }
  }

  const names = await listFiles(sourceDir);
  const files = {};
  for (const n of names) files[n] = await readFile(join(sourceDir, n), "utf8");
  const { markdown, migrated, templateOnly } = buildDesignMd(files, { legacy: LEGACY, source: SOURCE_REL });

  // Only untouched templates: an empty skeleton would make Build believe a
  // design system exists and skip extracting the real one from the code.
  if (!migrated.length) {
    stdout.write(
      `Nothing to migrate: ${SOURCE_REL}/ holds only the untouched templates. No DESIGN.md written.\n` +
        "  Create it from the code with the design-system skill (brownfield mode), or let Build do it before the first UI task.\n",
    );
    return 0;
  }

  if (opts.dryRun) {
    stdout.write(markdown);
    return 0;
  }

  await writeFile(target, markdown);
  const stub = pointerStub(relative(sourceDir, target).split(sep).join("/"));
  for (const n of [...migrated, ...templateOnly]) await writeFile(join(sourceDir, n), stub);

  stdout.write(`Wrote ${relative(root, target) || "DESIGN.md"}\n`);
  stdout.write(`  migrated:      ${migrated.join(", ") || "none"}\n`);
  stdout.write(`  template only: ${templateOnly.join(", ") || "none"}\n`);
  stdout.write(`  Each one is now a pointer to DESIGN.md. Review DESIGN.md, then commit both repositories.\n`);
  return 0;
}
