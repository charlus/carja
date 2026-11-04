// src/commands/review-log.js
//
// `conductor review-log` — the review findings ledger (E2).
//
//   conductor review-log append '<json>'
//   conductor review-log summary [--since <ISO date>]
//
// WHY. E1 changed the review gate on the argument that the reviewer's question
// was unbounded, not that the Maker writes bad code. That is a claim, and it
// deserves data rather than another opinion. This ledger is the instrument:
//
//   rounds to APPROVE            did the loop actually get shorter?
//   dismissal rate per class     a class dismissed most of the time is a RUBRIC
//                                defect — fix calibration.md, not the author.
//   blockers by category         if real blockers cluster in one area, that is
//                                a Maker/spec problem and E1's premise was wrong
//                                for this project. Say so and re-tune.
//   reviewer brief bytes         tests agentctl's finding that loop count tracks
//                                the size of the instruction corpus.
//
// Lives in the repo (`conductor/1-workbench/review-log.jsonl`), not under
// CONDUCTOR_HOME: unlike evidence, these findings are about the project and are
// useful to the whole team and to the Retrospective workflow.

import { appendFile, mkdir, readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join, dirname, resolve, relative, isAbsolute } from "node:path";
import { PRECEDENCE, outranks } from "../personas.js";
import { ignoredNestedRepos } from "../nested-repos.js";
import { statePath } from "../names.js";

export const REVIEW_LOG_REL = "conductor/1-workbench/review-log.jsonl";

const SEVERITIES = new Set(["BLOCKER", "IMPORTANT", "NIT", "SCOPE"]);

// F7: one vocabulary. Free-text categories split one idea over many names
// (spec-gap, spec-ambiguity, ambiguity), so no class reached the 3 findings the
// rubric alarm needs. The reviewer brief names the same classes.
export const CATEGORIES = [
  "acceptance", "correctness", "security", "data-integrity", "test-quality", "error-handling",
  "concurrency", "performance", "ui", "architecture", "consistency", "scope", "other",
];
const ALIASES = {
  acceptance: ["spec", "spec-gap", "spec-contradiction", "spec-ambiguity", "ambiguity", "completeness",
    "undefined-precedence", "unsatisfiable-criterion", "ambiguous-criterion", "spec-wording", "acceptance-criteria", "requirements", "external-api-answers"],
  correctness: ["bug", "logic", "edge-case", "ordering", "timezone", "validation", "type-safety", "stale-state", "regression", "accuracy"],
  security: ["info-leak", "auth", "authz", "injection", "sql-injection", "xss", "csrf", "secrets", "privacy"],
  "data-integrity": ["data-loss", "data", "migration", "db-constraint", "data-constraint", "schema", "data-model"],
  "test-quality": ["testing", "tests", "test-coverage", "coverage", "testability", "vacuous-test",
    "test-cannot-detect-subject", "wrong-test-seam", "test-structure"],
  "error-handling": ["logging", "errors", "resilience", "robustness"],
  concurrency: ["race", "race-condition", "locking"],
  performance: ["n-plus-one", "perf", "efficiency"],
  ui: ["ui-state", "accessibility", "a11y", "design-system", "missing-asset", "ux", "design"],
  architecture: ["coupling", "layering", "dependency"],
  consistency: ["naming", "wording", "stale-comment", "documentation", "docs", "style"],
  scope: ["slicing", "scope-creep"],
};
const ALIAS_TO_CLASS = new Map(
  Object.entries(ALIASES).flatMap(([cls, names]) => names.map((n) => [n, cls])),
);

/** The class a category name belongs to, or null. */
export function canonicalCategory(name) {
  const n = String(name ?? "").trim().toLowerCase();
  if (CATEGORIES.includes(n)) return n;
  return ALIAS_TO_CLASS.get(n) ?? null;
}

const FIELDS = new Set([
  "severity", "action", "category", "detail", "file", "line", "quote", "confidence", "reason", "round",
  "brief_bytes", "persona", "overridden_by", "po_decision", "fingerprint", "artifact", "slice",
]);
const ACTIONS = new Set(["fixed", "dismissed", "known-gap", "deferred"]);

