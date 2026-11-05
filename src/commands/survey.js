// src/commands/survey.js
//
// `carja survey [dir]` — the IO shell around src/survey.js.
//
// Walks a real tree, reads the few files worth reading, and prints the facts.
// Everything judgemental lives in the workflow; everything here is countable.

import { readFile, readdir, stat, writeFile, mkdir } from "node:fs/promises";
import { join, resolve, relative, sep, dirname } from "node:path";
import {
  classifyFile,
  coverageByArea,
  extractEnvKeys,
  findRoutes,
  findEntryPoints,
  renderSurvey,
  resolveTestImports,
} from "../survey.js";

// Reading every source file to hunt for routes is the expensive part, so it is
// bounded. A repo bigger than this gets its routes sampled, and the report
// says so rather than quietly under-reporting.
const MAX_ROUTE_FILES = 400;
const MAX_FILE_BYTES = 512 * 1024;

function parseArgs(args) {
  const opts = { dir: null, json: false, out: null };
  for (let i = 0; i < args.length; i += 1) {
    const a = args[i];
    if (a === "--json") opts.json = true;
    else if (a === "--out") opts.out = args[++i];
    else if (!a.startsWith("-") && !opts.dir) opts.dir = a;
  }
  return opts;
}

/**
 * Every file under root, relative, with excluded trees pruned as we go.
 *
 * A subdirectory with its own `.git` — a FILE for a linked worktree or a
 * submodule, a directory for a nested repository — is a different checkout,
 * not this codebase, and is skipped and recorded in `nested`. Detected rather
 * than guessed: the first version excluded worktrees by folder NAME, so the
 * reviewer's worktree at `review-copy/` was walked and reported as its own
 * untested area. The root's own `.git` is never counted.
 */
export async function walk(root, dir = root, acc = [], nested = []) {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return { files: acc, nested };
  }
  if (dir !== root && entries.some((e) => e.name === ".git")) {
    nested.push(relative(root, dir).split(sep).join("/"));
    return { files: acc, nested };
  }
  for (const e of entries) {
    const full = join(dir, e.name);
    const rel = relative(root, full).split(sep).join("/");
    if (e.name === ".git") continue;
    if (classifyFile(rel).kind === "excluded") continue;
    if (e.isDirectory()) await walk(root, full, acc, nested);
    else if (e.isFile()) acc.push(rel);
  }
  return { files: acc, nested };
}

async function readIfSmall(path) {
  try {
    const s = await stat(path);
    if (s.size > MAX_FILE_BYTES) return null;
    return await readFile(path, "utf8");
  } catch {
    return null;
  }
}

function dependenciesFrom(pkgText) {
  if (!pkgText) return { runtime: [], dev: [] };
  try {
    const pkg = JSON.parse(pkgText);
    return {
      runtime: Object.keys(pkg.dependencies ?? {}).sort(),
      dev: Object.keys(pkg.devDependencies ?? {}).sort(),
    };
  } catch {
    return { runtime: [], dev: [] };
  }
}

export async function surveyCommand(args, { cwd, stdout, stderr }) {
  const opts = parseArgs(args);
  const root = resolve(cwd, opts.dir || ".");

  const { files, nested } = await walk(root);
  if (files.length === 0) {
    stderr.write(`Nothing to survey under ${root}\n`);
    return 1;
  }

  const classified = files.map((f) => ({ path: f, ...classifyFile(f) }));
  const langCount = new Map();
  for (const f of classified) {
    if (!f.lang) continue;
    langCount.set(f.lang, (langCount.get(f.lang) ?? 0) + 1);
  }

  // Routes: source files only, largest-language first, bounded.
  const sourceFiles = classified.filter((f) => f.kind === "source");
  const routes = new Set();
  let sampled = false;
  const scanList = sourceFiles.slice(0, MAX_ROUTE_FILES);
  if (sourceFiles.length > MAX_ROUTE_FILES) sampled = true;
  for (const f of scanList) {
    const text = await readIfSmall(join(root, f.path));
    if (!text) continue;
    for (const r of findRoutes(text, f.lang === "py" ? "py" : "js")) routes.add(r);
  }

  // Attribute coverage by what each test imports, not by what it is called.
  const importsByTest = {};
  for (const f of classified.filter((c) => c.kind === "test")) {
    const text = await readIfSmall(join(root, f.path));
    if (text) importsByTest[f.path] = resolveTestImports(f.path, text);
  }

  const pkgText = await readIfSmall(join(root, "package.json"));
  const envText =
    (await readIfSmall(join(root, ".env.example"))) ??
    (await readIfSmall(join(root, ".env.sample"))) ??
    "";

  const facts = {
    root,
    fileCount: files.length,
    languages: [...langCount.entries()]
      .map(([lang, n]) => ({ lang, files: n }))
      .sort((a, b) => b.files - a.files),
    areas: coverageByArea(files, { importsByTest }),
    entryPoints: findEntryPoints({ "package.json": pkgText ?? undefined }),
    routes: [...routes].sort(),
    envKeys: extractEnvKeys(envText),
    dependencies: dependenciesFrom(pkgText),
    routesSampled: sampled,
    nestedCheckouts: nested.sort(),
  };

  if (opts.json) {
    stdout.write(`${JSON.stringify(facts, null, 2)}\n`);
    return 0;
  }

  let md = renderSurvey(facts);
  if (sampled) {
    md += `\n> Routes were scanned in the first ${MAX_ROUTE_FILES} of ${sourceFiles.length} source files. Treat the list as partial.\n`;
  }

  if (opts.out) {
    const target = resolve(cwd, opts.out);
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, md, "utf8");
    stderr.write(`Survey written to ${target}\n`);
    return 0;
  }

  stdout.write(md);
  return 0;
}
