// src/loop/lock.js
//
// A single-holder run lock for a Carja target. Independent `carja loop`
// PROCESSES are not concurrency-safe with each other: they race on the shared
// worktree, branch, PR, and the carja/ → source-of-truth write-back (the
// in-process swarm merge queue is serialized; separate processes are not). One
// loop per target. The lock lives at carja/1-workbench/loop.lock and holds
// the owner pid; a lock whose owner is dead is stale and may be stolen (a crash
// must never strand the target forever).
//
// This module is PURE: the decision is computed from the existing lock text and
// a caller-supplied "is that pid alive?" answer, so it is unit-testable without
// touching the filesystem or real processes. loop.js does the IO.

/** Parse a lock file body → { pid, at } | null (null on missing/corrupt). */
export function parseLock(text) {
  if (!text) return null;
  try {
    const obj = JSON.parse(text);
    const pid = Number(obj?.pid);
    if (!Number.isInteger(pid) || pid <= 0) return null;
    return { pid, at: typeof obj.at === "string" ? obj.at : null };
  } catch {
    return null;
  }
}

/** Render a lock file body for `pid` stamped at ISO string `at`. */
export function renderLock(pid, at) {
  return `${JSON.stringify({ pid, at })}\n`;
}

/**
 * Decide whether this process may take the lock.
 *   existingText — current lock file contents ("" / null if absent)
 *   isAlive(pid) — caller predicate: is that pid a live process?
 * @returns {{ acquire: boolean, heldByPid?: number, stale?: boolean }}
 *   acquire:true          → free / corrupt / stale (owner dead) → take it
 *   acquire:false + heldByPid → a live owner holds it → refuse
 */
export function lockDecision({ existingText, isAlive }) {
  const prev = parseLock(existingText);
  if (!prev) return { acquire: true }; // absent or corrupt → free to take
  if (isAlive(prev.pid)) return { acquire: false, heldByPid: prev.pid };
  return { acquire: true, stale: true, heldByPid: prev.pid }; // owner dead → steal
}
