// src/review/canvas.js
//
// The review canvas — pure half (F4, slice 1).
//
// WHY THIS EXISTS. Carja's human is a product owner, and on Claude Code
// there is no file browser: the terminal is the only surface. `carja view`
// fixed the reading half — every document rendered into one page. This is the
// missing return path. The human reads a plan in a browser and says approve or
// request changes, and that verdict comes back to a CLI call the agent is
// blocked on. No copying text into chat, no describing which paragraph.
//
// Slice 1 is verdict + comments. Element-anchored annotations ("move THIS
// section") are slice 2; the feedback record already has room for them.
//
// Everything here is pure so the page and the rules are testable without a
// browser or a socket. The server lives in ./server.js.

import { createHash } from "node:crypto";
import { renderMarkdown, escapeHtml } from "../view/markdown.js";

export const VERDICTS = Object.freeze(["approve", "request-changes"]);

/** A feedback record, or null when the input is not one. */
export function normalizeFeedback(raw) {
  if (!raw || typeof raw !== "object") return null;
  const at = new Date().toISOString();

  if (raw.kind === "verdict") {
    // Never coerce an unrecognised verdict. Defaulting to "approve" would ship
    // work the human did not sign off; defaulting to "request-changes" would
    // silently discard an approval. Both are worse than refusing the record.
    if (!VERDICTS.includes(raw.verdict)) return null;
    return { kind: "verdict", verdict: raw.verdict, at };
  }

  if (raw.kind === "comment" || raw.kind === "annotation") {
    const text = String(raw.text ?? "").trim();
    if (!text) return null;
    const anchor = normalizeAnchor(raw.anchor);
    // An annotation whose anchor did not survive is still the human's words.
    // Dropping the text because the pointer failed loses the feedback itself.
    if (raw.kind === "annotation" && anchor) return { kind: "annotation", text, anchor, at };
    return { kind: "comment", text, at };
  }

  return null;
}

const MAX_ANCHOR_CHARS = 400;

/**
 * The element the human pointed at, bounded and flattened.
 *
 * This arrives from a browser and ends up quoted into `carja/`, so only
 * the three fields we use survive, each a bounded string. An unbounded
 * snippet or a nested object would land in the knowledge base verbatim.
 */
function normalizeAnchor(anchor) {
  if (!anchor || typeof anchor !== "object") return null;
  const str = (v) => (v === undefined || v === null ? "" : String(v).slice(0, MAX_ANCHOR_CHARS));
  const selector = str(anchor.selector);
  const snippet = str(anchor.snippet);
  const tag = str(anchor.tag).toLowerCase().slice(0, 16);
  if (!selector && !snippet) return null;
  return { selector, tag, snippet };
}

/**
 * What should the agent do with this thread?
 * A comment is not a verdict: the loop keeps listening until the human decides.
 */
export function summariseFeedback(feedback = []) {
  const verdicts = feedback.filter((f) => f?.kind === "verdict");
  const last = verdicts[verdicts.length - 1];
  if (!last) return { status: "open", done: false, feedback };
  return {
    status: last.verdict === "approve" ? "approved" : "changes-requested",
    done: true,
    feedback,
  };
}

/**
 * Is this request really from the human's own browser, on THIS page?
 *
 * Two checks, and the second is the one the first version got wrong.
 *
 * Host must be a loopback literal — a page on 127.0.0.1 is reachable by any
 * site the human has open through DNS rebinding unless Host is checked.
 *
 * And a present Origin must be THIS page's origin: the same host AND port the
 * browser was sent to. The first version accepted any loopback Origin, so a
 * page served from another localhost port — a dev server, anything — could
 * POST an approval and end the agent's wait (independent review, blocker B4).
 * Loopback is not the boundary; the origin of this page is.
 *
 * A missing Origin is allowed: browsers always send one on a cross-origin
 * POST, so its absence means a non-browser client on this machine (curl, the
 * agent), which already has everything this server could give it.
 */
export function isLoopbackRequest(req) {
  const host = req?.headers?.host;
  if (typeof host !== "string" || !host) return false;
  // Strip the port; keep IPv6 brackets intact.
  const name = host.startsWith("[") ? host.slice(0, host.indexOf("]") + 1) : host.split(":")[0];
  const loopback = name === "127.0.0.1" || name === "localhost" || name === "[::1]" || name === "::1";
  if (!loopback) return false;

  const origin = req?.headers?.origin;
  if (origin) {
    let url;
    try {
      url = new URL(origin);
    } catch {
      return false;
    }
    // Same-origin: scheme http, and host:port byte-equal to the Host header.
    if (url.protocol !== "http:") return false;
    if (url.host !== host) return false;
  }
  return true;
}

/**
 * A short fingerprint of the document under review.
 *
 * Feedback is replayed across interrupted waits, and a VERDICT is only valid
 * for the text the human actually read. Without this, an approval given to v1
 * was honoured after the agent rewrote the document into v2.
 */
