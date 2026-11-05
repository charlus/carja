// src/project-card.js
//
// The project card in the root AGENTS.md (docs/roadmap/Agents-MD-Project-Card.md
// §5): a short description of the project that every session loads.
//
//   code writes  Stack, Commands, Layout, the list of product areas, Read more
//   agent writes Purpose, Conventions, one line per product area
//
// `checkCard` enforces the fixed headings, the size limit, no TODO left, and that
// the code-written sections still match the code (an agent cannot "improve" a
// fact). `stampCard` records one short hash per source file, so `staleSources`
// can say which source changed since. All pure.

import { createHash } from "node:crypto";

export const CARD_LIMIT_BYTES = 3072;
// Readers accept both marker prefixes (rename to Carja, PR 1); writers emit `carja:`.
const BEGIN_RE = /<!-- (?:carja|conductor):project-card:begin[^>]*-->/;
const END = "<!-- carja:project-card:end -->";
const END_RE = /<!-- (?:carja|conductor):project-card:end -->/;
const SOURCES_RE = /<!-- (?:carja|conductor):project-card:sources (\{.*\}) -->\n?/;

const HEADINGS = ["Purpose", "Stack", "Commands", "Layout", "Conventions", "Product areas", "Read more"];
const CODE_SECTIONS = ["Stack", "Commands", "Layout", "Read more"];
const TODO = {
  Purpose: "TODO: 2–3 sentences: what the product is and for whom.",
  Conventions: "TODO: up to 5 bullets that change how code is written.",
  area: "TODO: one line on what this area covers.",
};

const READ_MORE = [
  "- Goals: `carja/0-compass/north-star.md`",
  "- Architecture: `carja/4-context/technical/architecture.md`",
  "- Coding patterns: `carja/4-context/technical/coding-patterns.md`",
  "- Product areas: `carja/3-product-areas/`",
  "- Framework reference: `.agents/how-it-works.md`",
].join("\n");

/** The code-written sections, keyed by heading. */
function codeSections(facts) {
  const nested = (facts.codeRoots ?? ["."]).filter((r) => r !== ".");
  const stack = [
    ...(nested.length ? [`- Code: ${nested.map((r) => `\`${r}/\``).join(", ")} (separate git repository)`] : []),
    `- Languages: ${facts.languages?.length ? facts.languages.map((l) => `${l.lang} (${l.files} file${l.files === 1 ? "" : "s"})`).join(", ") : "none detected"}`,
    ...(facts.frameworks?.length ? [`- Frameworks: ${facts.frameworks.join(", ")}`] : []),
    `- Manifests: ${facts.manifests?.length ? facts.manifests.map((m) => `\`${m}\``).join(", ") : "none found"}`,
  ].join("\n");
  const commands = facts.commands?.length
    ? facts.commands.map((c) => `- ${c.what}: \`${c.cmd}\``).join("\n")
    : "- None found. Set one with `carja verify --set <cmd>`.";
  const layout = facts.layout?.length
    ? facts.layout.map((d) => `- \`${d.dir}/\` — ${d.files} file${d.files === 1 ? "" : "s"}`).join("\n")
    : "- No directories found.";
  return { Stack: stack, Commands: commands, Layout: layout, "Read more": READ_MORE };
}

/** What `carja agents-md facts` prints: the code-written sections only. */
export function renderFacts(facts) {
  const s = codeSections(facts);
  const areas = facts.areas?.length ? facts.areas.map((a) => `- \`${a}\``).join("\n") : "- None yet.";
  return [...CODE_SECTIONS.map((h) => `### ${h}\n\n${s[h]}`), `### Product areas\n\n${areas}`].join("\n\n") + "\n";
}

/** The card block inside `text` (an AGENTS.md or a bare card), or null. */
function cardBlock(text) {
  const m = BEGIN_RE.exec(text);
  if (!m) return null;
  const e = END_RE.exec(text.slice(m.index));
  return e ? text.slice(m.index, m.index + e.index + e[0].length) : null;
}

