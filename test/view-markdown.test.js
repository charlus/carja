// test/view-markdown.test.js
//
// The dependency-free markdown renderer that `carja view` uses at
// GENERATION time (never in the browser, so the page carries no parser).
//
// The security tests are the important ones. `carja/` holds text written by
// the human, by agents, and — via the inbox — by whatever the human pasted in.
// The generated page is opened from `file://`, an origin with more local reach
// than a website, so the renderer must NEVER pass raw HTML through and must
// never emit a `javascript:` URL. Escaping is the whole contract.

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  escapeHtml,
  renderInline,
  renderMarkdown,
  extractHeadings,
  documentTitle,
  slugifyHeading,
  stripInlineMarkdown,
} from "../src/view/markdown.js";

describe("escaping (the security contract)", () => {
  test("escapes the five dangerous characters", () => {
    assert.equal(escapeHtml(`<a href="x">&'`), "&lt;a href=&quot;x&quot;&gt;&amp;&#39;");
  });

  test("raw HTML in markdown is rendered as text, never passed through", () => {
    const html = renderMarkdown('<script>alert(1)</script>\n');
    assert.ok(!html.includes("<script>"), "a script tag must not survive");
    assert.ok(html.includes("&lt;script&gt;"), "it must appear as visible text");
  });

  test("an img onerror payload cannot escape", () => {
    const html = renderMarkdown('<img src=x onerror="alert(1)">\n');
    // The text may still READ "onerror=" — what must not exist is a live tag.
    assert.ok(!/<img/i.test(html), html);
    assert.ok(html.includes("&lt;img"), html);
  });

  test("javascript: links are neutralised", () => {
    const html = renderInline("[click](javascript:alert(1))");
    assert.ok(!html.toLowerCase().includes("javascript:"), html);
    assert.ok(html.includes('href="#"'), html);
  });

  test("a normal link and an autolink both work", () => {
    assert.ok(renderInline("[docs](./spec.md)").includes('href="./spec.md"'));
    assert.ok(renderInline("<https://example.com>").includes('href="https://example.com"'));
  });
});

describe("inline formatting", () => {
  test("bold, italic, strikethrough and code", () => {
    assert.ok(renderInline("**b**").includes("<strong>b</strong>"));
    assert.ok(renderInline("*i*").includes("<em>i</em>"));
    assert.ok(renderInline("~~s~~").includes("<del>s</del>"));
    assert.ok(renderInline("`c`").includes("<code>c</code>"));
  });

  test("markdown inside a code span stays literal", () => {
    const html = renderInline("`**not bold**`");
    assert.ok(html.includes("<code>**not bold**</code>"), html);
    assert.ok(!html.includes("<strong>"), html);
  });

  test("bold wins over italic on the same run", () => {
    const html = renderInline("**both**");
    assert.ok(html.includes("<strong>both</strong>"), html);
    assert.ok(!html.includes("<em>"), html);
  });
});

describe("block structure", () => {
  test("headings get stable slug ids", () => {
    const html = renderMarkdown("## Why This Matters\n");
    assert.match(html, /<h2 id="why-this-matters">Why This Matters<\/h2>/);
  });

  test("paragraphs, lists and nesting", () => {
    const html = renderMarkdown("hello\n\n- one\n- two\n  - deep\n");
    assert.ok(html.includes("<p>hello</p>"), html);
    assert.equal((html.match(/<ul>/g) ?? []).length, 2, "one nested list");
    assert.ok(html.includes("<li>deep</li>"), html);
  });

  test("ordered lists", () => {
    const html = renderMarkdown("1. first\n2. second\n");
    assert.ok(html.includes("<ol>"), html);
  });

  test("task list items render as real checkboxes, disabled", () => {
    const html = renderMarkdown("- [ ] open thing\n- [x] done thing\n");
    assert.ok(html.includes("disabled"), "must not be clickable — the file is the source of truth");
    assert.ok(html.includes("checked"), html);
    assert.ok(html.includes("task-done"), "a done item is marked so CSS can strike it");
  });

  test("fenced code keeps its language and escapes its body", () => {
    const html = renderMarkdown("```js\nconst a = 1 < 2;\n```\n");
    assert.ok(html.includes('class="lang-js"'), html);
    assert.ok(html.includes("1 &lt; 2"), html);
  });

  test("markdown inside a fence is not interpreted", () => {
    const html = renderMarkdown("```\n# not a heading\n- not a list\n```\n");
    assert.ok(!html.includes("<h1"), html);
    assert.ok(!html.includes("<li>"), html);
  });

  test("pipe tables render as tables with a header row", () => {
    const html = renderMarkdown("| A | B |\n|---|---|\n| 1 | 2 |\n");
    assert.ok(html.includes("<table>"), html);
    assert.ok(html.includes("<th>A</th>"), html);
    assert.ok(html.includes("<td>1</td>"), html);
  });

  test("a table is wrapped so it can scroll instead of breaking the layout", () => {
    const html = renderMarkdown("| A |\n|---|\n| 1 |\n");
    assert.ok(html.includes("table-wrap"), html);
  });

  test("blockquotes and horizontal rules", () => {
    assert.ok(renderMarkdown("> quoted\n").includes("<blockquote>"));
    assert.ok(renderMarkdown("---\n").includes("<hr>"));
  });

  test("GitHub alerts become styled callouts", () => {
    const html = renderMarkdown("> [!WARNING]\n> be careful\n");
    assert.ok(html.includes("callout"), html);
    assert.ok(html.includes("callout-warning"), html);
    assert.ok(html.includes("be careful"), html);
    assert.ok(!html.includes("[!WARNING]"), "the marker itself is not content");
  });

  test("YAML frontmatter is stripped, not rendered", () => {
    const html = renderMarkdown("---\ntrigger: always_on\n---\n\nbody\n");
    assert.ok(!html.includes("always_on"), html);
    assert.ok(html.includes("<p>body</p>"), html);
  });
});

