// src/personas.js
//
// Which domain personas a change needs, decided from the paths it touches.
//
// Pure: no IO. The rules match WORDS in a path, not substrings, so `token.ts`
// triggers the Security Auditor and `tokenizer.ts` does not. A wrong match
// costs one persona file read, a missed one ships unreviewed auth code, so
// the defaults lean wide. A project narrows or extends them under `personas`
// in carja.config.json.

export const DEFAULT_RULES = {
  // A dependency manifest is where coupling and lock-in enter a codebase.
  architect: {
    extensions: [],
    words: [],
    files: ["package.json", "pyproject.toml", "requirements.txt", "pipfile", "setup.py", "setup.cfg",
      "go.mod", "cargo.toml", "pom.xml", "build.gradle", "build.gradle.kts", "gemfile", "composer.json",
      "pubspec.yaml"],
    context: [".agents/skills/architecture-patterns/SKILL.md"],
  },
  designer: {
    // Server-side templates render screens too: a page built in Jinja is UI.
    extensions: ["css", "scss", "sass", "less", "styl", "vue", "svelte", "html", "htm", "jsx", "tsx",
      "jinja", "jinja2", "j2", "hbs", "handlebars", "ejs", "njk", "erb", "twig", "mustache"],
    words: ["component", "components", "page", "pages", "layout", "layouts", "ui", "style", "styles",
      "screen", "screens", "widget", "widgets", "theme", "themes", "tailwind"],
    context: ["DESIGN.md", ".agents/skills/design-system/SKILL.md", ".agents/skills/frontend-design/SKILL.md"],
  },
  "security-auditor": {
    extensions: [],
    words: ["auth", "authn", "authz", "authentication", "authorization", "login", "logout", "signin",
      "signup", "session", "sessions", "permission", "permissions", "rbac", "acl", "oauth", "oidc",
      "saml", "jwt", "token", "tokens", "password", "passwords", "credential", "credentials", "crypto",
      "secret", "secrets", "csrf", "cors", "middleware", "sanitize", "sanitizer"],
    context: [],
  },
  "database-architect": {
    extensions: ["sql", "prisma"],
    words: ["migration", "migrations", "migrate", "schema", "schemas", "model", "models", "entity",
      "entities", "repository", "repositories", "db", "database", "orm", "seed", "seeds", "alembic",
      "knex", "drizzle", "sequelize", "typeorm", "query", "queries"],
    context: [],
  },
  "performance-optimizer": {
    extensions: [],
    words: ["cache", "caching", "worker", "workers", "queue", "queues", "batch", "perf", "performance",
      "benchmark", "benchmarks", "bench", "profiler", "query", "queries", "webpack", "vite", "rollup"],
    context: [],
  },
};

// How the author settles two findings that pull opposite ways (D1): the earlier
// entry wins. Reversing it changes what the product owner gets, so only the
// product owner can (`po_decision` in the review log).
export const PRECEDENCE = [
  "security-auditor",
  "database-architect",
  "acceptance-criteria",
  "architect",
  "performance-optimizer",
  "designer",
];

export function outranks(winner, loser) {
  const w = PRECEDENCE.indexOf(winner);
  const l = PRECEDENCE.indexOf(loser);
  return w >= 0 && l >= 0 && w < l;
}

// Prose never triggers a persona: `docs/auth.md` is not auth code.
const IGNORED_EXTENSIONS = new Set(["md", "mdx", "txt", "rst", "lock"]);

export function pathWords(path) {
  return path
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
}

function extensionOf(path) {
  const base = path.split("/").pop();
  const dot = base.lastIndexOf(".");
  return dot > 0 ? base.slice(dot + 1).toLowerCase() : "";
}

/** Defaults, with each persona the project configures replaced whole, or removed by `false`. */
export function resolveRules(config) {
  const overrides = config?.personas ?? {};
  const rules = {};
  for (const [name, rule] of Object.entries(DEFAULT_RULES)) {
    const o = overrides[name];
    if (o === false) continue;
    rules[name] = o ? { extensions: [], words: [], files: [], context: rule.context, ...o } : rule;
  }
  return rules;
}

/** One entry per persona that at least one path triggers, with the paths that did. */
export function matchPersonas(paths, rules) {
  const out = [];
  for (const [name, rule] of Object.entries(rules)) {
    const exts = new Set(rule.extensions);
    const words = new Set(rule.words);
    const basenames = new Set(rule.files ?? []);
    const files = paths.filter((p) => {
      const ext = extensionOf(p);
      if (IGNORED_EXTENSIONS.has(ext)) return false;
      if (basenames.has(p.split("/").pop().toLowerCase())) return true;
      return exts.has(ext) || pathWords(p).some((w) => words.has(w));
    });
    if (files.length) out.push({ name, files, context: rule.context });
  }
  return out;
}

/** The bullet lines under `## Review Lens` in a persona file. */
export function extractReviewLens(markdown) {
  const lines = markdown.split("\n");
  const start = lines.findIndex((l) => /^##\s+Review Lens\s*$/.test(l));
  if (start < 0) return [];
  const out = [];
  for (const l of lines.slice(start + 1)) {
    if (/^#{1,2}\s/.test(l)) break;
    const m = l.match(/^\s*-\s+(.*\S)/);
    if (m) out.push(m[1]);
  }
  return out;
}
