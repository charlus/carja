// src/evidence/ledger.js
//
// The verification-evidence ledger (E2) — the mechanical arm of the Evidence
// Rule / Verification Iron Law.
//
//   recordRun()      run a command, stream its output, append what happened
//   checkFreshness() grade a prior run FRESH / STALE / MISSING
//
// TRANSPARENCY INVARIANT (asserted by the tests): the child's exit code is
// ALWAYS the wrapper's result. Only the caller can opt into a stricter verdict
// (`evidence run --stable-tree`, used by pre-push). Every bookkeeping failure — an
// unwritable ledger, a missing home, a non-git directory — is a warning on the
// returned record, never a failure. A wrapper whose job is to record runs must
// never be able to turn a green run red.
//
// Freshness binds to `wtree`, the working-tree CONTENT fingerprint (wtree.js),
// so evidence recorded on uncommitted code stays FRESH after exactly that
// content is committed, and an untracked new source file invalidates it.
//
// `cmd_sha256` is the sha256 of the exact command string with NO normalization,
// and `checkFreshness` can require it via `expectCmd`. Without that binding a
// green `echo ok` recorded under the label `tests` would satisfy the gate — the
// hash is what ties the label to the real suite.
//
// `env_sha256` (optional, `envFiles`) binds a run to files the command reads
// that git ignores, such as `.env`. The working-tree fingerprint leaves ignored
// files out, so without it a changed `.env` would keep a verdict FRESH.
//
// MACHINE-LOCAL by design. The ledger lives under CARJA_HOME (default
// ~/.carja, or ~/.conductor on a machine set up under 6.x), not in the repo: a synced record claiming a run happened on a
// machine where it did not would be worse than no record at all. It is also
// per-branch, so a record from another branch cannot grade this one FRESH.

