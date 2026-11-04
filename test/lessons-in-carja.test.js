// test/lessons-in-carja.test.js
//
// F8 — lessons go to carja/, not to one agent's private memory.
//
// Real usage (website, 2026-10): after a correction the agent said "I have saved
// that as a working rule for future sessions" — in its harness memory. The
// product owner: "If it is in your own memory that useless, you are not the
// only one working on the project, the more robust way to do it is in the
// carja files." In autopportunity and eurassistant the "build without
// checkpoints" rule also lived only in agent memories. Nothing in the always-on
// block said where a lesson belongs.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { buildFrameworkBlock } from "../src/agents-md.js";

const ROOT = new URL("..", import.meta.url).pathname;
const SRC = readFileSync(join(ROOT, "templates", ".agents", "AGENTS.md"), "utf8");

test("the always-on block says lessons go to carja/, not harness memory", async () => {
  const block = await buildFrameworkBlock(join(ROOT, "templates", ".agents"));
  for (const text of [SRC, block]) {
    assert.match(text, /lesson/i);
    assert.match(text, /4-context\/technical\/coding-patterns\.md/);
    assert.match(text, /4-context\/meta\/decision-log\.md/);
    assert.match(text, /(harness|your own|private) memory/i);
  }
});
