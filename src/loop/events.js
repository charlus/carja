// src/loop/events.js
//
// Loop Monitor M1 (docs/roadmap/Loop-Monitor.md): the event log. The driver
// appends one JSON line per event to `<git dir>/carja-loop-logs/events.ndjson`:
// run start and end, each beat's start and end (item, stage, role, model, time,
// cost), verify exit codes, review verdicts, question rounds, escalations, MRs.
// Every view reads this file; nothing else changes. Writing never fails a run.
// R2: a view shows what was recorded, never a guess.

import { appendFile, rename, stat, mkdir } from "node:fs/promises";
import { join } from "node:path";

export const EVENTS_FILE = "events.ndjson";
const ROTATE_BYTES = 5 * 1024 * 1024;

/** An `emit(type, data)` that appends to the run's event log, or does nothing without a directory. */
export function makeEmitter(dir, run, { now = () => Date.now(), runInfo = {} } = {}) {
  if (!dir) return async () => {};
  const path = join(dir, EVENTS_FILE);
  return async (type, data = {}) => {
    try {
      await mkdir(dir, { recursive: true });
      const size = await stat(path).then((s) => s.size).catch(() => 0);
      if (size > ROTATE_BYTES) await rename(path, `${path}.1`).catch(() => {});
      // run_start names the process and the project, so a view can show each live run.
      const info = type === "run_start" ? runInfo : {};
      await appendFile(path, `${JSON.stringify({ run, at: new Date(now()).toISOString(), type, ...info, ...data })}\n`, "utf8");
    } catch {
      /* the monitor is measurement only */
    }
  };
}

/** Parse the log, skipping lines that are not JSON (a line cut by a crash). */
export function readEvents(text) {
  const out = [];
  for (const line of String(text ?? "").split("\n")) {
    if (!line.trim()) continue;
    try {
      out.push(JSON.parse(line));
    } catch {
      /* skip */
    }
  }
  return out;
}

const STAGE_LABEL = { maker: "Build", checker: "Review", ship: "Ship", spec: "Spec", blueprint: "Blueprint" };
const describe = (e) => {
  switch (e.type) {
    case "beat_start":
      return `${STAGE_LABEL[e.kind] ?? e.kind} beat started${e.model ? ` (${e.model})` : ""}`;
    case "beat_end":
      return `${STAGE_LABEL[e.kind] ?? e.kind} beat ended after ${minutes(e.duration_s)}${e.cost_usd != null ? `, $${e.cost_usd.toFixed(2)}` : ""}`;
    case "verify":
      if (e.reused) return "verify reused: same content, already green";
      return `verify exit ${e.exit}${e.duration_s != null ? ` in ${minutes(e.duration_s)}` : ""}`;
    case "verdict":
      return `${e.phase ?? "code"} review ${e.approved ? "approved" : `rejected${e.reason ? `: ${e.reason}` : ""}`}`;
    case "questions":
      return `${e.count} question${e.count === 1 ? "" : "s"} for you`;
    case "escalated":
      return `escalated: ${e.reason ?? ""}`;
    case "merged":
      return `MR opened: ${[e.code_url, e.url].filter(Boolean).join(", ")}`;
    case "failed":
      return `failed: ${e.reason ?? ""}`;
    default:
      return e.type;
  }
};

function minutes(s) {
  if (s == null) return "?";
  return s < 90 ? `${s} s` : `${Math.round(s / 60)} min`;
}

/**
 * What the latest run is doing, from its events. Pure.
 * @returns {{run, started, ended: object|null, items: object[], beats: number, cost: number}}
 */
export function watchModel(events) {
  const last = events.filter((e) => e.type === "run_start").at(-1);
  return last ? runModel(events, last) : null;
}

/**
 * Every live run of the folder (two `carja loop <project>` runs side by
 * side), or the latest run when none is live. A run is live when it has not
 * ended and its process (`pid` in run_start) is alive. Pure but for `isAlive`.
 */
