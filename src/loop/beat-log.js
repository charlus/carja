// src/loop/beat-log.js
//
// F11: keep each agent beat's output. Without it, a beat that did nothing left
// no trace once teardown removed its clean worktree. Logs go in the main repo's
// git dir (`.git/carja-loop-logs/`): outside every worktree, never committed,
// and untouched by `carja upgrade`. The newest KEEP logs are kept.

import { mkdir, readdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";

export const BEAT_LOG_DIR = "carja-loop-logs";
/** F21: the driver's `- [<iso>] [loop] …` audit lines, in BEAT_LOG_DIR. */
export const AUDIT_FILE = "audit.md";
const KEEP = 200;

/** `<ISO time>-<label>.log`: sorts by time, safe as a file name. */
export function beatLogName({ now, label }) {
  const stamp = new Date(now).toISOString().replace(/[:.]/g, "-");
  const slug = String(label ?? "beat").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60);
  return `${stamp}-${slug || "beat"}.log`;
}

/** A14: role, model, task, duration, tokens and cost of one beat, on one line. */
export function usageLine({ role, model, task, duration_s, tokens, cost_usd, cache_pct = null }) {
  return [
    `role=${role}`,
    `model=${model ?? "default"}`,
    ...(task ? [`task=${task}`] : []),
    `duration=${duration_s ?? "?"}s`,
    `tokens=${tokens ?? "unknown"}`,
    `cost=${cost_usd === null || cost_usd === undefined ? "unknown" : `$${cost_usd.toFixed(4)}`}`,
    ...(cache_pct === null ? [] : [`cached=${cache_pct}%`]),
  ].join(" ");
}

/** Write one beat's log into `dir`, prune old logs, and return the log's path. */
export async function writeBeatLog(dir, { now, label, cwd, result = {}, usage = null, keep = KEEP }) {
  await mkdir(dir, { recursive: true });
  const path = join(dir, beatLogName({ now, label }));
  const text = [
    `# ${label}`,
    "",
    `- time: ${new Date(now).toISOString()}`,
    `- cwd: ${cwd}`,
    `- exit code: ${result.exitCode ?? "(none)"}`,
    ...(usage ? [`- usage: ${usageLine(usage)}`] : []),
    "",
    "## stdout",
    "",
    String(result.stdout ?? "").trimEnd() || "(empty)",
    "",
    "## stderr",
    "",
    String(result.stderr ?? "").trimEnd() || "(empty)",
    "",
  ].join("\n");
  await writeFile(path, text, "utf8");
  const logs = (await readdir(dir)).filter((n) => n.endsWith(".log")).sort();
  for (const old of logs.slice(0, Math.max(0, logs.length - keep))) await rm(join(dir, old), { force: true });
  return path;
}
