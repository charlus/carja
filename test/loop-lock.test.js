// test/loop-lock.test.js
//
// The single-holder run lock (src/loop/lock.js): one `carja loop` process per
// target. The decision is pure — given the existing lock text and an is-that-pid-
// alive predicate — so it is exercised here without touching the filesystem.

import { test } from "node:test";
import assert from "node:assert/strict";
import { parseLock, renderLock, lockDecision } from "../src/loop/lock.js";

test("parseLock: valid, missing, and corrupt bodies", () => {
  assert.deepEqual(parseLock('{"pid":123,"at":"2026-01-01T00:00:00Z"}'), {
    pid: 123,
    at: "2026-01-01T00:00:00Z",
  });
  assert.equal(parseLock(""), null);
  assert.equal(parseLock(null), null);
  assert.equal(parseLock("not json"), null);
  assert.equal(parseLock('{"pid":0}'), null); // non-positive pid
  assert.equal(parseLock('{"pid":"x"}'), null); // non-numeric pid
  assert.deepEqual(parseLock('{"pid":7}'), { pid: 7, at: null }); // missing timestamp ok
});

test("renderLock round-trips through parseLock", () => {
  const body = renderLock(4242, "2026-07-23T00:00:00Z");
  assert.match(body, /\n$/);
  assert.deepEqual(parseLock(body), { pid: 4242, at: "2026-07-23T00:00:00Z" });
});

test("lockDecision: absent or corrupt lock → acquire", () => {
  assert.deepEqual(lockDecision({ existingText: "", isAlive: () => true }), { acquire: true });
  assert.deepEqual(lockDecision({ existingText: "garbage", isAlive: () => true }), { acquire: true });
});

test("lockDecision: live owner → refuse with heldByPid", () => {
  const d = lockDecision({ existingText: '{"pid":999}', isAlive: (p) => p === 999 });
  assert.equal(d.acquire, false);
  assert.equal(d.heldByPid, 999);
});

test("lockDecision: dead owner → steal the stale lock", () => {
  const d = lockDecision({ existingText: '{"pid":555}', isAlive: () => false });
  assert.equal(d.acquire, true);
  assert.equal(d.stale, true);
  assert.equal(d.heldByPid, 555);
});
