import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

import { CURRENT, STAMP_FILES } from "./names.js";

/** The stamp file writers use. Readers accept every name in STAMP_FILES. */
export const STAMP_FILE = `.${CURRENT}-version.json`;

/** The framework version shipped by this package (single source of truth). */
export function packageVersion() {
  const pkgPath = fileURLToPath(new URL("../package.json", import.meta.url));
  return JSON.parse(readFileSync(pkgPath, "utf8")).version;
}

/** Read the version stamp written into an installed `.agents/`, or null. */
export function readVersionStamp(agentsDir) {
  const name = STAMP_FILES.find((f) => existsSync(join(agentsDir, f)));
  if (!name) return null;
  const p = join(agentsDir, name);
  try {
    return JSON.parse(readFileSync(p, "utf8"));
  } catch {
    return null;
  }
}

/**
 * Write/refresh the version stamp. Preserves the original installedAt.
 * `nowIso` is injectable for deterministic tests.
 */
export function writeVersionStamp(agentsDir, { nowIso } = {}) {
  const ts = nowIso || new Date().toISOString();
  const existing = readVersionStamp(agentsDir);
  const stamp = {
    frameworkVersion: packageVersion(),
    installedAt: existing?.installedAt || ts,
    upgradedAt: ts,
    schema: { selections: 1, loopState: 2 },
  };
  writeFileSync(join(agentsDir, STAMP_FILE), JSON.stringify(stamp, null, 2) + "\n");
  return stamp;
}

/**
 * Best-effort structural shape detection for installs with no version stamp.
 * Migrations are idempotent and structure-driven, so this is mainly for
 * reporting and the "already current" fast path.
 * Returns: "v4" | "v5" | "unknown".
 */
export function detectShape(targetDir) {
  const has = (p) => existsSync(join(targetDir, p));
  // V4-era: singular .agent/, dotted .conductor/, or root Title/kebab numbered folders
  // living outside a carja/ wrapper.
  if (has(".agent") || has(".conductor")) return "v4";
  const state = has("carja") || has("conductor");
  if ((has("0-Compass") || has("0-compass")) && !state) return "v4";
  if (has(".agents") && state) return "v5";
  return "unknown";
}
