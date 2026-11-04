// src/commands/personas.js
//
// `conductor personas [paths…]` — the IO shell around src/personas.js.
//
// With paths, it classifies those (Build passes the files a task will touch).
// Without, it reads what this branch changed: committed since the merge base,
// uncommitted, and untracked. Exit 0 whether or not anything matched.

import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { execFileSync } from "node:child_process";
import { resolveRules, matchPersonas, extractReviewLens } from "../personas.js";
import { ignoredNestedRepos } from "../nested-repos.js";
import { configPath as configPathOf } from "../names.js";

function parseArgs(args) {
  const opts = { json: false, base: null, paths: [] };
  for (let i = 0; i < args.length; i += 1) {
    const a = args[i];
    if (a === "--json") opts.json = true;
    else if (a === "--base") opts.base = args[++i];
    else if (!a.startsWith("-")) opts.paths.push(a);
  }
  return opts;
}

function git(root, args) {
  try {
    return execFileSync("git", args, { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
  } catch {
    return null;
  }
}

function mergeBase(root, base) {
  const candidates = base ? [base] : ["origin/HEAD", "origin/main", "origin/master", "main", "master"];
  for (const ref of candidates) {
    const sha = git(root, ["merge-base", ref, "HEAD"]);
    if (sha) return sha.trim();
  }
  return null;
}

function changedPaths(root, base) {
  const lists = [
    git(root, ["diff", "--name-only", "HEAD"]),
    git(root, ["ls-files", "--others", "--exclude-standard"]),
  ];
  const sha = mergeBase(root, base);
  if (sha) lists.push(git(root, ["diff", "--name-only", `${sha}...HEAD`]));
  const all = lists.flatMap((l) => (l ?? "").split("\n")).filter(Boolean);
  return [...new Set(all)].sort();
}

async function readJson(path) {
  try {
    return JSON.parse(await readFile(path, "utf8"));
  } catch {
    return {};
  }
}

export async function personasCommand(args, { cwd, stdout, stderr }) {
  const opts = parseArgs(args);
  const root = resolve(cwd);
  const config = await readJson(configPathOf(root));

  // In the outer layout each nested code repository has its own DESIGN.md:
  // one install can hold two products with two designs.
  const nested = (await ignoredNestedRepos(root)).map((d) => d.replace(/\/$/, ""));
  // No paths: the change itself. In the outer layout the code lives in the
  // nested repositories, so their diffs count too, prefixed with the folder.
  const paths = opts.paths.length
    ? opts.paths
    : [
        ...changedPaths(root, opts.base),
        ...nested.flatMap((r) => changedPaths(join(root, r), opts.base).map((p) => `${r}/${p}`)),
      ];
  const localise = (context, files) => {
    if (!nested.length || !context.includes("DESIGN.md")) return context;
    const repos = [...new Set(files.map((f) => nested.find((r) => f.startsWith(`${r}/`))).filter(Boolean))];
    if (!repos.length) return context;
    return context.flatMap((c) => (c === "DESIGN.md" ? repos.map((r) => `${r}/DESIGN.md`) : [c]));
  };

  const personas = [];
  for (const m of matchPersonas(paths, resolveRules(config))) {
    const file = `.agents/personas/${m.name}.md`;
    let review = [];
    try {
      review = extractReviewLens(await readFile(join(root, file), "utf8"));
    } catch {
      stderr.write(`⚠️  ${file} is missing: run \`conductor upgrade\`\n`);
    }
    personas.push({ name: m.name, persona: file, context: localise(m.context, m.files), files: m.files, review });
  }

  if (opts.json) {
    stdout.write(`${JSON.stringify({ paths: paths.length, personas }, null, 2)}\n`);
    return 0;
  }
  if (personas.length === 0) {
    stdout.write(`No domain persona for these ${paths.length} path(s).\n`);
    return 0;
  }
  for (const p of personas) {
    const shown = p.files.slice(0, 5).join(", ") + (p.files.length > 5 ? ` (+${p.files.length - 5} more)` : "");
    stdout.write(`\n${p.name}  →  read ${[p.persona, ...p.context].join(", ")}\n`);
    stdout.write(`  triggered by: ${shown}\n`);
    stdout.write(`  Review Lens:\n${p.review.map((r) => `    - ${r}`).join("\n")}\n`);
  }
  return 0;
}
