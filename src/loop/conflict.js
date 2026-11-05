// src/loop/conflict.js
//
// Merge-conflict PREDICTION for the swarm's merge queue (F7).
//
// WHY THIS EXISTS. The swarm dispatched a wave of Makers in parallel worktrees,
// then merged them one by one. A collision was only discovered at merge time —
// after the worker had burned a full beat, passed verify and passed the
// Checker — and it surfaced as "PR-gated merge failed: unknown", which tells
// the human nothing about what collided. `git merge-tree` answers the same
// question against the object store, touching no working tree, so the queue can
// land the clean branches first and escalate the colliding one with the exact
// file list.
//
// NOT A SAFETY GATE. The PR-gated merge is still the real gate; this only
// reorders the queue and improves the escalation message. So it FAILS OPEN: an
// old git, a missing merge base, any doubt at all → `method: "unknown"` and
// `conflicted: false`, and the merge is attempted exactly as before. A false
// "conflicted" would strand work that merges fine, which is the worse error.
//
// TWO FORMS, because git changed the command:
//   git >= 2.38  `merge-tree --write-tree --name-only` — exit 1 means conflict.
//   git <  2.38  `merge-tree <base> <ours> <theirs>`   — ALWAYS exits 0; the
//                only signal is a conflict marker in the diff body. Reading the
//                exit code on this form reports every conflict as clean.
//
// All git IO is injected as `git(argsArray) -> {ok, stdout, stderr, exitCode}`.

/**
 * The exact line legacy merge-tree writes to open a conflicted hunk. Matched as
 * a WHOLE line, and only inside a section that can conflict. The first version
 * matched the marker string anywhere, so any branch that merely contained the
 * text — a fixture, a test, this very file — was reported as a collision, and
 * the swarm withheld a merge that git performs cleanly.
 */
// `+` only: git WRITES the marker, so in the merged hunk it is always an added
// line. A context line (leading space) is a marker that was already in the
// file — accepting it made a file that merely contains one, edited on distant
// lines by both sides, read as a conflict (delta review, IMPORTANT).
const CONFLICT_OPEN = /^\+<<<<<<< \.our$/;

/** Sections where both sides edited the same content and markers mean conflict. */
const TEXT_CONFLICT_SECTIONS = new Set(["changed in both", "added in both"]);

/** Sections where one side deleted the file; conflict iff the other side changed it. */
const DELETE_SECTIONS = new Set(["removed in remote", "removed in local"]);

/** `  our    100644 <sha> path/to/file` → role, sha, path. */
const BLOB_LINE = /^\s+(base|our|their|result)\s+\d+\s+([0-9a-f]+)\s+(.+)$/;

/**
 * Parse legacy `git merge-tree <base> <ours> <theirs>` output.
 *
 * Legacy merge-tree exits 0 whatever happens, so the body is the only signal,
 * and it takes two readings — verified against real git 2.34.1 output:
 *
 *   TEXT CONFLICT   a `changed in both` / `added in both` section whose hunk has
 *                   a line that is exactly `+<<<<<<< .our`. Two branches editing
 *                   the same file on distant lines produce `changed in both` too,
 *                   and merge fine — the header alone would over-report.
 *   MODIFY/DELETE   a `removed in remote` / `removed in local` section where the
 *                   surviving side's blob differs from base. No markers are ever
 *                   written for this one, which is why a marker-only reading
 *                   missed it.
 *
 * Every other section — `added in remote`, `merged`, … — cannot conflict, even
 * when its content happens to contain marker text.
 *
 * @returns {{conflicted: boolean, files: string[]}}
 */
export function parseLegacyMergeTree(stdout) {
  const files = [];
  let section = null;
  let path = null;
  let blobs = {};
  let sawMarker = false;

  const flush = () => {
    if (!section || !path) return;
    let conflicted = false;
    if (TEXT_CONFLICT_SECTIONS.has(section)) conflicted = sawMarker;
    else if (DELETE_SECTIONS.has(section)) {
      const survivor = blobs.our ?? blobs.their;
      conflicted = Boolean(blobs.base && survivor && survivor !== blobs.base);
    }
    if (conflicted && !files.includes(path)) files.push(path);
  };

  for (const line of String(stdout ?? "").split("\n")) {
    // An unindented word starts a new section.
    if (/^[a-z]/.test(line)) {
      flush();
      section = line.trim();
      path = null;
      blobs = {};
      sawMarker = false;
      continue;
    }
    const blob = line.match(BLOB_LINE);
    if (blob) {
      blobs[blob[1]] = blob[2];
      path = blob[3].trim();
      continue;
    }
    if (CONFLICT_OPEN.test(line)) sawMarker = true;
  }
  flush();

  return { conflicted: files.length > 0, files };
}

