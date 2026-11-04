/* src/view/app.client.js — the generated page's only script, inlined verbatim.
 *
 * Kept as a real .js file rather than a string inside render.js so it stays
 * readable, and so template literals in it need no escaping.
 *
 * CONSTRAINT THAT SHAPED THIS FILE: the page is opened from `file://`, where the
 * document has a `null` origin and Chrome blocks the fetch API and XHR outright.
 * There is therefore no runtime loading of anything. The whole state — nav,
 * search index, every document already rendered to HTML — is parsed once from an
 * inlined JSON block. A page that tried to load a data file would show nothing,
 * with no error the reader would notice.
 *
 * All document HTML was escaped at generation time by src/view/markdown.js, so
 * assigning it to innerHTML is safe. Everything else that comes from a file
 * (titles, paths, backlog lines) is plain text and goes through esc() first.
 */

(function () {
  "use strict";

  var S = JSON.parse(document.getElementById("carja-data").textContent);

  var docByKey = {};
  var docList = S.docs.slice();
  for (var i = 0; i < docList.length; i++) {
    docByKey[docKey(docList[i].relPath)] = docList[i];
  }
  var sectionByKey = {};
  for (var j = 0; j < S.sections.length; j++) sectionByKey[S.sections[j].key] = S.sections[j];

  function docKey(relPath) {
    return relPath.replace(/^(carja|conductor)\//, "");
  }

  function esc(text) {
    return String(text == null ? "" : text).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  function plural(n, one, many) {
    return n + " " + (n === 1 ? one : many);
  }

  function ago(days) {
    if (days <= 0) return "today";
    if (days === 1) return "yesterday";
    if (days < 30) return days + " days ago";
    if (days < 60) return "a month ago";
    if (days < 365) return Math.round(days / 30) + " months ago";
    return Math.round(days / 365) + "y ago";
  }

  // ------------------------------------------------------------------ theme ---

  var root = document.documentElement;

  function readTheme() {
    try {
      return localStorage.getItem("carja-theme");
    } catch (e) {
      return null;
    }
  }

  function applyTheme(mode) {
    if (mode === "light" || mode === "dark") root.setAttribute("data-theme", mode);
    else root.removeAttribute("data-theme");
  }

  function cycleTheme() {
    var order = ["system", "light", "dark"];
    var current = readTheme() || "system";
    var next = order[(order.indexOf(current) + 1) % order.length];
    try {
      if (next === "system") localStorage.removeItem("carja-theme");
      else localStorage.setItem("carja-theme", next);
    } catch (e) {
      /* private mode — the choice just will not persist */
    }
    applyTheme(next);
    paintThemeButton(next);
  }

  function paintThemeButton(mode) {
    var btn = document.getElementById("theme-btn");
    if (!btn) return;
    btn.textContent = mode === "light" ? "☀" : mode === "dark" ? "☾" : "◐";
    btn.title = "Theme: " + mode + " (click to change)";
  }

  applyTheme(readTheme() || "system");

  // ----------------------------------------------------------------- layout ---

  function chip(text, kind) {
    return '<span class="chip chip-' + esc(kind) + '">' + esc(text) + "</span>";
  }

  function renderSidebar(route) {
    var initials = (S.projectName || "?").slice(0, 2).toUpperCase();
    var out =
      '<div class="brand">' +
      '<div class="brand-mark">' +
      esc(initials) +
      "</div>" +
      "<div>" +
      '<div class="brand-name">' +
      esc(S.projectName) +
      "</div>" +
      '<div class="brand-sub">Carja</div>' +
      "</div></div>" +
      '<button class="search-trigger" id="search-btn"><span>◌</span><span>Search…</span><kbd>/</kbd></button>' +
      '<a class="nav-item' +
      (route.kind === "home" ? " is-active" : "") +
      '" href="#/"><span>◇</span><span>Overview</span></a>' +
      '<div class="nav-group-label">Lifecycle</div>';

    for (var k = 0; k < S.sections.length; k++) {
      var sec = S.sections[k];
      var active = route.kind === "section" && route.key === sec.key;
      var hasActiveDoc = route.kind === "doc" && route.doc && route.doc.section === sec.key;
      out +=
        '<a class="nav-item' +
        (active ? " is-active" : "") +
        '" href="#/s/' +
        esc(sec.key) +
        '"><span class="nav-num">' +
        esc(sec.key.charAt(0)) +
        '</span><span>' +
        esc(sec.label) +
        '</span><span class="count">' +
        sec.docs.length +
        "</span></a>";

      if ((active || hasActiveDoc) && sec.docs.length) {
        out += '<div class="nav-docs">';
        for (var d = 0; d < sec.docs.length; d++) {
          var doc = sec.docs[d];
          var isCurrent = route.kind === "doc" && route.doc && route.doc.relPath === doc.relPath;
          out +=
            '<a class="nav-doc' +
            (isCurrent ? " is-active" : "") +
            '" href="#/d/' +
            esc(docKey(doc.relPath)) +
            '">' +
            esc(doc.title) +
            "</a>";
        }
        out += "</div>";
      }
    }
    return out;
  }

  function renderCrumb(route) {
    if (route.kind === "doc" && route.doc) {
      var sec = sectionByKey[route.doc.section];
      return (
        '<a href="#/s/' +
        esc(route.doc.section || "") +
        '">' +
        esc(sec ? sec.label : "Documents") +
        '</a><span class="sep">/</span><b>' +
        esc(route.doc.title) +
        "</b>"
      );
    }
    if (route.kind === "section") {
      var s = sectionByKey[route.key];
      return "<b>" + esc(s ? s.label : route.key) + "</b>";
    }
    return "<b>Overview</b>";
  }

  // ------------------------------------------------------------------- home ---

  function statCard(value, label, tone) {
    return (
      '<div class="stat' +
      (tone ? " " + tone : "") +
      '"><div class="v">' +
      esc(value) +
      '</div><div class="k">' +
      esc(label) +
      "</div></div>"
    );
  }

  function renderHome() {
    var d = S.digest;

    if (!d.docCount && !d.inboxCount && !d.backlogOpen) {
      return (
        '<div class="empty-state"><h2>Nothing yet — this dashboard is empty</h2>' +
        "<p>Drop a thought with <code>carja inbox add \"…\"</code> or <code>/inbox</code>, " +
        "add tasks to <code>carja/2-backlog/task-backlog.md</code>, " +
        "or start a new idea with <code>/genesis</code>.</p>" +
        "<p>Then run <code>carja view</code> again and refresh.</p></div>"
      );
    }

    var out = "";
    var p = d.byPriority || {};

    out +=
      '<div class="page-head"><h1>' +
      esc(S.projectName) +
      "</h1><p>" +
      plural(d.docCount, "document", "documents") +
      " across the lifecycle · generated " +
      esc(new Date(S.generatedAt).toLocaleString()) +
      "</p></div>";

    out += '<div class="stats">';
    out += statCard(d.inboxCount, "Inbox", d.inboxCount ? "accent" : "");
    out += statCard(d.backlogOpen, "Open tasks", "");
    out += statCard(p.P1 || 0, "P1", p.P1 ? "danger" : "");
    out += statCard(p.P2 || 0, "P2", p.P2 ? "warn" : "");
    out += statCard(d.docCount, "Documents", "");
    out += statCard(d.staleCount, "Stale 30d+", d.staleCount ? "warn" : "");
    out += "</div>";

    if (S.queue.length) {
      out +=
        '<div class="panel"><div class="panel-head"><h2>Next up</h2>' +
        '<span class="hint">the order the loop would drain it</span></div><div class="rows">';
      for (var q = 0; q < Math.min(S.queue.length, 8); q++) {
        var item = S.queue[q];
        out +=
          '<div class="row"><span class="ord">' +
          (q + 1) +
          "</span>" +
          chip(item.type, item.type) +
          // titleHtml is rendered and escaped at generation time.
          '<span class="t">' +
          item.titleHtml +
          '</span><span class="right">' +
          (item.priority ? chip(item.priority, item.priority.toLowerCase()) : "") +
          '<span class="chip">' +
          esc(item.source && item.source.kind ? item.source.kind : "carja") +
          "</span></span></div>";
      }
      out += "</div></div>";
    }

    if (S.backlog.groups.length) {
      out +=
        '<div class="panel"><div class="panel-head"><h2>Backlog</h2><span class="hint">' +
        esc(S.backlog.relPath) +
        '</span></div><div class="cols">';
      for (var g = 0; g < S.backlog.groups.length; g++) {
        var group = S.backlog.groups[g];
        var openItems = [];
        var doneItems = [];
        for (var gi = 0; gi < group.items.length; gi++) {
          (group.items[gi].done ? doneItems : openItems).push(group.items[gi]);
        }
        out +=
          '<div class="col"><h3>' +
          esc(group.priority || "Unprioritised") +
          (group.label ? " · " + esc(group.label) : "") +
          '<span class="count">' +
          openItems.length +
          "</span></h3>";

        out += openItems.length ? "<ul>" + taskItems(openItems) + "</ul>" : '<p class="col-empty">Nothing open</p>';

        // Done items are history, not the answer to "what's next" — a real
        // backlog carries long DONE entries with post-mortems in them, and
        // listing those in full buried the open work. Collapsed, counted,
        // one click away.
        if (doneItems.length) {
          out +=
            "<details class=\"done-fold\"><summary>" +
            doneItems.length +
            " done</summary><ul>" +
            taskItems(doneItems) +
            "</ul></details>";
        }
        out += "</div>";
      }
      out += "</div></div>";
    }

    if (S.inbox.items.length) {
      out +=
        '<div class="panel"><div class="panel-head"><h2>Inbox</h2><span class="hint">' +
        esc(S.inbox.relPath) +
        '</span></div><div class="rows">';
      for (var n = 0; n < S.inbox.items.length; n++) {
        out += '<div class="row"><span class="ord">·</span><span class="t">' + S.inbox.items[n].titleHtml + "</span></div>";
      }
      out += "</div></div>";
    }

    var recent = docList
      .slice()
      .sort(function (a, b) {
        return b.mtimeMs - a.mtimeMs;
      })
      .slice(0, 6);

    if (recent.length) {
      out += '<div class="panel-head" style="border:0;padding-left:0"><h2>Recently touched</h2></div><div class="cards">';
      for (var r = 0; r < recent.length; r++) out += card(recent[r]);
      out += "</div>";
    }

    if (S.stale.length) {
      out +=
        '<div class="panel" style="margin-top:22px"><div class="panel-head"><h2>Not touched in a while</h2>' +
        '<span class="hint">oldest first</span></div><div class="rows">';
      for (var st = 0; st < S.stale.length; st++) {
        var item2 = S.stale[st];
        out +=
          '<div class="row"><span class="ord">·</span><span class="t"><a href="#/d/' +
          esc(docKey(item2.relPath)) +
          '">' +
          esc(item2.title) +
          '</a></span><span class="right"><span class="chip">' +
          esc(ago(item2.ageDays)) +
          "</span></span></div>";
      }
      out += "</div></div>";
    }

    return out;
  }

  function taskItems(items) {
    var out = "";
    for (var i = 0; i < items.length; i++) {
      out +=
        '<li class="' +
        (items[i].done ? "is-done" : "") +
        '"><span class="box"></span><span class="li-text">' +
        items[i].titleHtml +
        "</span></li>";
    }
    return out;
  }

  function card(doc) {
    var snippet = doc.text ? doc.text.slice(0, 150) : "";
    return (
      '<a class="card" href="#/d/' +
      esc(docKey(doc.relPath)) +
      '"><div class="ct">' +
      esc(doc.title) +
      '</div><div class="cm">' +
      esc(docKey(doc.relPath)) +
      "</div>" +
      (snippet ? '<div class="cs">' + esc(snippet) + "</div>" : "") +
      "</a>"
    );
  }

  // ---------------------------------------------------------------- section ---

  function renderSection(key) {
    var sec = sectionByKey[key];
    if (!sec) return '<div class="empty-state"><h2>Unknown section</h2></div>';
    var out =
      '<div class="page-head"><h1>' + esc(sec.label) + "</h1><p>" + esc(sec.blurb) + "</p></div>";
    if (!sec.docs.length) {
      return (
        out +
        '<div class="empty-state"><h2>No documents here yet</h2><p><code>carja/' +
        esc(sec.key) +
        "/</code> is empty.</p></div>"
      );
    }
    out += '<div class="cards">';
    for (var i2 = 0; i2 < sec.docs.length; i2++) out += card(sec.docs[i2]);
    return out + "</div>";
  }

  // -------------------------------------------------------------------- doc ---

  function renderDoc(doc) {
    var toc = "";
    var headings = doc.headings.filter(function (h) {
      return h.level >= 2 && h.level <= 4;
    });
    if (headings.length >= 3) {
      toc = '<nav class="toc"><div class="toc-label">On this page</div>';
      for (var i3 = 0; i3 < headings.length; i3++) {
        toc +=
          '<a class="lvl-' + headings[i3].level + '" href="#' + esc(headings[i3].id) + '">' + esc(headings[i3].text) + "</a>";
      }
      toc += "</nav>";
    }

    var backlinks = "";
    if (doc.backlinks.length) {
      backlinks = '<div class="backlinks"><div class="toc-label">Referenced by</div><ul>';
      for (var b = 0; b < doc.backlinks.length; b++) {
        var other = docByKey[docKey(doc.backlinks[b])];
        backlinks +=
          '<li><a href="#/d/' +
          esc(docKey(doc.backlinks[b])) +
          '">' +
          esc(other ? other.title : doc.backlinks[b]) +
          "</a></li>";
      }
      backlinks += "</ul></div>";
    }

    return (
      '<div class="doc-layout' +
      (toc ? " has-toc" : "") +
      '"><div><div class="doc-head"><h1>' +
      esc(doc.title) +
      '</h1><div class="doc-meta"><span class="path">' +
      esc(doc.relPath) +
      "</span><span>edited " +
      esc(ago(doc.ageDays)) +
      "</span><span>" +
      plural(doc.words, "word", "words") +
      "</span></div></div>" +
      '<article class="prose">' +
      doc.html +
      "</article>" +
      backlinks +
      "</div>" +
      toc +
      "</div>"
    );
  }

  // ----------------------------------------------------------------- search ---

  var searchOpen = false;
  var selected = 0;
  var hits = [];

  function score(doc, needle) {
    var title = doc.title.toLowerCase();
    var path = doc.relPath.toLowerCase();
    var body = (doc.text || "").toLowerCase();
    var s = 0;
    if (title === needle) s += 200;
    if (title.indexOf(needle) === 0) s += 90;
    else if (title.indexOf(needle) >= 0) s += 60;
    if (path.indexOf(needle) >= 0) s += 25;
    for (var h = 0; h < doc.headings.length; h++) {
      if (doc.headings[h].text.toLowerCase().indexOf(needle) >= 0) {
        s += 18;
        break;
      }
    }
    var at = body.indexOf(needle);
    if (at >= 0) s += 12;
    return s;
  }

  function snippetFor(doc, needle) {
    var body = doc.text || "";
    var at = body.toLowerCase().indexOf(needle);
    if (at < 0) return body.slice(0, 130);
    var from = Math.max(0, at - 50);
    var raw = body.slice(from, from + 150);
    return raw;
  }

  function highlight(text, needle) {
    var safe = esc(text);
    if (!needle) return safe;
    var idx = safe.toLowerCase().indexOf(esc(needle).toLowerCase());
    if (idx < 0) return safe;
    return (
      safe.slice(0, idx) + "<mark>" + safe.slice(idx, idx + needle.length) + "</mark>" + safe.slice(idx + needle.length)
    );
  }

  function runSearch(query) {
    var needle = query.trim().toLowerCase();
    var list = document.getElementById("results");
    if (!needle) {
      hits = docList
        .slice()
        .sort(function (a, b) {
          return b.mtimeMs - a.mtimeMs;
        })
        .slice(0, 8);
    } else {
      hits = docList
        .map(function (doc) {
          return { doc: doc, s: score(doc, needle) };
        })
        .filter(function (x) {
          return x.s > 0;
        })
        .sort(function (a, b) {
          return b.s - a.s;
        })
        .slice(0, 12)
        .map(function (x) {
          return x.doc;
        });
    }
    selected = 0;
    if (!hits.length) {
      list.innerHTML = '<div class="no-results">Nothing matches “' + esc(query) + "”</div>";
      return;
    }
    var out = "";
    for (var i4 = 0; i4 < hits.length; i4++) {
      out +=
        '<a class="result' +
        (i4 === selected ? " is-sel" : "") +
        '" data-i="' +
        i4 +
        '" href="#/d/' +
        esc(docKey(hits[i4].relPath)) +
        '"><div class="rt">' +
        highlight(hits[i4].title, needle) +
        '</div><div class="rp">' +
        esc(docKey(hits[i4].relPath)) +
        '</div><div class="rs">' +
        highlight(snippetFor(hits[i4], needle), needle) +
        "</div></a>";
    }
    list.innerHTML = out;
  }

  function paintSelection() {
    var nodes = document.querySelectorAll("#results .result");
    for (var i5 = 0; i5 < nodes.length; i5++) {
      if (i5 === selected) {
        nodes[i5].classList.add("is-sel");
        nodes[i5].scrollIntoView({ block: "nearest" });
      } else nodes[i5].classList.remove("is-sel");
    }
  }

  function openSearch() {
    if (searchOpen) return;
    searchOpen = true;
    var el = document.createElement("div");
    el.className = "overlay";
    el.id = "overlay";
    el.innerHTML =
      '<div class="search-panel"><input type="search" id="search" placeholder="Search every document…" ' +
      'autocomplete="off" spellcheck="false"><div class="results" id="results"></div>' +
      '<div class="search-foot"><span><kbd>↑</kbd><kbd>↓</kbd> move</span><span><kbd>↵</kbd> open</span>' +
      "<span><kbd>esc</kbd> close</span></div></div>";
    document.body.appendChild(el);
    el.addEventListener("click", function (ev) {
      if (ev.target === el) closeSearch();
    });
    var input = document.getElementById("search");
    input.addEventListener("input", function () {
      runSearch(input.value);
    });
    runSearch("");
    input.focus();
  }

  function closeSearch() {
    var el = document.getElementById("overlay");
    if (el) el.remove();
    searchOpen = false;
  }

  // ----------------------------------------------------------------- router ---

  function parseRoute() {
    var hash = location.hash.replace(/^#/, "");
    if (hash.indexOf("/d/") === 0) {
      var key = decodeURIComponent(hash.slice(3));
      return { kind: "doc", key: key, doc: docByKey[key] || null };
    }
    if (hash.indexOf("/s/") === 0) return { kind: "section", key: decodeURIComponent(hash.slice(3)) };
    return { kind: "home" };
  }

  function render() {
    var route = parseRoute();
    document.getElementById("sidebar").innerHTML = renderSidebar(route);
    document.getElementById("crumb").innerHTML = renderCrumb(route);
    paintThemeButton(readTheme() || "system");

    var body;
    if (route.kind === "doc") {
      body = route.doc
        ? renderDoc(route.doc)
        : '<div class="empty-state"><h2>That document is not in this build</h2><p><code>' +
          esc(route.key) +
          "</code> was not found. Run <code>carja view</code> again if you just added it.</p></div>";
    } else if (route.kind === "section") {
      body = renderSection(route.key);
    } else {
      body = renderHome();
    }
    document.getElementById("content").innerHTML = body;

    document.getElementById("search-btn").addEventListener("click", openSearch);
    document.title =
      (route.kind === "doc" && route.doc ? route.doc.title + " · " : "") + S.projectName + " · Carja";

    // A hash that also names a heading anchor still has to scroll there.
    window.scrollTo({ top: 0 });
  }

  document.getElementById("theme-btn").addEventListener("click", cycleTheme);
  document.getElementById("menu-btn").addEventListener("click", function () {
    document.getElementById("sidebar").classList.toggle("is-open");
  });

  document.addEventListener("keydown", function (ev) {
    if (searchOpen) {
      if (ev.key === "Escape") {
        ev.preventDefault();
        closeSearch();
      } else if (ev.key === "ArrowDown") {
        ev.preventDefault();
        selected = Math.min(selected + 1, hits.length - 1);
        paintSelection();
      } else if (ev.key === "ArrowUp") {
        ev.preventDefault();
        selected = Math.max(selected - 1, 0);
        paintSelection();
      } else if (ev.key === "Enter" && hits[selected]) {
        ev.preventDefault();
        location.hash = "#/d/" + docKey(hits[selected].relPath);
        closeSearch();
      }
      return;
    }

    var typing = /^(INPUT|TEXTAREA|SELECT)$/.test(ev.target.tagName);
    if (!typing && (ev.key === "/" || ((ev.metaKey || ev.ctrlKey) && ev.key === "k"))) {
      ev.preventDefault();
      openSearch();
    } else if (!typing && ev.key === "g") {
      location.hash = "#/";
    }
  });

  window.addEventListener("hashchange", render);
  render();
})();
