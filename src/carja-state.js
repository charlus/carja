// src/carja-state.js
//
// ONE read of `carja/`, shared by every human-facing surface.
//
// WHY THIS EXISTS. The autonomous loop already had a structured view of the
// human's `carja/` folder: `src/loop/harvester.js` turns `inbox.md` and
// `task-backlog.md` into a ranked, typed work queue. The human had `ls`, `cat`
// and `vim`. That asymmetry is the actual problem with using this framework from
// a terminal — not the files themselves, which are what make the loop, the
// evidence ledger and PR review work at all.
//
// So this module is the human's read path, and it deliberately CALLS the
// harvester rather than re-parsing. A second parser would let the two views of
// the same backlog disagree, and the first time they did, the human would stop
// trusting both.
//
// Everything here is pure except `collectState`, which is the thin IO wrapper.
// That split is what makes the digest testable without a repo on disk.

import { readFile, readdir, stat, writeFile, mkdir } from "node:fs/promises";
import { join, dirname, basename, sep } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { harvestWorkQueue, parseInbox } from "./loop/harvester.js";
import { gateStateFrom, NONE } from "./verify-config.js";
import { ignoredNestedRepos } from "./nested-repos.js";
import { skippedHooks } from "./heartbeat.js";
import {
  renderMarkdown,
  renderInline,
  extractHeadings,
  documentTitle,
  plainText,
} from "./view/markdown.js";
import { stateDirName, statePath, configPath } from "./names.js";

export const CARJA_DIR = "carja";
export const VIEWS_REL = "carja/.views";
export const INBOX_REL = "carja/1-workbench/inbox.md";
export const BACKLOG_REL = "carja/2-backlog/task-backlog.md";
export const LOOP_STATE_REL = "carja/1-workbench/loop-state.json";
export const SHIP_LOG_REL = "carja/0-compass/ship-log.md";
export const CONFIG_REL = "carja.config.json";

/** The lifecycle, in order. This is the nav, so the folder tree is never browsed. */
export const SECTIONS = Object.freeze([
  { key: "0-compass", label: "Compass", blurb: "Vision, north star, ship log" },
  { key: "1-workbench", label: "Workbench", blurb: "Inbox, scratchpad, live loop state" },
  { key: "2-backlog", label: "Backlog", blurb: "Tasks, implementations, projects" },
  { key: "3-product-areas", label: "Product Areas", blurb: "Specs and notes per area" },
  { key: "4-context", label: "Context", blurb: "Product, technical, design, identity" },
  { key: "5-templates", label: "Templates", blurb: "Scaffolding for new documents" },
  { key: "6-archive", label: "Archive", blurb: "Completed work, kept for reference" },
]);

const SECTION_KEYS = new Set(SECTIONS.map((s) => s.key));

/** Folders that are meant to sit still, so age there is not a signal. */
const NEVER_STALE = new Set(["5-templates", "6-archive"]);

const DAY_MS = 86400000;

/** Which lifecycle folder a `carja/…` path belongs to, or null. */
export function sectionForPath(relPath) {
  const parts = String(relPath ?? "").split("/");
  const key = parts[0] === "conductor" || parts[0] === CARJA_DIR ? parts[1] : parts[0];
  return SECTION_KEYS.has(key) ? key : null;
}

/**
 * Summarise `task-backlog.md` for display: the priority groups in file order,
 * each with its items, plus open/done counts.
 *
 * Distinct from the harvester's `parseBacklog`, which drops done items because
 * the loop cannot work on them. Here a done item is information — it is what
 * "we shipped that" looks like.
 */
