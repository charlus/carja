// src/survey.js
//
// `carja survey` — the facts about a codebase somebody else wrote (F15).
//
// WHY THIS EXISTS. Genesis assumes a blank page. A product owner who has just
// inherited a running product has the opposite problem: the code is the only
// honest record of what the thing does, and the people who knew are gone.
// Carja had no path from an existing codebase into `carja/`.
//
// THE SPLIT IS THE POINT. A script collects facts exhaustively; an agent
// judges them. This file is the script half — deterministic, testable, unable
// to flatter itself. It reports counts and paths a human can check, and it
// says "none found" rather than staying silent, because a missing section
// reads as "there are none" when it means "I did not find any".
//
// It deliberately does NOT infer purpose. What the product is FOR is the one
// thing the code cannot tell you, and guessing it is how a knowledge base
// gets seeded with confident fiction. That is the workflow's job, with the
// human in the room.

import { extname, sep } from "node:path";

/** Trees whose contents would drown every count in the report. */
const EXCLUDED = [
  // Always tooling, whatever the depth.
  /(^|\/)node_modules\//, /(^|\/)\.git\//, /(^|\/)__pycache__\//, /(^|\/)\.venv\//,
  /(^|\/)venv\//, /(^|\/)\.next\//, /(^|\/)\.carja-backup\//, /(^|\/)\.yarn\//,
  /(^|\/)\.nuxt\//, /(^|\/)\.svelte-kit\//, /(^|\/)\.turbo\//, /(^|\/)\.cache\//,
  // Build output only where tools put it: at the root, or at the root of a
  // workspace package. Matching these names at ANY depth dropped a real
  // src/build/compile.js from the report (coverage review, I4).
  /^(dist|build|target|coverage|out|vendor)\//,
  /^(packages|apps|libs|crates|services)\/[^/]+\/(dist|build|target|coverage|out|vendor)\//,
  // No worktree rule here on purpose. A worktree is detected by the `.git` at
  // its root, in the walker — excluding by folder name both missed a worktree
  // at an arbitrary path and would drop a real `src/worktrees/` module.
];

const TEST_PATTERNS = [
  /(\.|_)(test|spec)\./i,
  /(^|\/)(tests?|__tests__|specs?)\//i,
  /(^|\/)test_[^/]*$/i,
  /_test\.[a-z]+$/i,
];

const SOURCE_EXT = new Set([
  ".js", ".jsx", ".ts", ".tsx", ".mjs", ".cjs", ".py", ".go", ".rs", ".java",
  ".rb", ".php", ".c", ".h", ".cc", ".cpp", ".hpp", ".cs", ".swift", ".kt",
  ".scala", ".ex", ".exs", ".dart", ".vue", ".svelte",
]);

const CONFIG_NAMES = new Set([
  "package.json", "tsconfig.json", "pyproject.toml", "setup.py", "go.mod",
  "Cargo.toml", "Gemfile", "pom.xml", "build.gradle", "composer.json",
  "requirements.txt", "Dockerfile", "docker-compose.yml",
]);

const LANG_BY_EXT = {
  ".js": "js", ".jsx": "js", ".mjs": "js", ".cjs": "js",
  ".ts": "ts", ".tsx": "ts", ".py": "py", ".go": "go", ".rs": "rust",
  ".java": "java", ".rb": "ruby", ".php": "php", ".cs": "csharp",
  ".swift": "swift", ".kt": "kotlin", ".vue": "vue", ".svelte": "svelte",
};

/** What kind of file is this, for counting purposes? */
export function classifyFile(relPath) {
  const p = String(relPath).split(sep).join("/");
  if (EXCLUDED.some((re) => re.test(p))) return { kind: "excluded", lang: null };

  const ext = extname(p).toLowerCase();
  const base = p.split("/").pop();

  if (CONFIG_NAMES.has(base) || /\.(ya?ml|toml|ini|cfg)$/i.test(p) || /^\./.test(base)) {
    return { kind: "config", lang: null };
  }
  if (TEST_PATTERNS.some((re) => re.test(p))) return { kind: "test", lang: LANG_BY_EXT[ext] ?? null };
  if (SOURCE_EXT.has(ext)) return { kind: "source", lang: LANG_BY_EXT[ext] ?? null };
  if (/\.(md|rst|txt|adoc)$/i.test(p)) return { kind: "doc", lang: null };
  return { kind: "other", lang: null };
}

/** `tests/lib/hooks-config.test.js` → `hooks-config`. */
function stem(path) {
  const base = String(path).split(sep).join("/").split("/").pop();
  return base
    .replace(/\.[a-z0-9]+$/i, "")
    .replace(/[.\-_](test|spec)$/i, "")
    .replace(/^test_/i, "")
    .replace(/_test$/i, "");
}

