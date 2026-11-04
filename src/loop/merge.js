// src/loop/merge.js
//
// PR-gated merge for the loop (ADR-0001 D4 / Phase 4). The driver NEVER pushes to
// a protected branch: on an L3 execution completion it pushes the Maker's worktree
// branch and opens a pull/merge request, gated by the green floor + Checker
// approval already established upstream. A human (or a separate CI merge policy)
// does the actual merge. Reuses the `gh` / `glab` CLIs (the same tools the
// git-hub-cli / git-lab-cli skills use). The caller resolves which one from the
// origin host (config.js resolveForge).
//
// The `git(args) -> {ok, stdout}` runner is injected so the decision + command
// shape are testable without a real remote.

/** Pure: what should happen on completion at this level/phase? */
export function planMergeAction({ autonomyLevel, phase }) {
  const rank = { L0: 0, L1: 1, L2: 2, L3: 3 }[autonomyLevel] ?? 1;
  if (phase === "execution" && rank >= 3) return "pr";
  return "none"; // L1/L2 and non-execution hand off to the human without merging
}

/**
 * F10: a PR/MR title from a backlog item. The item's whole first line ran past
 * GitLab's 255-character limit. Keep the first sentence, without markdown
 * emphasis or the loop's own tags, cut at a word to at most `max` characters.
 */
export function prTitle(text, max = 120) {
  let t = String(text ?? "")
    .replace(/\(loop-ready\)/gi, "")
    .replace(/\*+/g, "")
    .replace(/\s+/g, " ")
    .trim();
  const end = t.search(/[.?](\s|$)/);
  if (end > 0) t = t.slice(0, end).trim();
  if (t.length <= max) return t;
  const cut = t.slice(0, max - 1);
  const atWord = cut.lastIndexOf(" ");
  return `${(atWord > max / 2 ? cut.slice(0, atWord) : cut).trimEnd()}…`;
}

/** F11: the forge has not registered the branch pushed a moment ago. */
const BRANCH_NOT_SEEN = /source[_ ]branch.*(does not exist|not found)|branch .*not found/i;

export const DEFAULT_PR_BODY = "Opened by `carja loop`: verify passed and the independent Checker approved. A human merges.";

/**
 * The argv for opening a PR/MR on the chosen forge (pure — for testing). The
 * driver has already pushed the branch, so no flag may push again: glab's
 * `--fill` does, which re-runs the whole pre-push gate (live evals included) and
 * failed the first real crossing's MR step. Title and body are passed explicitly.
 */
export function prCommand(forge, { branch, title, body = DEFAULT_PR_BODY, base = null, stacked = false }) {
  if (forge === "gh") {
    return ["gh", ["pr", "create", "--head", branch, ...(base ? ["--base", base] : []), "--title", title, "--body", body]];
  }
  if (forge === "glab") {
    // C3-F21: squashed on merge, so the team's history gets one commit named by
    // the MR, not the loop's beat commits. The owner can untick it per MR.
    // A stacked MR is never squashed on merge (the MR above it would show this
    // one's changes again): the loop squashes the code to one commit per item
    // before the push instead. Its source branch is deleted on merge, so GitLab
    // moves the MR above it to the default branch.
    const merge = stacked ? ["--remove-source-branch"] : ["--squash-before-merge"];
    return ["glab", ["mr", "create", "--source-branch", branch, ...(base ? ["--target-branch", base] : []), "--title", title, "--description", body, ...merge, "--yes"]];
  }
  throw new Error(`Unknown forge '${forge}'`);
}

/** The argv to look up an already-open PR/MR for `branch` (pure — for testing). */
export function prLookupCommand(forge, { branch }) {
  if (forge === "gh") {
    return ["gh", ["pr", "list", "--head", branch, "--state", "open", "--json", "url", "--jq", ".[0].url"]];
  }
  if (forge === "glab") {
    return ["glab", ["mr", "list", "--source-branch", branch]];
  }
  throw new Error(`Unknown forge '${forge}'`);
}

