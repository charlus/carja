// test/rename-leftovers.test.js
//
// What the 7.0.0 rename missed, found on the owner's checkouts on 2026-11-05:
//   F4  the project card's source stamp names conductor/ paths, so `status` called the card stale
//   F5  a clone that gets the rename by a pull keeps .git/conductor-*: heartbeats, loop logs, ready queue
//   F6  the project card itself sends every session to conductor/ paths that no longer exist

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync, spawnSync } from "node:child_process";
import { rewriteCardBlock } from "../src/rename-migration.js";
import { staleSources } from "../src/project-card.js";

const REPO = new URL("..", import.meta.url).pathname;
const OLD = ["con", "ductor"].join("");
const G = (cwd, ...a) => execFileSync("git", a, { cwd, stdio: "pipe" }).toString().trim();
const carja = (cwd, ...a) => spawnSync("node", [join(REPO, "bin/carja.js"), ...a], { cwd, encoding: "utf8", timeout: 180000 });

const OLD_CARD = [
  "# My app",
  `Notes outside the card keep \`${OLD}/2-backlog/x.md\` as written.`,
  "",
  `<!-- ${OLD}:project-card:begin status=ok -->`,
  "## Read more",
  `- Goals: \`${OLD}/0-compass/north-star.md\``,
  `- Product areas: \`${OLD}/3-product-areas/\``,
  `<!-- ${OLD}:project-card:sources {"${OLD}.config.json#commands":"aaaaaaaaaa","${OLD}/0-compass/north-star.md":"bbbbbbbbbb","pyproject.toml":"cccccccccc"} -->`,
  `<!-- ${OLD}:project-card:end -->`,
  "",
].join("\n");

/** A 7.x install, committed, hooks on. */
function v7project() {
  const base = mkdtempSync(join(tmpdir(), "leftovers-"));
  const p = join(base, "app");
  execFileSync("node", [join(REPO, "bin/carja.js"), "init", p, "--all", "--no-detect"], { stdio: "pipe" });
  G(p, "init", "-q", "-b", "main");
  G(p, "config", "user.email", "t@t");
  G(p, "config", "user.name", "t");
  execFileSync("node", [join(REPO, "bin/carja.js"), "install-hooks", p], { stdio: "pipe" });
  G(p, "add", "-A");
  execFileSync("git", ["commit", "-qm", "init"], { cwd: p, env: { ...process.env, CARJA_ON_DEFAULT: "fixture" } });
  return { base, p, gitDir: join(p, ".git") };
}

test("F6: the card's paths, stamp keys and markers move to carja/, and nothing outside the card changes", () => {
  const out = rewriteCardBlock(OLD_CARD);
  const card = out.slice(out.indexOf("<!-- carja:project-card:begin"));
  assert.doesNotMatch(card, new RegExp(OLD), card);
  assert.match(card, /- Goals: `carja\/0-compass\/north-star\.md`/);
  assert.match(card, /"carja\.config\.json#commands":"aaaaaaaaaa"/);
  assert.match(card, /"carja\/0-compass\/north-star\.md":"bbbbbbbbbb"/);
  assert.ok(out.includes(`Notes outside the card keep \`${OLD}/2-backlog/x.md\``), "the owner's own text is not the framework's to rewrite");
  assert.equal(rewriteCardBlock(out), out, "idempotent");
  assert.equal(rewriteCardBlock("# no card\n"), "# no card\n");
});

test("F4: a stamp written before the rename is not stale when only the folder name changed", () => {
  const sources = { "carja.config.json#commands": "same", "carja/0-compass/north-star.md": "same goals" };
  const card = (keys) =>
    `<!-- ${OLD}:project-card:begin status=ok -->\n<!-- ${OLD}:project-card:sources ${JSON.stringify(keys)} -->\n<!-- ${OLD}:project-card:end -->\n`;
  const hash = (s) => execFileSync("node", ["-e", `process.stdout.write(require("crypto").createHash("sha256").update(${JSON.stringify(s)}).digest("hex").slice(0,10))`]).toString();
  const fresh = card({ [`${OLD}.config.json#commands`]: hash("same"), [`${OLD}/0-compass/north-star.md`]: hash("same goals") });
  assert.deepEqual(staleSources(fresh, sources), []);
  const changed = card({ [`${OLD}.config.json#commands`]: hash("same"), [`${OLD}/0-compass/north-star.md`]: hash("old goals") });
  assert.deepEqual(staleSources(changed, sources), ["carja/0-compass/north-star.md"], "a real change is still reported");
});

