// src/loop/merge-stack.js
//
// `carja merge-stack <project>` (owner, 2026-11-17): "If I could I'll just
// delegate the post carja loop to an agent." The owner runs it, or tells their
// agent to: one command merges a stacked run's MRs in order, bottom first.
//
// It merges through the forge's MR API only, never a push to the default
// branch, and only when the owner runs it, or at the end of `carja loop <project>`
// for the items below the owner's risk.owner_review (src/loop/risk.js). For
// each item, bottom first: the code MR, then the Carja state MR, each one
//   - moved to the default branch when it still targets the item below,
//   - merged only when its pipeline is green (it waits for a running one) and
//     the forge shows no conflict,
//   - merged without squashing (the items above are built on its commits),
//     at the head it checked, its source branch deleted.
// It stops before an item that needs the owner (owner actions, documents
// merged from both sides, a high-risk decision; with a risk block in
// carja.config.json, an item whose tier the owner reviews: src/loop/risk.js),
// at the first red pipeline,
// conflict or closed MR, and after an item the owner confirmed, so the owner
// does that item's after-merge steps before anything above it lands.
//
// The walk is pure over an injected forge: {status(url), merge(url, {head, source}), retarget(url, base)}.

import { ownerActionsOf } from "./stack.js";
import { needsOwnerReview } from "./risk.js";

const sp = (n) => (n === 1 ? "" : "s");

/** "!85" on GitLab, "#7" on GitHub, else the URL. */
export function shortRef(url) {
  const gl = String(url ?? "").match(/\/merge_requests\/(\d+)/);
  if (gl) return `!${gl[1]}`;
  const gh = String(url ?? "").match(/\/pull\/(\d+)/);
  return gh ? `#${gh[1]}` : String(url);
}

