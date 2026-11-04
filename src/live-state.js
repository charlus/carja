// src/live-state.js
//
// Live state: MR and deploy status fetched now, not remembered.
//
// WHY THIS EXISTS. `carja/` holds history: a ship-log entry is true on the
// day it was written. MR status and what runs in production are live: the
// human merges and deploys outside any conversation and does not always say
// so. Measured 2026-10-20: an agent read "Not deployed yet" from the state it
// had written the day before and reported it as today's fact, after the human
// had merged and deployed both MRs. A real ship-log (evalapp-v2) already had a
// hand-written "correction to the entry above: MR !52 merged" for the same
// reason.
//
// So the agent never states a live status from the files. It runs
// `carja status --live`, which asks the forge (`gh` / `glab`) and the
// project's own `deployCheck` command, or it says it did not check and asks.
// Where no deploy check is configured, the answer is "ask the human", never a
// guess.
//
// Everything here is pure except `collectLive`, which takes an injected runner
// so the tests never touch the network.

import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { execFile } from "node:child_process";
import { ignoredNestedRepos } from "./nested-repos.js";
import { statePath, configFileName } from "./names.js";

/** How many of the newest ship-log entries are checked. Older MRs are history. */
export const DEFAULT_ENTRIES = 5;
/** Hard cap on forge calls per run, whatever the log holds. */
const MAX_REFS = 20;
/** A range wider than this ("!1 to !900") is a typo, not a batch. */
const MAX_RANGE = 20;
/** Lines of deploy-check output kept: enough to read, short enough for one screen. */
const MAX_OUTPUT_LINES = 15;
const TIMEOUT_MS = 30000;

const GITLAB_URL = /https?:\/\/([^\s/)>\]]+)\/([^\s)>\]]+?)\/-\/merge_requests\/(\d+)/g;
const GITHUB_URL = /https?:\/\/github\.com\/([^\s/)>\]]+)\/([^\s/)>\]]+)\/pull\/(\d+)/g;
const GITLAB_RANGE = /(?<![\w/])!(\d+)\s*(?:to|–|—|-)\s*!(\d+)\b/g;
const GITLAB_BARE = /(?<![\w/[])!(\d+)\b/g;
const GITHUB_BARE = /\b(?:PR|pull request)\s*#(\d+)\b/gi;
/** The waiver lines `hooks/lib.sh` appends. They sit after an entry but are not part of it. */
const WAIVER_LINE = /^- \[\d{4}-\d{2}-\d{2}[^\]]*\] Hook waiver .*$/gm;

/**
 * Split the ship-log into dated entries, newest first by date.
 * @returns {Array<{date: string, title: string, text: string}>}
 */
