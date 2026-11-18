// src/reviewer-recall.js
//
// F10 (docs/roadmap/Risk-Tiered-Merge.md): measure the reviewer on the bugs
// that mattered, after the Claude Code team's eval. A case is a commit that
// later had to be reverted or fixed (an incident) or a commit that stayed clean
// (a control, size-matched). The answer key is where the fixing commit changed
// the code: a finding counts when it names a fixed file within 3 lines of a
// fixed hunk. Recall of any finding, recall of blockers and blockers on clean
// controls are kept apart, so a reviewer that finds a bug and then drops it, or
// one that blocks everything, shows. Fixes written in prose (no revert, no
// trailer) are traced with SZZ: `git blame` on the lines a `fix` commit changed
// names the commit that introduced them. Pure, except harvestCases (git).

import { execFileSync } from "node:child_process";

const REVERT = /This reverts commit ([0-9a-f]{6,40})/;
const FIXES = /^Fixes:\s*([0-9a-f]{6,40})\b/im;

/** Commits that undo or fix an earlier one: [{bad, fix, key, kind}]. */
export function incidentsFromLog(log) {
  const out = [];
  for (const c of log ?? []) {
    const r = String(c.body ?? "").match(REVERT);
    const f = String(c.body ?? "").match(FIXES);
    if (r) out.push({ bad: r[1], fix: c.sha, key: c.subject, kind: "revert" });
    else if (f) out.push({ bad: f[1], fix: c.sha, key: c.subject, kind: "fix" });
  }
  return out;
}

/** The old-side line ranges a unified diff (-U0) changes, per file: {file: [[from, to]]}. */
export function parseHunks(diff) {
  const out = {};
  let file = null;
  for (const line of String(diff ?? "").split("\n")) {
    const m = line.match(/^--- (?:a\/)?(.+)$/);
    if (m) {
      file = m[1] === "/dev/null" ? null : m[1];
      continue;
    }
    const p = line.match(/^\+\+\+ (?:b\/)?(.+)$/);
    if (p && !file && p[1] !== "/dev/null") file = p[1];
    const h = line.match(/^@@ -(\d+)(?:,(\d+))? /);
    if (h && file) {
      const from = Number(h[1]);
      const n = h[2] === undefined ? 1 : Number(h[2]);
      (out[file] ??= []).push([from, from + Math.max(n, 1) - 1]);
    }
  }
  return out;
}