/**
 * Validate and normalise one finding record. Returns {ok, record|error}.
 * Kept pure so the contract is unit-testable.
 */
export function normalizeFinding(raw, { now = () => Date.now() } = {}) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return { ok: false, error: "a finding must be a JSON object" };
  }
  const severity = String(raw.severity ?? "").toUpperCase();
  if (!SEVERITIES.has(severity)) {
    return { ok: false, error: `severity must be one of ${[...SEVERITIES].join(", ")}` };
  }
  const action = String(raw.action ?? "").toLowerCase();
  if (!ACTIONS.has(action)) {
    return { ok: false, error: `action must be one of ${[...ACTIONS].join(", ")}` };
  }
  const unknown = Object.keys(raw).filter((k) => !FIELDS.has(k));
  if (unknown.length) {
    return { ok: false, error: `unknown field(s): ${unknown.join(", ")}. Allowed: ${[...FIELDS].join(", ")}` };
  }
  const category = canonicalCategory(raw.category);
  if (!category) {
    return { ok: false, error: `category must be one of ${CATEGORIES.join(", ")} (got "${raw.category ?? ""}")` };
  }
  const detail = raw.detail
    ? String(raw.detail).slice(0, 200)
    : String(raw.category).trim().toLowerCase() !== category ? String(raw.category) : null;
  const confidence = Number(raw.confidence);
  // The E1 bar, enforced here too so the ledger cannot record a finding the
  // rubric would have refused: a BLOCKER needs a quote and confidence >= 7.
  if (severity === "BLOCKER") {
    if (!Number.isFinite(confidence) || confidence < 7) {
      return { ok: false, error: "a BLOCKER needs confidence >= 7 (rubric v2)" };
    }
    if (!String(raw.quote ?? "").trim()) {
      return { ok: false, error: "a BLOCKER needs the quoted line that proves it (rubric v2)" };
    }
  }
  // D1: a finding a higher-ranked one overrode. The ledger refuses a reversed
  // order unless the product owner made that call, so the precedence cannot
  // drift one quiet dismissal at a time.
  const persona = raw.persona ? String(raw.persona) : null;
  const overriddenBy = raw.overridden_by ? String(raw.overridden_by) : null;
  const poDecision = raw.po_decision === true;
  if (persona && (!PRECEDENCE.includes(persona) || persona === "acceptance-criteria")) {
    return { ok: false, error: `persona must be one of ${PRECEDENCE.filter((p) => p !== "acceptance-criteria").join(", ")}` };
  }
  if (overriddenBy) {
    if (!persona) return { ok: false, error: "overridden_by needs the persona whose finding lost" };
    if (action !== "dismissed") return { ok: false, error: "an overridden finding is recorded as dismissed" };
    if (!PRECEDENCE.includes(overriddenBy)) {
      return { ok: false, error: `overridden_by must be one of ${PRECEDENCE.join(", ")}` };
    }
    if (!outranks(overriddenBy, persona) && !poDecision) {
      return {
        ok: false,
        error: `${overriddenBy} cannot override ${persona}: that reverses the precedence. ` +
          "It is a product decision: ask the product owner, then record po_decision: true",
      };
    }
  }
  return {
    ok: true,
    record: {
      ts: new Date(now()).toISOString(),
      round: Number.isFinite(Number(raw.round)) ? Number(raw.round) : 1,
      severity,
      confidence: Number.isFinite(confidence) ? confidence : null,
      category,
      detail,
      slice: raw.slice ? String(raw.slice) : null,
      file: raw.file ? String(raw.file) : null,
      line: Number.isFinite(Number(raw.line)) ? Number(raw.line) : null,
      quote: raw.quote ? String(raw.quote).slice(0, 400) : null,
      action,
      reason: raw.reason ? String(raw.reason).slice(0, 400) : null,
      // Fingerprint lets a later round suppress a finding already dismissed on
      // code that did not change.
      fingerprint: raw.fingerprint
        ? String(raw.fingerprint)
        : `${raw.file ?? "?"}:${raw.line ?? "?"}:${category}`,
      brief_bytes: Number.isFinite(Number(raw.brief_bytes)) ? Number(raw.brief_bytes) : null,
      artifact: raw.artifact ? String(raw.artifact) : "diff",
      persona,
      overridden_by: overriddenBy,
      po_decision: poDecision,
    },
  };
}

