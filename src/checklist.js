// src/checklist.js
//
// F24 (docs/roadmap/Risk-Tiered-Merge.md): checklist items triggered by the
// diff, after the Claude Code team's reliability checklist (39 items, each with
// a trigger read from the diff; a review checks the 3 to 10 that match). An
// item of carja/0-compass/architecture-checklist.md may carry
//
//   trigger: <glob>, <glob>
//
// (paths as the project root sees them, so a nested code repository's files
// start with its folder). An item without a trigger always applies: an old
// checklist behaves as before. Pure.

import { globMatch } from "./loop/risk.js";

export const CHECKLIST_REL = "carja/0-compass/architecture-checklist.md";

const ITEM = /^ {0,3}[-*] /;
const HEADING = /^#{1,6} +(.+?)\s*$/;

/** The items of a checklist: [{section, lines, text, trigger: string[]|null}]. */
export function parseChecklist(md) {
  const items = [];
  let section = null;
  let cur = null;
  const close = () => {
    if (!cur) return;
    while (cur.lines.length && !cur.lines.at(-1).trim()) cur.lines.pop();
    const t = cur.lines.map((l) => l.match(/^\s*trigger:\s*(.+)$/)).find(Boolean);
    cur.trigger = t ? t[1].split(",").map((g) => g.trim().replace(/^`|`$/g, "")).filter(Boolean) : null;
    cur.text = cur.lines.join("\n");
    items.push(cur);
    cur = null;
  };
  for (const line of String(md ?? "").split("\n")) {
    const h = line.match(HEADING);
    if (h) {
      close();
      section = h[1];
      continue;
    }
    if (ITEM.test(line)) {
      close();
      cur = { section, lines: [line] };
      continue;
    }
    if (cur && (/^\s/.test(line) || !line.trim())) cur.lines.push(line);
    else close();
  }
  close();
  return items;
}

/** {applies, skipped, total}: items whose trigger matches one of `files`, and items without a trigger. */
export function applicableItems(items, files) {
  const list = (files ?? []).map((f) => String(f).replace(/^\.\//, ""));
  const applies = items.filter((i) => !i.trigger || i.trigger.some((g) => list.some((f) => globMatch(g, f))));
  return { applies, skipped: items.length - applies.length, total: items.length };
}

/** The applicable items as markdown, under their sections, with a count line. */
export function renderApplicable({ applies, skipped, total }) {
  const out = [`${applies.length} of ${total} checklist items apply to this diff; ${skipped} left out by its trigger.`];
  let section;
  for (const i of applies) {
    if (i.section !== section) {
      section = i.section;
      if (section) out.push("", `## ${section}`);
    }
    out.push("", i.text);
  }
  return `${out.join("\n")}\n`;
}
