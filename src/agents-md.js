// src/agents-md.js
//
// Root AGENTS.md: the one instruction file every harness loads (the AGENTS.md
// standard, AAIF / Linux Foundation; Claude Code reads it when no CLAUDE.md
// exists). Design: docs/roadmap/Agents-MD-Project-Card.md.
//
//   [framework block]  GENERATED from .agents/: the classifier (.agents/AGENTS.md)
//                      plus every rule marked `inline: true`. .agents/ stays the
//                      only place framework text is edited; upgrade regenerates.
//   [project card]     written per project; a draft until the card workflow runs.
//   (user content)     anything outside the markers, never touched.
//
// Claude Code reads nothing under .agents/ and Codex has no import syntax, so the
// framework text is inline. All functions here are pure except buildFrameworkBlock,
// which only reads.

import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";

export const FRAMEWORK_BEGIN =
  "<!-- conductor:framework:begin — generated from .agents/ by `conductor upgrade`. Do not edit here: edit .agents/ and re-run upgrade. -->";
export const FRAMEWORK_END = "<!-- conductor:framework:end -->";
export const CARD_BEGIN = "<!-- conductor:project-card:begin status=draft -->";
export const CARD_END = "<!-- conductor:project-card:end -->";

const DRAFT_CARD = [
  CARD_BEGIN,
  "## Project card",
  "",
  "Not written yet. Until it is, read `conductor/0-compass/north-star.md`, `conductor/4-context/technical/` and `conductor/3-product-areas/` before acting.",
  CARD_END,
].join("\n");

const FRONTMATTER_RE = /^---\r?\n[\s\S]*?\r?\n---\r?\n/;

/** Frontmatter of a markdown file, or "" when absent. */
function frontmatter(text) {
  const m = FRONTMATTER_RE.exec(text);
  return m ? m[0] : "";
}

/** Is this rule part of the always-loaded framework block? */
export function isInlineRule(text) {
  return /^\s*inline:\s*true\s*$/m.test(frontmatter(text));
}

/** Push every markdown heading one level down, so a rule nests under the framework title. */
function demoteHeadings(md) {
  let fenced = false;
  return md
    .split("\n")
    .map((line) => {
      if (/^```/.test(line)) fenced = !fenced;
      return !fenced && /^#{1,5} /.test(line) ? `#${line}` : line;
    })
    .join("\n");
}

/** The generated framework block for the `.agents/` tree at `agentsDir`. */
export async function buildFrameworkBlock(agentsDir) {
  const parts = [];
  const classifier = await readFile(join(agentsDir, "AGENTS.md"), "utf8");
  parts.push(classifier.replace(FRONTMATTER_RE, "").trim());

  const rulesDir = join(agentsDir, "rules");
  const names = (await readdir(rulesDir).catch(() => [])).filter((n) => n.endsWith(".md")).sort();
  for (const name of names) {
    const text = await readFile(join(rulesDir, name), "utf8");
    if (!isInlineRule(text)) continue;
    parts.push(demoteHeadings(text.replace(FRONTMATTER_RE, "").trim()));
  }
  return `${FRAMEWORK_BEGIN}\n${parts.join("\n\n")}\n${FRAMEWORK_END}`;
}

// Readers accept both marker prefixes (rename to Carja, PR 1); writers emit the constants above.
const marker = (rest) => new RegExp(`<!-- (?:carja|conductor):${rest}`);
const FW_BEGIN_RE = marker("framework:begin");
const FW_END_RE = marker("framework:end -->");
const CARD_BEGIN_RE = marker("project-card:begin");
const CARD_END_RE = marker("project-card:end -->");

/** Split `text` around one begin/end marker pair (regexes), or null if absent. */
function splitBlock(text, beginRe, endRe) {
  const b = beginRe.exec(text);
  if (!b) return null;
  const e = endRe.exec(text.slice(b.index));
  if (!e) return null;
  const stop = b.index + e.index + e[0].length;
  return { before: text.slice(0, b.index), block: text.slice(b.index, stop), after: text.slice(stop) };
}

/**
 * Root AGENTS.md content with `framework` as its framework block.
 *   - no file          → framework block + draft card
 *   - our markers      → replace the framework block only; add a draft card if missing
 *   - no markers       → a team- or user-written file: insert both blocks on top,
 *                        keep every existing byte below
 * Idempotent.
 */
export function renderRootAgentsMd(existing, framework) {
  if (existing == null) return `${framework}\n\n${DRAFT_CARD}\n`;
  const fw = splitBlock(existing, FW_BEGIN_RE, FW_END_RE);
  if (!fw) return `${framework}\n\n${DRAFT_CARD}\n\n${existing}`;
  let out = fw.before + framework + fw.after;
  if (!splitBlock(out, CARD_BEGIN_RE, CARD_END_RE)) {
    const at = out.indexOf(FRAMEWORK_END) + FRAMEWORK_END.length;
    out = `${out.slice(0, at)}\n\n${DRAFT_CARD}${out.slice(at)}`;
  }
  return out;
}

/**
 * The user's own text in an old CLAUDE.md / GEMINI.md stub: everything outside
 * Conductor's managed block, minus our frontmatter and our own comments. A stub
 * without the markers is entirely the user's.
 */
export function extractStubNotes(stub) {
  const managed = splitBlock(stub, marker("managed:begin"), marker("managed:end -->"));
  const text = (managed ? managed.before + managed.after : stub)
    .replace(FRONTMATTER_RE, "")
    .replace(/<!-- (Add your project-specific instructions|⬆ Conductor manages)[^\n]*-->/g, "")
    .split("\n")
    .filter((line) => !STUB_POINTER_LINES.some((re) => re.test(line)))
    .join("\n")
    .trim();
  // Headings with nothing under them are the stub's title, not notes.
  return text.split("\n").some((l) => l.trim() && !/^#{1,6} /.test(l)) ? text : "";
}

// Lines every generation of pointer stub carried (ours and copies of ours).
const STUB_POINTER_LINES = [
  /^> This is a platform stub for auto-discovery\./,
  /^Read and follow the instructions in `[^`]*AGENTS\.md` before any action\.\s*$/,
];

/** Append notes moved from `fromName` to the user section of AGENTS.md, once. */
export function appendMovedNotes(agentsMd, fromName, notes) {
  const heading = `## Notes moved from ${fromName}`;
  if (!notes || agentsMd.includes(heading)) return agentsMd;
  return `${agentsMd.trimEnd()}\n\n${heading}\n\n<!-- Moved by \`conductor upgrade\`, which removed ${fromName}. Delete anything that duplicates the framework block. -->\n\n${notes}\n`;
}
