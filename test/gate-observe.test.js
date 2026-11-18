// test/gate-observe.test.js — F8: carja status counts what observe-mode gates would have blocked.
import { test } from "node:test";
import assert from "node:assert/strict";

import { summariseObserved } from "../src/gate-observe.js";
import { renderStatus } from "../src/view/status.js";

const NOW = Date.parse("2026-11-18T12:00:00");
const LOG = ["2026-11-17 10:00\ttdd\titem\tabc", "2026-11-18 09:00\ttdd\titem\tabd", "2026-11-18 09:30\teval\titem\tabe", "2026-09-01 09:30\teval\told\tabf", "junk"].join("\n");

test("observed blocks of the last 30 days, per gate, most first", () => {
  assert.deepEqual(summariseObserved(LOG, { now: NOW }), { count: 3, days: 30, byGate: [{ gate: "tdd", count: 2 }, { gate: "eval", count: 1 }] });
  assert.equal(summariseObserved("", { now: NOW }).count, 0);
});

test("carja status shows what observe-mode gates would have blocked", async () => {
  const { mkdtemp, mkdir, writeFile, rm } = await import("node:fs/promises");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const { execFileSync } = await import("node:child_process");
  const { collectState } = await import("../src/carja-state.js");
  const d = await mkdtemp(join(tmpdir(), "carja-observe-"));
  try {
    await mkdir(join(d, "carja/0-compass"), { recursive: true });
    await mkdir(join(d, "carja/1-workbench"), { recursive: true });
    await writeFile(join(d, "carja/0-compass/ship-log.md"), "# Ship Log\n");
    await writeFile(join(d, "carja.config.json"), "{}\n");
    execFileSync("git", ["init", "-q", "-b", "work"], { cwd: d });
    const today = new Date().toISOString().slice(0, 16).replace("T", " ");
    await writeFile(join(d, ".git/carja-gate-observe.log"), `${today}\ttdd\twork\tabc\n${today}\ttdd\twork\tabd\n`);
    const out = renderStatus((await collectState(d)).state, { color: false });
    assert.match(out, /Observed\s+2 in 30 days · tdd ×2 \(would have blocked/);
  } finally {
    await rm(d, { recursive: true, force: true });
  }
});