export function watchModels(events, { isAlive = () => false } = {}) {
  const starts = events.filter((e) => e.type === "run_start");
  if (!starts.length) return [];
  const ended = new Set(events.filter((e) => e.type === "run_end").map((e) => e.run));
  const live = starts.filter((s) => !ended.has(s.run) && (s.pid ? isAlive(s.pid) : s === starts.at(-1)));
  return (live.length ? live : [starts.at(-1)]).map((s) => runModel(events, s));
}

function runModel(events, last) {
  const mine = events.filter((e) => e.run === last.run);
  const items = new Map();
  let beats = 0;
  let cost = 0;
  for (const e of mine) {
    if (e.task) {
      const it = items.get(e.task) ?? { task: e.task, active: null, last: null, beats: {}, red: 0, rejected: 0 };
      if (e.type === "beat_start") it.active = { kind: e.kind, model: e.model ?? null, since: e.at };
      if (e.type === "step") {
        if (it.active) {
          it.active.steps = (it.active.steps ?? 0) + 1;
          it.active.lastStep = { at: e.at, text: `${e.tool}${e.detail ? `: ${e.detail}` : ""}` };
        }
        items.set(e.task, it);
        continue;
      }
      if (e.type === "verify" && e.exit !== 0) it.red += 1;
      if (e.type === "verdict" && !e.approved) it.rejected += 1;
      if (e.type === "beat_end") {
        it.beats[e.kind] = (it.beats[e.kind] ?? 0) + 1;
        it.active = null;
        beats += 1;
        cost += e.cost_usd ?? 0;
      }
      it.last = { at: e.at, text: describe(e) };
      if (["merged", "escalated", "failed", "questions"].includes(e.type)) it.done = e.type;
      if (e.type === "merged") it.mr = { url: e.url ?? null, code: e.code_url ?? null };
      items.set(e.task, it);
    }
  }
  const quota = mine.filter((e) => e.type === "quota_wait" || e.type === "quota_resume").at(-1);
  return {
    run: last.run,
    project: last.project ?? null,
    started: last.at,
    ended: mine.find((e) => e.type === "run_end") ?? null,
    items: [...items.values()],
    beats,
    cost,
    planned: last.items ?? [],
    waitingQuota: quota?.type === "quota_wait" ? quota.until : null,
    stack: stackModel(events, last),
  };
}

/**
 * I7 (owner, 2026-10-23: "seems either stuck or still running"): where a
 * stacked run is. Its own events (stack_start, stack_item, stack_end) share the
 * process id with the item runs. Pure.
 * @returns {{project, n, of, item, itemSince, avgMin: number|null, endsAt: string|null, stop: object|null}|null}
 */
export function stackModel(events, run) {
  if (!run?.project || !run.pid) return null;
  const starts = events.filter((e) => e.type === "stack_start" && e.project === run.project && e.pid === run.pid && e.at <= run.at);
  const start = starts.at(-1);
  if (!start) return null;
  const mine = events.filter((e) => e.run === start.run);
  const itemsSeen = mine.filter((e) => e.type === "stack_item");
  const current = itemsSeen.at(-1) ?? null;
  const end = mine.find((e) => e.type === "stack_end") ?? null;
  // A finished item lasted from its stack_item to the next one.
  const spans = itemsSeen.slice(0, -1).map((e, i) => Date.parse(itemsSeen[i + 1].at) - Date.parse(e.at)).filter((ms) => ms > 0);
  const avgMs = spans.length ? spans.reduce((a, b) => a + b, 0) / spans.length : null;
  const left = current ? current.of - current.n + 1 : 0;
  return {
    project: run.project,
    n: current?.n ?? null,
    of: current?.of ?? start.total ?? null,
    item: current?.item ?? null,
    itemSince: current?.at ?? null,
    avgMin: avgMs ? Math.round(avgMs / 60000) : null,
    endsAt: avgMs && current && !end ? new Date(Date.parse(current.at) + avgMs * left).toISOString() : null,
    stop: end ? { status: end.status, item: end.item ?? null, reason: end.reason ?? null, at: end.at } : null,
  };
}

