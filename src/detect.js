/**
 * detect.js — Tech stack detection for auto-recommending registry skills.
 *
 * Scans a project directory for common indicators (config files, lock files,
 * directory structures) and returns a list of detected technologies.
 * These are matched against the `techStack` field in skill manifests.
 */

import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { exists } from "./registry.js";

/**
 * Each detector checks for the presence of files/patterns and returns
 * matching tech stack identifiers (matching skill.json `techStack` values).
 */
const DETECTORS = [
  // --- JavaScript / TypeScript ---
  {
    tech: ["react"],
    check: async (dir) => {
      const pkg = await readPkg(dir);
      return hasDep(pkg, "react") || hasDep(pkg, "react-dom");
    },
  },
  {
    tech: ["nextjs", "react"],
    check: async (dir) => {
      const pkg = await readPkg(dir);
      return hasDep(pkg, "next");
    },
  },
  {
    tech: ["vite"],
    check: async (dir) => {
      const pkg = await readPkg(dir);
      return hasDep(pkg, "vite") || (await exists(join(dir, "vite.config.ts"))) || (await exists(join(dir, "vite.config.js")));
    },
  },
  {
    tech: ["typescript"],
    check: async (dir) => {
      return (await exists(join(dir, "tsconfig.json"))) || (await exists(join(dir, "tsconfig.base.json")));
    },
  },
  {
    tech: ["tailwind"],
    check: async (dir) => {
      return (await exists(join(dir, "tailwind.config.js"))) || (await exists(join(dir, "tailwind.config.ts")));
    },
  },
  {
    tech: ["shadcn"],
    check: async (dir) => {
      return (await exists(join(dir, "components.json")));
    },
  },
  {
    tech: ["vue"],
    check: async (dir) => {
      const pkg = await readPkg(dir);
      return hasDep(pkg, "vue");
    },
  },
  {
    tech: ["angular"],
    check: async (dir) => {
      return (await exists(join(dir, "angular.json")));
    },
  },
  {
    tech: ["svelte"],
    check: async (dir) => {
      const pkg = await readPkg(dir);
      return hasDep(pkg, "svelte");
    },
  },
  {
    tech: ["remotion", "react"],
    check: async (dir) => {
      const pkg = await readPkg(dir);
      return hasDep(pkg, "remotion") || hasDep(pkg, "@remotion/cli");
    },
  },
  {
    tech: ["expo", "react"],
    check: async (dir) => {
      const pkg = await readPkg(dir);
      return hasDep(pkg, "expo");
    },
  },

  // --- Python ---
  {
    tech: ["python"],
    check: async (dir) => {
      return (
        (await exists(join(dir, "requirements.txt"))) ||
        (await exists(join(dir, "pyproject.toml"))) ||
        (await exists(join(dir, "setup.py"))) ||
        (await exists(join(dir, "Pipfile")))
      );
    },
  },
  {
    tech: ["django", "python"],
    check: async (dir) => {
      return (await exists(join(dir, "manage.py")));
    },
  },
  {
    tech: ["fastapi", "python"],
    check: async (dir) => {
      const req = await readTextFile(join(dir, "requirements.txt"));
      return req?.toLowerCase().includes("fastapi") ?? false;
    },
  },
  {
    tech: ["flask", "python"],
    check: async (dir) => {
      const req = await readTextFile(join(dir, "requirements.txt"));
      return req?.toLowerCase().includes("flask") ?? false;
    },
  },

  // --- DevOps / Infra ---
  {
    tech: ["docker"],
    check: async (dir) => {
      return (
        (await exists(join(dir, "Dockerfile"))) ||
        (await exists(join(dir, "docker-compose.yml"))) ||
        (await exists(join(dir, "docker-compose.yaml")))
      );
    },
  },
  {
    tech: ["terraform"],
    check: async (dir) => {
      return (await exists(join(dir, "main.tf")));
    },
  },
  {
    tech: ["kubernetes"],
    check: async (dir) => {
      return (
        (await exists(join(dir, "k8s"))) ||
        (await exists(join(dir, "kubernetes")))
      );
    },
  },

  // --- Git platforms ---
  {
    tech: ["github"],
    check: async (dir) => {
      return (await exists(join(dir, ".github")));
    },
  },
  {
    tech: ["gitlab"],
    check: async (dir) => {
      return (await exists(join(dir, ".gitlab-ci.yml")));
    },
  },

  // --- Databases ---
  {
    tech: ["postgres"],
    check: async (dir) => {
      const pkg = await readPkg(dir);
      return hasDep(pkg, "pg") || hasDep(pkg, "prisma") || hasDep(pkg, "knex");
    },
  },
  {
    tech: ["supabase"],
    check: async (dir) => {
      const pkg = await readPkg(dir);
      return hasDep(pkg, "@supabase/supabase-js");
    },
  },

];