/**
 * Parse modern `git merge-tree --write-tree --name-only` output.
 * Exit 1 is the conflict signal; stdout is the tree oid, then the conflicted
 * paths, then (unless suppressed) messages after a blank line.
 *
 * NOT exercised against a real git here — this machine runs 2.34.1, which has
 * no `--write-tree`. Shape taken from the documented contract.
 *
 * @returns {{conflicted: boolean, files: string[]}}
 */
export function parseModernMergeTree(stdout, exitCode) {
  if (exitCode === 0) return { conflicted: false, files: [] };
  const lines = String(stdout ?? "").split("\n");
  const files = [];
  for (const line of lines.slice(1)) {
    if (line.trim() === "") break; // blank line ends the path list
    files.push(line.trim());
  }
  return { conflicted: true, files };
}

/** True when git rejected the flags rather than answering the question. */
function unsupportedForm(res) {
  const text = `${res?.stderr ?? ""}${res?.stdout ?? ""}`;
  return res?.exitCode === 129 || /usage: git merge-tree|unknown option/i.test(text);
}

/**
 * Would merging `branch` into `base` conflict, and where?
 *
 * @returns {Promise<{conflicted:boolean, files:string[], method:"merge-tree"|"merge-tree-legacy"|"unknown"}>}
 *   `method: "unknown"` means we could not tell — never that it is clean.
 */
export async function predictConflicts({ git, base, branch }) {
  const unknown = { conflicted: false, files: [], method: "unknown" };
  if (!git || !base || !branch) return unknown;

  // Modern form first; --no-messages keeps stdout to oid + paths.
  try {
    const modern = await git([
      "merge-tree", "--write-tree", "--name-only", "--no-messages", base, branch,
    ]);
    if (!unsupportedForm(modern)) {
      // exitCode 0 = clean, 1 = conflict. Anything else is a real failure
      // (bad ref, corrupt object) and must not be read as a verdict.
      //
      // And exit 1 alone is not enough: a git that failed for its own reasons
      // — no such ref, no git at all — also exits non-zero with nothing on
      // stdout, and reading that as "conflict" would strand work that merges
      // fine. A genuine verdict always writes the resulting tree oid first, so
      // require it before believing either answer.
      const hasVerdict = String(modern.stdout ?? "").trim() !== "";
      if (hasVerdict && (modern.exitCode === 0 || modern.exitCode === 1)) {
        return { ...parseModernMergeTree(modern.stdout, modern.exitCode), method: "merge-tree" };
      }
      return unknown;
    }
  } catch {
    // fall through to the legacy form
  }

  try {
    const mb = await git(["merge-base", base, branch]);
    const mergeBase = mb?.ok ? String(mb.stdout ?? "").trim() : "";
    if (!mergeBase) return unknown; // unrelated histories → we cannot predict

    const legacy = await git(["merge-tree", mergeBase, base, branch]);
    if (!legacy?.ok) return unknown;
    return { ...parseLegacyMergeTree(legacy.stdout), method: "merge-tree-legacy" };
  } catch {
    return unknown;
  }
}

/**
 * Order a wave's merge results so predicted-clean branches land first.
 *
 * Pure and STABLE: the driver forbids randomness, so the same wave must always
 * merge in the same order or a resumed run diverges from the one it resumes.
 * An unknown prediction sorts with the clean group — we do not demote work on
 * a guess.
 *
 * @param {Array<{task:object, prediction?:{conflicted?:boolean}}>} results
 * @returns a new array; the input is not mutated.
 */
export function orderMergeQueue(results) {
  const list = [...(results ?? [])];
  const conflicting = (r) => (r?.prediction?.conflicted === true ? 1 : 0);
  return list
    .map((r, i) => [r, i])
    .sort((a, b) => conflicting(a[0]) - conflicting(b[0]) || a[1] - b[1])
    .map(([r]) => r);
}