/** Aggregate records into the numbers the plan promised to measure. */
export function summarise(records) {
  const byClass = {};
  const bySeverity = {};
  let blockers = 0;
  let dismissed = 0;
  const rounds = new Set();
  const byPersona = {};

  for (const r of records) {
    if (r.persona) {
      const p = (byPersona[r.persona] ??= { total: 0, overridden: 0 });
      p.total += 1;
      if (r.overridden_by) p.overridden += 1;
    }
    bySeverity[r.severity] = (bySeverity[r.severity] ?? 0) + 1;
    // Old rows carry free-text categories: count them under their class.
    const cls = canonicalCategory(r.category) ?? r.category ?? "other";
    const c = (byClass[cls] ??= { total: 0, dismissed: 0, blockers: 0 });
    c.total += 1;
    if (r.action === "dismissed") {
      c.dismissed += 1;
      dismissed += 1;
    }
    if (r.severity === "BLOCKER") {
      c.blockers += 1;
      blockers += 1;
    }
    if (Number.isFinite(r.round)) rounds.add(r.round);
  }

  const classes = Object.entries(byClass)
    .map(([name, c]) => ({
      name,
      ...c,
      dismissalRate: c.total ? c.dismissed / c.total : 0,
    }))
    .sort((a, b) => b.total - a.total);

  const personas = Object.entries(byPersona)
    .map(([name, p]) => ({ name, ...p, overrideRate: p.overridden / p.total }))
    .sort((a, b) => b.total - a.total);

  return {
    findings: records.length,
    bySeverity,
    blockers,
    dismissed,
    dismissalRate: records.length ? dismissed / records.length : 0,
    maxRound: rounds.size ? Math.max(...rounds) : 0,
    classes,
    // A class dismissed most of the time is the reviewer being wrong repeatedly
    // in one place — a rubric defect, fixable in calibration.md.
    rubricSuspects: classes.filter((c) => c.total >= 3 && c.dismissalRate > 0.5),
    personas,
    // A persona whose findings lose most conflicts asks for the wrong thing:
    // fix its Review Lens, not the code (D4).
    lensSuspects: personas.filter((p) => p.overridden >= 3 && p.overrideRate > 0.5),
  };
}

/**
 * The project root: the nearest folder up from `cwd` that holds `conductor/`
 * and `.agents/`. Run from a nested code repository, the ledger is still the
 * project's, never a stray copy in the code repository.
 */
export function findProjectRoot(cwd) {
  let dir = resolve(cwd);
  for (;;) {
    if ((existsSync(join(dir, "carja")) || existsSync(join(dir, "conductor"))) && existsSync(join(dir, ".agents"))) return dir;
    const up = dirname(dir);
    if (up === dir) return resolve(cwd);
    dir = up;
  }
}

/** `file` relative to the project root, whichever folder the caller ran in. */
async function projectPath(file, cwd, root) {
  if (!file) return file;
  const fromCwd = isAbsolute(file) ? file : resolve(cwd, file);
  if (existsSync(fromCwd)) return relative(root, fromCwd);
  // A path relative to a nested code repository, given from the project root.
  for (const repo of await ignoredNestedRepos(root)) {
    const candidate = join(root, repo, file);
    if (existsSync(candidate)) return relative(root, candidate);
  }
  return relative(root, fromCwd);
}

