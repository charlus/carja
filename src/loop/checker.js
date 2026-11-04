// src/loop/checker.js
//
// The independent Checker's verdict contract (Phase 3). The Checker runs as a
// SEPARATE process with a fresh context (structural independence) and records its
// verdict to a file — a `claude -p` process exit code is always 0 on success, so
// it cannot itself carry the verdict. The driver reads that file back.
//
// Fail-safe by construction (Evidence Rule): anything other than an explicit,
// well-formed `{"approved": true}` is treated as a REJECT. No approval evidence
// ⇒ not approved. This keeps a crashed/confused/silent Checker from waving work
// through.

export const VERDICT_REL = "carja/1-workbench/checker-verdict.json";

/**
 * The rubric-v2 evidence bar, in code (E3).
 *
 * `.agents/skills/independent-review/reviewer.md` says a BLOCKER needs a
 * quoted line and confidence >= 7, so an unsure Checker DOWNGRADES rather than
 * rejecting. Prose is advisory; this enforces it.
 *
 * DIRECTION IS EVERYTHING (Operating Truth 4). The bar may only ever make the
 * gate stricter or leave it unchanged. A malformed BLOCKER is malformed — it
 * does NOT become an approval, because "write a sloppy finding to get waved
 * through" would invert the whole point. What the bar buys is a DIAGNOSTIC: the
 * driver can tell an evidenced rejection from a Checker rejecting on vibes, and
 * the latter is a Checker problem, not a Maker problem.
 *
 * @param {object} f a finding from the verdict's `findings[]`
 * @returns {string|null} what is wrong with it, or null when it is well-formed
 */
function blockerDefect(f) {
  if (!f || typeof f !== "object") return "finding is not an object";
  if (String(f.severity ?? "").toUpperCase() !== "BLOCKER") return null; // bar is blockers-only
  if (!String(f.quote ?? "").trim()) {
    return "BLOCKER has no `quote` — the verbatim line that proves it is required (rubric v2)";
  }
  const c = Number(f.confidence);
  if (!Number.isFinite(c) || c < 7) {
    return "BLOCKER has confidence below 7 — an unsure finding is reported as IMPORTANT, not a blocker (rubric v2)";
  }
  if (!String(f.file ?? "").trim()) {
    return "BLOCKER has no `file` — a finding must be located";
  }
  return null;
}

/** Normalize the optional `findings[]` field. A junk value degrades to []. */
function readFindings(obj) {
  return Array.isArray(obj?.findings) ? obj.findings : [];
}

/**
 * Parse a Checker verdict file's contents into a normalized result.
 *
 * @param {string|null|undefined} text raw file contents (or null if absent)
 * @returns {{approved: boolean, reason: string, findings: object[],
 *            malformedFindings: {problem: string, finding: object}[],
 *            provenBlockers: number}}
 */
export function parseCheckerVerdict(text) {
  const empty = { findings: [], malformedFindings: [], provenBlockers: 0 };

  if (text == null || String(text).trim() === "") {
    return { approved: false, reason: "no verdict file written by Checker", ...empty };
  }
  let obj;
  try {
    obj = JSON.parse(text);
  } catch {
    return { approved: false, reason: "Checker verdict was not valid JSON", ...empty };
  }
  if (!obj || typeof obj !== "object" || Array.isArray(obj)) {
    return { approved: false, reason: "Checker verdict was not a JSON object", ...empty };
  }

  const findings = readFindings(obj);
  const malformedFindings = [];
  let provenBlockers = 0;
  for (const f of findings) {
    const problem = blockerDefect(f);
    if (problem) malformedFindings.push({ problem, finding: f });
    else if (String(f?.severity ?? "").toUpperCase() === "BLOCKER") provenBlockers += 1;
  }
  const blockerCount = findings.filter(
    (f) => String(f?.severity ?? "").toUpperCase() === "BLOCKER",
  ).length;

  if (obj.approved === true) {
    // A verdict that approves while listing a BLOCKER contradicts itself.
    // Fail safe: the blocker wins. (Rubric v2: APPROVE means zero BLOCKERS —
    // IMPORTANT and NIT findings are expected alongside an approval.)
    if (blockerCount > 0) {
      return {
        approved: false,
        reason:
          `Checker approved while listing ${blockerCount} BLOCKER finding(s) — a contradictory ` +
          `verdict fails safe to reject`,
        findings,
        malformedFindings,
        provenBlockers,
      };
    }
    return {
      approved: true,
      reason: String(obj.reason ?? "approved"),
      findings,
      malformedFindings,
      provenBlockers,
    };
  }

  // A rejection. Report whether it actually carried evidence, so an operator
  // reading the audit trail can tell a real gate from a Checker on vibes.
  const stated = String(obj.reason ?? "Checker did not approve");
  const unproven = blockerCount > 0 && provenBlockers === 0;
  return {
    approved: false,
    reason: unproven
      ? `${stated} — WARNING: rejected with no quoted evidence (all ${blockerCount} BLOCKER finding(s) malformed: ` +
        `${malformedFindings.map((m) => m.problem).join("; ")})`
      : stated,
    findings,
    malformedFindings,
    provenBlockers,
  };
}