/** What the owner does or reads before an item is merged. [] when the item can be merged without them. */
export function ownerNeeds(e) {
  const out = [];
  const actions = ownerActionsOf(e);
  if (actions.length) out.push(...actions);
  if (e.docsMerged?.length) out.push(`Read the Carja documents the loop merged from both sides, in the MR: ${e.docsMerged.map((f) => `\`${f}\``).join(", ")}.`);
  for (const r of e.rulings ?? []) {
    if (r?.risk === "high" && (r.decision || r.text)) out.push(`A high-risk decision was taken for you: ${r.decision ?? r.text}. Overrule it in the MR, or accept it.`);
  }
  return out;
}

/**
 * What stops the walk before an item, under the project's risk block
 * (src/loop/risk.js). Without the block: ownerNeeds, as before. With it: an
 * item below the owner's review level merges without them, and one at or above
 * it waits with the reason first, then its owner steps.
 */
export function needsUnder(risk) {
  if (!risk?.configured) return ownerNeeds;
  return (e) => {
    const why = needsOwnerReview(e, risk);
    return why.length ? [...why, ...ownerNeeds(e)] : [];
  };
}

const RUNNING = new Set(["running", "pending", "created", "waiting_for_resource", "preparing", "scheduled"]);

/**
 * Walk the stack, bottom first.
 * @param {{project: string, entries: object[], forges: {outer: object, code: object|null}, defaults: {outer: string, code: string|null},
 *   confirm?: number|null, dryRun?: boolean, waitMs?: number, pollMs?: number, sleep?: (ms: number) => Promise<void>, needsOf?: (e: object) => string[]}} input
 * @returns {Promise<{code: 0|1|2, lines: string[], next: string, merged: string[]}>}
 *   code 0: every item is merged (dry run: every item can be); 2: the owner must act; 1: a problem stopped the walk.
 */
export async function walkStack({ project, entries, forges, defaults, confirm = null, dryRun = false, waitMs = 20 * 60_000, pollMs = 20_000, sleep = (ms) => new Promise((r) => setTimeout(r, ms)), needsOf = ownerNeeds }) {
  const items = entries.filter((e) => !e.merged);
  const lines = [];
  const merged = [];
  const cmd = `carja merge-stack ${project}`;
  let code = 0;
  let next = null;
  const stop = (c, line, n) => {
    lines.push(line);
    return { code: c, lines, next: n, merged };
  };
  if (!items.length) return { code: 0, lines: [`${project}: no MR waits for a merge.`], next: "Next: nothing.", merged };
  lines.push(`${project}: ${items.length} item${sp(items.length)}, bottom first.${dryRun ? " Dry run: nothing is merged." : ""}`);

  for (let i = 0; i < items.length; i++) {
    const n = i + 1;
    const e = items[i];
    const label = `${n}. ${e.title}`;
    const sides = [...(e.code ? [{ key: "code", ...e.code }] : []), { key: "outer", ...e.outer }];
    const forgeOf = (s) => forges[s.key];
    const read = async (s) => (forgeOf(s) ? forgeOf(s).status(s.url) : null);

    let st = [];
    for (const s of sides) st.push(await read(s));
    const missing = sides.find((s, k) => !st[k]);
    if (missing) return stop(1, `${label}: stopped. The forge does not answer for ${missing.url ?? "its MR (no URL recorded)"}.`, `Next: check \`${missing.key === "code" ? "the code repository's" : "this repository's"}\` forge login, then run \`${cmd}\` again.`);
    if (st.every((x) => x.state === "merged")) {
      lines.push(`${label}: already merged.`);
      continue;
    }
    const closed = sides.find((s, k) => st[k].state === "closed");
    if (closed) return stop(1, `${label}: closed without a merge (${closed.url}).`, `Next: \`carja loop ${project}\` builds it again, with everything above it.`);

    const needs = needsOf(e);
    const confirmed = confirm === n;
    if (needs.length && !confirmed) {
      const block = [`${label}: needs you before the merge:`, ...needs.map((a) => `   - ${a}`)].join("\n");
      if (!dryRun) return stop(2, block, `Next: do the steps above that come before the merge, then run \`${cmd} --confirm ${n}\`.`);
      // The dry run details the first item the walk will stop at; the others come one at a time.
      lines.push(next ? `${label}: needs you before the merge (${needs.length} step${sp(needs.length)}).` : block);
      code = Math.max(code, 2);
      next ??= `Next: \`${cmd}\` merges up to item ${n}. Do its steps before the merge, then \`${cmd} --confirm ${n}\`.`;
      continue;
    }

    if (dryRun) {
      const problems = [];
      sides.forEach((s, k) => {
        const x = st[k];
        if (x.state === "merged") return;
        if (x.conflict) problems.push(`${s.url} has a conflict`);
        else if (x.pipeline === "failed") problems.push(`the pipeline of ${s.url} failed`);
        else if (x.pipeline === "manual") problems.push(`the pipeline of ${s.url} waits on a manual job`);
        else if (RUNNING.has(x.pipeline) || x.pipeline === "running") problems.push(`the pipeline of ${s.url} is running`);
      });
      if (problems.some((p) => !p.endsWith("is running"))) {
        lines.push(`${label}: blocked. ${problems.join(", ")}.`);
        code = 1;
        next = `Next: fix the item on its branch, or rerun its pipeline, then \`${cmd} --dry-run\` again.`;
      } else lines.push(`${label}: ready${problems.length ? ` once ${problems.join(", ")}` : ""} (${sides.map((s) => shortRef(s.url)).join(" + ")}).`);
      continue;
    }

    for (let k = 0; k < sides.length; k++) {
      const s = sides[k];
      if (st[k].state === "merged") continue;
      const f = forgeOf(s);
      const base = defaults[s.key];
      if (st[k].target !== base) {
        const r = await f.retarget(s.url, base);
        if (!r?.ok) return stop(1, `${label}: stopped. ${s.url} still targets ${st[k].target ?? "the item below"} and the forge refused to move it to ${base}${r?.reason ? `: ${r.reason}` : ""}.`, `Next: change its target to ${base} on the forge, then run \`${cmd}\` again.`);
        st[k] = await read(s);
      }
      // Wait for a running pipeline, or for the forge to compute mergeability.
      let waited = 0;
      while (st[k] && (RUNNING.has(st[k].pipeline) || st[k].checking) && waited < waitMs) {
        await sleep(pollMs);
        waited += pollMs;
        st[k] = await read(s);
      }
      const x = st[k];
      const partial = k > 0 ? ` ${shortRef(sides[0].url)} is merged, ${shortRef(s.url)} is not.` : "";
      if (!x) return stop(1, `${label}: stopped. The forge does not answer for ${s.url}.${partial}`, `Next: run \`${cmd}\` again.`);
      if (x.conflict) return stop(1, `${label}: stopped. ${s.url} has a conflict.${partial}`, `Next: resolve it on the forge (in Carja documents, keep both sides; in code, it is your decision), then run \`${cmd}\` again.`);
      if (x.pipeline === "failed") return stop(1, `${label}: stopped. The pipeline of ${s.url} failed.${partial}`, `Next: rerun the pipeline or push a fix to the branch, then run \`${cmd}\` again.`);
      if (x.pipeline === "manual") return stop(1, `${label}: stopped. The pipeline of ${s.url} waits on a manual job.${partial}`, `Next: run or skip the job on the forge, then run \`${cmd}\` again.`);
      if (RUNNING.has(x.pipeline) || x.checking) return stop(1, `${label}: stopped. The pipeline of ${s.url} is still running after ${Math.round(waitMs / 60_000)} min.${partial}`, `Next: run \`${cmd}\` again when it ends.`);

      let r = await f.merge(s.url, { head: x.head, source: x.source ?? s.branch });
      if (!r?.ok) {
        await sleep(pollMs);
        const again = await read(s);
        if (again?.state === "open" && again.head === x.head && again.pipeline !== "failed" && !again.conflict) r = await f.merge(s.url, { head: x.head, source: x.source ?? s.branch });
      }
      let after = await read(s);
      for (let t = 0; after?.state !== "merged" && t < 3; t++) {
        await sleep(pollMs);
        after = await read(s);
      }
      if (after?.state !== "merged") return stop(1, `${label}: stopped. The forge did not merge ${s.url}${r?.reason ? `: ${r.reason}` : ""}.${partial}`, `Next: read the MR on the forge, then run \`${cmd}\` again.`);
      merged.push(s.url);
    }
    lines.push(`${label}: merged ${sides.map((s) => shortRef(s.url)).join(" + ")}.`);
    if (needs.length) return stop(2, `   Now do its steps that come after the merge:\n${needs.map((a) => `   - ${a}`).join("\n")}`, `Next: do the steps of item ${n} that come after its merge, then run \`${cmd}\` for the rest.`);
  }

  if (dryRun) return { code, lines, next: next ?? `Next: \`${cmd}\` merges them.`, merged };
  return { code: 0, lines, next: `Next: deploy and test the product. Then \`git pull\` in this folder (it removes the merged items' worktrees), and \`carja loop ${project}\` if the project has items left to build.`, merged };
}