test("F6: carja upgrade rewrites an old card in a project already on 7.x", () => {
  const { base, p } = v7project();
  try {
    const md = readFileSync(join(p, "AGENTS.md"), "utf8").replace(/<!-- carja:project-card:begin[\s\S]*<!-- carja:project-card:end -->\n?/, "");
    writeFileSync(join(p, "AGENTS.md"), md + "\n" + OLD_CARD.split("\n").slice(3).join("\n"));
    G(p, "add", "-A");
    execFileSync("git", ["commit", "-qm", "old card"], { cwd: p, env: { ...process.env, CARJA_ON_DEFAULT: "fixture", CARJA_NO_PROTECTED: "fixture" } });
    const r = carja(p, "upgrade", "--yes");
    assert.equal(r.status, 0, r.stdout + r.stderr);
    const after = readFileSync(join(p, "AGENTS.md"), "utf8");
    assert.doesNotMatch(after, new RegExp(`${OLD}[/:.]`), after);
    assert.match(after, /`carja\/0-compass\/north-star\.md`/);
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});

test("F5: any carja command adopts the 6.x files in the git dir, once", () => {
  const { base, p, gitDir } = v7project();
  try {
    rmSync(join(gitDir, "carja-heartbeat"), { force: true }); // as in a clone whose hooks were installed under 6.x
    writeFileSync(join(gitDir, `${OLD}-heartbeat`), "100 installed\n");
    mkdirSync(join(gitDir, `${OLD}-loop-logs/runs`), { recursive: true });
    writeFileSync(join(gitDir, `${OLD}-loop-logs/audit.md`), "old audit\n");
    writeFileSync(join(gitDir, `${OLD}-loop-ready.json`), "[]\n");
    const r = carja(p, "status");
    assert.equal(r.status, 0, r.stdout + r.stderr);
    for (const f of ["heartbeat", "loop-logs", "loop-ready.json"]) {
      assert.ok(existsSync(join(gitDir, `carja-${f}`)), `carja-${f}`);
      assert.ok(!existsSync(join(gitDir, `${OLD}-${f}`)), `${OLD}-${f} is gone`);
    }
    assert.equal(readFileSync(join(gitDir, "carja-loop-logs/audit.md"), "utf8"), "old audit\n");
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});

test("F5: a project still on the 6.x layout keeps its git-dir files (its 6.x hooks write there)", () => {
  const { base, p, gitDir } = v7project();
  try {
    mkdirSync(join(p, `${OLD}/2-backlog`), { recursive: true });
    rmSync(join(p, "carja"), { recursive: true, force: true });
    rmSync(join(gitDir, "carja-heartbeat"), { force: true });
    writeFileSync(join(gitDir, `${OLD}-heartbeat`), "100 installed\n");
    carja(p, "status");
    assert.ok(existsSync(join(gitDir, `${OLD}-heartbeat`)));
    assert.ok(!existsSync(join(gitDir, "carja-heartbeat")));
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});

test("F5: the first commit after a pull keeps the old heartbeat history", () => {
  const { base, p, gitDir } = v7project();
  try {
    rmSync(join(gitDir, "carja-heartbeat"), { force: true });
    writeFileSync(join(gitDir, `${OLD}-heartbeat`), "100 installed\n");
    G(p, "switch", "-q", "-c", "feat/x");
    writeFileSync(join(p, "carja/1-workbench/inbox.md"), "- a thought\n");
    G(p, "commit", "-qam", "note");
    const hb = readFileSync(join(gitDir, "carja-heartbeat"), "utf8");
    assert.match(hb, /^100 installed\n\d+ pre-commit\n$/, hb);
    assert.ok(!existsSync(join(gitDir, `${OLD}-heartbeat`)));
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});

// 7.0.2, F7 (autopportunity, 2026-11-05): the loop's run lock was not adopted,
// and a git dir that already had the new heartbeat kept the old history apart.
test("F7: the 6.x run lock is adopted, so a 7.x loop sees it", () => {
  const { base, p, gitDir } = v7project();
  try {
    writeFileSync(join(gitDir, `${OLD}-holder`), '{"pid":1,"at":"2026-10-22T14:46:57.740Z"}');
    const r = carja(p, "status");
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.ok(existsSync(join(gitDir, "carja-holder")));
    assert.ok(!existsSync(join(gitDir, `${OLD}-holder`)));
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});

test("F7: when both heartbeats exist, the old history goes first into the new file (CLI)", () => {
  const { base, p, gitDir } = v7project();
  try {
    writeFileSync(join(gitDir, "carja-heartbeat"), "300 installed\n");
    writeFileSync(join(gitDir, `${OLD}-heartbeat`), "100 installed\n200 pre-commit\n");
    carja(p, "status");
    assert.ok(readFileSync(join(gitDir, "carja-heartbeat"), "utf8").startsWith("100 installed\n200 pre-commit\n300 installed\n"));
    assert.ok(!existsSync(join(gitDir, `${OLD}-heartbeat`)));
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});

test("F7: when both heartbeats exist, the hook merges them (a nested code repo, which no carja command visits)", () => {
  const { base, p, gitDir } = v7project();
  try {
    writeFileSync(join(gitDir, "carja-heartbeat"), "300 installed\n");
    writeFileSync(join(gitDir, `${OLD}-heartbeat`), "100 installed\n");
    G(p, "switch", "-q", "-c", "feat/y");
    writeFileSync(join(p, "carja/1-workbench/inbox.md"), "- another thought\n");
    G(p, "commit", "-qam", "note");
    assert.match(readFileSync(join(gitDir, "carja-heartbeat"), "utf8"), /^100 installed\n300 installed\n\d+ pre-commit\n$/);
    assert.ok(!existsSync(join(gitDir, `${OLD}-heartbeat`)));
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});