export function summariseBacklog(md) {
  const groups = [];
  const byPriority = {};
  let open = 0;
  let done = 0;
  let current = null;

  for (const raw of String(md ?? "").split(/\r?\n/)) {
    const heading = raw.match(/^#{1,6}\s+(P\d)\b(.*)$/i);
    if (heading) {
      current = {
        priority: heading[1].toUpperCase(),
        label: heading[2].replace(/^[\s\-–—:]+/, "").trim(),
        items: [],
      };
      groups.push(current);
      continue;
    }
    const box = raw.match(/^\s*[-*]\s+\[( |x|X)\]\s+(\S.*?)\s*$/);
    if (!box) continue;
    const isDone = box[1].toLowerCase() === "x";
    const item = { title: box[2].trim(), done: isDone, priority: current?.priority ?? null };
    if (isDone) done += 1;
    else {
      open += 1;
      if (current) byPriority[current.priority] = (byPriority[current.priority] ?? 0) + 1;
    }
    if (current) current.items.push(item);
    else {
      // Items above any priority heading still count, under a synthetic group.
      if (!groups.length || groups[0].priority !== null) {
        groups.unshift({ priority: null, label: "Unprioritised", items: [] });
      }
      groups[0].items.push(item);
    }
  }

  return { groups, byPriority, open, done };
}

/**
 * Which documents reference which. Generated at read time, when every file is
 * visible at once — which is exactly why the page can show backlinks and `cat`
 * cannot. A reference counts if the text mentions the other document's path or
 * its bare filename.
 */
export function computeBacklinks(docs) {
  const out = {};
  for (const target of docs) out[target.relPath] = [];

  for (const target of docs) {
    const name = basename(target.relPath);
    for (const source of docs) {
      if (source.relPath === target.relPath) continue;
      const text = String(source.raw ?? "");
      if (text.includes(target.relPath) || text.includes(name)) {
        out[target.relPath].push(source.relPath);
      }
    }
  }
  return out;
}

/**
 * Documents nobody has touched in a while — a signal the human used to get for
 * free from a file tree sorted by date.
 */
export function computeStale(docs, { now = Date.now(), days = 30 } = {}) {
  const cutoff = days * DAY_MS;
  return docs
    .filter((d) => !NEVER_STALE.has(sectionForPath(d.relPath) ?? ""))
    .map((d) => ({
      relPath: d.relPath,
      ageDays: Math.max(0, Math.floor((now - (d.mtimeMs ?? 0)) / DAY_MS)),
    }))
    .filter((d) => d.ageDays * DAY_MS >= cutoff)
    .sort((a, b) => b.ageDays - a.ageDays);
}

/**
 * Summarise the ship-log: how many dated entries, the LATEST date, its age.
 *
 * WHY. Measured 2026-09-15: every live project's ship-log had stopped in July
 * while merges kept landing (103 in one project). The gap was found by hand —
 * last `## YYYY-MM-DD` heading against `git log --merges --since` — and nobody
 * runs that by hand twice. So the number lives in the digest and on the status
 * screen, where the daily question is asked.
 *
 * Only `## YYYY-MM-DD …` headings count, which is the shape the Ship workflow
 * writes. The old template's pipe-table preamble and the waiver lines the hooks
 * append (`- ⚠️ 2026-08-02T… TDD waived`) are not entries. Entries need not be
 * in order — one live log had 07-15 listed after 07-16 — so the latest date is
 * a max, not the last match. Absence is `null`, never a fake zero.
 *
 * @param {string|undefined} md
 * @param {{now?: number}} [opts]
 * @returns {{entries: number, lastDate: string|null, ageDays: number|null}}
 */
export function summariseShipLog(md, { now = Date.now() } = {}) {
  const text = String(md ?? "");
  const dates = [...text.matchAll(/^## (\d{4}-\d{2}-\d{2})\b/gm)].map((m) => m[1]);
  if (!dates.length) return { entries: 0, lastDate: null, ageDays: null };
  const lastDate = dates.reduce((a, b) => (b > a ? b : a));
  const [y, mo, d] = lastDate.split("-").map(Number);
  const ageDays = Math.max(0, Math.floor((now - Date.UTC(y, mo - 1, d)) / DAY_MS));
  return { entries: dates.length, lastDate, ageDays };
}

/**
 * Count the hook waivers logged in the last `days` days.
 *
 * Reads the exact line `hooks/lib.sh carja_log_waiver` appends:
 * `- [YYYY-MM-DD HH:MM] Hook waiver (Kind): reason`. A gate waived every week
 * is a gate in name only, and this is the one place that shows it.
 *
 * @param {string|undefined} md
 * @param {{now?: number, days?: number}} [opts]
 * @returns {{count: number, days: number, byKind: Array<{kind: string, count: number}>}}
 */
export function summariseWaivers(md, { now = Date.now(), days = 30 } = {}) {
  const since = now - days * DAY_MS;
  const counts = new Map();
  let count = 0;
  for (const m of String(md ?? "").matchAll(/^- \[(\d{4})-(\d{2})-(\d{2})[^\]]*\] Hook waiver \(([^)]+)\)/gm)) {
    const at = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
    if (at < since - DAY_MS || at > now) continue;
    count += 1;
    counts.set(m[4], (counts.get(m[4]) ?? 0) + 1);
  }
  const byKind = [...counts]
    .map(([kind, n]) => ({ kind, count: n }))
    .sort((a, b) => b.count - a.count || a.kind.localeCompare(b.kind));
  return { count, days, byKind };
}

/**
 * Pull the decisions a ship-log still has waiting on the human.
 *
 * WHY. `status` answered "what is on our plate" with counts and freshness.
 * Across 4-6 products the question that actually costs the maintainer time is
 * "what is waiting on me", and the answer existed nowhere — it was buried in
 * prose inside whichever ship-log entry raised it, or in a PR body.
 *
 * Reads the `- Decide:` line of each entry's `**For you**` block. `none`,
 * `None.`, an empty value and a missing field all mean closed, so an entry
 * with nothing to ask costs the reader nothing. Entries predating the
 * two-block shape have no `Decide` line and are simply skipped, never guessed
 * at. Newest first, by the entry's own date.
 *
 * @param {string|undefined} md
 * @returns {Array<{date: string, title: string, question: string}>}
 */
export function openDecisions(md) {
  const text = String(md ?? "");
  const out = [];
  // Split on entry headings, keeping the heading with its body.
  const parts = text.split(/^## (?=\d{4}-\d{2}-\d{2}\b)/m).slice(1);
  for (const part of parts) {
    const head = part.slice(0, part.indexOf("\n") === -1 ? part.length : part.indexOf("\n"));
    const date = head.slice(0, 10);
    const title = head.slice(10).replace(/^[\s—\-–:]+/, "").trim();
    const m = part.match(/^[-*]\s*(?:\*\*)?Decide(?:\*\*)?\s*:\s*(?:\*\*)?\s*(.*?)\s*(?:\*\*)?$/mi);
    if (!m) continue;
    const question = m[1].trim();
    if (!question || /^none\.?$/i.test(question)) continue;
    out.push({ date, title, question });
  }
  return out.sort((a, b) => (a.date < b.date ? 1 : -1));
}

/**
 * Build the state object every surface renders from. Pure: give it the file
 * contents and it gives you the digest, the queue, the sections and the
 * rendered documents.
 *
 * @param {object} input
 * @param {string} input.root absolute repo root (for display only)
 * @param {string} input.projectName
 * @param {string} [input.inboxMd]
 * @param {string} [input.backlogMd]
 * @param {object|null} [input.loopState]
 * @param {Array<{relPath:string, raw:string, mtimeMs:number}>} input.docs
 * @param {string} [input.shipLogMd]
 * @param {number|null} [input.mergesSinceShipLog] merges in THIS repo since the last entry; null = unknown
 * @param {string|null} [input.verifyCommand] what pre-push will run; null/blank = the gate is off
 * @param {object|null} [input.gateWiring] from readGateWiring; null = unknown
 * @param {number} [input.now]
 * @param {number} [input.staleDays]
 */
export function buildState({
  root,
  projectName,
  inboxMd = "",
  backlogMd = "",
  loopState = null,
  docs = [],
  shipLogMd = "",
  mergesSinceShipLog = null,
  verifyCommand = null,
  gateWiring = null,
  now = Date.now(),
  staleDays = 30,
}) {
  // Every human-facing title carries a rendered `titleHtml` alongside the raw
  // text. Backlog and inbox lines are full of `**bold**` and `` `code` `` — the
  // page was showing those markers literally, because the client escaped the
  // text and no renderer ever touched it. Rendering here keeps the page free of
  // a markdown parser: it receives HTML, as it does for documents.
  const withHtml = (item) => ({ ...item, titleHtml: renderInline(item.title) });

  const inboxItems = parseInbox(inboxMd).map((it) => withHtml({ title: it.title }));
  const backlogRaw = summariseBacklog(backlogMd);
  const backlog = {
    ...backlogRaw,
    groups: backlogRaw.groups.map((g) => ({ ...g, items: g.items.map(withHtml) })),
  };
  // Still the harvester's queue — same items, same order, same routing — with a
  // rendered title added for display. The parser is not duplicated.
  const queue = harvestWorkQueue({ inboxMd, backlogMd }).map(withHtml);
  const backlinks = computeBacklinks(docs);

  const prepared = docs
    .map((doc) => {
      const filename = basename(doc.relPath);
      const raw = String(doc.raw ?? "");
      const text = plainText(raw);
      return {
        relPath: doc.relPath,
        filename,
        title: documentTitle(raw, filename),
        section: sectionForPath(doc.relPath),
        folder: dirname(doc.relPath),
        mtimeMs: doc.mtimeMs ?? 0,
        ageDays: Math.max(0, Math.floor((now - (doc.mtimeMs ?? 0)) / DAY_MS)),
        // The title is already shown by the page's document header, so the
        // document's own leading `# Title` is dropped to avoid printing it twice.
        html: renderMarkdown(raw, { skipFirstH1: true }),
        headings: extractHeadings(raw),
        words: text ? text.split(/\s+/).length : 0,
        text: text.slice(0, 4000),
        backlinks: backlinks[doc.relPath] ?? [],
      };
    })
    .sort((a, b) => a.relPath.localeCompare(b.relPath));

  const sections = SECTIONS.map((s) => ({
    ...s,
    docs: prepared
      .filter((d) => d.section === s.key)
      .sort((a, b) => a.title.localeCompare(b.title)),
  }));

  const stale = computeStale(docs, { now, days: staleDays })
    .map((s) => {
      const doc = prepared.find((d) => d.relPath === s.relPath);
      return { ...s, title: doc?.title ?? basename(s.relPath) };
    })
    .slice(0, 10);

  return {
    generatedAt: new Date(now).toISOString(),
    root,
    projectName,
    digest: {
      inboxCount: inboxItems.length,
      backlogOpen: backlog.open,
      backlogDone: backlog.done,
      byPriority: backlog.byPriority,
      docCount: prepared.length,
      staleCount: stale.length,
      queueLength: queue.length,
      loop: loopState,
      shipLog: {
        ...summariseShipLog(shipLogMd, { now }),
        openDecisions: openDecisions(shipLogMd),
        mergesSince: Number.isFinite(mergesSinceShipLog) ? mergesSinceShipLog : null,
      },
      // Three states, not two: a gate that is ON, a gate the project has
      // DECLARED it does not need, and a gate nobody has decided about. Only
      // the last one deserves a warning — warning at a docs repo forever is
      // how a safety message gets trained out of the reader.
      verify: (() => {
        const cmd = typeof verifyCommand === "string" ? verifyCommand.trim() : "";
        const state = !cmd ? "unset" : cmd.toLowerCase() === NONE ? NONE : "set";
        return { state, configured: state === "set", command: state === "set" ? cmd : null };
      })(),
      gates: gateWiring
        ? { ...gateWiring, waivers: summariseWaivers(shipLogMd, { now }) }
        : null,
    },
    inbox: { relPath: root ? statePath(root, INBOX_REL) : INBOX_REL, items: inboxItems },
    backlog: { relPath: root ? statePath(root, BACKLOG_REL) : BACKLOG_REL, ...backlog },
    queue,
    sections,
    stale,
    docs: prepared,
  };
}

// ---------------------------------------------------------------------------
// Writers and small platform helpers
// ---------------------------------------------------------------------------

/**
 * Append one thought to the inbox, VERBATIM.
 *
 * The zero-judgment rule is the point: `Inbox: X` exists so capture is as fast
 * as opening a file would have been. It was a prose rule in the always-on
 * classifier, which is why it did not fire reliably — prose competes for
 * attention, a command does not.
 *
 * Newlines are folded to spaces so one thought stays one bullet, and the
 * template's empty `- ` placeholder is consumed rather than stacked under.
 */
export function appendInboxLine(md, text) {
  const thought = String(text ?? "").trim().replace(/\s*\r?\n\s*/g, " ");
  if (!thought) throw new Error("refusing to append an empty inbox line");

  const bullet = `- ${thought}`;
  const lines = String(md ?? "").split(/\r?\n/);

  // Drop trailing blank lines so the bullet lands against the list.
  while (lines.length && !lines[lines.length - 1].trim()) lines.pop();

  // Consume a trailing empty placeholder bullet (`- ` with nothing after it).
  if (lines.length && /^\s*[-*]\s*$/.test(lines[lines.length - 1])) lines.pop();

  lines.push(bullet);
  return `${lines.join("\n")}\n`;
}

/** Add a `.gitignore` entry unless an exact line for it already exists. */
export function ensureGitignoreEntry(contents, entry) {
  const text = String(contents ?? "");
  const lines = text.split(/\r?\n/).map((l) => l.trim());
  if (lines.includes(entry)) return text;
  const prefix = text && !text.endsWith("\n") ? "\n" : "";
  const spacer = text.trim() ? "\n" : "";
  return `${text}${prefix}${spacer}# Carja's derived HTML views — regenerate with \`carja view\`\n${entry}\n`;
}

/**
 * A `file://` URL the human can click in their terminal, correct for the
 * platform the BROWSER runs on — which is not always the platform this process
 * runs on.
 *
 * WSL is why this function exists. The generated page sits on the Linux
 * filesystem, but the browser that opens it is a Windows one, and Windows
 * cannot resolve `file:///home/...`. It can resolve the UNC host
 * `wsl.localhost/<distro>`. Emitting the wrong one hands over a link that
 * silently does nothing, which is worse than printing a bare path.
 *
 * (On Windows 10 builds predating the `wsl.localhost` host the equivalent is
 * `wsl$`. Not emitted here: the modern host is what current builds resolve, and
 * offering two links to the same file is its own kind of confusion.)
 *
 * @param {string} absPath absolute path to the file
 * @param {string} [platform] as `process.platform`
 * @param {object} [env] as `process.env`
 */
export function clickableUrl(absPath, platform = process.platform, env = process.env) {
  // encodeURI leaves `/` and the Windows drive colon alone but escapes spaces.
  // It also leaves `#` and `?`, either of which would truncate the URL.
  const encode = (p) => encodeURI(p).replace(/#/g, "%23").replace(/\?/g, "%3F");

  if (platform === "win32") {
    const forward = String(absPath).replace(/\\/g, "/").replace(/^\/+/, "");
    return `file:///${encode(forward)}`;
  }

  const distro = env.WSL_DISTRO_NAME;
  if (distro && platform === "linux") {
    return `file://wsl.localhost/${encode(distro)}${encode(absPath)}`;
  }

  return `file://${encode(absPath)}`;
}

/**
 * The command that opens a local file in the platform's browser.
 * WSL is the case that matters here: `xdg-open` has nothing to open on a
 * distro with no desktop, while `wslview` hands the file to Windows.
 */
export function openerFor(platform = process.platform, env = process.env) {
  if (platform === "darwin") return "open";
  if (platform === "win32") return "start";
  if (env.WSL_DISTRO_NAME || env.WSL_INTEROP) return "wslview";
  return "xdg-open";
}

// ---------------------------------------------------------------------------
// IO wrapper
// ---------------------------------------------------------------------------

async function readIfPresent(path) {
  try {
    return await readFile(path, "utf8");
  } catch {
    return null;
  }
}

const execFileP = promisify(execFile);

/**
 * What pre-push will run, or the declared `none`, or null. One resolver, shared
 * with the CLI and mirroring lib.sh, so `status` can never disagree with the
 * hook about whether this repo is gated.
 */
function resolveVerifyCommand(configRaw, pkgRaw) {
  const gate = gateStateFrom(configRaw, pkgRaw);
  if (gate.state === NONE) return NONE;
  return gate.command;
}

/**
 * Merges on the current branch of the repo at `root` since `date` (YYYY-MM-DD).
 * Counted in THE REPO STATUS IS RUN IN and labelled as such by the renderer:
 * a state-only wrapper repo reports its own merges, honestly, not the code's.
 * `null` outside a git work tree or on any git error — never a fake zero.
 */
async function countMergesSince(root, date) {
  try {
    const { stdout: inside } = await execFileP("git", ["rev-parse", "--is-inside-work-tree"], { cwd: root });
    if (inside.trim() !== "true") return null;
    const { stdout } = await execFileP(
      "git",
      ["log", "--merges", `--since=${date}T00:00:00Z`, "--format=%H"],
      { cwd: root, maxBuffer: 8 * 1024 * 1024 },
    );
    return stdout.split("\n").filter(Boolean).length;
  } catch {
    return null;
  }
}

const HOOKS_REL = ".agents/hooks";

/** True when the file exists and has an executable bit — git skips it otherwise, silently. */
async function isExecutable(path) {
  try {
    return ((await stat(path)).mode & 0o111) !== 0;
  } catch {
    return false;
  }
}

/** Which Carja guards a Claude Code settings file wires as PreToolUse hooks. */
function guardsIn(raw) {
  let settings;
  try {
    settings = JSON.parse(raw);
  } catch {
    return { bypass: false, factGate: false };
  }
  const entries = Array.isArray(settings?.hooks?.PreToolUse) ? settings.hooks.PreToolUse : [];
  const commands = entries
    .flatMap((e) => (Array.isArray(e?.hooks) ? e.hooks : []))
    .map((h) => String(h?.command ?? ""));
  return {
    bypass: commands.some((c) => c.includes("pretooluse-no-bypass.sh")),
    factGate: commands.some((c) => c.includes("pretooluse-fact-gate.sh")),
  };
}

/**
 * Whether git will actually run the Carja hooks here, and which opt-in
 * Claude Code guards are wired. Mirrors `carja install-hooks`: armed means
 * `core.hooksPath` resolves to `.agents/hooks` and both entry scripts are
 * executable. Anything less and every law is prose.
 *
 * In the outer layout, `nested` lists each nested code repository and whether
 * its core.hooksPath points at this `.agents/hooks`: "on" for the outer
 * repository alone guards no code.
 *
 * @returns {Promise<{hooks: "on"|"off"|"custom"|"missing"|"not-git", customPath?: string, nested?: Array<{repo: string, hooks: "on"|"off"|"custom"}>, guards: {bypass: boolean, factGate: boolean}}>}
 */
export async function readGateWiring(root) {
  const own = await readOwnGateWiring(root);
  if (own.hooks === "not-git") return own;
  const wiring = { ...own, skipped: await skippedHooks(root) };
  const nested = [];
  const ours = join(root, HOOKS_REL);
  for (const entry of await ignoredNestedRepos(root)) {
    const repo = entry.replace(/\/+$/, "");
    let path = "";
    try {
      ({ stdout: path } = await execFileP("git", ["config", "--local", "--get", "core.hooksPath"], { cwd: join(root, repo) }));
    } catch {
      path = "";
    }
    path = path.trim().replace(/\/+$/, "");
    nested.push({ repo, hooks: path === ours ? "on" : path ? "custom" : "off" });
    const sk = await skippedHooks(join(root, repo));
    if (sk) {
      wiring.skipped ??= { commits: [], pushes: 0, days: sk.days };
      wiring.skipped.commits.push(...sk.commits.map((c) => `${repo}/${c}`));
      wiring.skipped.pushes += sk.pushes;
    }
  }
  return nested.length ? { ...wiring, nested } : wiring;
}

async function readOwnGateWiring(root) {
  const settings = await Promise.all(
    ["settings.json", "settings.local.json"].map((f) => readIfPresent(join(root, ".claude", f))),
  );
  const guards = settings
    .filter((raw) => raw !== null)
    .map(guardsIn)
    .reduce((a, b) => ({ bypass: a.bypass || b.bypass, factGate: a.factGate || b.factGate }), {
      bypass: false,
      factGate: false,
    });

  try {
    const { stdout } = await execFileP("git", ["rev-parse", "--is-inside-work-tree"], { cwd: root });
    if (stdout.trim() !== "true") return { hooks: "not-git", guards };
  } catch {
    return { hooks: "not-git", guards };
  }

  let hooksPath = "";
  try {
    ({ stdout: hooksPath } = await execFileP("git", ["config", "--get", "core.hooksPath"], { cwd: root }));
    hooksPath = hooksPath.trim();
  } catch {
    hooksPath = ""; // unset: git exits 1
  }

  const hooksDir = join(root, HOOKS_REL);
  const ours = hooksPath.replace(/\/+$/, "") === HOOKS_REL || hooksPath.replace(/\/+$/, "") === hooksDir;
  if (hooksPath && !ours) return { hooks: "custom", customPath: hooksPath, guards };

  try {
    await stat(hooksDir);
  } catch {
    return { hooks: "missing", guards };
  }
  if (!hooksPath) return { hooks: "off", guards };

  const armed = (await Promise.all(["pre-commit", "pre-push"].map((h) => isExecutable(join(hooksDir, h))))).every(Boolean);
  return { hooks: armed ? "on" : "off", guards };
}

/** Every markdown file under `carja/`, excluding the derived views. */
async function walkDocs(root) {
  const base = join(root, stateDirName(root));
  const out = [];

  const walk = async (dir) => {
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (entry.name.startsWith(".")) continue; // .views, .gitkeep, etc.
      const abs = join(dir, entry.name);
      if (entry.isDirectory()) {
        await walk(abs);
        continue;
      }
      if (!entry.name.endsWith(".md")) continue;
      const [raw, st] = await Promise.all([readFile(abs, "utf8"), stat(abs)]);
      out.push({
        relPath: abs.slice(root.length + 1).split(sep).join("/"),
        raw,
        mtimeMs: st.mtimeMs,
      });
    }
  };

  await walk(base);
  return out;
}

/**
 * Read `carja/` from disk and build the shared state.
 * Returns `{ ok: false }` when the folder is not there, so callers can print a
 * useful message instead of an empty dashboard.
 */
export async function collectState(root, { now = Date.now(), staleDays = 30 } = {}) {
  const [inboxMd, backlogMd, loopRaw, shipLogMd, configRaw, pkgRaw] = await Promise.all([
    readIfPresent(join(root, statePath(root, INBOX_REL))),
    readIfPresent(join(root, statePath(root, BACKLOG_REL))),
    readIfPresent(join(root, statePath(root, LOOP_STATE_REL))),
    readIfPresent(join(root, statePath(root, SHIP_LOG_REL))),
    readIfPresent(configPath(root)),
    readIfPresent(join(root, "package.json")),
  ]);

  // What pre-push will actually run: `verify` from the config, else the hook's
  // own fallback (`npm test` when package.json has a test script). Mirrors
  // `hooks/lib.sh carja_verify_cmd` so status and the gate never disagree.
  const verifyCommand = resolveVerifyCommand(configRaw, pkgRaw);

  const shipLog = summariseShipLog(shipLogMd, { now });
  const mergesSinceShipLog = shipLog.lastDate ? await countMergesSince(root, shipLog.lastDate) : null;

  let loopState = null;
  if (loopRaw) {
    try {
      loopState = JSON.parse(loopRaw);
    } catch {
      loopState = { status: "unreadable", note: "loop-state.json is not valid JSON" };
    }
  }

  const docs = await walkDocs(root);
  const gateWiring = await readGateWiring(root);
  const present = inboxMd !== null || backlogMd !== null || docs.length > 0;

  return {
    ok: present,
    state: buildState({
      root,
      projectName: basename(root),
      inboxMd: inboxMd ?? "",
      backlogMd: backlogMd ?? "",
      loopState,
      docs,
      shipLogMd: shipLogMd ?? "",
      mergesSinceShipLog,
      verifyCommand,
      gateWiring,
      now,
      staleDays,
    }),
  };
}

/**
 * Append to the inbox on disk, creating `inbox.md` from a stub if the install
 * has none yet.
 *
 * It will NOT create `carja/` itself. Capture is meant to be
 * failure-proof INSIDE a Carja project; run from anywhere else it would
 * otherwise silently scatter a half-empty state folder into an unrelated repo,
 * which is worse than a clear refusal.
 */
export async function captureInbox(root, text) {
  const relPath = statePath(root, INBOX_REL);
  const path = join(root, relPath);
  const existing = await readIfPresent(path);

  if (existing === null) {
    let hasInstall = false;
    try {
      hasInstall = (await stat(join(root, stateDirName(root)))).isDirectory();
    } catch {
      hasInstall = false;
    }
    if (!hasInstall) {
      throw new Error(
        `no \`carja/\` folder in ${root} — run \`carja init\` first, or capture from the project root`
      );
    }
  }

  const base =
    existing ??
    "# Inbox\n\nDump anything here. Ideas, tasks, thoughts. Process later into the right place.\n\n---\n\n- \n";
  const next = appendInboxLine(base, text);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, next, "utf8");
  return { path, relPath, created: existing === null };
}