// ---- The forges ----------------------------------------------------------

const ghPipeline = (checks) => {
  if (!Array.isArray(checks) || !checks.length) return "none";
  const bad = new Set(["FAILURE", "CANCELLED", "TIMED_OUT", "ACTION_REQUIRED", "STARTUP_FAILURE", "ERROR"]);
  if (checks.some((c) => bad.has(String(c.conclusion ?? "").toUpperCase()) || bad.has(String(c.state ?? "").toUpperCase()))) return "failed";
  if (checks.some((c) => (c.status != null && String(c.status).toUpperCase() !== "COMPLETED") || ["PENDING", "EXPECTED"].includes(String(c.state ?? "").toUpperCase()))) return "running";
  return "success";
};

/** GitHub through `gh`. `run(cmd, argv)` runs in the repository the MR belongs to. */
export function ghForge(run) {
  return {
    async status(url) {
      const r = await run("gh", ["pr", "view", url, "--json", "state,baseRefName,headRefName,headRefOid,mergeable,statusCheckRollup"]);
      if (!r.ok) return null;
      try {
        const p = JSON.parse(r.stdout);
        return {
          state: String(p.state).toLowerCase(),
          target: p.baseRefName ?? null,
          source: p.headRefName ?? null,
          head: p.headRefOid ?? null,
          pipeline: ghPipeline(p.statusCheckRollup),
          conflict: p.mergeable === "CONFLICTING",
          checking: false,
        };
      } catch {
        return null;
      }
    },
    async merge(url, { head, source }) {
      // No --delete-branch: gh would also delete and switch the local branch.
      const r = await run("gh", ["pr", "merge", url, "--merge", "--match-head-commit", head]);
      if (!r.ok) return { ok: false, reason: (r.stderr || r.stdout || "").trim().slice(-300) };
      if (source) await run("gh", ["api", "-X", "DELETE", `repos/{owner}/{repo}/git/refs/heads/${source}`]);
      return { ok: true };
    },
    async retarget(url, base) {
      const r = await run("gh", ["pr", "edit", url, "--base", base]);
      return r.ok ? { ok: true } : { ok: false, reason: (r.stderr || r.stdout || "").trim().slice(-300) };
    },
  };
}