/** The last 300 characters of a failed CLI's stderr (else stdout), on one line. */
function cliError(res) {
  const text = String(res?.stderr || res?.stdout || "").replace(/\s+/g, " ").trim();
  return text.length > 300 ? `…${text.slice(-300)}` : text;
}

/** First http(s) URL found in a blob of CLI output, or null. */
function firstUrl(text) {
  return (text || "").trim().split(/\s+/).find((t) => t.startsWith("http")) || null;
}

/**
 * Was a PR/MR already opened for this branch? `create` exits non-zero both on a
 * real failure AND when one already exists (contention / a retried beat), so a
 * bare non-zero must NOT be read as "no PR" — probe before escalating.
 * @returns {Promise<string|null>} the existing PR/MR url, or null if none.
 */
async function findExistingPr(forge, branch, run) {
  try {
    const [cmd, argv] = prLookupCommand(forge, { branch });
    const res = await run(cmd, argv);
    if (!res.ok) return null;
    return firstUrl(res.stdout);
  } catch {
    return null;
  }
}

/**
 * Push the branch and open a PR/MR. Injected IO:
 *   git(args) -> {ok, stdout}
 *   run(cmd, args) -> {ok, stdout}   (for gh/glab)
 *   forge: "gh" | "glab" | null — resolved from the origin host or loop.forge (config.js)
 * @returns {Promise<{ok:boolean, branch?:string, prUrl?:string, reason?:string}>}
 */
export async function openPullRequest({ branch, title, body, git, run, forge, base = null, stacked = false, sleep = (ms) => new Promise((r) => setTimeout(r, ms)) }) {
  title = prTitle(title);
  if (!forge) {
    return { ok: false, reason: "no forge resolved to open a PR (set loop.forge in carja.config.json)" };
  }

  // Push the branch (set upstream). Never touch a protected branch directly.
  let push = await git(["push", "-u", "origin", branch]);
  if (!push.ok) {
    // A leftover same-named loop branch from a PRIOR run (divergent history)
    // rejects a plain non-fast-forward push. carja/loop/* is machine-owned, so
    // refresh our view of the remote ref and replace it with --force-with-lease:
    // this overwrites a stale machine branch but STILL rejects a genuine concurrent
    // push we haven't fetched (lease mismatch). Only then do we give up.
    await git(["fetch", "origin", branch]);
    push = await git(["push", "--force-with-lease", "-u", "origin", branch]);
    if (!push.ok) {
      const detail = cliError(push);
      return { ok: false, branch, reason: `git push failed for ${branch}${detail ? `: ${detail}` : ""}` };
    }
  }

  const [cmd, argv] = prCommand(forge, { branch, title, base, stacked, ...(body ? { body } : {}) });
  let pr = await run(cmd, argv);
  // F11: right after the push, GitLab answered "source_branch does not exist".
  // Give the forge a moment and ask once more.
  if (!pr.ok && BRANCH_NOT_SEEN.test(`${pr.stderr ?? ""} ${pr.stdout ?? ""}`)) {
    await sleep(5000);
    pr = await run(cmd, argv);
  }
  if (!pr.ok) {
    // Don't escalate on a bare non-zero: `create` also fails when a PR already
    // exists for this branch (concurrency / a retried beat). If one is open, the
    // merge genuinely succeeded — reuse it instead of a false-negative reject.
    const existing = await findExistingPr(forge, branch, run);
    if (existing) return { ok: true, branch, prUrl: existing, reused: true };
    // Keep the forge's own words: "failed to open" alone sent the first real
    // crossing to a manual re-run to find the cause.
    const detail = cliError(pr);
    return { ok: false, branch, reason: `${forge} failed to open the PR/MR${detail ? `: ${detail}` : ""}` };
  }
  // gh/glab print the PR/MR URL on stdout.
  const url = firstUrl(pr.stdout);
  return { ok: true, branch, prUrl: url };
}
