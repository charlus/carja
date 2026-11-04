// test/parallel-sessions.test.js
//
// F10 — parallel sessions do not collide on carja/ state.
//
// Real usage (autopportunity, eurassistant, 2026-10): two sessions each added a
// ship-log entry on their own branch and the merge request then conflicted
// ("!21 has conflict"); one session switched the branch of the shared checkout
// while another was working in it.
//
// The append-only logs merge with git's built-in union driver: both entries are
// kept, no conflict. Checked with a real git merge.

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync, spawnSync } from "node:child_process";
import { ensureUnionMerge, UNION_PATHS } from "../src/gitattributes.js";

const ROOT = new URL("..", import.meta.url).pathname;
const g = (cwd, ...a) => execFileSync("git", ["-c", "user.email=t@t", "-c", "user.name=t", ...a], { cwd, encoding: "utf8", stdio: "pipe" });

test("ensureUnionMerge adds each log once and keeps the user's lines", () => {
  const dir = mkdtempSync(join(tmpdir(), "cond-ga-"));
  writeFileSync(join(dir, ".gitattributes"), "*.png binary\n");
  assert.equal(ensureUnionMerge(dir), true);
  assert.equal(ensureUnionMerge(dir), false, "a second run adds nothing");
  const text = readFileSync(join(dir, ".gitattributes"), "utf8");
  assert.match(text, /^\*\.png binary$/m);
  for (const p of UNION_PATHS) assert.equal(text.split("\n").filter((l) => l.startsWith(`${p} `)).length, 1, p);
  assert.ok(UNION_PATHS.includes("carja/0-compass/ship-log.md"));
});

test("two branches that each add a ship-log entry merge without conflict", () => {
  const dir = mkdtempSync(join(tmpdir(), "cond-union-"));
  mkdirSync(join(dir, "carja", "0-compass"), { recursive: true });
  const log = join(dir, "carja", "0-compass", "ship-log.md");
  writeFileSync(log, "# Ship Log\n\n## 2026-10-01 — Old\n- done\n");
  g(dir, "init", "-q", "-b", "main");
  ensureUnionMerge(dir);
  g(dir, "add", "-A");
  g(dir, "commit", "-q", "-m", "base");
  for (const [branch, title] of [["a", "Alpha"], ["b", "Beta"]]) {
    g(dir, "switch", "-q", "-c", branch, "main");
    writeFileSync(log, readFileSync(log, "utf8").replace("# Ship Log\n\n", `# Ship Log\n\n## 2026-10-13 — ${title}\n- shipped\n\n`));
    g(dir, "commit", "-q", "-am", title);
  }
  g(dir, "switch", "-q", "main");
  g(dir, "merge", "-q", "a");
  const r = spawnSync("git", ["-c", "user.email=t@t", "-c", "user.name=t", "merge", "-q", "--no-edit", "b"], { cwd: dir, encoding: "utf8" });
  assert.equal(r.status, 0, r.stdout + r.stderr);
  const merged = readFileSync(log, "utf8");
  assert.match(merged, /Alpha/);
  assert.match(merged, /Beta/);
  assert.match(merged, /Old/);
});

test("Ship and the git workflow never switch the branch of a shared checkout", () => {
  const ship = readFileSync(join(ROOT, "templates", ".agents", "workflows", "ship.md"), "utf8");
  const gw = readFileSync(join(ROOT, "templates", ".agents", "skills", "git-workflow", "SKILL.md"), "utf8");
  for (const doc of [ship, gw]) {
    assert.match(doc, /worktree/i);
    assert.match(doc, /never switch the branch of (a|the) shared checkout/i);
  }
});
