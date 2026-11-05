// src/design-md.js
//
// DESIGN.md: the one file that keeps a product's UI coherent. Pure: no IO.
//
// The canonical sections are shared by the greenfield template
// (carja/5-templates/design-md.md, pinned by test) and by the migration,
// which maps each H2 section of the old carja/4-context/design/ files to
// the first canonical section whose words its title contains.

export const DESIGN_SECTIONS = [
  { title: "Visual Theme & Atmosphere", words: ["theme", "atmosphere", "principle", "principles", "mood", "tone", "voice", "philosophy", "identity"] },
  { title: "Colour Palette & Roles", words: ["colour", "colours", "color", "colors", "palette"] },
  { title: "Typography", words: ["typography", "font", "fonts", "type", "typeface"] },
  { title: "Layout & Spacing", words: ["layout", "spacing", "grid", "breakpoint", "breakpoints", "responsive"] },
  { title: "Component Styling", words: ["component", "components", "button", "buttons", "card", "cards", "badge", "badges", "state", "states"] },
  { title: "Patterns", words: ["pattern", "patterns", "form", "forms", "edit", "editing", "inline", "confirmation", "confirm", "navigation", "interaction", "interactions", "modal", "modals"] },
  { title: "Data Display", words: ["date", "dates", "number", "numbers", "format", "formats", "formatting", "currency", "unknown", "units", "time"] },
  { title: "Brand Assets", words: ["brand", "logo", "logos", "asset", "assets", "image", "images", "icon", "icons", "files"] },
  { title: "Reference Screens", words: ["reference", "references", "example", "examples", "screens"] },
  { title: "Tokens", words: ["token", "tokens", "variables"] },
  { title: "Other Notes", words: [] },
];

// Where a section goes when its title names nothing canonical.
const FILE_DEFAULTS = { "ui-components.md": "Component Styling", "brand-assets.md": "Brand Assets" };
const TEXT_EXTENSIONS = /\.(md|markdown|txt)$/i;

const EMPTY = {
  Tokens: "_Not defined yet. Name the file that holds the values (Tailwind config, CSS variables, theme file)._",
};

/** A preamble ({title: null}) and one entry per `## ` section. H1 lines are dropped. */
export function splitSections(text) {
  const sections = [{ title: null, body: "" }];
  for (const line of text.replace(/\r\n/g, "\n").split("\n")) {
    const h2 = line.match(/^##\s+(.*\S)\s*$/);
    if (h2) sections.push({ title: h2[1], body: "" });
    else if (!/^#\s/.test(line)) sections[sections.length - 1].body += `${line}\n`;
  }
  return sections;
}

function normalise(s) {
  return s
    .split("\n")
    .map((l) => l.trimEnd())
    .filter((l) => l.trim() !== "---")
    .join("\n")
    .replace(/\n{2,}/g, "\n")
    .trim();
}

function clean(body) {
  const lines = body.split("\n");
  const isNoise = (l) => l.trim() === "" || l.trim() === "---";
  while (lines.length && isNoise(lines[0])) lines.shift();
  while (lines.length && isNoise(lines[lines.length - 1])) lines.pop();
  return lines.join("\n");
}

function words(title) {
  return title.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
}

function canonicalFor(title, file) {
  if (title) {
    const w = new Set(words(title));
    const hit = DESIGN_SECTIONS.find((s) => s.words.some((x) => w.has(x)));
    if (hit) return hit.title;
  }
  return FILE_DEFAULTS[file] ?? "Other Notes";
}

function templateKeys(legacy) {
  const keys = new Set();
  for (const text of Object.values(legacy ?? {})) {
    for (const s of splitSections(text)) keys.add(`${s.title ?? ""}\n${normalise(s.body)}`);
  }
  return keys;
}

/**
 * Combine the files of the old design folder into one DESIGN.md.
 * `files` maps a name relative to the folder to its text. A name that is not
 * a text file is listed under Brand Assets, never inlined.
 */
export function buildDesignMd(files, { legacy = {}, source, date = new Date().toISOString().slice(0, 10) } = {}) {
  const keys = templateKeys(legacy);
  const placed = Object.fromEntries(DESIGN_SECTIONS.map((s) => [s.title, []]));
  const migrated = [];
  const templateOnly = [];

  for (const name of Object.keys(files).sort()) {
    if (!TEXT_EXTENSIONS.test(name)) {
      placed["Brand Assets"].push(`- \`${source}/${name}\``);
      continue;
    }
    let kept = 0;
    for (const s of splitSections(files[name])) {
      const body = normalise(s.body);
      if (!body || keys.has(`${s.title ?? ""}\n${body}`)) continue;
      const heading = s.title ?? `Notes from ${name}`;
      const demoted = clean(s.body).replace(/^(#{3,})\s/gm, "#$1 ");
      placed[canonicalFor(s.title, name)].push(`### ${heading}\n<!-- from ${source}/${name} -->\n\n${demoted}`);
      kept += 1;
    }
    if (kept) migrated.push(name);
    else if (normalise(files[name])) templateOnly.push(name);
  }

  const out = [
    "# Design System",
    "",
    "> The visual identity of this product. Every new screen follows it. The values live in code (see **Tokens**). " +
      "This file holds the roles, the rules and the reasons. Maintained with `.agents/skills/design-system/SKILL.md`.",
    "",
  ];
  if (migrated.length || placed["Brand Assets"].length) {
    out.push(`<!-- Migrated from ${source}/ by \`carja design migrate\` on ${date}. -->`, "");
  }
  for (const { title } of DESIGN_SECTIONS) {
    out.push(`## ${title}`, "");
    out.push(placed[title].length ? placed[title].join("\n\n") : (EMPTY[title] ?? "_Not defined yet._"), "");
  }
  return { markdown: out.join("\n"), migrated, templateOnly };
}

export function pointerStub(relativeTarget) {
  return `# Moved to \`DESIGN.md\`\n\nThe design system now lives in one file: \`${relativeTarget}\`. Edit it there.\n`;
}