describe("document metadata", () => {
  test("headings are extracted in order with levels", () => {
    const hs = extractHeadings("# Title\n\n## One\n\n### Deep\n\n## Two\n");
    assert.deepEqual(
      hs.map((h) => [h.level, h.text]),
      [
        [1, "Title"],
        [2, "One"],
        [3, "Deep"],
        [2, "Two"],
      ]
    );
    assert.equal(hs[1].id, "one");
  });

  test("headings inside a fence are not extracted", () => {
    assert.equal(extractHeadings("```\n# fake\n```\n").length, 0);
  });

  test("the title comes from the first h1, else from the filename", () => {
    assert.equal(documentTitle("# Real Title\n", "some-file.md"), "Real Title");
    assert.equal(documentTitle("no heading\n", "north-star.md"), "North Star");
  });

  test("duplicate headings get unique ids", () => {
    const hs = extractHeadings("## Same\n\n## Same\n");
    assert.notEqual(hs[0].id, hs[1].id);
  });

  test("slugify strips punctuation and collapses spaces", () => {
    assert.equal(slugifyHeading("P1 — High Priority (Do Next)"), "p1-high-priority-do-next");
  });
});

describe("regressions found on a real backlog (2026-09-08)", () => {
  // A real `task-backlog.md` has task items whose bodies carry bold, inline
  // code and underscore emphasis. Four separate failures showed up on it, and
  // every one passed the original suite because those fixtures were tidy
  // one-word items. The lesson is the same as the loop-state one: a fixture
  // that does not look like the real thing proves nothing.

  test("a task item's body is ONE element, so a flex li cannot shatter it", () => {
    // `.prose li.task` is display:flex. Unwrapped inline content makes every
    // <strong>, <code> and text node its own flex ITEM, each shrinking to a
    // narrow column — the one-word-per-line layout in the screenshot.
    const html = renderMarkdown("- [ ] **DB-1: fix it.** Add `pool_pre_ping` to `core/db.py`.\n");
    const li = html.match(/<li class="task[^"]*">([\s\S]*?)<\/li>/);
    assert.ok(li, "expected a task item");
    const afterCheckbox = li[1].replace(/<input[^>]*>\s*/, "");
    assert.match(
      afterCheckbox,
      /^<span class="task-body">/,
      `body must be wrapped in a single element, got: ${afterCheckbox.slice(0, 80)}`
    );
  });

  test("underscore emphasis renders", () => {
    assert.ok(renderInline("_Why:_ observed in prod").includes("<em>Why:</em>"));
    assert.ok(renderInline("__really__ bad").includes("<strong>really</strong>"));
  });

  test("but snake_case identifiers are left alone", () => {
    // This matters more than the emphasis: real backlogs are full of them.
    for (const id of ["pool_pre_ping", "user_tokens", "expires_at", "a_b_c_d"]) {
      const out = renderInline(`the ${id} field`);
      assert.ok(!out.includes("<em>"), `${id} was mangled into emphasis: ${out}`);
      assert.ok(out.includes(id), `${id} did not survive: ${out}`);
    }
  });

  test("the leading H1 can be dropped, so a title is not shown twice", () => {
    const md = "# Backlog\n\nSmall stuff.\n";
    assert.match(renderMarkdown(md), /<h1 /, "default keeps it");
    const body = renderMarkdown(md, { skipFirstH1: true });
    assert.ok(!body.includes("<h1"), body);
    assert.ok(body.includes("<p>Small stuff.</p>"), "the rest survives");
  });

  test("skipFirstH1 drops only a LEADING h1, never a later one", () => {
    const body = renderMarkdown("# One\n\n## Two\n\n# Three\n", { skipFirstH1: true });
    assert.ok(!body.includes(">One<"), "leading h1 dropped");
    assert.ok(body.includes(">Three<"), "a later h1 is content, not a title");
  });

  test("emphasis survives across an inline-code boundary", () => {
    const out = renderInline("**bold** then `code` then _em_");
    assert.ok(out.includes("<strong>bold</strong>"), out);
    assert.ok(out.includes("<code>code</code>"), out);
    assert.ok(out.includes("<em>em</em>"), out);
  });

  test("a plain-text form exists for surfaces that cannot render html", () => {
    // The terminal digest showed `**DB-1: …**` literally. It needs the text,
    // not the markup, and not `plainText`'s aggressive stripping.
    assert.equal(
      stripInlineMarkdown("**DB-1: fix it.** Add `pool_pre_ping` — _now_"),
      "DB-1: fix it. Add pool_pre_ping — now"
    );
    assert.equal(stripInlineMarkdown("[label](http://x)"), "label");
  });
});
