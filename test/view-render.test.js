// test/view-render.test.js
//
// The two renderers over the one state object: the terminal digest and the
// single-file HTML page.
//
// The HTML page has one hard constraint that drove its shape: it is opened from
// `file://`, where Chrome gives the page a `null` origin and blocks `fetch()`.
// So EVERYTHING — nav, search index, rendered documents — must be stamped in at
// generation time. A page that tries to load anything at runtime silently shows
// nothing, with no error the human would notice. These tests pin that.

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { buildState } from "../src/carja-state.js";
import { renderPage, VIEW_FILENAME } from "../src/view/render.js";
import { renderStatus } from "../src/view/status.js";
import { readFileSync } from "node:fs";

const INBOX = "# Inbox\n\n---\n\n- rename the export button\n";
const BACKLOG = `# Backlog

## P1 - High Priority (Do Next)
- [ ] Fix login timeout bug on mobile
- [ ] Update the README

## P2 - Medium Priority
- [ ] Add a "Clear All" button
`;

const state = (over = {}) =>
  buildState({
    root: "/repo",
    projectName: "acme-app",
    inboxMd: INBOX,
    backlogMd: BACKLOG,
    // A realistic slice of the v2 schema — never an invented shape, which is
    // exactly how the `loop.beat` bug survived its own test.
    loopState: { phase: "build", status: "idle", iterations: { current: 3, max_allowed: 20 }, autonomy_level: "L1" },
    docs: [
      {
        relPath: "carja/0-compass/north-star.md",
        raw: "# North Star\n\nWe help teams ship.\n\n## Metrics\n\n| Metric | Target |\n|---|---|\n| DAU | 1000 |\n",
        mtimeMs: Date.parse("2026-09-01T00:00:00Z"),
      },
      {
        relPath: "carja/3-product-areas/auth/spec.md",
        raw: "# Auth Spec\n\nSee north-star.md for context.\n",
        mtimeMs: Date.parse("2026-09-07T00:00:00Z"),
      },
    ],
    now: Date.parse("2026-09-08T00:00:00Z"),
    ...over,
  });