const STOP_WORDS = {
  done: "every item is built: merge the MRs in the order of the loop report",
  awaiting_answers: "an item waits for your answer to a question round",
  awaiting_review: "an item would conflict on merge, or its MR could not be opened",
  escalated: "an item needs something only you can give",
  usage_limit_reached: "the usage limit was reached, and its reset was too far away to wait for",
  halted_isolation: "a worktree was removed under the run; nothing was committed",
  budget_exceeded: "an item used its whole time budget",
  max_iterations_exceeded: "an item used its whole beat budget",
  failed: "an item failed",
  stalled: "an item made no progress",
  interrupted: "you stopped the run",
};

/** A stop status in plain words. */
export function stopInWords(status) {
  return STOP_WORDS[status] ?? `stopped (${status})`;
}

/** One screen for every run `watchModels` returned, each under its project's name. */
export function renderWatchAll(models, now) {
  if (!models.length) return renderWatch(null, now);
  if (models.length === 1 && !models[0].project) return renderWatch(models[0], now);
  return models.map((m) => `  ── ${m.project ?? "whole folder (--from-carja)"} ──\n${renderWatch(m, now)}`).join("\n");
}

const hhmm = (iso) => new Date(iso).toTimeString().slice(0, 5);

/** The watch screen. `now` in ms. */
export function renderWatch(m, now) {
  if (!m) return "  No loop run recorded here yet. Start one with `carja loop . --from-carja`.\n";
  const lines = [];
  // I7: a stacked run says where it is in the project, and when it should end.
  const st = m.stack;
  if (st?.n) {
    const now_ = m.items.find((i) => i.active)?.active;
    lines.push(
      `  ${st.project}: ${st.item ?? "item"} — ${st.n} of ${st.of}` +
        `${now_ ? ` · now: ${STAGE_LABEL[now_.kind] ?? now_.kind} since ${hhmm(now_.since)}` : ""}` +
        `${st.avgMin ? ` · about ${st.avgMin} min per item` : ""}` +
        `${st.endsAt ? ` · should end about ${hhmm(st.endsAt)}` : ""}`
    );
  }
  if (m.waitingQuota) lines.push(`  ⏸  Usage limit reached: waiting until ${hhmm(m.waitingQuota)}, then the same beat runs again.`);
  if (st?.stop) lines.push(`  Last stop ${hhmm(st.stop.at)}: ${st.stop.item ? `${st.stop.item}: ` : ""}${stopInWords(st.stop.status)}${st.stop.reason ? ` (${st.stop.reason})` : ""}.`);
  lines.push(`  Loop run started ${hhmm(m.started)} · ${Math.round((now - Date.parse(m.started)) / 60000)} min · ${m.beats} beat${m.beats === 1 ? "" : "s"} · ≈ $${m.cost.toFixed(2)} at list price`, "");
  if (!m.items.length) lines.push(`  ${m.planned.length} item${m.planned.length === 1 ? "" : "s"} queued, no beat yet.`);
  for (const it of m.items) {
    lines.push(`  ${it.task}`);
    if (it.active) {
      lines.push(`    now: ${STAGE_LABEL[it.active.kind] ?? it.active.kind} beat${it.active.model ? ` on ${it.active.model}` : ""}, ${Math.round((now - Date.parse(it.active.since)) / 60000)} min so far${it.active.steps ? `, ${it.active.steps} step${it.active.steps === 1 ? "" : "s"}` : ""}`);
      if (it.active.lastStep) lines.push(`    last step ${hhmm(it.active.lastStep.at)}: ${it.active.lastStep.text}`);
    }
    const done = Object.entries(it.beats).map(([k, n]) => `${n} ${STAGE_LABEL[k] ?? k}`);
    const trouble = [it.red && `${it.red} red verify`, it.rejected && `${it.rejected} rejected review`].filter(Boolean);
    if (done.length) lines.push(`    so far: ${done.join(", ")}${trouble.length ? ` (${trouble.join(", ")})` : ""}`);
    if (it.last) lines.push(`    last news ${hhmm(it.last.at)}: ${it.last.text}`);
  }
  lines.push("");
  lines.push(m.ended ? `  Run ended ${hhmm(m.ended.at)}: ${m.ended.status}.` : "  Running. Steps come from the engine as they happen (claude); verdicts and MRs when they land.");
  return `${lines.join("\n")}\n`;
}