/**
 * Check each proven BLOCKER's quote against the code it names (Harness
 * Engineering 101 harvest, F3). A model judging a model must cite something
 * real: a quote that is not in the file is an invented quote, a Checker defect.
 *
 * Direction (Operating Truth 4): this only ever lowers `provenBlockers` and adds
 * a WARNING. It never changes `approved`, so an invented quote still rejects.
 * The finding is marked `ungrounded` so the next Maker does not chase it blindly.
 *
 * @param {object} verdict a parseCheckerVerdict result
 * @param {(file:string)=>string|null} sourceFor the text the quote may come from
 *   (the file, and its diff), or null when it cannot be read: then the finding is left as it was
 */
export function groundFindings(verdict, sourceFor) {
  if (verdict.approved || !verdict.provenBlockers) return verdict;
  const malformed = new Set(verdict.malformedFindings.map((m) => m.finding));
  const malformedFindings = [...verdict.malformedFindings];
  let provenBlockers = verdict.provenBlockers;
  const findings = verdict.findings.map((f) => {
    if (malformed.has(f) || String(f?.severity ?? "").toUpperCase() !== "BLOCKER") return f;
    let source = null;
    try {
      source = sourceFor(String(f.file));
    } catch {
      source = null;
    }
    if (source == null || flatten(source).includes(flatten(f.quote))) return f;
    const marked = { ...f, ungrounded: true };
    malformedFindings.push({ problem: `BLOCKER quote not found in ${f.file}`, finding: marked });
    provenBlockers -= 1;
    return marked;
  });
  const blockerCount = findings.filter((f) => String(f?.severity ?? "").toUpperCase() === "BLOCKER").length;
  const reason =
    provenBlockers === 0 && !/WARNING/.test(verdict.reason)
      ? `${verdict.reason} — WARNING: rejected with no quoted evidence (all ${blockerCount} BLOCKER finding(s) malformed: ` +
        `${malformedFindings.map((m) => m.problem).join("; ")})`
      : verdict.reason;
  return { ...verdict, reason, findings, malformedFindings, provenBlockers };
}

/** Whitespace-insensitive form, with diff markers removed, for quote matching. */
function flatten(text) {
  return String(text ?? "")
    .split("\n")
    .map((l) => l.replace(/^[+-](?![+-])/, ""))
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Map a verdict onto the exit-code contract the driver's runChecker expects. */
export function verdictToExitCode(verdict) {
  return verdict.approved ? 0 : 1;
}

/**
 * True when a rejection reason reflects an INFRASTRUCTURE failure (the Checker
 * process could not run or emit a well-formed verdict) rather than a substantive
 * "the work is wrong" rejection. Matches the two non-substantive outcomes
 * `parseCheckerVerdict` produces: a missing verdict file and invalid JSON.
 *
 * The self-improvement miner uses this to avoid proposing a CONTENT rule for an
 * outage — a rule addressed to an agent cannot fix a beat where no agent ran
 * (the JuRaph session-limit incident: 47 "no verdict file" rejections that were
 * an outage, not a missing acceptance criterion).
 */
export function isInfraReason(reason) {
  const r = String(reason ?? "").toLowerCase();
  return r.includes("no verdict file") || r.includes("not valid json");
}

/**
 * Multi-vote / adversarial Checker (ADR-0001 Deferred → shipped). Run N
 * independent Checker processes and require a strict majority to approve. This is
 * the survey's "verify with N skeptics": any single skeptic that rejects lowers
 * the approval count, and a tie or minority approval fails safe to reject.
 * @param {Array<{approved:boolean,reason?:string}>} verdicts
 * @param {number} votes total number of Checkers that were supposed to run
 * @returns {{approved:boolean, reason:string, approvals:number, votes:number}}
 */
export function tallyVerdicts(verdicts, votes) {
  const n = Math.max(1, votes || (verdicts?.length ?? 1));
  const list = verdicts ?? [];
  const approvals = list.filter((v) => v && v.approved === true).length;
  // Strict majority of the intended vote count (missing/crashed votes count as reject).
  const approved = approvals > n / 2;
  // Per-vote reasons make a rejection DIAGNOSABLE (Loop-Robustness P1.2): the
  // caller can tell "no verdict file written" (plumbing/empty-diff) apart from an
  // explicit "Checker did not approve" (a genuine substantive rejection).
  const reasons = list.map((v) => v?.reason ?? "no verdict");
  return {
    approved,
    approvals,
    votes: n,
    reasons,
    reason: approved
      ? `${approvals}/${n} Checkers approved (majority)`
      : `${approvals}/${n} Checkers approved (no majority) — failing safe to reject`,
  };
}
