// src/context-bill.js
//
// The context bill-of-materials (E2) — what Carja actually costs an agent
// before it has read a single line of the user's code.
//
// SOURCE. The idea of billing the framework's own context, and of a ratchet
// that fails CI on growth, is gstack's `lib/context-bill.ts` (Garry Tan, MIT).
// Our ceilings are bytes, theirs tokens; see README.md credits.
//
// WHY. Progressive Disclosure is one of Carja's founding design decisions,
// and until now it was a paragraph in AGENTS.md. Nothing measured it, so nothing
// stopped it eroding: `templates/` is ~500 KB of markdown and any of it could
// quietly become always-on. Two independent findings make this worth a number
// rather than a principle:
//   * agentctl measured loop count tracking the size of the instruction corpus
//     (0-118 lines of rules → 1 loop; 1,662-4,830 lines → 15-21 loops).
//   * The field guidance converged on the same thing from the other side —
//     "keep AGENTS.md under ~60 lines, a pilot's checklist, not a style guide".
//
// TWO LEDGERS, because they are paid at different times:
//
//   ALWAYS-ON  — what EVERY session loads before doing anything: the framework
//                block of the root AGENTS.md (classifier + inline rules), and the YAML frontmatter of
//                every skill (the router reads frontmatter to decide what to
//                load). This is the number that matters most: it is multiplied
//                by every session, forever.
//   EAGER      — what invoking ONE skill or workflow costs: its whole file.
//                Paid only on use, so a large workflow is not automatically a
//                problem; a large always-on rule always is.
//
// CEILINGS ARE IN BYTES, deliberately. Bytes are exact and reproducible on any
// machine with no model call. Token counts are reported alongside as an
// ESTIMATE with its divisor named, so nobody mistakes them for measurements —
// a ratchet that drifts because a tokenizer changed would be worse than no
// ratchet.

import { readdir, readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import { buildFrameworkBlock, isInlineRule } from "./agents-md.js";

/**
 * Bytes per token, by content class. Rough and openly so: markdown prose runs
 * ~4 bytes/token, YAML frontmatter is denser (~3.5) because it is mostly short
 * keys and punctuation. Used for the human-facing estimate only — never for a
 * ceiling. Real measurement would need a provider call, which this must not do.
 */
export const BYTES_PER_TOKEN = Object.freeze({ prose: 4.0, frontmatter: 3.5 });

export function estimateTokens(bytes, kind = "prose") {
  return Math.round(bytes / (BYTES_PER_TOKEN[kind] ?? BYTES_PER_TOKEN.prose));
}

/** Extract the leading `---` YAML frontmatter block, or "" when absent. */
export function frontmatterOf(text) {
  const m = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text);
  return m ? m[0] : "";
}

/** Is this rule inlined into the always-loaded framework block (`inline: true`)? */
export const isAlwaysOn = isInlineRule;

async function listFiles(dir, ext = ".md") {
  try {
    const entries = await readdir(dir, { withFileTypes: true });
    return entries.filter((e) => e.isFile() && e.name.endsWith(ext)).map((e) => e.name);
  } catch {
    return [];
  }
}

async function listDirs(dir) {
  try {
    const entries = await readdir(dir, { withFileTypes: true });
    return entries.filter((e) => e.isDirectory()).map((e) => e.name);
  } catch {
    return [];
  }
}

/**
 * Build the bill for an `.agents/` tree.
 * @param {string} agentsDir  path to a `.agents` directory
 * @returns {Promise<{alwaysOn: object, eager: object[], totals: object}>}
 */
