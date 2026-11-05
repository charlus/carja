// src/view/markdown.js
//
// A small, dependency-free markdown → HTML renderer, run at GENERATION time by
// `carja view`. The generated page therefore ships no parser: documents
// arrive already rendered, which keeps the single file small and means the page
// needs no runtime work beyond routing.
//
// WHY WRITE ONE INSTEAD OF TAKING A DEPENDENCY. `carja` is installed with
// `npx` into other people's repos and the framework has no build step. A
// zero-dependency renderer keeps both properties. The markdown that actually
// appears in `carja/` is a known, narrow dialect (headings, lists, task
// lists, fences, pipe tables, blockquotes, GitHub alerts), so full CommonMark
// would be paying for coverage nothing uses.
//
// THE SECURITY CONTRACT. `carja/` holds text written by the human, by
// agents, and — through the inbox — by whatever the human pasted in. The page is
// opened from `file://`, an origin with more local reach than a website. So:
//
//   * every character of content is escaped before it reaches the output;
//   * raw HTML in the source is shown as text, never passed through;
//   * `javascript:`, `data:` and `vbscript:` URLs are replaced with `#`.
//
// There is no "trusted markdown" path and there must never be one.

const ESCAPES = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };

// Code spans are lifted out before escaping so formatting inside them stays
// literal. The sentinel is a NUL, which cannot occur in a markdown source we
// would want to render, written as an escape so no control byte enters this file.
const SENTINEL = "\u0000";
const CODE_SLOT_RE = /\u0000(\d+)\u0000/g;

