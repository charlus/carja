// src/loop/tower.js
//
// The watch tower's screen (owner, 2026-10-21: "works great, but is a bit
// dull"). One line per product, running ones first, then the ones waiting for
// the owner, then the finished ones; an elapsed bar on each beat in progress;
// finished items folded to one line with their MR numbers. Colour only on a
// terminal; the same symbols carry the meaning without it. Pure.

const STAGE = { maker: "Build", checker: "Review", ship: "Ship", spec: "Spec", blueprint: "Blueprint" };
const ORDER = { running: 0, waiting: 1, failed: 2, ended: 3, idle: 4 };
const SYMBOL = { running: "▶", waiting: "?", failed: "✖", ended: "✔", idle: "·" };
const ITEM = { active: "●", merged: "✔", questions: "?", escalated: "✖", failed: "✖", queued: "○" };

const hhmm = (iso) => new Date(iso).toTimeString().slice(0, 5);
const mins = (from, now) => Math.max(0, Math.round((now - Date.parse(from)) / 60000));

/** "!52" for a GitLab MR, "#12" for a GitHub PR, else the URL. */
export function mrRef(url) {
  if (!url) return null;
  const gl = url.match(/merge_requests\/(\d+)/);
  if (gl) return `!${gl[1]}`;
  const gh = url.match(/\/pull\/(\d+)/);
  return gh ? `#${gh[1]}` : url;
}

/** Elapsed bar, 10 cells, full at `full` minutes. */
export function bar(minutes, full = 30) {
  const n = Math.min(10, Math.round((minutes / full) * 10));
  return `${"▓".repeat(n)}${"░".repeat(10 - n)}`;
}

function paint(color) {
  const c = (code) => (s) => (color ? `\x1b[${code}m${s}\x1b[0m` : s);
  return { running: c("36"), waiting: c("33"), failed: c("31"), ended: c("32"), idle: c("2"), dim: c("2"), bold: c("1") };
}

/** A product's state from its model and its waiting rounds. */
export function productState(m, waitingCount) {
  if (waitingCount) return "waiting";
  if (!m) return "idle";
  if (!m.ended) return "running";
  if (["awaiting_answers"].includes(m.ended.status)) return "waiting";
  if (["escalated", "failed", "stalled", "budget_exceeded", "max_iterations_exceeded"].includes(m.ended.status)) return "failed";
  return "ended";
}

const shortTask = (t) => String(t).replace(/^(task|bugfix|slice|blueprint|feature):/, "").slice(0, 36);

/**
 * @param {{name: string, root: string, model: object|null, waiting: string[]}[]} products
 */
export function renderTower(products, now, { color = false } = {}) {
  const p = paint(color);
  if (!products.length) return "  No product registered for the loop on this machine. `carja loop on <project>` (or `--backlog`) in a product registers it.\n";
  const rows = products.map((x) => ({ ...x, state: productState(x.model, x.waiting.length) })).sort((a, b) => ORDER[a.state] - ORDER[b.state]);
  const count = (s) => rows.filter((r) => r.state === s).length;
  const cost = rows.reduce((s, r) => s + (r.model?.cost ?? 0), 0);
  const head = [
    `${rows.length} product${rows.length === 1 ? "" : "s"}`,
    p.running(`▶ ${count("running")} running`),
    p.waiting(`? ${count("waiting")} waiting for you`),
    p.ended(`✔ ${count("ended")} done`),
    ...(count("failed") ? [p.failed(`✖ ${count("failed")} stopped`)] : []),
    `≈ $${cost.toFixed(2)} at list price`,
  ].join(" · ");
  const out = [` ${p.bold("CARJA watch tower")} · ${new Date(now).toTimeString().slice(0, 5)} · ${head}`, ""];
  for (const r of rows) {
    const m = r.model;
    const sym = p[r.state](SYMBOL[r.state]);
    const name = p.bold(r.name.padEnd(18));
    let summary;
    if (!m) summary = p.dim("no run yet");
    else if (m.ended) summary = `ended ${hhmm(m.ended.at)} ${m.ended.status} · ${mins(m.started, Date.parse(m.ended.at))} min · ${m.beats} beats · $${m.cost.toFixed(2)}`;
    else summary = `started ${hhmm(m.started)} · ${mins(m.started, now)} min · ${m.beats} beats · $${m.cost.toFixed(2)}`;
    out.push(` ${sym} ${name} ${summary}`);
    for (const w of r.waiting) out.push(`     ${p.waiting("?")} question round waiting for you → ${w}`);
    if (!m) continue;
    if (!m.items.length && !m.ended) out.push(p.dim(`     ○ ${m.planned.length} item${m.planned.length === 1 ? "" : "s"} queued, no beat yet`));
    for (const it of m.items) {
      const label = shortTask(it.task).padEnd(36);
      const history = Object.entries(it.beats).map(([k, n]) => `${n} ${STAGE[k] ?? k}`).join(", ");
      const trouble = [it.red && `${it.red} red verify`, it.rejected && `${it.rejected} rejected review`].filter(Boolean).join(", ");
      if (it.active) {
        const a = it.active;
        const el = mins(a.since, now);
        out.push(`     ${p.running(ITEM.active)} ${label} ${STAGE[a.kind] ?? a.kind} ${p.running(bar(el))} ${el} min${a.model ? ` · ${a.model}` : ""}${a.steps ? ` · ${a.steps} steps` : ""}`);
        if (a.lastStep) out.push(p.dim(`         last step ${hhmm(a.lastStep.at)}  ${a.lastStep.text.slice(0, 100)}`));
        if (history) out.push(p.dim(`         so far: ${history}${trouble ? ` (${trouble})` : ""}`));
      } else if (it.done === "merged") {
        const refs = [mrRef(it.mr?.code), it.mr?.code ? `state ${mrRef(it.mr?.url)}` : mrRef(it.mr?.url)].filter(Boolean).join(" + ");
        out.push(`     ${p.ended(ITEM.merged)} ${label} ${refs}${p.dim(` · ${history}${trouble ? ` (${trouble})` : ""}`)}`);
      } else if (it.done) {
        out.push(`     ${p[it.done === "questions" ? "waiting" : "failed"](ITEM[it.done])} ${label} ${it.last?.text ?? it.done}`);
      } else {
        out.push(`     ${p.dim(ITEM.queued)} ${label} ${p.dim(it.last ? `last news ${hhmm(it.last.at)}: ${it.last.text}` : "waiting for its turn")}`);
      }
    }
  }
  return `${out.join("\n")}\n`;
}