export async function buildBill(agentsDir) {
  const alwaysOnItems = [];

  // 1. The framework block of the root AGENTS.md: loaded every session, by every
  //    harness. It is generated from .agents/ (the classifier + every rule marked
  //    `inline: true`), so bill exactly what the generator emits.
  try {
    const block = await buildFrameworkBlock(agentsDir);
    alwaysOnItems.push({ name: "AGENTS.md (framework block)", kind: "framework", bytes: Buffer.byteLength(block) });
  } catch {
    /* absent in a partial install */
  }

  // 2. Rules NOT inlined are loaded on demand (e.g. loop-guardrails, by the loop).
  const rulesDir = join(agentsDir, "rules");
  for (const name of await listFiles(rulesDir)) {
    const text = await readFile(join(rulesDir, name), "utf8").catch(() => "");
    if (!text || isAlwaysOn(text)) continue;
    alwaysOnItems.push({ name: `rules/${name}`, kind: "rule-on-demand", bytes: 0, eagerBytes: Buffer.byteLength(text) });
  }

  // 3. Skill frontmatter: the router reads every skill's frontmatter to decide
  //    what to load, so the frontmatter — not the body — is the always-on cost.
  const skillsDir = join(agentsDir, "skills");
  const eager = [];
  for (const dir of await listDirs(skillsDir)) {
    const path = join(skillsDir, dir, "SKILL.md");
    const text = await readFile(path, "utf8").catch(() => "");
    if (!text) continue;
    const fm = frontmatterOf(text);
    alwaysOnItems.push({
      name: `skills/${dir}`,
      kind: "skill-frontmatter",
      bytes: Buffer.byteLength(fm),
    });
    eager.push({ name: `skills/${dir}`, kind: "skill", bytes: Buffer.byteLength(text) });
  }

  // 4. Workflows are always eager — routed to by name, never scanned.
  const wfDir = join(agentsDir, "workflows");
  for (const name of await listFiles(wfDir)) {
    const st = await stat(join(wfDir, name)).catch(() => null);
    if (st) eager.push({ name: `workflows/${name}`, kind: "workflow", bytes: st.size });
  }

  const alwaysOnBytes = alwaysOnItems.reduce((n, i) => n + i.bytes, 0);
  const alwaysOnTokens = alwaysOnItems.reduce(
    (n, i) => n + estimateTokens(i.bytes, i.kind === "skill-frontmatter" ? "frontmatter" : "prose"),
    0,
  );

  return {
    alwaysOn: {
      items: alwaysOnItems.filter((i) => i.bytes > 0).sort((a, b) => b.bytes - a.bytes),
      bytes: alwaysOnBytes,
      tokensEstimate: alwaysOnTokens,
    },
    eager: eager.sort((a, b) => b.bytes - a.bytes),
    totals: {
      alwaysOnBytes,
      alwaysOnTokensEstimate: alwaysOnTokens,
      skillCount: eager.filter((e) => e.kind === "skill").length,
      workflowCount: eager.filter((e) => e.kind === "workflow").length,
    },
  };
}

/**
 * Grade a bill against a committed budget fixture.
 * @param {object} bill    from buildBill
 * @param {object} budget  { alwaysOnBytes: number, eagerBytes: Record<string, number> }
 * @returns {{ok: boolean, failures: string[]}}
 */
export function checkBudget(bill, budget) {
  const failures = [];

  // A malformed fixture must not silently disable the ceiling: a string or a
  // missing value would make every comparison pass.
  if (typeof budget?.alwaysOnBytes !== "number" || !Number.isFinite(budget.alwaysOnBytes)) {
    failures.push("budget fixture has no numeric alwaysOnBytes — the always-on ceiling is OFF. Re-capture it.");
  } else if (bill.totals.alwaysOnBytes > budget.alwaysOnBytes) {
    failures.push(
      `always-on grew to ${bill.totals.alwaysOnBytes} bytes (ceiling ${budget.alwaysOnBytes}). ` +
        `Every session pays this.`,
    );
  }

  const ceilings = budget?.eagerBytes ?? {};
  for (const item of bill.eager) {
    const ceiling = ceilings[item.name];
    if (typeof ceiling !== "number" || !Number.isFinite(ceiling)) {
      // A NEW skill or workflow with no budget is a failure, not a pass. Adding
      // context has to be a conscious, visible decision.
      failures.push(`${item.name} has no budget entry — new context must be budgeted deliberately.`);
    } else if (item.bytes > ceiling) {
      failures.push(`${item.name} grew to ${item.bytes} bytes (ceiling ${ceiling}).`);
    }
  }

  return { ok: failures.length === 0, failures };
}

/** Capture the current bill as a budget fixture (the ratchet's "accept" step). */
export function captureBudget(bill) {
  const eagerBytes = {};
  for (const item of bill.eager) eagerBytes[item.name] = item.bytes;
  return {
    _comment:
      "Context budget ceilings in BYTES (exact, machine-independent). Regenerate with " +
      "`node scripts/capture-context-budget.js` and commit the result in the SAME commit as " +
      "the growth, so it is a visible decision. Ceilings ratchet DOWN after a reduction.",
    alwaysOnBytes: bill.totals.alwaysOnBytes,
    eagerBytes,
  };
}

/** Human-readable report. */
export function renderBill(bill, { top = 12 } = {}) {
  const kb = (b) => `${(b / 1024).toFixed(1)} KB`;
  const lines = [
    "Carja context bill",
    "",
    `ALWAYS-ON (every session pays this): ${kb(bill.totals.alwaysOnBytes)} ` +
      `≈ ${bill.totals.alwaysOnTokensEstimate} tokens (estimate: bytes ÷ ${BYTES_PER_TOKEN.prose}/${BYTES_PER_TOKEN.frontmatter})`,
  ];
  for (const i of bill.alwaysOn.items.slice(0, top)) {
    lines.push(`  ${kb(i.bytes).padStart(9)}  ${i.kind.padEnd(18)} ${i.name}`);
  }
  if (bill.alwaysOn.items.length > top) {
    lines.push(`  … ${bill.alwaysOn.items.length - top} more`);
  }
  lines.push(
    "",
    `EAGER (paid only when invoked): ${bill.totals.skillCount} skills, ${bill.totals.workflowCount} workflows`,
  );
  for (const i of bill.eager.slice(0, top)) {
    lines.push(`  ${kb(i.bytes).padStart(9)}  ${i.kind.padEnd(18)} ${i.name}`);
  }
  return lines.join("\n");
}