const norm = (f) => String(f ?? "").replace(/^\.\//, "");

/** Files that are not code for the answer key: documentation and Carja's own records. */
const NOT_CODE = /(\.(md|mdx|txt|rst)$)|(^|\/)(carja|docs)\//i;
const FIX_SUBJECT = /^fix(\(|:|!)/i;

/** The code hunks of a diff, without documentation. */
const codeHunks = (h) => Object.fromEntries(Object.entries(h).filter(([f]) => !NOT_CODE.test(f)));

/** Does a finding land where the fix changed the code (same file, within 3 lines)? */
export function findingHits(finding, hunks, slack = 3) {
  const ranges = hunks?.[norm(finding?.file)];
  const line = Number(finding?.line);
  if (!ranges || !Number.isFinite(line)) return false;
  return ranges.some(([a, b]) => line >= a - slack && line <= b + slack);
}

/** Findings in the reviewer.md report shape: `[SEVERITY] (confidence N) file:line`. */
export function parseReviewerReport(text) {
  const out = [];
  for (const m of String(text ?? "").matchAll(/^\[([A-Z-]+)\]\s*\(confidence\s*(\d+)\)\s*(\S+?):(\d+)/gm)) {
    out.push({ severity: m[1], confidence: Number(m[2]), file: m[3], line: Number(m[4]) });
  }
  return out;
}

/** {incidents, controls, recall_any, recall_blocker, control_blocked} over reviewed cases. */
export function scoreRun(cases) {
  const inc = cases.filter((c) => c.kind === "incident");
  const ctl = cases.filter((c) => c.kind === "control");
  const blocker = (f) => String(f?.severity).toUpperCase() === "BLOCKER";
  const share = (n, d) => (d ? n / d : 0);
  return {
    incidents: inc.length,
    controls: ctl.length,
    recall_any: share(inc.filter((c) => (c.findings ?? []).some((f) => findingHits(f, c.hunks))).length, inc.length),
    recall_blocker: share(inc.filter((c) => (c.findings ?? []).some((f) => blocker(f) && findingHits(f, c.hunks))).length, inc.length),
    control_blocked: share(ctl.filter((c) => (c.findings ?? []).some(blocker)).length, ctl.length),
  };
}

/**
 * The eval cases of a repository: each incident with its hunks, and one clean
 * control per incident, nearest in changed lines, at least `controlMinAgeDays` old.
 */
export function harvestCases(dir, { controlMinAgeDays = 30, maxCommits = 2000, now = Date.now() } = {}) {
  const git = (...a) => execFileSync("git", a, { cwd: dir, stdio: ["ignore", "pipe", "ignore"], maxBuffer: 64 * 1024 * 1024 }).toString();
  const raw = git("log", "--no-merges", `-n${maxCommits}`, "--format=%x1e%H%x1f%P%x1f%ct%x1f%s%x1f%b%x1f", "--numstat");
  const log = [];
  for (const rec of raw.split("\x1e").filter((x) => x.trim())) {
    const [sha, parents, ct, subject, body, rest = ""] = rec.split("\x1f");
    const changed = rest.split("\n").map((l) => l.split("\t")).filter((p) => p.length === 3).reduce((s, [a, d]) => s + (Number(a) || 0) + (Number(d) || 0), 0);
    log.push({ sha, parents: parents.trim(), at: Number(ct) * 1000, subject, body, changed });
  }
  const full = (s) => {
    try {
      return git("rev-parse", "--verify", "-q", `${s}^{commit}`).trim();
    } catch {
      return null;
    }
  };
  const cases = [];
  const used = new Set();
  const add = (badRef, fix, key, hunks) => {
    const bad = full(badRef);
    const meta = log.find((c) => c.sha === bad);
    if (!bad || !meta?.parents || used.has(bad) || !Object.keys(hunks).length) return;
    used.add(bad).add(fix);
    cases.push({ kind: "incident", bad, base: meta.parents.split(" ")[0], key, hunks, changed: meta.changed });
  };
  const explicit = incidentsFromLog(log);
  for (const i of explicit) add(i.bad, i.fix, i.key, codeHunks(parseHunks(git("show", "-U0", "--format=", i.fix))));
  // SZZ: a fix commit with no revert or trailer. The commit that introduced most
  // of the lines it changed is the incident; only those lines are the key.
  // A fix made in a review round is a bug the reviewer already caught: it would inflate recall.
  for (const c of log.filter((x) => FIX_SUBJECT.test(x.subject) && !/\breview\b/i.test(x.subject) && x.parents && !explicit.some((i) => i.fix === x.sha))) {
    const hunks = codeHunks(parseHunks(git("show", "-U0", "--format=", c.sha)));
    const blamed = new Map();
    for (const [file, ranges] of Object.entries(hunks)) {
      for (const [a, b] of ranges) {
        let out = "";
        try {
          out = git("blame", "--porcelain", "-L", `${a},${b}`, `${c.parents.split(" ")[0]}`, "--", file);
        } catch {
          continue;
        }
        // Porcelain: <sha> <line in that commit> <line now>. The key is in the
        // introducing commit's own line numbers: that is the code the reviewer sees.
        for (const m of out.matchAll(/^([0-9a-f]{40}) (\d+) \d+/gm)) {
          const e = blamed.get(m[1]) ?? {};
          (e[file] ??= []).push([Number(m[2]), Number(m[2])]);
          blamed.set(m[1], e);
        }
      }
    }
    const [top] = [...blamed].sort((x, y) => Object.values(y[1]).flat().length - Object.values(x[1]).flat().length);
    if (top) add(top[0], c.sha, c.subject, top[1]);
  }
  const clean = log.filter(
    (c) => c.parents && !used.has(c.sha) && !/^(revert|fix)/i.test(c.subject) && !REVERT.test(c.body) && !FIXES.test(c.body) && now - c.at >= controlMinAgeDays * 86400000,
  );
  for (const inc of cases.filter((c) => c.kind === "incident")) {
    const pick = clean.filter((c) => !used.has(c.sha)).sort((a, b) => Math.abs(a.changed - inc.changed) - Math.abs(b.changed - inc.changed))[0];
    if (!pick) break;
    used.add(pick.sha);
    cases.push({ kind: "control", bad: pick.sha, base: pick.parents.split(" ")[0], key: null, hunks: {}, changed: pick.changed });
  }
  return cases;
}