function entriesOf(md) {
  const parts = String(md ?? "").split(/^## (?=\d{4}-\d{2}-\d{2}\b)/m).slice(1);
  return parts
    .map((part) => {
      const nl = part.indexOf("\n");
      const head = nl === -1 ? part : part.slice(0, nl);
      return {
        date: head.slice(0, 10),
        title: head.slice(10).replace(/^[\s—\-–:]+/, "").trim(),
        text: part.replace(WAIVER_LINE, "").trim(),
      };
    })
    .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
}

/**
 * Every MR/PR the newest ship-log entries mention, deduplicated, newest entry
 * first. A URL ref names its own project; a bare `!N` or `PR #N` is resolved
 * against the repositories here at lookup time.
 *
 * @param {string} md
 * @param {{entries?: number}} [opts]
 * @returns {Array<{key: string, kind: "gitlab"|"github", number: number, label: string, project: string|null, line: string, entryDate: string, entryTitle: string}>}
 */
export function mrRefsFromShipLog(md, { entries = DEFAULT_ENTRIES } = {}) {
  const out = [];
  const seen = new Set();
  const add = (ref, entry) => {
    if (seen.has(ref.key) || out.length >= MAX_REFS) return;
    seen.add(ref.key);
    out.push({ ...ref, entryDate: entry.date, entryTitle: entry.title });
  };
  // The line a ref sits on: a status claim counts only next to its own MR.
  const lineAt = (text, index) => {
    const start = text.lastIndexOf("\n", index) + 1;
    const end = text.indexOf("\n", index);
    return text.slice(start, end === -1 ? text.length : end).trim();
  };

  for (const entry of entriesOf(md).slice(0, entries)) {
    const text = entry.text;
    const urlNumbers = { gitlab: new Set(), github: new Set() };

    for (const m of text.matchAll(GITLAB_URL)) {
      const project = `https://${m[1]}/${m[2]}`;
      urlNumbers.gitlab.add(Number(m[3]));
      add({ key: `gitlab:${m[1]}/${m[2]}!${m[3]}`, kind: "gitlab", number: Number(m[3]), label: `!${m[3]}`, project, line: lineAt(text, m.index) }, entry);
    }
    for (const m of text.matchAll(GITHUB_URL)) {
      urlNumbers.github.add(Number(m[3]));
      add(
        { key: `github:${m[1]}/${m[2]}#${m[3]}`, kind: "github", number: Number(m[3]), label: `#${m[3]}`, project: m[0], line: lineAt(text, m.index) },
        entry,
      );
    }

    const bare = new Map(); // number → the line it was first seen on
    const note = (n, index) => bare.has(n) || bare.set(n, lineAt(text, index));
    for (const m of text.matchAll(GITLAB_RANGE)) {
      const [from, to] = [Number(m[1]), Number(m[2])];
      if (to > from && to - from <= MAX_RANGE) for (let n = from; n <= to; n += 1) note(n, m.index);
    }
    for (const m of text.matchAll(GITLAB_BARE)) note(Number(m[1]), m.index);
    for (const n of [...bare.keys()].sort((a, b) => a - b)) {
      if (urlNumbers.gitlab.has(n)) continue; // "MR !41 https://…/merge_requests/41" is one MR
      add({ key: `gitlab:!${n}`, kind: "gitlab", number: n, label: `!${n}`, project: null, line: bare.get(n) }, entry);
    }
    for (const m of text.matchAll(GITHUB_BARE)) {
      const n = Number(m[1]);
      if (urlNumbers.github.has(n)) continue;
      add({ key: `github:#${n}`, kind: "github", number: n, label: `#${n}`, project: null, line: lineAt(text, m.index) }, entry);
    }
  }
  return out;
}

/**
 * One vocabulary for both forges: open, merged, closed, or unknown.
 * `at` is the merge (or close) date, YYYY-MM-DD.
 *
 * @param {"gitlab"|"github"} kind
 * @param {string} stdout the CLI's JSON
 * @returns {{state: "open"|"merged"|"closed"|"unknown", at: string|null}}
 */
export function normaliseMrState(kind, stdout) {
  let data;
  try {
    data = JSON.parse(stdout);
  } catch {
    return { state: "unknown", at: null };
  }
  const raw = String(data?.state ?? "").toLowerCase();
  const day = (v) => (typeof v === "string" && v.length >= 10 ? v.slice(0, 10) : null);
  const merged = kind === "github" ? data?.mergedAt : data?.merged_at;
  const closed = kind === "github" ? data?.closedAt : data?.closed_at;
  if (raw === "merged") return { state: "merged", at: day(merged) };
  if (raw === "open" || raw === "opened") return { state: "open", at: null };
  if (raw === "closed") return { state: "closed", at: day(closed) };
  return { state: "unknown", at: null };
}

// "unmerged" is left out on purpose: in real logs it qualifies a branch
// ("the unmerged docs branch"), not the MR on the same line.
const NOT_MERGED_CLAIM =
  /\b(not (?:yet )?merged|awaiting (?:merge|review)|waiting (?:for|on) (?:the |a )?merge|pending merge|still open|open for review)\b/i;

/**
 * The status an entry stored that the forge now contradicts, or null.
 * Only "not merged" claims on the ref's own line are checked: an entry that
 * merely links its MR is the normal shape, and is history, not a claim about
 * today.
 */
export function staleClaim(ref, live) {
  if (live.state !== "merged" && live.state !== "closed") return null;
  const m = String(ref.line ?? "").match(NOT_MERGED_CLAIM);
  return m ? `entry says "${m[1]}"` : null;
}

/**
 * The deploy checks this project declares: `deployCheck` at the top level and
 * under each `repos.<name>` of an outer layout. Empty means none: the caller
 * must then ask the human, not guess.
 *
 * @param {string|null} configRaw
 * @returns {Array<{repo: string|null, command: string}>}
 */
export function deployChecksFrom(configRaw) {
  let cfg;
  try {
    cfg = configRaw ? JSON.parse(configRaw) : null;
  } catch {
    return [];
  }
  const out = [];
  const cmd = (v) => (typeof v === "string" ? v.trim() : "");
  if (cmd(cfg?.deployCheck)) out.push({ repo: null, command: cmd(cfg.deployCheck) });
  for (const [repo, settings] of Object.entries(cfg?.repos ?? {})) {
    if (cmd(settings?.deployCheck)) out.push({ repo, command: cmd(settings.deployCheck) });
  }
  return out;
}

/** The default runner: never throws, always resolves `{code, stdout, stderr}`. */
export function runCommand(cmd, args, { cwd, timeout = TIMEOUT_MS } = {}) {
  return new Promise((resolve) => {
    execFile(cmd, args, { cwd, timeout, maxBuffer: 4 * 1024 * 1024 }, (err, stdout, stderr) => {
      const code = err ? (typeof err.code === "number" ? err.code : 127) : 0;
      resolve({ code, stdout: String(stdout ?? ""), stderr: String(stderr ?? err?.message ?? "") });
    });
  });
}

const isGithub = (url) => /github\.com[:/]/i.test(url);

/** The repositories a bare ref could belong to, by forge: this one and each nested one. */
async function reposByForge(root, run) {
  const dirs = [root, ...(await ignoredNestedRepos(root)).map((r) => join(root, r.replace(/\/+$/, "")))];
  const byForge = { gitlab: [], github: [] };
  for (const dir of dirs) {
    const { code, stdout } = await run("git", ["remote", "get-url", "origin"], { cwd: dir });
    const url = stdout.trim();
    if (code !== 0 || !url) continue;
    byForge[isGithub(url) ? "github" : "gitlab"].push(dir);
  }
  return byForge;
}

const firstLine = (s) => String(s ?? "").trim().split("\n")[0].slice(0, 160);

async function lookUp(ref, repos, root, run) {
  let cwd = root;
  let args;
  if (ref.kind === "gitlab") {
    args = ["mr", "view", String(ref.number), "--output", "json"];
    if (ref.project) args.push("-R", ref.project);
  } else {
    args = ["pr", "view", ref.project ?? String(ref.number), "--json", "state,mergedAt,closedAt"];
  }
  if (!ref.project) {
    const candidates = repos[ref.kind];
    if (candidates.length !== 1) {
      const why = candidates.length ? "several repositories could own it" : `no ${ref.kind === "gitlab" ? "GitLab" : "GitHub"} repository here`;
      return { state: "unknown", at: null, reason: `not checked: ${why}` };
    }
    cwd = candidates[0];
  }
  const cli = ref.kind === "gitlab" ? "glab" : "gh";
  const res = await run(cli, args, { cwd });
  if (res.code !== 0) return { state: "unknown", at: null, reason: `${cli}: ${firstLine(res.stderr) || `exit ${res.code}`}` };
  const live = normaliseMrState(ref.kind, res.stdout);
  return live.state === "unknown" ? { ...live, reason: `${cli}: unreadable output` } : live;
}

/**
 * F22: the head commit of the merged MR whose source branch is `branch`, from
 * the forge of `dir`'s origin; null when there is none or the forge cannot say.
 * The loop's cleanup uses it for squash-merged branches. Never throws.
 */
export async function forgeMergedHead(dir, branch, run = runCommand) {
  const { code, stdout } = await run("git", ["remote", "get-url", "origin"], { cwd: dir });
  if (code !== 0 || !stdout.trim()) return null;
  const sha = (v) => (typeof v === "string" && /^[0-9a-f]{40}$/.test(v) ? v : null);
  if (isGithub(stdout.trim())) {
    const r = await run("gh", ["pr", "list", "--head", branch, "--state", "merged", "--json", "headRefOid", "--limit", "1"], { cwd: dir });
    try {
      return r.code === 0 ? sha(JSON.parse(r.stdout)[0]?.headRefOid) : null;
    } catch {
      return null;
    }
  }
  const r = await run("glab", ["api", `projects/:id/merge_requests?source_branch=${encodeURIComponent(branch)}&state=merged`], { cwd: dir });
  try {
    return r.code === 0 ? sha(JSON.parse(r.stdout)[0]?.sha) : null;
  } catch {
    return null;
  }
}

/**
 * Fetch the live state. Never throws: a missing CLI, no auth or no network
 * makes an item `unknown` with its reason, and the rest still renders.
 *
 * @param {string} root
 * @param {{shipLogMd?: string, configRaw?: string|null, run?: Function, now?: number, entries?: number}} [opts]
 */
export async function collectLive(root, { shipLogMd, configRaw, run = runCommand, now = Date.now(), entries } = {}) {
  const read = async (rel) => {
    try {
      return await readFile(join(root, rel), "utf8");
    } catch {
      return null;
    }
  };
  const log = shipLogMd ?? (await read(statePath(root, "carja/0-compass/ship-log.md"))) ?? "";
  const config = configRaw !== undefined ? configRaw : await read(configFileName(root));

  const refs = mrRefsFromShipLog(log, entries ? { entries } : {});
  const repos = refs.some((r) => !r.project) ? await reposByForge(root, run) : { gitlab: [], github: [] };
  const mrs = await Promise.all(
    refs.map(async (ref) => {
      const live = await lookUp(ref, repos, root, run);
      return { ...ref, ...live, stale: staleClaim(ref, live) };
    }),
  );

  const declared = deployChecksFrom(config);
  const checks = await Promise.all(
    declared.map(async ({ repo, command }) => {
      const res = await run("sh", ["-c", command], { cwd: repo ? join(root, repo) : root });
      const text = (res.stdout.trim() || res.stderr.trim()).split("\n").slice(-MAX_OUTPUT_LINES).join("\n");
      return { repo, command, code: res.code, output: text };
    }),
  );

  return {
    checkedAt: new Date(now).toISOString(),
    mrs,
    deploy: { state: declared.length ? "checked" : "ask", checks },
  };
}