/**
 * Find the source area a test stem refers to.
 *
 * Exact first, then drop leading hyphen-segments: Carja's own convention
 * is `test/loop-driver.test.js` for `src/loop/driver.js`, and exact matching
 * missed every one of them — it reported src/loop, one of the most heavily
 * tested areas in this repo, as untested. Dropping from the LEFT keeps the
 * most specific match and never invents one: a stem that reduces to nothing
 * recognised returns null rather than being force-fitted.
 */
function matchSourceStem(testPath, testStem, stemAreas, areaNames) {
  let candidate = testStem;
  // The segments dropped so far. A match found only AFTER dropping must have
  // every dropped segment among its area's path segments: `loop-driver` →
  // `driver` in src/loop is fine, `user-service` → `service` in src/billing is
  // not — that credited billing and hid src/user's gap, the dangerous
  // direction (coverage review, B8). Declining is the correct answer there.
  const dropped = [];
  const agrees = (area) => dropped.every((seg) => area.split("/").includes(seg));
  while (candidate) {
    const areas = stemAreas.get(candidate);
    if (areas && areas.size === 1) {
      const only = [...areas][0];
      return agrees(only) ? only : null;
    }
    if (areas && areas.size > 1) {
      // Ambiguous: index.js and render.js exist many times in a real repo.
      // Prefer the area sharing the longest path prefix with the test; if
      // nothing distinguishes them, return null. A coin-flip attribution is
      // worse than none — it silently credits the wrong area and hides a gap.
      const testParts = String(testPath).split(sep).join("/").split("/");
      let best = null;
      let bestScore = -1;
      let tied = false;
      for (const area of areas) {
        const parts = area.split("/");
        let score = 0;
        while (score < parts.length && parts[score] === testParts[score]) score += 1;
        if (score > bestScore) {
          bestScore = score;
          best = area;
          tied = false;
        } else if (score === bestScore) {
          tied = true;
        }
      }
      return bestScore > 0 && !tied && agrees(best) ? best : null;
    }
    const cut = candidate.indexOf("-");
    if (cut === -1) break;
    dropped.push(candidate.slice(0, cut));
    candidate = candidate.slice(cut + 1);
  }
  // Last resort: a test named after a module DIRECTORY rather than a file.
  // `test/evidence.test.js` covers `src/evidence/{wtree,ledger}.js`, where no
  // single source file carries the name but the area does.
  const byLeaf = [...areaNames].filter((a) => a.split("/").pop() === testStem);
  return byLeaf.length === 1 ? byLeaf[0] : null;
}

/**
 * The source file an import specifier refers to, or null.
 *
 * `require("../src/loop")` names a DIRECTORY: taking the area of the raw
 * specifier read it as area `src`, crediting the parent and leaving src/loop
 * untested (coverage review, I6). Resolve it the way a module loader would:
 * the exact file, then with an extension, then an index file, then anything
 * inside that directory.
 */
const RESOLVE_EXT = [".js", ".ts", ".mjs", ".cjs", ".jsx", ".tsx", ".py"];
function resolveSpecifier(spec, sourceFiles) {
  const s = String(spec ?? "").replace(/\/$/, "");
  if (!s) return null;
  const set = new Set(sourceFiles);
  if (set.has(s)) return s;
  for (const ext of RESOLVE_EXT) if (set.has(s + ext)) return s + ext;
  for (const ext of RESOLVE_EXT) if (set.has(`${s}/index${ext}`)) return `${s}/index${ext}`;
  return sourceFiles.find((f) => f.startsWith(`${s}/`)) ?? null;
}

/** The area a path belongs to: its first two segments, or its first. */
function areaOf(path) {
  const parts = String(path).split(sep).join("/").split("/");
  return parts.length > 2 ? `${parts[0]}/${parts[1]}` : parts[0];
}

/**
 * Source and test counts per area, untested first.
 *
 * The single most useful fact for someone inheriting a product: which parts
 * nobody has ever tested. Not a quality score — a place to look first. An
 * area with no source at all is omitted: a docs folder has nothing to test,
 * and listing it as a risk is the noise that gets a risk report skimmed.
 *
 * A test is credited to the area of the source it IMPORTS when that can be
 * resolved, and otherwise to the source file it appears to be named after —
 * never to its own path. Grouping tests by prefix looked right against invented fixtures with
 * co-located tests, and was badly wrong on the first real repo it met: ECC
 * keeps 320 tests in a central tests/ tree, so every source area came back
 * "no tests" — a false alarm in the one section the reader is told to read
 * first. A test whose stem matches no source falls back to its own area, so
 * co-located layouts behave exactly as before.
 */
