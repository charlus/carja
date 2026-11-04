// src/commands/agents-md.js
//
// `carja agents-md <facts|write|check> [dir]` — the project card in the root
// AGENTS.md (docs/roadmap/Agents-MD-Project-Card.md §5).
//
//   facts   print the sections the code can state (Stack, Commands, Layout, areas)
//   write   refresh those sections in the card; keep the agent's text; TODO where missing
//   check   exit 0 only for a complete card whose facts match the code; then stamp it
//
// The facts come from the CODE repository: the folder itself, or in the outer
// layout the gitignored nested repository that holds the team's code.

import { readFile, writeFile, readdir } from "node:fs/promises";
import { join, resolve } from "node:path";
import { walk } from "./survey.js";
import { classifyFile } from "../survey.js";
import { ignoredNestedRepos } from "../nested-repos.js";
import { buildCard, parseCard, checkCard, stampCard, staleSources, renderFacts } from "../project-card.js";
import { configPath as configPathOf, stateDirName } from "../names.js";

const MANIFESTS = ["package.json", "pyproject.toml", "requirements.txt", "go.mod", "Cargo.toml", "pom.xml", "build.gradle", "Gemfile", "composer.json", "Makefile"];
const SCRIPTS = ["dev", "start", "build", "test", "lint", "typecheck"];
const KNOWN = [
  "react", "next", "vue", "nuxt", "svelte", "@sveltejs/kit", "angular", "@angular/core", "vite", "express", "fastify", "@nestjs/core", "hono", "electron", "typescript", "prisma", "drizzle-orm", "vitest", "jest", "playwright",
  "fastapi", "django", "flask", "sqlalchemy", "pydantic", "celery", "pytest", "alembic", "streamlit",
];
const SKIP_DIRS = new Set(["carja", "conductor", "node_modules", "dist", "build", "coverage", "venv"]);

async function readOr(path, fallback = null) {
  try {
    return await readFile(path, "utf8");
  } catch {
    return fallback;
  }
}

async function dirsOf(path) {
  try {
    return (await readdir(path, { withFileTypes: true })).filter((e) => e.isDirectory()).map((e) => e.name);
  } catch {
    return [];
  }
}

/** Facts + the source contents the card's freshness stamp covers. */
export async function gatherFacts(root) {
  const nested = (await ignoredNestedRepos(root)).map((d) => d.replace(/\/$/, ""));
  const codeRoots = nested.length ? nested : ["."];
  const sources = {};
  const langCount = new Map();
  const frameworks = new Set();
  const manifests = [];
  const commands = [];
  const layout = [];

  const config = JSON.parse((await readOr(configPathOf(root))) ?? "{}");
  if (config.verify) commands.push({ what: "verify", cmd: config.verify });
  if (config.eval) commands.push({ what: "eval", cmd: config.eval });
  if (config.loop?.setup) commands.push({ what: "setup", cmd: config.loop.setup });
  sources["carja.config.json#commands"] = JSON.stringify([config.verify, config.eval, config.loop?.setup]);

  for (const cr of codeRoots) {
    const base = resolve(root, cr);
    const prefix = cr === "." ? "" : `${cr}/`;
    const { files } = await walk(base);
    const perDir = new Map();
    for (const f of files) {
      const { lang } = classifyFile(f);
      if (lang) langCount.set(lang, (langCount.get(lang) ?? 0) + 1);
      const top = f.includes("/") ? f.split("/")[0] : null;
      if (top && !top.startsWith(".") && !SKIP_DIRS.has(top)) perDir.set(top, (perDir.get(top) ?? 0) + 1);
    }
    for (const [dir, n] of [...perDir.entries()].sort(([a], [b]) => a.localeCompare(b))) layout.push({ dir: `${prefix}${dir}`, files: n });
    sources[`${prefix}(layout)`] = [...perDir.keys()].sort().join(",");

    // Manifests at the code root and one level down (client/, server/, …).
    const candidates = files.filter((f) => f.split("/").length <= 2 && MANIFESTS.includes(f.split("/").pop()));
    for (const m of candidates.sort()) {
      const text = (await readOr(join(base, m))) ?? "";
      manifests.push(`${prefix}${m}`);
      sources[`${prefix}${m}`] = text;
      const dir = m.includes("/") ? m.slice(0, m.lastIndexOf("/")) : "";
      const cd = [prefix.replace(/\/$/, ""), dir].filter(Boolean).join("/");
      const run = (c) => (cd ? `cd ${cd} && ${c}` : c);
      if (m.endsWith("package.json")) {
        try {
          const pkg = JSON.parse(text);
          for (const d of Object.keys({ ...pkg.dependencies, ...pkg.devDependencies })) if (KNOWN.includes(d)) frameworks.add(d);
          for (const s of SCRIPTS) if (pkg.scripts?.[s]) commands.push({ what: s, cmd: run(`npm run ${s}`) });
        } catch {
          /* a broken manifest is not a reason to fail */
        }
      } else if (/requirements\.txt$|pyproject\.toml$/.test(m)) {
        for (const k of KNOWN) if (new RegExp(`^\\s*"?${k.replace(/[/@]/g, "\\$&")}\\b`, "mi").test(text)) frameworks.add(k);
      } else if (m.endsWith("Makefile")) {
        for (const t of ["test", "build", "run", "lint"]) if (new RegExp(`^${t}:`, "m").test(text)) commands.push({ what: t, cmd: run(`make ${t}`) });
      }
    }
  }

  const sd = stateDirName(root);
  const areasDir = join(root, sd, "3-product-areas");
  const areas = [];
  for (const name of (await dirsOf(areasDir)).sort()) {
    if (name.startsWith("example-")) continue; // the template's examples, not the project's
    areas.push(`${sd}/3-product-areas/${name}/`);
    for (const f of (await readdir(join(areasDir, name)).catch(() => [])).filter((n) => n.endsWith(".md")).sort()) {
      sources[`${sd}/3-product-areas/${name}/${f}`] = (await readOr(join(areasDir, name, f))) ?? "";
    }
  }
  for (const rel of [`${sd}/0-compass/north-star.md`]) sources[rel] = (await readOr(join(root, rel))) ?? "";
  const tech = join(root, sd, "4-context", "technical");
  for (const f of (await readdir(tech).catch(() => [])).filter((n) => n.endsWith(".md")).sort()) {
    sources[`${sd}/4-context/technical/${f}`] = (await readOr(join(tech, f))) ?? "";
  }

  const facts = {
    codeRoots,
    languages: [...langCount.entries()].map(([lang, files]) => ({ lang, files })).sort((a, b) => b.files - a.files).slice(0, 5),
    frameworks: [...frameworks].sort(),
    manifests,
    commands,
    layout: layout.slice(0, 15),
    areas,
  };
  return { facts, sources };
}