export async function reviewLogCommand(args, { cwd, stdout, stderr }) {
  const sub = args.find((a) => !a.startsWith("-")) ?? "";
  const root = findProjectRoot(cwd);
  const path = join(root, statePath(root, REVIEW_LOG_REL));

  if (sub === "append") {
    const json = args[args.indexOf("append") + 1];
    if (!json) {
      stderr.write("usage: conductor review-log append '<json finding>'\n");
      return 1;
    }
    let parsed;
    try {
      parsed = JSON.parse(json);
    } catch (e) {
      stderr.write(`review-log: not valid JSON (${e.message})\n`);
      return 1;
    }
    if (parsed && typeof parsed === "object" && parsed.file) parsed.file = await projectPath(String(parsed.file), cwd, root);
    const res = normalizeFinding(parsed);
    if (!res.ok) {
      stderr.write(`review-log: ${res.error}\n`);
      return 1;
    }
    try {
      await mkdir(dirname(path), { recursive: true });
      await appendFile(path, `${JSON.stringify(res.record)}\n`);
    } catch (e) {
      stderr.write(`review-log: could not write ${path} (${e.message})\n`);
      return 1;
    }
    stdout.write(`recorded ${res.record.severity} ${res.record.fingerprint} → ${res.record.action}\n`);
    return 0;
  }

  if (sub === "summary") {
    let text = "";
    try {
      text = await readFile(path, "utf8");
    } catch {
      stdout.write("No review findings recorded yet.\n");
      return 0;
    }
    const since = args.includes("--since") ? Date.parse(args[args.indexOf("--since") + 1]) : null;
    const records = [];
    for (const line of text.split("\n")) {
      if (!line.trim()) continue;
      try {
        const r = JSON.parse(line);
        if (since && Date.parse(r.ts) < since) continue;
        records.push(r);
      } catch {
        /* skip torn lines */
      }
    }
    const s = summarise(records);
    stdout.write(`Review findings: ${s.findings} (${s.blockers} blockers)\n`);
    stdout.write(`Dismissal rate:  ${(s.dismissalRate * 100).toFixed(0)}%\n`);
    stdout.write(`Max round:       ${s.maxRound}\n\n`);
    stdout.write("By class:\n");
    for (const c of s.classes) {
      stdout.write(
        `  ${String(c.total).padStart(4)}  ${String(c.blockers).padStart(3)} blk  ` +
          `${(c.dismissalRate * 100).toFixed(0).padStart(3)}% dismissed  ${c.name}\n`,
      );
    }
    if (s.rubricSuspects.length) {
      stdout.write("\nRubric suspects (dismissed >50% of the time, n>=3):\n");
      for (const c of s.rubricSuspects) {
        stdout.write(`  ${c.name} — add a worked case to skills/independent-review/calibration.md\n`);
      }
    }
    if (s.personas.length) {
      stdout.write("\nBy persona (findings, lost to a higher-ranked one):\n");
      for (const p of s.personas) {
        stdout.write(`  ${String(p.total).padStart(4)}  ${String(p.overridden).padStart(3)} lost  ${p.name}\n`);
      }
    }
    if (s.lensSuspects.length) {
      stdout.write("\nLens suspects (lose >50% of their conflicts, n>=3):\n");
      for (const p of s.lensSuspects) {
        stdout.write(`  ${p.name} — recalibrate the Review Lens in .agents/personas/${p.name}.md\n`);
      }
    }
    return 0;
  }

  stderr.write(
    "usage: conductor review-log <append|summary>\n\n" +
      "  append '<json>'   record one finding + its disposition\n" +
      "  summary [--since <ISO date>]\n\n" +
      "Fields: severity (BLOCKER|IMPORTANT|NIT|SCOPE), action (fixed|dismissed|known-gap|deferred),\n" +
      "        category, file, line, quote, confidence, reason, round, brief_bytes,\n" +
      "        persona, overridden_by, po_decision (a conflict between two personas' findings).\n" +
      "A BLOCKER requires confidence >= 7 and a quote — the same bar as rubric v2.\n",
  );
  return sub ? 1 : 0;
}