/** Escape the five characters that can change HTML structure or break an attribute. */
export function escapeHtml(text) {
  return String(text ?? "").replace(/[&<>"']/g, (c) => ESCAPES[c]);
}

/** Neutralise any URL scheme that can execute. Input is already HTML-escaped. */
function safeUrl(url) {
  const trimmed = String(url ?? "").trim();
  // Strip HTML entities and whitespace before testing, so `java&#9;script:` and
  // `JAVASCRIPT&colon;` style evasions cannot slip past the scheme check.
  const probe = trimmed.replace(/&[#a-z0-9]+;/gi, "").replace(/\s+/g, "").toLowerCase();
  if (/^(javascript|data|vbscript|file):/.test(probe)) return "#";
  return trimmed;
}

/** Heading text → a stable, readable anchor id. */
export function slugifyHeading(text) {
  return (
    String(text ?? "")
      .toLowerCase()
      .replace(/`|\*\*|\*|~~|_/g, "")
      .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") || "section"
  );
}

/** Make ids unique within one document, so a TOC link always lands. */
function uniqueId(base, seen) {
  const n = (seen.get(base) ?? 0) + 1;
  seen.set(base, n);
  return n === 1 ? base : `${base}-${n}`;
}

/** Drop a leading YAML frontmatter block — it is metadata, not content. */
function stripFrontmatter(src) {
  const m = src.match(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/);
  return m ? src.slice(m[0].length) : src;
}

/**
 * Render inline markdown. Code spans are pulled out first so that formatting
 * inside them stays literal, then everything is escaped, then the inline
 * patterns run over already-safe text.
 */
export function renderInline(text) {
  const codes = [];
  let s = String(text ?? "").replace(/`([^`]+)`/g, (_m, code) => {
    codes.push(code);
    return `${SENTINEL}${codes.length - 1}${SENTINEL}`;
  });

  s = escapeHtml(s);

  // Images before links — the syntaxes differ only by the leading `!`.
  s = s.replace(
    /!\[([^\]]*)\]\(([^)\s]+)\)/g,
    (_m, alt, src) => `<img alt="${alt}" src="${safeUrl(src)}" loading="lazy">`
  );
  s = s.replace(/\[([^\]]+)\]\(([^)\s]*)\)/g, (_m, label, href) => {
    const url = safeUrl(href);
    const external = /^https?:/i.test(url);
    const attrs = external ? ' target="_blank" rel="noopener noreferrer"' : "";
    return `<a href="${url}"${attrs}>${label}</a>`;
  });
  s = s.replace(
    /&lt;(https?:\/\/[^\s&]+)&gt;/g,
    (_m, url) => `<a href="${safeUrl(url)}" target="_blank" rel="noopener noreferrer">${url}</a>`
  );

  s = s.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  s = s.replace(/(^|[^*\w])\*([^*\n]+)\*/g, "$1<em>$2</em>");

  // Underscore emphasis, with the delimiter required to sit against a
  // non-word character on BOTH sides. Without that guard the identifiers real
  // backlogs are full of — `pool_pre_ping`, `user_tokens`, `expires_at` — get
  // chewed into <em>, which is worse than not supporting `_` at all.
  s = s.replace(/(^|[^\w_])__([^_\n]+)__(?=[^\w_]|$)/g, "$1<strong>$2</strong>");
  s = s.replace(/(^|[^\w_])_([^_\n]+)_(?=[^\w_]|$)/g, "$1<em>$2</em>");

  s = s.replace(/~~([^~]+)~~/g, "<del>$1</del>");

  return s.replace(CODE_SLOT_RE, (_m, i) => `<code>${escapeHtml(codes[Number(i)])}</code>`);
}

const FENCE_RE = /^\s*(?:```+|~~~+)\s*([\w+#.-]*)\s*$/;
const HEADING_RE = /^(#{1,6})\s+(.*)$/;
const HR_RE = /^\s*(?:-{3,}|\*{3,}|_{3,})\s*$/;
const LIST_RE = /^(\s*)(?:([-*+])|(\d+)[.)])\s+(.*)$/;
const TASK_RE = /^\[([ xX])\]\s+(.*)$/;
const TABLE_SEP_RE = /^\s*\|?[\s:|-]*-[\s:|-]*\|?\s*$/;

const ALERTS = {
  NOTE: "Note",
  TIP: "Tip",
  IMPORTANT: "Important",
  WARNING: "Warning",
  CAUTION: "Caution",
};

/** Split a pipe-table row into its cells, tolerating optional outer pipes. */
function tableCells(line) {
  let s = line.trim();
  if (s.startsWith("|")) s = s.slice(1);
  if (s.endsWith("|")) s = s.slice(0, -1);
  return s.split("|").map((c) => c.trim());
}

/** Build a possibly-nested list from a run of list lines, using indent depth. */
function renderList(lines) {
  const items = lines.map((line) => {
    const m = line.match(LIST_RE);
    return {
      indent: m[1].replace(/\t/g, "  ").length,
      ordered: Boolean(m[3]),
      text: m[4],
    };
  });

  let i = 0;
  const build = (depth) => {
    const out = [];
    let ordered = false;
    while (i < items.length && items[i].indent >= depth) {
      const item = items[i];
      if (item.indent > depth) {
        // Deeper than expected without a parent — treat as this level.
        item.indent = depth;
      }
      ordered = item.ordered;
      i += 1;
      let body;
      let classes = [];
      const task = item.text.match(TASK_RE);
      if (task) {
        const done = task[1].toLowerCase() === "x";
        classes.push("task");
        if (done) classes.push("task-done");
        // The body MUST be a single wrapper element. `li.task` is a flex
        // container so the checkbox can sit beside the text; leave the body
        // unwrapped and every <strong>, <code> and text node becomes its own
        // flex item, each collapsing to a one-word column.
        body =
          `<input type="checkbox" ${done ? "checked " : ""}disabled>` +
          `<span class="task-body">${renderInline(task[2])}</span>`;
      } else {
        body = renderInline(item.text);
      }
      // Any following items indented deeper belong to this one.
      let nested = "";
      if (i < items.length && items[i].indent > depth) {
        nested = build(items[i].indent);
      }
      const attr = classes.length ? ` class="${classes.join(" ")}"` : "";
      out.push(`<li${attr}>${body}${nested}</li>`);
    }
    const tag = ordered ? "ol" : "ul";
    return `<${tag}>${out.join("")}</${tag}>`;
  };

  return build(items[0].indent);
}

/**
 * Render a markdown document to HTML.
 *
 * @param {string} md
 * @param {{skipFirstH1?: boolean}} [opts] `skipFirstH1` drops a LEADING `# …`
 *   when the caller is already displaying it as the document's title, so the
 *   title is not printed twice. A later h1 is content and is always kept.
 * @returns {string} HTML fragment (no wrapper element)
 */
export function renderMarkdown(md, opts = {}) {
  const lines = stripFrontmatter(String(md ?? "")).split(/\r?\n/);
  const out = [];
  const seenIds = new Map();
  let skipH1 = opts.skipFirstH1 === true;
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    if (!line.trim()) {
      i += 1;
      continue;
    }

    // Fenced code — consumed verbatim so no markdown inside is interpreted.
    const fence = line.match(FENCE_RE);
    if (fence) {
      const lang = fence[1] ? ` class="lang-${escapeHtml(fence[1])}"` : "";
      const body = [];
      i += 1;
      while (i < lines.length && !FENCE_RE.test(lines[i])) {
        body.push(lines[i]);
        i += 1;
      }
      i += 1; // closing fence
      out.push(`<pre><code${lang}>${escapeHtml(body.join("\n"))}</code></pre>`);
      continue;
    }

    // Horizontal rule before lists: `---` is a rule, not a bullet.
    if (HR_RE.test(line)) {
      out.push("<hr>");
      i += 1;
      continue;
    }

    const heading = line.match(HEADING_RE);
    if (heading) {
      const level = heading[1].length;
      const text = heading[2].trim();
      // The title is shown by the caller; consume this one and stop looking.
      if (skipH1 && level === 1 && out.length === 0) {
        skipH1 = false;
        i += 1;
        continue;
      }
      skipH1 = false;
      const id = uniqueId(slugifyHeading(text), seenIds);
      out.push(`<h${level} id="${id}">${renderInline(text)}</h${level}>`);
      i += 1;
      continue;
    }

    // Pipe table: this row plus a separator row underneath.
    if (line.includes("|") && TABLE_SEP_RE.test(lines[i + 1] ?? "")) {
      const head = tableCells(line);
      i += 2;
      const body = [];
      while (i < lines.length && lines[i].includes("|") && lines[i].trim()) {
        body.push(tableCells(lines[i]));
        i += 1;
      }
      const thead = `<thead><tr>${head.map((c) => `<th>${renderInline(c)}</th>`).join("")}</tr></thead>`;
      const tbody = body.length
        ? `<tbody>${body
            .map((row) => `<tr>${row.map((c) => `<td>${renderInline(c)}</td>`).join("")}</tr>`)
            .join("")}</tbody>`
        : "";
      out.push(`<div class="table-wrap"><table>${thead}${tbody}</table></div>`);
      continue;
    }

    // Blockquote, including GitHub alert callouts.
    if (/^\s*>/.test(line)) {
      const inner = [];
      while (i < lines.length && /^\s*>/.test(lines[i])) {
        inner.push(lines[i].replace(/^\s*>\s?/, ""));
        i += 1;
      }
      const alert = inner[0]?.match(/^\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\]\s*$/i);
      if (alert) {
        const kind = alert[1].toUpperCase();
        const body = renderMarkdown(inner.slice(1).join("\n"));
        out.push(
          `<blockquote class="callout callout-${kind.toLowerCase()}">` +
            `<p class="callout-title">${ALERTS[kind]}</p>${body}</blockquote>`
        );
      } else {
        out.push(`<blockquote>${renderMarkdown(inner.join("\n"))}</blockquote>`);
      }
      continue;
    }

    if (LIST_RE.test(line)) {
      const block = [];
      while (i < lines.length && LIST_RE.test(lines[i])) {
        block.push(lines[i]);
        i += 1;
      }
      out.push(renderList(block));
      continue;
    }

    // Paragraph: consume until a blank line or the start of another block.
    const para = [];
    while (
      i < lines.length &&
      lines[i].trim() &&
      !HEADING_RE.test(lines[i]) &&
      !HR_RE.test(lines[i]) &&
      !FENCE_RE.test(lines[i]) &&
      !LIST_RE.test(lines[i]) &&
      !/^\s*>/.test(lines[i])
    ) {
      para.push(lines[i].trim());
      i += 1;
    }
    out.push(`<p>${renderInline(para.join(" "))}</p>`);
  }

  return out.join("\n");
}

/**
 * Extract the heading outline, skipping fenced code. Ids match the ones
 * `renderMarkdown` emits (same algorithm, same order), so a TOC link lands.
 *
 * @returns {Array<{level:number, text:string, id:string}>}
 */
export function extractHeadings(md) {
  const lines = stripFrontmatter(String(md ?? "")).split(/\r?\n/);
  const seen = new Map();
  const out = [];
  let inFence = false;
  for (const line of lines) {
    if (FENCE_RE.test(line)) {
      inFence = !inFence;
      continue;
    }
    if (inFence) continue;
    const m = line.match(HEADING_RE);
    if (!m) continue;
    const text = m[2].trim();
    out.push({ level: m[1].length, text, id: uniqueId(slugifyHeading(text), seen) });
  }
  return out;
}

/** A kebab-case filename read as a title: `north-star.md` → `North Star`. */
function titleFromFilename(filename) {
  return String(filename ?? "")
    .replace(/\.md$/i, "")
    .split(/[-_]/)
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

/** The document's display name: its first h1, else its filename read as prose. */
export function documentTitle(md, filename) {
  const lines = stripFrontmatter(String(md ?? "")).split(/\r?\n/);
  let inFence = false;
  for (const line of lines) {
    if (FENCE_RE.test(line)) {
      inFence = !inFence;
      continue;
    }
    if (inFence) continue;
    const m = line.match(/^#\s+(.*)$/);
    if (m && m[1].trim()) return m[1].trim();
  }
  return titleFromFilename(filename);
}

/**
 * Strip inline markup from a single line, keeping every word.
 *
 * For surfaces that cannot render HTML — the terminal digest, a page title —
 * where `**DB-1: fix it.**` should read as `DB-1: fix it.` rather than showing
 * its asterisks. Distinct from `plainText`, which is for the search index and
 * strips punctuation aggressively enough to ruin a title.
 */
export function stripInlineMarkdown(text) {
  return String(text ?? "")
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/`([^`]*)`/g, "$1")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/(^|[^*\w])\*([^*\n]+)\*/g, "$1$2")
    // Same boundary guard as the renderer, so identifiers keep their
    // underscores instead of being silently de-underscored.
    .replace(/(^|[^\w_])__([^_\n]+)__(?=[^\w_]|$)/g, "$1$2")
    .replace(/(^|[^\w_])_([^_\n]+)_(?=[^\w_]|$)/g, "$1$2")
    .replace(/~~([^~]+)~~/g, "$1")
    .replace(/\s+/g, " ")
    .trim();
}

/** Plain text of a document, for the search index. */
export function plainText(md) {
  return stripFrontmatter(String(md ?? ""))
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/`[^`]*`/g, " ")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, " ")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/[#>*_~|-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}