/** The GitLab API path of an MR URL: {host, path: "projects/<id>/merge_requests/<iid>"}, or null. */
export function glabTarget(url) {
  const m = String(url ?? "").match(/^https?:\/\/([^/]+)\/(.+?)\/-\/merge_requests\/(\d+)/);
  return m ? { host: m[1], path: `projects/${encodeURIComponent(m[2])}/merge_requests/${m[3]}` } : null;
}

const GL_CHECKING = new Set(["checking", "unchecked", "preparing", "approvals_syncing"]);
const glPipeline = (p) => {
  const s = p?.status;
  if (!s) return "none";
  if (s === "success" || s === "skipped") return "success";
  if (s === "failed" || s === "canceled") return "failed";
  if (s === "manual") return "manual";
  return "running";
};

/** GitLab through `glab api`, on the MR's own project and host. */
export function glabForge(run) {
  const api = async (url, extra) => {
    const t = glabTarget(url);
    if (!t) return { ok: false, stdout: "", stderr: `not a GitLab MR URL: ${url}` };
    return run("glab", ["api", "--hostname", t.host, ...extra(t.path)]);
  };
  return {
    async status(url) {
      const r = await api(url, (p) => [p]);
      if (!r.ok) return null;
      try {
        const m = JSON.parse(r.stdout);
        return {
          state: m.state === "opened" || m.state === "locked" ? "open" : m.state,
          target: m.target_branch ?? null,
          source: m.source_branch ?? null,
          head: m.sha ?? null,
          pipeline: glPipeline(m.head_pipeline),
          conflict: Boolean(m.has_conflicts) || m.detailed_merge_status === "conflict",
          checking: GL_CHECKING.has(m.detailed_merge_status ?? m.merge_status),
        };
      } catch {
        return null;
      }
    },
    async merge(url, { head }) {
      const r = await api(url, (p) => ["-X", "PUT", `${p}/merge`, "-F", "squash=false", "-F", "should_remove_source_branch=true", "-f", `sha=${head}`]);
      return r.ok ? { ok: true } : { ok: false, reason: (r.stderr || r.stdout || "").trim().slice(-300) };
    },
    async retarget(url, base) {
      const r = await api(url, (p) => ["-X", "PUT", p, "-f", `target_branch=${base}`]);
      return r.ok ? { ok: true } : { ok: false, reason: (r.stderr || r.stdout || "").trim().slice(-300) };
    },
  };
}

/** The forge adapter for "gh" | "glab", or null. */
export function forgeAdapter(forge, run) {
  if (forge === "gh") return ghForge(run);
  if (forge === "glab") return glabForge(run);
  return null;
}