// --- Helpers ---

let _pkgCache = null;

async function readPkg(dir) {
  if (_pkgCache !== null) return _pkgCache;
  try {
    const raw = await readFile(join(dir, "package.json"), "utf-8");
    _pkgCache = JSON.parse(raw);
  } catch {
    _pkgCache = {};
  }
  return _pkgCache;
}

function hasDep(pkg, name) {
  return !!(
    pkg?.dependencies?.[name] ||
    pkg?.devDependencies?.[name] ||
    pkg?.peerDependencies?.[name]
  );
}

async function readTextFile(path) {
  try {
    return await readFile(path, "utf-8");
  } catch {
    return null;
  }
}

/**
 * Detect the tech stack of a project.
 * @param {string} projectDir - Root directory of the project
 * @returns {Promise<string[]>} Deduplicated list of detected tech identifiers
 */
export async function detectTechStack(projectDir) {
  _pkgCache = null; // Reset cache for each run
  const detected = new Set();

  for (const detector of DETECTORS) {
    try {
      if (await detector.check(projectDir)) {
        for (const t of detector.tech) {
          detected.add(t);
        }
      }
    } catch {
      // Skip detectors that throw — file access issues, etc.
    }
  }

  return [...detected].sort();
}

// ---------------------------------------------------------------------------
// Verification command suggestion (O6)
// ---------------------------------------------------------------------------

async function readJson(path) {
  try {
    return JSON.parse(await readFile(path, "utf-8"));
  } catch {
    return null;
  }
}

/**
 * Derive the project's verification command from the files that are actually
 * present. Deterministic, no model call.
 *
 * WHY. `pre-push` enforces the Verification Iron Law only when
 * `carja.config.json` carries a `verify` command (or `package.json` has a
 * `test` script — the hook's own fallback, mirrored here as the first rule so
 * the CLI and the hook never disagree). Measured 2026-09-15: one of five live
 * installs had one; the other four were skipping the gate silently. Nothing
 * here guesses — when no rule matches the answer is "", and the caller warns.
 *
 * @param {string} projectDir
 * @returns {Promise<string>} the command, or "" when none can be derived
 */
export async function suggestVerifyCommand(projectDir) {
  const pkg = await readJson(join(projectDir, "package.json"));
  if (pkg?.scripts?.test) return "npm test";

  // Two-package layouts (backend/ + frontend/, server/ + client/ …): run each.
  const subs = [];
  for (const sub of ["backend", "frontend", "server", "client", "api", "web"]) {
    const p = await readJson(join(projectDir, sub, "package.json"));
    if (p?.scripts?.test) subs.push(sub);
  }
  if (subs.length) return subs.map((s) => `npm --prefix ${s} test`).join(" && ");

  const pyproject = await readTextFile(join(projectDir, "pyproject.toml"));
  const requirements = [
    await readTextFile(join(projectDir, "requirements.txt")),
    await readTextFile(join(projectDir, "requirements-dev.txt")),
  ]
    .filter(Boolean)
    .join("\n");
  const usesPytest =
    /pytest/i.test(`${pyproject ?? ""}\n${requirements}`) ||
    (await exists(join(projectDir, "pytest.ini"))) ||
    (await exists(join(projectDir, "conftest.py")));
  if (usesPytest) {
    if (pyproject && /\[tool\.poetry\]/.test(pyproject)) return "poetry run pytest -q";
    if (await exists(join(projectDir, ".venv", "bin", "python"))) return ".venv/bin/python -m pytest -q";
    return "python -m pytest -q";
  }

  if (await exists(join(projectDir, "go.mod"))) return "go test ./...";
  if (await exists(join(projectDir, "Cargo.toml"))) return "cargo test";
  return "";
}
