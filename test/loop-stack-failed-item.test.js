// test/loop-stack-failed-item.test.js
//
// An item that failed, then the same command again (field report, 2026-11-25):
// "a slice marked failed is never retried" and "a ship step that fails after
// archiving the slice makes the next run find nothing to build, with no message
// saying why". The Ship beat archives the slice folder in the item's branch. A
// run that failed after that step resumed from that branch, found no open slice
// there, ran no beat and reported the status of the run before, every time.
// The real CLI in the outer layout, the stub engine and the stub `gh`. No model is called.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, rmSync } from "node:fs";
import { join } from "node:path";

import { layout, loop } from "./helpers/stacked-layout.js";

const stack = (l) => JSON.parse(readFileSync(join(l.root, ".git/carja-loop-logs/runs/notes/stack.json"), "utf8"));
const beats = (l, log, heading, slice) =>
  readdirSync(join(l.base, log))
    .filter((f) => f.endsWith(".txt"))
    .map((f) => readFileSync(join(l.base, log, f), "utf8"))
    .filter((p) => p.includes(heading) && p.includes(slice)).length;

test("a Ship beat that failed after it archived the slice: the next run resumes the item at Ship", async () => {
  const l = layout({ carved: 3, prefix: "stack-failed-ship-" });
  try {
    const first = loop(l, ["notes"], "p1", { STUB_SHIP_NO_LOG: "02-slice-2" });
    assert.equal(first.status, 1, first.stdout + first.stderr);
    assert.equal(stack(l).length, 1, "only slice 1 reached an MR");

    const second = loop(l, ["notes"], "p2");
    const out = second.stdout + second.stderr;
    assert.equal(second.status, 0, out);
    assert.match(out, /slice 02-slice-2: .*archived.*resum\w+ at Ship/i, "the run says why it starts at Ship");
    assert.deepEqual(stack(l).map((e) => e.title), ["slice 01-slice-1", "slice 02-slice-2", "slice 03-slice-3"]);
    assert.equal(beats(l, "p2", "# Spec assignment (this beat)", "02-slice-2"), 0, "the spec is not written again");
    assert.equal(beats(l, "p2", "# Loop Assignment (this beat)", "02-slice-2"), 0, "the code is not built again");
    assert.ok(beats(l, "p2", "# Ship assignment (this beat)", "02-slice-2") >= 1, "the Ship beat runs again");
  } finally {
    rmSync(l.base, { recursive: true, force: true });
  }
});

test("a slice whose build failed is built again by the next run", async () => {
  const l = layout({ carved: 2, prefix: "stack-failed-build-" });
  try {
    const first = loop(l, ["notes"], "p1", { STUB_BUILD_IDLE: "02-slice-2" });
    assert.equal(first.status, 1, first.stdout + first.stderr);
    assert.equal(stack(l).length, 1);

    const second = loop(l, ["notes"], "p2");
    assert.equal(second.status, 0, second.stdout + second.stderr);
    assert.deepEqual(stack(l).map((e) => e.title), ["slice 01-slice-1", "slice 02-slice-2"]);
  } finally {
    rmSync(l.base, { recursive: true, force: true });
  }
});