describe("the HTML page is genuinely self-contained", () => {
  const html = renderPage(state());

  test("it is one complete document", () => {
    assert.ok(html.startsWith("<!doctype html>"), html.slice(0, 40));
    assert.ok(html.trimEnd().endsWith("</html>"));
  });

  test("it loads nothing over the network", () => {
    assert.ok(!/src\s*=\s*["']https?:/i.test(html), "no remote scripts or images");
    assert.ok(!/<link[^>]+href\s*=\s*["']https?:/i.test(html), "no remote stylesheets");
    assert.ok(!/@import\s+url\(\s*["']?https?:/i.test(html), "no remote CSS imports");
  });

  test("it never calls fetch or XHR — file:// blocks both", () => {
    assert.ok(!/\bfetch\s*\(/.test(html), "fetch() is blocked from a null origin");
    assert.ok(!/XMLHttpRequest/.test(html));
  });

  test("its CSS and JS are inline", () => {
    assert.ok(html.includes("<style>"), "inline stylesheet");
    assert.ok(html.includes("<script"), "inline script");
  });

  test("the filename is the single bookmarkable entry point", () => {
    assert.equal(VIEW_FILENAME, "index.html");
  });
});

describe("data is inlined safely", () => {
  test("state ships as JSON in a script tag, with < escaped so it cannot break out", () => {
    const html = renderPage(state());
    assert.ok(html.includes('type="application/json"'), "parsed, not evaluated");
    assert.ok(!/<\/script>\s*<\/script>/.test(html));
  });

  test("a document containing </script> cannot terminate the data block", () => {
    const html = renderPage(
      state({
        docs: [
          {
            relPath: "carja/0-compass/north-star.md",
            raw: "# T\n\n```\n</script><script>alert(1)</script>\n```\n",
            mtimeMs: 0,
          },
        ],
      })
    );
    const scripts = html.match(/<script\b/gi) ?? [];
    // Exactly the data block plus the app script — no injected third one.
    assert.equal(scripts.length, 2, `unexpected script count: ${scripts.length}`);
    assert.ok(!html.includes("alert(1)</script>"), "payload must stay escaped");
  });

  test("U+2028/2029 are escaped — they are line terminators in JS", () => {
    const html = renderPage(
      state({ docs: [{ relPath: "carja/0-compass/a.md", raw: "# T\n\nx y\n", mtimeMs: 0 }] })
    );
    assert.ok(!html.includes(" "), "raw U+2028 would break the parse");
  });
});

describe("the page carries what the human lost with the IDE", () => {
  const html = renderPage(state());

  test("every lifecycle section is in the nav, so the folder tree is never browsed", () => {
    for (const key of ["0-compass", "1-workbench", "2-backlog", "3-product-areas", "4-context", "5-templates", "6-archive"]) {
      assert.ok(html.includes(key), `${key} missing from the page`);
    }
  });

  test("the digest numbers are on the page", () => {
    assert.ok(html.includes("acme-app"), "project name");
    assert.ok(/Inbox/i.test(html));
    assert.ok(/P1/.test(html));
  });

  test("documents arrive pre-rendered, including their tables", () => {
    assert.ok(html.includes("North Star"));
    assert.ok(html.includes("table-wrap"), "a rendered table is an asset here, not a liability");
  });

  test("backlinks are on the page — the thing cat cannot show", () => {
    assert.ok(/backlink/i.test(html));
  });

  test("it has a search box and an inlined index to search", () => {
    assert.ok(/type="search"|id="search"/.test(html), "a search input");
    assert.ok(html.includes("north-star"), "index entries are inlined");
  });

  test("it is theme-aware in both directions", () => {
    assert.ok(html.includes("prefers-color-scheme"), "follows the OS by default");
    assert.ok(html.includes("data-theme"), "and an explicit toggle wins");
  });

  test("it works on a phone-width screen", () => {
    assert.ok(html.includes("viewport"), "meta viewport");
    assert.ok(html.includes("@media"), "responsive rules");
  });

  test("an empty carja/ is flagged on the page, not left to render as zeros", () => {
    const empty = renderPage(buildState({ root: "/r", projectName: "r", docs: [], now: 0 }));
    assert.ok(empty.startsWith("<!doctype html>"));
    assert.ok(empty.includes('data-empty="true"'), "the page states it is empty");
    assert.ok(!renderPage(state()).includes('data-empty="true"'), "and a populated one does not");
  });
});

describe("the loop line reads the REAL loop-state shape", () => {
  // The bug this pins: an earlier version read a top-level `loop.beat`, which
  // does not exist — the counter is `iterations.current`. It passed because the
  // fixture was invented. So the fixture here is the SHIPPED template file: an
  // invented shape can no longer satisfy this test, and a schema change breaks
  // it loudly instead of silently blanking the line.
  const seeded = JSON.parse(
    readFileSync(
      new URL("../templates/carja/1-workbench/loop-state.json", import.meta.url),
      "utf8"
    )
  );

  const lineFor = (loopState) => {
    const out = renderStatus(
      buildState({ root: "/r", projectName: "r", docs: [], loopState, now: 0 }),
      { color: false }
    );
    return out.split("\n").find((l) => l.includes("Loop")) ?? "";
  };

  test("the seeded state renders phase, status, beat and autonomy", () => {
    const line = lineFor(seeded);
    assert.match(line, /discovery/, "phase leads — it is what gates a run");
    assert.match(line, /idle/, "status");
    assert.match(line, /beat 0\/20/, "beat comes from iterations.current/max_allowed");
    assert.match(line, /L1/, "autonomy level");
  });

  test("a mid-run state shows the real beat counter", () => {
    const line = lineFor({ ...seeded, status: "building", iterations: { current: 7, max_allowed: 20 } });
    assert.match(line, /beat 7\/20/, line);
  });

  test("an invented top-level `beat` is NOT what gets read", () => {
    const line = lineFor({ status: "building", beat: 99 });
    assert.ok(!line.includes("99"), `a bogus field must not render: ${line}`);
  });

  test("no loop state at all says so plainly", () => {
    assert.match(lineFor(null), /not started/);
  });
});

describe("the terminal digest", () => {
  test("answers 'what is on our plate' in one screen", () => {
    const out = renderStatus(state(), { color: false });
    assert.ok(out.includes("acme-app"));
    assert.ok(/Inbox\s+1/.test(out), out);
    assert.ok(out.includes("Fix login timeout bug on mobile"), "the P1 items are named");
    assert.ok(/P1/.test(out));
  });

  test("it is short enough to read at a glance", () => {
    const lines = renderStatus(state(), { color: false }).split("\n");
    assert.ok(lines.length <= 40, `digest is ${lines.length} lines — too long to scan`);
  });

  test("--no-color emits no escape sequences, so it pipes cleanly", () => {
    const out = renderStatus(state(), { color: false });
    // eslint-disable-next-line no-control-regex
    assert.ok(!/\[/.test(out), "ANSI leaked into a no-color render");
  });

  test("colour is used when asked for", () => {
    // eslint-disable-next-line no-control-regex
    assert.ok(/\[/.test(renderStatus(state(), { color: true })));
  });

  test("it names the next work item the loop would pick", () => {
    const out = renderStatus(state(), { color: false });
    assert.ok(/Next/i.test(out), out);
    assert.ok(out.includes("Fix login timeout bug on mobile"), "bugfix ranks first");
  });

  test("an empty project gets a hint, not a wall of zeros", () => {
    const out = renderStatus(buildState({ root: "/r", projectName: "r", docs: [], now: 0 }), { color: false });
    assert.ok(/inbox|idea|genesis/i.test(out), out);
  });
});
