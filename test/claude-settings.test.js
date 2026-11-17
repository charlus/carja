// test/claude-settings.test.js
//
// F7 (owner, 2026-11-17): "we need to get rid of these claude rules, it
// frustrates me, a lot." Claude Code's auto mode blocked the agent from writing
// the owner's answer in a question file. An allow rule in the project's
// .claude/settings.json is decided before auto mode's check, so `init` and
// `upgrade` add Carja's rules there, next to the owner's own.

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync, mkdirSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";

import { CARJA_ALLOW, mergeAllowRules } from "../src/claude-settings.js";

const REPO = new URL("..", import.meta.url).pathname;
const carja = (...a) => execFileSync("node", [join(REPO, "bin/carja.js"), ...a], { stdio: "pipe" }).toString();

test("the rules cover the carja/ folder and the carja command, nothing else", () => {
  assert.ok(CARJA_ALLOW.length > 0);
  for (const r of CARJA_ALLOW) assert.match(r, /^(Edit|Write)\(.*carja\/\*\*\)$|^Bash\(carja[ :]\*?/, r);
});

test("merge: adds the missing rules, keeps everything else, and is idempotent", () => {
  const own = { permissions: { allow: ["Bash(npm test)"], deny: ["Read(.env)"] }, model: "x" };
  const first = mergeAllowRules(own);
  assert.deepEqual(first.added, CARJA_ALLOW);
  assert.deepEqual(first.settings.permissions.allow, ["Bash(npm test)", ...CARJA_ALLOW]);
  assert.deepEqual(first.settings.permissions.deny, ["Read(.env)"]);
  assert.equal(first.settings.model, "x");
  assert.deepEqual(own.permissions.allow, ["Bash(npm test)"], "the input is not changed");
  assert.deepEqual(mergeAllowRules(first.settings).added, []);
});

test("merge: a rule the owner denies or asks for is never added", () => {
  const { added, settings } = mergeAllowRules({ permissions: { deny: [CARJA_ALLOW[0]], ask: [CARJA_ALLOW[1]] } });
  assert.ok(!added.includes(CARJA_ALLOW[0]) && !added.includes(CARJA_ALLOW[1]));
  assert.ok(!settings.permissions.allow.includes(CARJA_ALLOW[0]));
});

test("init writes the rules; upgrade keeps the owner's settings, adds the rules, and commits the file", () => {
  const base = mkdtempSync(join(tmpdir(), "claude-settings-"));
  try {
    const dir = join(base, "p");
    carja("init", dir, "--all", "--no-detect");
    const read = () => JSON.parse(readFileSync(join(dir, ".claude/settings.json"), "utf8"));
    assert.deepEqual(read().permissions.allow, CARJA_ALLOW);

    const G = (...a) => execFileSync("git", a, { cwd: dir, stdio: "pipe" }).toString().trim();
    G("init", "-q", "-b", "main");
    G("config", "user.email", "t@t");
    G("config", "user.name", "t");
    writeFileSync(join(dir, ".claude/settings.json"), JSON.stringify({ permissions: { allow: ["Bash(make)"] }, env: { A: "1" } }, null, 2));
    G("add", "-A");
    execFileSync("git", ["commit", "-qm", "init"], { cwd: dir, stdio: "pipe", env: { ...process.env, CARJA_NO_PROTECTED: "test" } });
    carja("upgrade", dir);
    const s = read();
    assert.deepEqual(s.permissions.allow, ["Bash(make)", ...CARJA_ALLOW]);
    assert.deepEqual(s.env, { A: "1" });
    assert.equal(G("status", "--porcelain", "--", ".claude/settings.json"), "", "the upgrade commit carries the file");
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});

test("a settings file that is not valid JSON is left alone, with a warning", () => {
  const base = mkdtempSync(join(tmpdir(), "claude-settings-"));
  try {
    const dir = join(base, "p");
    mkdirSync(join(dir, ".claude"), { recursive: true });
    writeFileSync(join(dir, ".claude/settings.json"), "{ not json");
    const out = carja("init", dir, "--all", "--no-detect");
    assert.equal(readFileSync(join(dir, ".claude/settings.json"), "utf8"), "{ not json");
    assert.match(out, /\.claude\/settings\.json is not valid JSON/);
    assert.ok(existsSync(join(dir, "AGENTS.md")), "init goes on");
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});