export function contentHash(markdown) {
  return createHash("sha256").update(String(markdown ?? "")).digest("hex").slice(0, 16);
}

/**
 * The whole review page: rendered artifact plus the review panel.
 * Self-contained on purpose — served on loopback to a human who may be
 * offline, and a CDN script in a review tool is an unreviewed dependency
 * standing between the author and the approval.
 */
export function renderReviewPage({ markdown, title, artifactPath }) {
  const body = renderMarkdown(String(markdown ?? ""));
  const safeTitle = escapeHtml(String(title ?? "Review"));
  const safePath = escapeHtml(String(artifactPath ?? ""));

  return `<!DOCTYPE html>
<html lang="en"><head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Review — ${safeTitle}</title>
<style>
:root {
  --bg: #fbfaf8; --fg: #1d1c1a; --muted: #6b6862; --line: #e3e0da;
  --card: #ffffff; --accent: #2f6f4f; --warn: #9a5b23;
}
@media (prefers-color-scheme: dark) {
  :root:not([data-theme="light"]) {
    --bg: #17181a; --fg: #e9e7e3; --muted: #9a968f; --line: #2e3033;
    --card: #1f2124; --accent: #6bbd90; --warn: #d79a55;
  }
}
* { box-sizing: border-box; }
body { margin: 0; background: var(--bg); color: var(--fg);
  font: 16px/1.65 ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif; }
.wrap { max-width: 860px; margin: 0 auto; padding: 32px 16px 160px; }
.path { color: var(--muted); font: 13px/1.4 ui-monospace, SFMono-Regular, Menlo, monospace;
  word-break: break-all; margin-bottom: 24px; }
article h1, article h2, article h3 { line-height: 1.25; margin: 1.6em 0 .5em; }
article h1 { font-size: 1.9rem; } article h2 { font-size: 1.4rem; }
article pre { background: var(--card); border: 1px solid var(--line); border-radius: 8px;
  padding: 12px; overflow-x: auto; }
article code { font: 13.5px/1.5 ui-monospace, SFMono-Regular, Menlo, monospace; }
article table { border-collapse: collapse; width: 100%; display: block; overflow-x: auto; }
article th, article td { border: 1px solid var(--line); padding: 6px 10px; text-align: left; }
.panel { position: fixed; left: 0; right: 0; bottom: 0; background: var(--card);
  border-top: 1px solid var(--line); padding: 12px 16px; }
.panel-inner { max-width: 860px; margin: 0 auto; display: flex; gap: 8px; flex-wrap: wrap; }
textarea { flex: 1 1 260px; min-height: 44px; resize: vertical; padding: 10px;
  border: 1px solid var(--line); border-radius: 8px; background: var(--bg); color: var(--fg);
  font: inherit; font-size: 14px; }
button { border: 1px solid var(--line); border-radius: 8px; padding: 10px 14px;
  font: inherit; font-size: 14px; cursor: pointer; background: var(--bg); color: var(--fg); }
button.primary { background: var(--accent); border-color: var(--accent); color: #fff; }
button.changes { border-color: var(--warn); color: var(--warn); }
button:disabled { opacity: .5; cursor: default; }
.thread { max-width: 860px; margin: 0 auto 8px; font-size: 13.5px; color: var(--muted); }
.thread div { padding: 2px 0; }
.done { text-align: center; padding: 14px; font-weight: 600; color: var(--accent); }
.notice { max-width: 860px; margin: 0 auto 6px; font-size: 13px; color: var(--warn); }
.notice:empty { display: none; }
article [data-anchorable] { cursor: pointer; border-radius: 4px;
  transition: background .12s, box-shadow .12s; }
article [data-anchorable]:hover { background: color-mix(in srgb, var(--accent) 10%, transparent); }
article [data-anchorable].picked { background: color-mix(in srgb, var(--accent) 18%, transparent);
  box-shadow: inset 3px 0 0 var(--accent); }
.anchored { max-width: 860px; margin: 0 auto 6px; font-size: 13px; color: var(--muted);
  display: none; align-items: center; gap: 8px; }
.anchored.on { display: flex; }
.anchored b { font-weight: 600; color: var(--fg); overflow: hidden;
  text-overflow: ellipsis; white-space: nowrap; }
.anchored button { padding: 2px 8px; font-size: 12px; }
</style>
</head><body>
<div class="wrap">
  <div class="path">${safePath}</div>
  <article id="doc">${body}</article>
</div>
<div class="panel">
  <div class="thread" id="thread"></div>
  <div class="notice" id="notice" role="status"></div>
  <div class="anchored" id="anchored">
    <span>on</span><b id="anchor-snippet"></b>
    <button id="anchor-clear" type="button">clear</button>
  </div>
  <div class="panel-inner" id="controls">
    <textarea id="text" placeholder="Click any paragraph to point at it, or just type and decide."></textarea>
    <button id="comment">Comment</button>
    <button id="changes" class="changes" data-verdict="request-changes">Request changes</button>
    <button id="approve" class="primary" data-verdict="approve">Approve</button>
  </div>
</div>
<script>
(function () {
  var thread = document.getElementById("thread");
  var text = document.getElementById("text");
  var controls = document.getElementById("controls");
  var doc = document.getElementById("doc");
  var anchoredBar = document.getElementById("anchored");
  var anchorSnippet = document.getElementById("anchor-snippet");
  var notice = document.getElementById("notice");
  var picked = null;

  // Pointing at a paragraph is the entire reason this is a page and not a
  // chat box. Only block-level content is anchorable — anchoring an inline
  // <em> gives the agent a selector it cannot act on.
  var ANCHORABLE = "h1,h2,h3,h4,h5,h6,p,li,pre,blockquote,tr";
  Array.prototype.forEach.call(doc.querySelectorAll(ANCHORABLE), function (el) {
    el.setAttribute("data-anchorable", "");
  });

  function selectorFor(el) {
    var parts = [];
    var node = el;
    while (node && node !== doc) {
      var tag = node.tagName.toLowerCase();
      var i = 1;
      var sib = node;
      while ((sib = sib.previousElementSibling)) {
        if (sib.tagName === node.tagName) i++;
      }
      parts.unshift(tag + ":nth-of-type(" + i + ")");
      node = node.parentElement;
    }
    return parts.join(" > ");
  }

  function setAnchor(el) {
    if (picked) picked.classList.remove("picked");
    picked = el;
    if (!el) {
      anchoredBar.classList.remove("on");
      return;
    }
    el.classList.add("picked");
    anchorSnippet.textContent = (el.textContent || "").trim().slice(0, 120);
    anchoredBar.classList.add("on");
    text.focus();
  }

  doc.addEventListener("click", function (e) {
    // A link in the plan, such as [spec](other.md), is a same-tab link to a page
    // this server does not have: following it would 404 and drop anything
    // unsent. The click still anchors its paragraph, which is what a click
    // on this page means.
    var link = e.target.closest("a");
    if (link && doc.contains(link) && (link.getAttribute("href") || "").charAt(0) !== "#") {
      e.preventDefault();
    }
    var el = e.target.closest("[data-anchorable]");
    if (!el || !doc.contains(el)) return;
    setAnchor(el === picked ? null : el);
  });
  document.getElementById("anchor-clear").addEventListener("click", function () {
    setAnchor(null);
  });

  function draw(items) {
    thread.innerHTML = "";
    items.forEach(function (f) {
      var d = document.createElement("div");
      if (f.kind === "verdict") d.textContent = "\u2713 " + f.verdict;
      else if (f.kind === "annotation") {
        d.textContent = "\u21b3 " + (f.anchor && f.anchor.snippet ? f.anchor.snippet : "") +
          " \u2014 \u201c" + f.text + "\u201d";
      } else d.textContent = "\u201c" + f.text + "\u201d";
      thread.appendChild(d);
    });
  }

  // A send either reaches the server or it did not; there is no third case
  // that should cost the human their words. The first version cleared the box
  // BEFORE sending and drew an empty thread on a bad response, so a click into
  // a review whose process had ended silently erased what they had written.
  function send(payload) {
    return fetch("api/feedback", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload)
    }).then(function (r) {
      if (!r.ok) throw new Error("status " + r.status);
      return r.json();
    }).then(function (s) {
      draw(s.feedback || []);
      if (s.done) {
        controls.innerHTML = '<div class="done">Sent \u2014 ' + s.status +
          ". You can close this tab.</div>";
        anchoredBar.classList.remove("on");
      }
      return s;
    });
  }

  function notSent() {
    notice.textContent = "Not sent \u2014 this review is no longer running. " +
      "Your text is still in the box: re-run carja review, then send it again.";
  }

  function sent() {
    text.value = "";
    notice.textContent = "";
  }

  function sendText(t) {
    var el = picked;
    var payload = el ? {
      kind: "annotation",
      text: t,
      anchor: {
        selector: selectorFor(el),
        tag: el.tagName.toLowerCase(),
        snippet: (el.textContent || "").trim().slice(0, 300)
      }
    } : { kind: "comment", text: t };
    // The anchor is released only once the note has actually landed.
    return send(payload).then(function (s) {
      if (el && picked === el) setAnchor(null);
      return s;
    });
  }

  document.getElementById("comment").addEventListener("click", function () {
    var t = text.value.trim();
    if (!t) return;
    sendText(t).then(sent, notSent);
  });

  ["approve", "changes"].forEach(function (id) {
    document.getElementById(id).addEventListener("click", function () {
      var t = text.value.trim();
      var verdict = this.getAttribute("data-verdict");
      var chain = t ? sendText(t) : Promise.resolve();
      chain
        .then(function () { return send({ kind: "verdict", verdict: verdict }); })
        .then(sent, notSent);
    });
  });
})();
</script>
</body></html>`;
}
