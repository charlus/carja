// src/commands/watch.js — `carja watch [dir] [--once]` (Loop Monitor M2).
//
// What the latest loop run is doing, from its event log: each item, the beat
// in progress (stage, model, minutes so far), the last recorded fact, the run's
// beats and cost. Refreshes every 2 seconds in a terminal and stops once the
// run has ended; `--once` (or no terminal) prints one screen.

import { readFile } from "node:fs/promises";
import { join, resolve, basename } from "node:path";
import { execFileSync } from "node:child_process";
import { readEvents, watchModels, renderWatchAll, EVENTS_FILE } from "../loop/events.js";
import { isPidAlive } from "../loop/reconcile.js";
import { BEAT_LOG_DIR } from "../loop/beat-log.js";

function eventsPath(root) {
  try {
    const common = execFileSync("git", ["rev-parse", "--path-format=absolute", "--git-common-dir"], { cwd: root, stdio: ["ignore", "pipe", "ignore"] }).toString().trim();
    return join(common, BEAT_LOG_DIR, EVENTS_FILE);
  } catch {
    return null;
  }
}

async function towerScreen(roots, now, { color = false } = {}) {
  const { access } = await import("node:fs/promises");
  const { readRounds } = await import("./status.js");
  const { renderTower } = await import("../loop/tower.js");
  const products = [];
  for (const root of roots) {
    if (!(await access(root).then(() => true, () => false))) continue;
    const path = eventsPath(root);
    const models = watchModels(readEvents(path ? await readFile(path, "utf8").catch(() => "") : ""), { isAlive: isPidAlive });
    const rounds = await readRounds(root).catch(() => ({ waiting: [] }));
    // One row per live run: two `carja loop <project>` runs in one folder show as two.
    if (!models.length) products.push({ name: basename(root), root, model: null, waiting: rounds.waiting });
    models.forEach((model, i) =>
      products.push({ name: model.project ? `${basename(root)} · ${model.project}` : basename(root), root, model, waiting: i === 0 ? rounds.waiting : [] })
    );
  }
  return renderTower(products, now, { color });
}

export async function watchCommand(args, { cwd, stdout }) {
  // The watch tower: every product the loop works on, or the folders named.
  const dirs = args.filter((a) => !a.startsWith("-"));
  if (args.includes("--all") || dirs.length > 1) {
    const { listLoopProjects } = await import("../loop/projects-registry.js");
    const roots = args.includes("--all") ? await listLoopProjects() : dirs.map((d) => resolve(cwd, d));
    if (!(stdout.isTTY && !args.includes("--once"))) {
      stdout.write(await towerScreen(roots, Date.now()));
      return 0;
    }
    for (;;) {
      const color = !process.env.NO_COLOR && !args.includes("--no-color");
      stdout.write(`\x1b[2J\x1b[H${await towerScreen(roots, Date.now(), { color })}\n  Ctrl-C to leave\n`);
      await new Promise((r) => setTimeout(r, 3000));
    }
  }
  const dir = dirs[0];
  const root = resolve(cwd, dir || ".");
  const path = eventsPath(root);
  const models = async () => watchModels(readEvents(path ? await readFile(path, "utf8").catch(() => "") : ""), { isAlive: isPidAlive });
  const screen = async () => renderWatchAll(await models(), Date.now());
  const live = stdout.isTTY && !args.includes("--once");
  if (!live) {
    stdout.write(await screen());
    return 0;
  }
  for (;;) {
    const text = await screen();
    stdout.write(`\x1b[2J\x1b[H  carja watch · ${root} · Ctrl-C to leave\n\n${text}`);
    const ms = await models();
    if (!ms.length || ms.every((m) => m.ended)) return 0;
    await new Promise((r) => setTimeout(r, 2000));
  }
}
