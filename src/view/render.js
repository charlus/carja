// src/view/render.js
//
// Assembles ONE self-contained HTML file from the shared state object.
//
// WHY ONE FILE AND NOT A SITE. The page is opened straight off disk with
// `file://`. In that origin Chrome blocks `fetch()` and XHR, so nothing can be
// loaded at runtime; and a per-document site would mean the human is back to
// choosing which file to open, which is the problem this replaces. One file is
// one bookmark: `carja view`, then refresh.
//
// Consequences, all deliberate:
//   * CSS and JS are inlined from their real sibling files (readable source,
//     single artefact out);
//   * documents arrive already rendered to HTML, so the page ships no markdown
//     parser;
//   * state travels in a JSON block that is PARSED, not evaluated, with `<`
//     escaped so no content can close the tag and inject a script.
//
// The output is derived. It is written to a gitignored folder and must never be
// committed — `carja/` is the source of truth, this is a projection of it.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const CSS = readFileSync(join(HERE, "styles.css"), "utf8");
const APP = readFileSync(join(HERE, "app.client.js"), "utf8");

/** The single bookmarkable entry point. */
export const VIEW_FILENAME = "index.html";

/**
 * Serialise state for an inlined `application/json` block.
 *
 * `<` and `>` are escaped so a document containing `</script>` cannot terminate
 * the block; `&` so no entity is re-interpreted; U+2028/U+2029 because they are
 * line terminators in JavaScript and would break the parse even though JSON
 * itself permits them raw.
 */
function inlineJson(value) {
  return JSON.stringify(value)
    .replace(/</g, "\\u003c")
    .replace(/>/g, "\\u003e")
    .replace(/&/g, "\\u0026")
    .replace(/\u2028/g, "\\u2028")
    .replace(/\u2029/g, "\\u2029");
}

function escapeAttr(text) {
  return String(text ?? "").replace(/[&<>"']/g, (c) => {
    return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
  });
}

/**
 * Render the whole dashboard to a single HTML string.
 *
 * @param {ReturnType<import("../carja-state.js").buildState>} state
 * @returns {string}
 */
export function renderPage(state) {
  const isEmpty =
    !state.digest.docCount && !state.digest.inboxCount && !state.digest.backlogOpen;
  const title = `${state.projectName} · Carja`;

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="generator" content="carja view">
<meta name="robots" content="noindex">
<title>${escapeAttr(title)}</title>
<style>
${CSS}
</style>
</head>
<body data-empty="${isEmpty ? "true" : "false"}">
<div class="shell">
  <aside class="sidebar" id="sidebar"></aside>
  <div class="main">
    <header class="topbar">
      <button class="icon-btn menu-btn" id="menu-btn" title="Sections" aria-label="Sections">&#8801;</button>
      <div class="crumb" id="crumb"></div>
      <div class="topbar-right">
        <span class="chip" title="This page is derived from carja/. Re-run carja view to refresh.">derived</span>
        <button class="icon-btn" id="theme-btn" title="Theme" aria-label="Theme">&#9686;</button>
      </div>
    </header>
    <main class="content" id="content"></main>
  </div>
</div>
<noscript>
  <div style="padding:32px;max-width:44em;margin:0 auto">
    <h1>${escapeAttr(state.projectName)} · Carja</h1>
    <p>This dashboard renders itself from an inlined data block, so it needs JavaScript.
    The source of truth is unaffected: every document is a plain markdown file under
    <code>carja/</code>.</p>
  </div>
</noscript>
<script type="application/json" id="carja-data">${inlineJson(state)}</script>
<script>
${APP}
</script>
</body>
</html>
`;
}
