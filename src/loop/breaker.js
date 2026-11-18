// src/loop/breaker.js
//
// A3 / F23 (docs/roadmap/Risk-Tiered-Merge.md): the circuit breaker the
// Claude Code team plans for its own merges, "tighten approval when revert or
// incident numbers move". Every item Carja merges without the owner is
// appended to a ledger in the git common dir (carja-auto-merges.jsonl), with
// the base and head of each repository's branch. Before the next merge without
// the owner, the default branch of each repository is read for reverts of the
// last risk.breaker_days days (default 30): a revert names a commit of the item
// (base..head), the item's merge commit, or its merge request. When
// risk.breaker_reverts items (default 2, 0 = off) were reverted, medium goes
// back to the owner. Derived from history every time: nothing to reset; the
// breaker closes again when the reverts leave the window.

import { appendFile, readFile } from "node:fs/promises";
import { join } from "node:path";

import { TIERS } from "./risk.js";

export const LEDGER_FILE = "carja-auto-merges.jsonl";

export const breakerConfig = (risk) => ({ reverts: risk?.breakerReverts ?? 2, days: risk?.breakerDays ?? 30 });

/** The ledger entries a revert touches, once each, in ledger order. */
export function revertedItems(ledger, reverts, { inRange }) {
  const hit = new Set();
  for (const r of reverts ?? []) {
    for (const [i, e] of (ledger ?? []).entries()) {
      for (const [repo, side] of Object.entries(e.repos ?? {})) {
        if (!side?.head || repo !== r.repo) continue;
        const byCommit = r.reverted && (r.reverted === side.head || inRange(repo, r.reverted, side.base, side.head));
        const byMerge = r.mergedHead && r.mergedHead === side.head;
        const byMr = r.mr && (side.url ?? "").match(/\/(merge_requests|pull)\/(\d+)$/)?.[2] === r.mr;
        if (byCommit || byMerge || byMr) hit.add(i);
      }
    }
  }
  return [...hit].sort((a, b) => a - b).map((i) => ledger[i]);
}

/** The risk setting with medium given back to the owner when the breaker trips; `breaker` says why. */
export function tightenedRisk(risk, reverted) {
  const cfg = breakerConfig(risk);
  if (!cfg.reverts || (reverted?.length ?? 0) < cfg.reverts || risk.ownerReview.includes("medium")) return risk;
  return {
    ...risk,
    ownerReview: TIERS.filter((t) => risk.ownerReview.includes(t) || t === "medium" || t === "high"),
    breaker: `${reverted.length} items Carja merged without you were reverted in the last ${cfg.days} days (${reverted.map((r) => r.title).join(", ")}): medium items wait for you again until those reverts are older than ${cfg.days} days.`,
  };
}

/** Append the items merged without the owner. `items`: [{project, title, repos: {outer|code: {base, head, url}}}]. */
export async function recordAutoMerges(gitCommonDir, items, now = new Date()) {
  if (!items.length) return;
  await appendFile(join(gitCommonDir, LEDGER_FILE), items.map((i) => `${JSON.stringify({ at: now.toISOString(), ...i })}\n`).join(""));
}

export async function readLedger(gitCommonDir) {
  const text = await readFile(join(gitCommonDir, LEDGER_FILE), "utf8").catch(() => "");
  return text.split("\n").filter((l) => l.trim()).flatMap((l) => {
    try {
      return [JSON.parse(l)];
    } catch {
      return [];
    }
  });
}

/**
 * The reverts on `ref` in the last `days` days of one repository.
 * @param {(argv: string[]) => Promise<{ok: boolean, stdout: string}>} git
 */
export async function readReverts(git, repo, ref, days, now = Date.now()) {
  const r = await git(["log", ref, `--since=${Math.floor(now / 1000) - days * 86400}`, "--format=%x1e%H%x1f%ct%x1f%B"]);
  if (!r.ok) return [];
  const out = [];
  for (const rec of r.stdout.split("\x1e").filter((x) => x.trim())) {
    const [, ct, body = ""] = rec.split("\x1f");
    const at = Number(ct) * 1000;
    for (const m of body.matchAll(/This reverts commit ([0-9a-f]{7,40})/g)) {
      const second = await git(["rev-parse", "-q", "--verify", `${m[1]}^2`]);
      out.push({ repo, at, reverted: m[1], mergedHead: second.ok && second.stdout ? second.stdout.trim() : null });
    }
    for (const m of body.matchAll(/This reverts merge request !(\d+)|Reverts [\w.-]+\/[\w.-]+#(\d+)/g)) out.push({ repo, at, mr: m[1] ?? m[2] });
  }
  return out;
}

/** Is `sha` a commit of base..head in that repository? */
export const commitInRange = async (git, sha, base, head) => {
  if (!sha || !head) return false;
  const inHead = await git(["merge-base", "--is-ancestor", sha, head]);
  if (!inHead.ok) return false;
  if (!base) return true;
  return !(await git(["merge-base", "--is-ancestor", sha, base])).ok;
};

/** Ledger lines for the stack entries the walk merged without the owner. */
export function ledgerItems(project, entries, mergedUrls) {
  const merged = new Set(mergedUrls ?? []);
  return (entries ?? [])
    .filter((e) => [e.outer?.url, ...(e.code ? [e.code.url] : [])].every((u) => u && merged.has(u)))
    .map((e) => ({
      project,
      title: e.title,
      repos: {
        outer: { base: e.base?.outer ?? null, head: e.outer.head, url: e.outer.url },
        ...(e.code ? { code: { base: e.base?.code ?? null, head: e.code.head, url: e.code.url } } : {}),
      },
    }));
}

/**
 * The risk setting in force now: tightened when the breaker trips.
 * @param {{gitCommonDir: string, repos: {key: "outer"|"code", git: Function, ref: string|null}[], risk: object, now?: number}} input
 */
export async function effectiveRisk({ gitCommonDir, repos, risk, now = Date.now() }) {
  if (!risk?.configured || !breakerConfig(risk).reverts) return risk;
  const ledger = await readLedger(gitCommonDir);
  if (!ledger.length) return risk;
  const { days } = breakerConfig(risk);
  const reverts = [];
  const gitOf = {};
  for (const r of repos) {
    if (!r.ref) continue;
    gitOf[r.key] = r.git;
    reverts.push(...(await readReverts(r.git, r.key, r.ref, days, now)));
  }
  const ranges = new Map();
  for (const rv of reverts) {
    if (!rv.reverted) continue;
    for (const e of ledger) {
      const side = e.repos?.[rv.repo];
      if (side?.head) ranges.set(`${rv.repo}:${rv.reverted}:${side.base}:${side.head}`, await commitInRange(gitOf[rv.repo], rv.reverted, side.base, side.head));
    }
  }
  const inRange = (repo, sha, base, head) => ranges.get(`${repo}:${sha}:${base}:${head}`) ?? false;
  return tightenedRisk(risk, revertedItems(ledger, reverts, { inRange }));
}