import { appendFile, mkdir, readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { spawn, execFile } from "node:child_process";
import { promisify } from "node:util";
import { join, dirname } from "node:path";
import { workingTreeFingerprint, repoRoot, headSha } from "./wtree.js";
import { machineHome } from "../names.js";

const execFileAsync = promisify(execFile);

export function sha256(text) {
  return createHash("sha256").update(String(text)).digest("hex");
}

function carjaHome(home) {
  return home || machineHome(process.env);
}

/** Filesystem-safe slug for a repo path or branch name. */
function slug(text) {
  return String(text || "unknown")
    .replace(/[^A-Za-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80) || "unknown";
}

async function currentBranch(cwd) {
  try {
    const { stdout } = await execFileAsync("git", ["rev-parse", "--abbrev-ref", "HEAD"], { cwd });
    return stdout.trim();
  } catch {
    return "no-branch";
  }
}

/**
 * Path of the evidence ledger for this repo + branch.
 * Synchronous-shaped (no await) so tests and callers can name it directly; the
 * branch segment is resolved lazily by the async callers below.
 */
export function ledgerPath({ cwd = process.cwd(), home = null, branch = null, project = null } = {}) {
  const base = carjaHome(home);
  const proj = slug(project || cwd.split("/").filter(Boolean).at(-1));
  return join(base, "projects", proj, `${slug(branch || "current")}-evidence.jsonl`);
}

/**
 * Resolve the real ledger path (repo root + branch aware). Never throws.
 * Exported because callers and tests must be able to name the SAME file the
 * writer used — the sync `ledgerPath` above cannot know the branch.
 */
export async function resolveLedgerPath({ cwd = process.cwd(), home = null } = {}) {
  let project = cwd;
  let branch = "no-branch";
  try {
    project = (await repoRoot(cwd)) || cwd;
    branch = await currentBranch(cwd);
  } catch {
    /* degrade to cwd/no-branch */
  }
  return ledgerPath({
    cwd,
    home,
    branch,
    project: project.split("/").filter(Boolean).at(-1),
  });
}

const resolveLedger = resolveLedgerPath;

/**
 * sha256 over the names and contents of `envFiles` (paths relative to cwd).
 * A missing file hashes as absent, so creating one changes the digest.
 */
export async function envDigest(cwd, envFiles) {
  const h = createHash("sha256");
  for (const f of [...envFiles].sort()) {
    h.update(`${f}\0`);
    try {
      h.update(await readFile(join(cwd, f)));
    } catch {
      h.update("\0absent");
    }
    h.update("\0");
  }
  return h.digest("hex");
}

/**
 * Run `command` through a shell, streaming its output, and append a record of
 * what happened. The child's exit code is always returned unchanged.
 *
 * @param {object} opts
 * @param {string} opts.label     lane name, e.g. "tests" / "lint" / "evals"
 * @param {string} opts.command   the exact command string
 * @param {string} [opts.cwd]
 * @param {string|null} [opts.home]   CARJA_HOME override (tests)
 * @param {object} [opts.io]      { stdout, stderr } sinks; defaults to process
 * @param {string[]|null} [opts.envFiles]  ignored files the command reads (`.env`)
 * @param {() => number} [opts.now]
 * @returns {Promise<{exitCode:number, wtree:string|null, warning?:string, record:object}>}
 */
export async function recordRun({
  label,
  command,
  cwd = process.cwd(),
  home = null,
  envFiles = null,
  io = { stdout: process.stdout, stderr: process.stderr },
  now = () => Date.now(),
}) {
  const startedMs = now();

  // The fingerprint is taken BEFORE the run: it describes the content that was
  // tested. Taking it after would fold any artefact the run itself wrote into
  // the tree the evidence claims to cover.
  const wtree = await workingTreeFingerprint(cwd).catch(() => null);
  const head = await headSha(cwd).catch(() => null);
  const env = envFiles ? await envDigest(cwd, envFiles).catch(() => null) : null;

  const exitCode = await new Promise((resolve) => {
    const child = spawn(command, { cwd, shell: true, stdio: ["ignore", "pipe", "pipe"] });
    child.stdout.on("data", (d) => io.stdout?.write?.(d));
    child.stderr.on("data", (d) => io.stderr?.write?.(d));
    child.on("error", () => resolve(127));
    child.on("close", (code) => resolve(code ?? 1));
  });

  // A second fingerprint after the run. When it differs, the command changed
  // files while it ran (snapshots, a lint fix, a lockfile): the code that
  // passed is not the code on disk. Ignored files do not count.
  const wtreeAfter = wtree ? await workingTreeFingerprint(cwd).catch(() => null) : null;
  let treeChanged;
  if (wtree && wtreeAfter && wtreeAfter !== wtree) {
    treeChanged = (await treeDiffPaths(cwd, wtree, wtreeAfter)) ?? ["(unknown paths)"];
  }

  const record = {
    ts: new Date(startedMs).toISOString(),
    label: String(label),
    command: String(command),
    cmd_sha256: sha256(command),
    exit: exitCode,
    duration_s: Math.round((now() - startedMs) / 100) / 10,
    commit: head,
    wtree,
    ...(env ? { env_sha256: env } : {}),
    ...(treeChanged ? { tree_changed: treeChanged } : {}),
  };

  let warning;
  try {
    const path = await resolveLedger({ cwd, home });
    await mkdir(dirname(path), { recursive: true });
    await appendFile(path, `${JSON.stringify(record)}\n`, { mode: 0o600 });
  } catch (error) {
    // TRANSPARENCY: bookkeeping never fails the run.
    warning = `evidence: could not record this run (${error?.message ?? error}) — the command's result stands`;
    io.stderr?.write?.(`${warning}\n`);
  }

  return { exitCode, wtree, treeChanged, warning, record };
}

/**
 * Paths that differ between two git trees, or null when the diff cannot be
 * taken (a gc'd tree, a non-git dir). Null must always be read as "cannot
 * prove they match" — never as a match.
 */
async function treeDiffPaths(cwd, treeA, treeB) {
  try {
    const { stdout } = await execFileAsync(
      "git",
      ["diff-tree", "-r", "--name-only", "--no-commit-id", treeA, treeB],
      { cwd, timeout: 30_000, maxBuffer: 8 * 1024 * 1024 },
    );
    return stdout.split("\n").map((l) => l.trim()).filter(Boolean);
  } catch {
    return null;
  }
}

/**
 * True when every differing path is covered by the allow-list. A prefix match
 * is used so "docs/" covers everything under it.
 */
function allPathsAllowed(paths, allowPaths) {
  if (!allowPaths?.length) return false;
  return paths.every((p) =>
    allowPaths.some((a) => p === a || (a.endsWith("/") && p.startsWith(a))),
  );
}

/** Read the ledger into records, newest last. Corrupt lines are skipped. */
async function readLedger({ cwd, home }) {
  try {
    const path = await resolveLedger({ cwd, home });
    const text = await readFile(path, "utf8");
    const out = [];
    for (const line of text.split("\n")) {
      if (!line.trim()) continue;
      try {
        out.push(JSON.parse(line));
      } catch {
        /* skip a torn or hand-edited line rather than failing the check */
      }
    }
    return out;
  } catch {
    return [];
  }
}

/**
 * Grade recorded evidence for each requested label.
 *
 * READ-ONLY and it never throws: any git failure, gc'd tree or missing ledger
 * degrades to STALE/MISSING. A check that could throw would take the calling
 * workflow down, and "I could not tell" must never read as "it is fine".
 *
 * @param {object} opts
 * @param {Array<{label:string, expectCmd?:string}>} opts.labels  labels to grade.
 *   Callers must name them explicitly — the ledger cannot prove that a lane
 *   which never ran was supposed to.
 * @param {string} [opts.cwd]
 * @param {string|null} [opts.home]
 * @param {number|null} [opts.maxAgeHours]
 * @param {string[]|null} [opts.envFiles]  when given, the record's env_sha256 must match
 * @param {() => number} [opts.now]
 * @returns {Promise<{ok:boolean, wtree:string|null, byLabel:Record<string,object>}>}
 */
export async function checkFreshness({
  labels,
  cwd = process.cwd(),
  home = null,
  envFiles = null,
  maxAgeHours = null,
  allowPaths = [],
  now = () => Date.now(),
}) {
  const wanted = (labels ?? []).map((l) => (typeof l === "string" ? { label: l } : l));
  const wtree = await workingTreeFingerprint(cwd).catch(() => null);
  const records = await readLedger({ cwd, home });
  const env = envFiles ? await envDigest(cwd, envFiles).catch(() => null) : null;

  const byLabel = {};
  for (const { label, expectCmd } of wanted) {
    // Newest record for the label wins: an older run must never outvote it.
    const rec = [...records].reverse().find((r) => r?.label === label);

    if (!rec) {
      byLabel[label] = { state: "MISSING", reason: "no recorded run for this label" };
      continue;
    }

    const base = {
      exit: rec.exit,
      ts: rec.ts,
      command: rec.command,
      wtree: rec.wtree ?? null,
    };

    if (expectCmd && rec.cmd_sha256 !== sha256(expectCmd)) {
      byLabel[label] = {
        ...base,
        state: "STALE",
        reason: `recorded command does not match the expected one (recorded: ${rec.command})`,
      };
      continue;
    }
    if (rec.exit !== 0) {
      byLabel[label] = { ...base, state: "STALE", reason: `the recorded run failed (exit ${rec.exit})` };
      continue;
    }
    if (rec.tree_changed?.length) {
      byLabel[label] = {
        ...base,
        state: "STALE",
        reason: `the run changed files while it ran (${rec.tree_changed.slice(0, 4).join(", ")}${rec.tree_changed.length > 4 ? ", …" : ""})`,
      };
      continue;
    }
    if (envFiles && (!env || rec.env_sha256 !== env)) {
      byLabel[label] = { ...base, state: "STALE", reason: "the .env files changed since this run, or were not recorded" };
      continue;
    }
    if (!wtree || !rec.wtree) {
      byLabel[label] = {
        ...base,
        state: "STALE",
        reason: "no working-tree fingerprint available to compare against",
      };
      continue;
    }
    if (rec.wtree !== wtree) {
      // ALLOW-LIST ESCAPE. A ship legitimately edits release files between
      // running the suite and pushing (CHANGELOG, VERSION). Invalidating the
      // whole run for that means the fast path almost never fires, so a diff
      // confined to allow-listed paths keeps the evidence FRESH.
      //
      // RESIDUAL RISK, accepted and stated: a behaviour-changing edit hidden
      // inside an allow-listed path would not invalidate the evidence. That is
      // why the list must stay small and must never include source paths.
      const changed = await treeDiffPaths(cwd, rec.wtree, wtree);
      if (changed && allPathsAllowed(changed, allowPaths)) {
        byLabel[label] = {
          ...base,
          state: "FRESH",
          reason: `green; only allow-listed paths changed since (${changed.join(", ")})`,
        };
        continue;
      }
      byLabel[label] = {
        ...base,
        state: "STALE",
        reason: changed
          ? `the working tree changed since this run (${changed.slice(0, 4).join(", ")}${changed.length > 4 ? ", …" : ""})`
          : "the working tree changed since this run",
      };
      continue;
    }
    if (maxAgeHours != null) {
      const ageH = (now() - Date.parse(rec.ts)) / 3_600_000;
      if (!Number.isFinite(ageH) || ageH > maxAgeHours) {
        byLabel[label] = {
          ...base,
          state: "STALE",
          reason: `the record is older than the max age (${ageH.toFixed(1)}h > ${maxAgeHours}h)`,
        };
        continue;
      }
    }
    byLabel[label] = { ...base, state: "FRESH", reason: "same content, green" };
  }

  const ok = wanted.length > 0 && wanted.every(({ label }) => byLabel[label].state === "FRESH");
  return { ok, wtree, byLabel };
}