/** "draft" | "ok" | { stale: [paths] } | null (no AGENTS.md / no card), for `carja status`. */
export async function cardState(root) {
  const text = await readOr(join(root, "AGENTS.md"));
  if (!text) return null;
  const card = parseCard(text);
  if (!card) return null;
  if (!/status=ok/.test(card.begin)) return "draft";
  const stale = staleSources(text, (await gatherFacts(root)).sources);
  return stale && stale.length ? { stale } : "ok";
}

export async function agentsMdCommand(args, { cwd, stdout, stderr }) {
  const [sub, dirArg] = args;
  const root = resolve(cwd, dirArg ?? ".");
  const agentsPath = join(root, "AGENTS.md");
  if (!["facts", "write", "check"].includes(sub)) {
    stderr.write("Usage: carja agents-md <facts|write|check> [dir]\n");
    return 1;
  }
  const { facts, sources } = await gatherFacts(root);
  if (sub === "facts") {
    stdout.write(renderFacts(facts));
    return 0;
  }

  const text = await readOr(agentsPath);
  if (text == null) {
    stderr.write(`No AGENTS.md in ${root}. Run \`carja upgrade\` (or \`carja init\`) first.\n`);
    return 1;
  }

  if (sub === "write") {
    const card = buildCard({ facts, previous: parseCard(text) });
    const m = /<!-- (?:carja|conductor):project-card:begin[^>]*-->[\s\S]*?<!-- (?:carja|conductor):project-card:end -->/.exec(text);
    let out;
    if (m) out = text.replace(m[0], card);
    else if (/<!-- (?:carja|conductor):framework:end -->/.test(text)) out = text.replace(/<!-- (?:carja|conductor):framework:end -->/, (end) => `${end}\n\n${card}`);
    else out = `${card}\n\n${text}`;
    await writeFile(agentsPath, out, "utf8");
    const todos = (card.match(/TODO/g) ?? []).length;
    stdout.write(`Project card refreshed in AGENTS.md: facts from the code${todos ? `, ${todos} TODO to write` : ""}.\n`);
    stdout.write(todos ? "Write the TODO sections, then run: carja agents-md check\n" : "Run: carja agents-md check\n");
    return 0;
  }

  const result = checkCard(text, facts);
  if (!result.ok) {
    stderr.write(`Project card not ready:\n${result.problems.map((p) => `  - ${p}`).join("\n")}\n`);
    return 1;
  }
  await writeFile(agentsPath, stampCard(text, sources), "utf8");
  stdout.write("✅ Project card complete and current. Stamped against its sources.\n");
  return 0;
}