/** Sections of a card: { begin, sections: {heading: body}, order: [headings], areaText: {path: text} }. */
export function parseCard(text) {
  const block = cardBlock(text);
  if (!block) return null;
  const sections = {};
  const order = [];
  const body = block.replace(SOURCES_RE, "");
  const parts = body.split(/^### /m).slice(1);
  for (const p of parts) {
    const nl = p.indexOf("\n");
    const heading = p.slice(0, nl).trim();
    order.push(heading);
    sections[heading] = p.slice(nl + 1).replace(END_RE, "").trim();
  }
  const areaText = {};
  for (const line of (sections["Product areas"] ?? "").split("\n")) {
    const m = /^- `([^`]+)` — (.*)$/.exec(line);
    if (m) areaText[m[1]] = m[2].trim();
  }
  return { begin: BEGIN_RE.exec(block)[0], sections, order, areaText, sources: JSON.parse(SOURCES_RE.exec(block)?.[1] ?? "null") };
}

/** A card with fresh facts, keeping the agent's text from `previous` (parsed). Always a draft. */
export function buildCard({ facts, previous }) {
  const s = codeSections(facts);
  const keep = (h) => previous?.sections?.[h] || TODO[h];
  const areas = facts.areas?.length
    ? facts.areas.map((a) => `- \`${a}\` — ${previous?.areaText?.[a] || TODO.area}`).join("\n")
    : "- None yet.";
  const body = {
    Purpose: keep("Purpose"),
    Stack: s.Stack,
    Commands: s.Commands,
    Layout: s.Layout,
    Conventions: keep("Conventions"),
    "Product areas": areas,
    "Read more": s["Read more"],
  };
  return [
    "<!-- carja:project-card:begin status=draft -->",
    "## Project card",
    "",
    ...HEADINGS.flatMap((h) => [`### ${h}`, "", body[h], ""]),
    END,
  ].join("\n");
}

/** Card bytes as an agent reads them: without the marker and stamp comments. */
function contentBytes(block) {
  return Buffer.byteLength(block.replace(BEGIN_RE, "").replace(SOURCES_RE, "").replace(END_RE, "").trim());
}

/** Shape, size, no TODO, facts untouched. @returns {{ok:boolean, problems:string[]}} */
export function checkCard(text, facts) {
  const block = cardBlock(text);
  if (!block) return { ok: false, problems: ["no project card block in AGENTS.md (run `carja agents-md write`)"] };
  const card = parseCard(block);
  const problems = [];
  if (card.order.join("|") !== HEADINGS.join("|")) {
    const missing = HEADINGS.filter((h) => !card.order.includes(h));
    problems.push(
      missing.length
        ? `missing heading(s): ${missing.map((h) => `### ${h}`).join(", ")}`
        : `headings must be, in order: ${HEADINGS.join(", ")} (found ${card.order.join(", ")})`
    );
  }
  if (/TODO/.test(block)) problems.push("TODO left in: " + HEADINGS.filter((h) => /TODO/.test(card.sections[h] ?? "")).join(", "));
  const fresh = codeSections(facts);
  for (const h of CODE_SECTIONS) {
    if (card.sections[h] !== undefined && card.sections[h] !== fresh[h]) {
      problems.push(`${h} differs from what the code says; it is generated, do not edit it (run \`carja agents-md write\`)`);
    }
  }
  const listed = Object.keys(card.areaText).sort().join("|");
  if (listed !== [...(facts.areas ?? [])].sort().join("|")) {
    problems.push("Product areas list differs from carja/3-product-areas/ (run `carja agents-md write`)");
  }
  const bullets = (card.sections.Conventions ?? "").split("\n").filter((l) => /^\s*[-*] /.test(l)).length;
  if (bullets > 5) problems.push(`Conventions has ${bullets} bullets, at most 5`);
  const bytes = contentBytes(block);
  if (bytes > CARD_LIMIT_BYTES) problems.push(`card is ${bytes} bytes, limit ${CARD_LIMIT_BYTES}: move detail into carja/ and link it`);
  return { ok: problems.length === 0, problems };
}

const shortHash = (text) => createHash("sha256").update(String(text)).digest("hex").slice(0, 10);

/** Mark the card checked: status ok + one hash per source ({path: content}). */
export function stampCard(text, sources) {
  const block = cardBlock(text);
  const hashes = Object.fromEntries(Object.keys(sources).sort().map((k) => [k, shortHash(sources[k])]));
  const stamped = block
    .replace(BEGIN_RE, "<!-- carja:project-card:begin status=ok -->")
    .replace(SOURCES_RE, "")
    .replace(END_RE, `<!-- carja:project-card:sources ${JSON.stringify(hashes)} -->\n${END}`);
  return text.replace(block, stamped);
}

/** Sources changed since the stamp (paths), [] when fresh, null when never stamped. */
export function staleSources(text, sources) {
  const block = cardBlock(text);
  const stamp = block && JSON.parse(SOURCES_RE.exec(block)?.[1] ?? "null");
  if (!stamp) return null;
  const keys = new Set([...Object.keys(stamp), ...Object.keys(sources)]);
  return [...keys].filter((k) => stamp[k] !== (k in sources ? shortHash(sources[k]) : undefined)).sort();
}