// ---------------------------------------------------------------------------
// I3 (owner, 2026-10-23): KM relief stopped at slice 08 of 17 because its
// Ship touched two Carja documents (nexus-technical.md, coding-patterns.md)
// that CoP had changed on main in the meantime. A conflict that is only in
// Carja documents does not stop a project: the item's branch takes what it
// must land on, both sides of each conflicted document are kept (an append-only
// log is a union; a prose document keeps both texts and the report names it for
// the owner), verify runs again, and the MR opens. A conflict in code still
// stops the item: code is never merged by the loop.

/** The path prefix of what the loop may merge on its own. */
export const DOC_PREFIX = "carja/";

/** True when every conflicted file is a Carja document. */
export function onlyCarjaDocs(files) {
  return Array.isArray(files) && files.length > 0 && files.every((f) => String(f).startsWith(DOC_PREFIX));
}

/**
 * Resolve a file's conflict markers by keeping both sides, ours first. A diff3
 * base section (`|||||||`) is dropped. Text with no markers comes back as is.
 */
export function keepBothSides(text) {
  const out = [];
  let state = "text";
  let ours = [];
  let theirs = [];
  for (const line of String(text ?? "").split("\n")) {
    if (state === "text" && /^<{7}( |$)/.test(line)) {
      state = "ours";
      ours = [];
      theirs = [];
      continue;
    }
    if (state === "ours" && /^\|{7}( |$)/.test(line)) {
      state = "base";
      continue;
    }
    if ((state === "ours" || state === "base") && /^={7}$/.test(line)) {
      state = "theirs";
      continue;
    }
    if (state === "theirs" && /^>{7}( |$)/.test(line)) {
      out.push(...ours, ...theirs);
      state = "text";
      continue;
    }
    if (state === "ours") ours.push(line);
    else if (state === "theirs") theirs.push(line);
    else if (state === "text") out.push(line);
  }
  // An unterminated block is not resolved: give the text back untouched.
  return state === "text" ? out.join("\n") : String(text ?? "");
}

const MARKER = /^(<{7}|={7}|>{7})( |$)/m;

/**
 * Merge `base` into the branch checked out in a worktree. Conflicts only in
 * Carja documents are resolved by keeping both sides and committed (the
 * commit runs the repository's hooks); any other conflict, or a failed
 * commit, aborts the merge and leaves the branch as it was.
 * IO injected: `git(args)` runs in the worktree, `read(rel)`/`write(rel, text)`.
 * @returns {Promise<{merged: boolean, files: string[], reason?: string}>}
 */
export async function mergeKeepingDocs({ git, base, read, write, message }) {
  const start = await git(["merge", "--no-ff", "--no-commit", base]);
  const conflicted = (await git(["diff", "--name-only", "--diff-filter=U"])).stdout?.split("\n").map((s) => s.trim()).filter(Boolean) ?? [];
  if (!start.ok && !conflicted.length) {
    await git(["merge", "--abort"]);
    return { merged: false, files: [], reason: `git merge failed: ${String(start.stderr || start.stdout || "").split("\n")[0]}` };
  }
  if (conflicted.length && !onlyCarjaDocs(conflicted)) {
    await git(["merge", "--abort"]);
    return { merged: false, files: conflicted, reason: `a conflict outside the Carja documents (${conflicted.filter((f) => !f.startsWith(DOC_PREFIX)).join(", ")}): code is never merged by the loop` };
  }
  for (const f of conflicted) {
    const text = await read(f);
    if (text != null) {
      const resolved = keepBothSides(text);
      if (MARKER.test(resolved)) {
        await git(["merge", "--abort"]);
        return { merged: false, files: conflicted, reason: `${f} could not be resolved by keeping both sides` };
      }
      await write(f, resolved);
    }
    await git(["add", "--", f]);
  }
  const c = await git(["commit", "--no-edit", "-m", message]);
  if (!c.ok) {
    await git(["merge", "--abort"]);
    return { merged: false, files: conflicted, reason: `the merge commit was refused${c.stderr ? `: ${c.stderr.split("\n")[0]}` : ""}` };
  }
  return { merged: true, files: conflicted };
}