export function coverageByArea(paths, { importsByTest = {} } = {}) {
  const stemAreas = new Map();
  const byArea = new Map();
  const touch = (area) => {
    if (!byArea.has(area)) byArea.set(area, { area, source: 0, tests: 0 });
    return byArea.get(area);
  };

  const tests = [];
  for (const p of paths) {
    const { kind } = classifyFile(p);
    if (kind === "source") {
      const area = areaOf(p);
      touch(area).source += 1;
      // First one wins: a stem shared across areas is ambiguous either way.
      // Every area a stem appears in, so an ambiguous name can be detected
      // rather than resolved by whichever readdir arrived first.
      const key = stem(p);
      if (!stemAreas.has(key)) stemAreas.set(key, new Set());
      stemAreas.get(key).add(area);
    } else if (kind === "test") {
      tests.push(p);
    }
  }

  // Materialised ONCE: byArea.keys() is an iterator, and passing it into the
  // loop meant every test after the first saw an exhausted one. The unit test
  // had a single test file, so it passed; the real repo did not.
  const areaNames = [...byArea.keys()];
  const sourceFiles = paths
    .map((p) => String(p).split(sep).join("/"))
    .filter((p) => classifyFile(p).kind === "source");
  for (const p of tests) {
    // What the test IMPORTS is a fact; what it is named is a guess. Prefer
    // the fact. This repo has both src/commands/evidence.js and src/evidence/,
    // which no name-based rule can tell apart.
    const imported = (importsByTest[p] ?? [])
      .map((spec) => resolveSpecifier(spec, sourceFiles))
      .filter(Boolean)
      .map((src) => areaOf(src))
      .filter((a) => byArea.has(a) && byArea.get(a).source > 0);
    const target = imported.length ? imported[0] : matchSourceStem(p, stem(p), stemAreas, areaNames);
    // An orphan test names no source we found. Credit it to its own area only
    // if that area has source — otherwise it would invent a `tests/` area.
    const area = target ?? areaOf(p);
    if (!byArea.has(area) || byArea.get(area).source === 0) continue;
    byArea.get(area).tests += 1;
  }

  return [...byArea.values()]
    .filter((a) => a.source > 0)
    .sort((a, b) => {
      const ra = a.tests / a.source;
      const rb = b.tests / b.source;
      return ra - rb || b.source - a.source || a.area.localeCompare(b.area);
    });
}

/**
 * Configuration key NAMES from a .env.example.
 * Values are discarded deliberately: a survey is committed to `carja/`,
 * and carrying values across would publish whatever someone left in the
 * example file.
 */
export function extractEnvKeys(text) {
  const keys = new Set();
  for (const line of String(text ?? "").split("\n")) {
    const m = line.match(/^\s*(?:export\s+)?([A-Z][A-Z0-9_]*)\s*=/);
    if (m) keys.add(m[1]);
  }
  return [...keys].sort();
}

