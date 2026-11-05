import { cpSync, existsSync, mkdirSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";

export const BACKUP_DIR = ".carja-backup";

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
    cpSync(src, dst, { recursive: true });
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
    rmSync(dst, { recursive: true, force: true });
    mkdirSync(dirname(dst), { recursive: true });
    cpSync(src, dst, { recursive: true });
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
