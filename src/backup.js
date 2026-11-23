import { cpSync, existsSync, mkdirSync, readFileSync, writeFileSync, rmSync, renameSync } from "node:fs";
import { dirname, join, relative, sep } from "node:path";

export const BACKUP_DIR = ".carja-backup";

/**
 * Paths a backup never copies and a restore never touches: the live worktrees,
 * full checkouts with their node_modules (2026-11-23: 9.9 GB of copies over
 * three projects). Their work is in git branches, not in the framework.
 */
export const BACKUP_SKIP = Object.freeze([join(".agents", ".worktrees")]);

const skipped = (targetDir, path) => {
  const rel = relative(targetDir, path);
  return BACKUP_SKIP.some((s) => rel === s || rel.startsWith(s + sep));
};

/** Filesystem-safe timestamp. `nowIso` injectable for deterministic tests. */
export function backupStamp(nowIso) {
  return (nowIso || new Date().toISOString()).replace(/[:.]/g, "-");
}

/**
 * Copy each existing relative path under targetDir into
 * `.carja-backup/<timestamp>/<relpath>`, preserving structure.
 * Returns { backupRoot, copied: string[] }. Non-existent paths are skipped.
 */
export function createBackup(targetDir, relPaths, { nowIso } = {}) {
  const backupRoot = join(targetDir, BACKUP_DIR, backupStamp(nowIso));
  const copied = [];
  for (const rel of relPaths) {
    const src = join(targetDir, rel);
    if (!existsSync(src)) continue;
    const dst = join(backupRoot, rel);
    mkdirSync(dirname(dst), { recursive: true });
    cpSync(src, dst, { recursive: true, filter: (from) => !skipped(targetDir, from) });
    copied.push(rel);
  }
  return { backupRoot, copied };
}

/** Restore the given relative paths from a backup root back into targetDir. */
export function restoreBackup(targetDir, backupRoot, relPaths) {
  for (const rel of relPaths) {
    const src = join(backupRoot, rel);
    if (!existsSync(src)) continue;
    const dst = join(targetDir, rel);
    // Move the skipped paths under dst aside, replace dst, then put them back.
    const kept = BACKUP_SKIP.filter((s) => s.startsWith(rel + sep) && existsSync(join(targetDir, s)));
    const aside = (s) => join(targetDir, BACKUP_DIR, `restore-keep-${process.pid}-${s.split(sep).join("_")}`);
    for (const s of kept) {
      mkdirSync(join(targetDir, BACKUP_DIR), { recursive: true });
      renameSync(join(targetDir, s), aside(s));
    }
    rmSync(dst, { recursive: true, force: true });
    mkdirSync(dirname(dst), { recursive: true });
    cpSync(src, dst, { recursive: true });
    for (const s of kept) {
      mkdirSync(dirname(join(targetDir, s)), { recursive: true });
      renameSync(aside(s), join(targetDir, s));
    }
  }
}

/** Ensure `.carja-backup/` is git-ignored. Returns true if it added the entry. */
export function ensureGitignore(targetDir, entry = `${BACKUP_DIR}/`) {
  const p = join(targetDir, ".gitignore");
  let content = existsSync(p) ? readFileSync(p, "utf8") : "";
  const bare = entry.replace(/\/$/, "");
  if (content.split(/\r?\n/).some((l) => {
    const t = l.trim();
    return t === entry || t === bare;
  })) {
    return false;
  }
  if (content && !content.endsWith("\n")) content += "\n";
  writeFileSync(p, content + entry + "\n");
  return true;
}