const JS_ROUTE =
  // No `api`: `api.get("/users/me")` is an HTTP CLIENT call, not a handler
  // (coverage review, I7). These receivers are the ones that declare routes.
  /(?:^|[^\w.])(?:app|router|server|routes)\s*\.\s*(get|post|put|patch|delete|options|head)\s*\(\s*['"`]([^'"`]+)['"`]/gi;
const PY_ROUTE =
  /^\s*@\s*(?:app|router|bp|blueprint)\s*\.\s*(get|post|put|patch|delete)\s*\(\s*['"]([^'"]+)['"]/gim;

/** HTTP routes a file declares. Comments are stripped first — a mention is not a route. */
export function findRoutes(text, lang = "js") {
  const src = String(text ?? "")
    .split("\n")
    .filter((l) => !/^\s*(\/\/|#)/.test(l))
    .join("\n");

  const out = new Set();
  const re = lang === "py" ? PY_ROUTE : JS_ROUTE;
  re.lastIndex = 0;
  let m;
  while ((m = re.exec(src)) !== null) {
    const path = m[2];
    // A route path starts with "/" — this filters out a string that merely
    // looks like a call, which is the common false positive.
    if (!path.startsWith("/")) continue;
    out.add(`${m[1].toUpperCase()} ${path}`);
  }
  return [...out];
}

/**
 * Entry points, read from the manifest rather than guessed from filenames.
 * `manifests` maps a manifest path to its raw text.
 */
export function findEntryPoints(manifests = {}) {
  const out = new Set();
  const pkgText = manifests["package.json"];
  if (pkgText) {
    try {
      const pkg = JSON.parse(pkgText);
      if (typeof pkg.main === "string") out.add(pkg.main);
      if (typeof pkg.module === "string") out.add(pkg.module);
      if (typeof pkg.bin === "string") out.add(pkg.bin);
      else if (pkg.bin && typeof pkg.bin === "object") {
        for (const v of Object.values(pkg.bin)) if (typeof v === "string") out.add(v);
      }
      // `start` runs the product; `test`/`build` do not.
      const start = pkg.scripts?.start;
      // Values stay out: `STRIPE_KEY=sk_live_… node src/cli.js` is reported as
      // `STRIPE_KEY=… node src/cli.js`. A survey is committed to carja/
      // (coverage review, I5), and the key names are already reported.
      if (typeof start === "string") {
        out.add(`(npm start) ${start.replace(/\b([A-Za-z_][A-Za-z0-9_]*)=\S+/g, "$1=…")}`);
      }
    } catch {
      /* a broken manifest is a fact about the repo, not a reason to abort */
    }
  }
  return [...out];
}

const section = (title, items, empty) =>
  `## ${title}\n\n${items.length ? items.join("\n") : `_${empty}_`}\n`;

/** The survey, as the markdown a human and an agent both read. */
export function renderSurvey(facts) {
  const {
    root = "", fileCount = 0, languages = [], areas = [], entryPoints = [],
    routes = [], envKeys = [], dependencies = { runtime: [], dev: [] },
    nestedCheckouts = [],
  } = facts ?? {};

  const untested = areas.filter((a) => a.tests === 0);
  const langLine = languages.length
    ? languages.map((l) => `${l.lang} ${l.files}`).join(", ")
    : "none detected";

  return [
    `# Survey — ${root}`,
    "",
    "> Facts only, collected by `carja survey`. Nothing here is an opinion,",
    "> and nothing here says what the product is **for** — the code cannot tell",
    "> you that. Use this as the agenda for the interview with the human, not as",
    "> a substitute for it.",
    "",
    `**${fileCount} files** · ${langLine}`,
    "",
    // The risk map leads, because it is what the reader came for.
    section(
      "Untested areas — look here first",
      untested.map((a) => `- \`${a.area}\` — ${a.source} source file${a.source === 1 ? "" : "s"}, **no tests**`),
      "every area with source has at least one test",
    ),
    section(
      "Coverage by area",
      areas.map((a) => `- \`${a.area}\` — ${a.source} source, ${a.tests} test${a.tests === 1 ? "" : "s"}`),
      "no source files found",
    ),
    section("Entry points", entryPoints.map((e) => `- \`${e}\``), "none found in the manifest"),
    section("HTTP routes", routes.map((r) => `- \`${r}\``), "none found"),
    section("Configuration keys", envKeys.map((k) => `- \`${k}\``), "none found"),
    section(
      "Dependencies",
      [
        ...(dependencies.runtime ?? []).map((d) => `- \`${d}\``),
        ...(dependencies.dev ?? []).map((d) => `- \`${d}\` _(dev)_`),
      ],
      "none found",
    ),
    ...(nestedCheckouts.length
      ? [
          `> Skipped ${nestedCheckouts.length} separate checkout${nestedCheckouts.length === 1 ? "" : "s"} ` +
            `(a worktree, submodule or nested repo — its own \`.git\`): ` +
            nestedCheckouts.map((n) => `\`${n}\``).join(", ") + ".",
          "",
        ]
      : []),
    "> Coverage is attributed by what each test imports where that resolves,",
    "> and otherwise by the source file the test appears to be named after —",
    "> declining when the name is ambiguous. Treat an area marked untested as a",
    "> place to check rather than a proven gap.",
    "",
    "## What this does not tell you",
    "",
    "Who uses it, what it is for, which behaviour must never break, and what",
    "the last team was in the middle of. Those come from the human.",
    "",
  ].join("\n");
}

/**
 * Relative source paths a test file imports, resolved against the repo root.
 *
 * Reading the imports is the difference between attributing coverage by fact
 * and attributing it by guess. Only RELATIVE specifiers are considered — a
 * package import says nothing about which area of this repo is covered.
 */
export function resolveTestImports(testPath, text) {
  const out = new Set();
  const dir = String(testPath).split(sep).join("/").split("/").slice(0, -1);
  const re = /(?:from\s+|import\s+|require\s*\(\s*)['"](\.[^'"]+)['"]/g;
  let m;
  while ((m = re.exec(String(text ?? ""))) !== null) {
    const parts = [...dir];
    for (const seg of m[1].split("/")) {
      if (seg === "." || seg === "") continue;
      if (seg === "..") parts.pop();
      else parts.push(seg);
    }
    const resolved = parts.join("/");
    if (resolved) out.add(resolved);
  }
  return [...out];
}
