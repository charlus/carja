// test/names-dual.test.js
//
// Rename to Carja, PR 1 (docs/roadmap/Rename-To-Carja.md): every reader accepts
// both names, so that PR 2 only flips the writers. Nothing here writes a
// `carja` name: 6.x installs keep working exactly as before.

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync, renameSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { stateDirName, statePath, configFileName, configPath, mirrorEnv, MARKER_NAMES } from "../src/names.js";

const REPO = new URL("..", import.meta.url).pathname;

function dir(layout = {}) {
  const root = mkdtempSync(join(tmpdir(), "names-"));
  for (const [rel, text] of Object.entries(layout)) {
    const p = join(root, rel);
    mkdirSync(join(p, ".."), { recursive: true });
    if (text === null) mkdirSync(p, { recursive: true });
    else writeFileSync(p, text);
  }
  return root;
}

test("the state folder: carja/ when present, conductor/ otherwise", () => {
  const old = dir({ "conductor/1-workbench": null });
  const neu = dir({ "carja/1-workbench": null });
  const both = dir({ "carja/1-workbench": null, "conductor/product.md": "Google's file\n" });
  const none = dir();
  try {
    assert.equal(stateDirName(old), "conductor");
    assert.equal(stateDirName(neu), "carja");
    assert.equal(stateDirName(both), "carja", "after the rename, a conductor/ left for Google's files is not ours");
    assert.equal(stateDirName(none), "conductor", "6.x writes conductor/");
    assert.equal(statePath(neu, "conductor/1-workbench/inbox.md"), "carja/1-workbench/inbox.md");
    assert.equal(statePath(old, "carja/1-workbench/inbox.md"), "conductor/1-workbench/inbox.md");
    assert.equal(statePath(neu, "package.json"), "package.json", "a path outside the state folder is unchanged");
  } finally {
    for (const d of [old, neu, both, none]) rmSync(d, { recursive: true, force: true });
  }
});

test("the config file: carja.config.json when present, conductor.config.json otherwise", () => {
  const old = dir({ "conductor.config.json": "{}" });
  const neu = dir({ "carja.config.json": "{}" });
  const none = dir();
  try {
    assert.equal(configFileName(old), "conductor.config.json");
    assert.equal(configFileName(neu), "carja.config.json");
    assert.equal(configFileName(none), "conductor.config.json");
    assert.equal(configPath(neu), join(neu, "carja.config.json"));
  } finally {
    for (const d of [old, neu, none]) rmSync(d, { recursive: true, force: true });
  }
});

test("CARJA_* variables reach the CONDUCTOR_* readers; an explicit CONDUCTOR_* value wins", () => {
  const env = { CARJA_HOME: "/h", CARJA_NO_TEST: "reason", CONDUCTOR_NO_TEST: "old", PATH: "/bin" };
  mirrorEnv(env);
  assert.equal(env.CONDUCTOR_HOME, "/h");
  assert.equal(env.CONDUCTOR_NO_TEST, "old");
  assert.equal(env.CARJA_HOME, "/h", "the new name stays set for child processes");
  assert.deepEqual(MARKER_NAMES, ["carja", "conductor"]);
});

test("the CLI reads CARJA_HOME: watch --all lists the products registered there", () => {
  const home = mkdtempSync(join(tmpdir(), "names-home-"));
  try {
    mkdirSync(join(home, "proj-carja"));
    writeFileSync(join(home, "loop-projects.json"), JSON.stringify({ projects: [join(home, "proj-carja")] }));
    const env = { ...process.env, CARJA_HOME: home };
    delete env.CONDUCTOR_HOME;
    const r = spawnSync("node", [join(REPO, "bin/conductor.js"), "watch", "--all"], { encoding: "utf8", env, timeout: 20000 });
    assert.match(r.stdout, /proj-carja/, r.stdout + r.stderr);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

// The commands an agent or the owner runs on an install, through the real CLI,
// on a project whose folder and config were renamed by hand (what PR 2's
// upgrade will do). Each must read and write carja/, never recreate conductor/.
test("status, inbox, review-log and agents-md work on a carja/ layout", () => {
  const base = mkdtempSync(join(tmpdir(), "names-cli-"));
  const p = join(base, "p");
  const cli = (...args) => spawnSync("node", [join(REPO, "bin/conductor.js"), ...args], { cwd: p, encoding: "utf8", timeout: 60000 });
  try {
    spawnSync("node", [join(REPO, "bin/conductor.js"), "init", p, "--all", "--no-detect"], { encoding: "utf8" });
    spawnSync("git", ["init", "-q"], { cwd: p });
    renameSync(join(p, "conductor"), join(p, "carja"));
    const cfg = JSON.parse(readFileSync(join(p, "conductor.config.json"), "utf8"));
    rmSync(join(p, "conductor.config.json"));
    writeFileSync(join(p, "carja.config.json"), JSON.stringify({ ...cfg, verify: "echo carja-verify" }));
    mkdirSync(join(p, "carja/3-product-areas/billing"), { recursive: true });
    writeFileSync(join(p, "carja/3-product-areas/billing/README.md"), "# Billing\n");

    const status = cli("status");
    assert.equal(status.status, 0, status.stdout + status.stderr);
    assert.match(status.stdout, /echo carja-verify/, "the verify command comes from carja.config.json");

    const inbox = cli("inbox", "add", "hello carja");
    assert.equal(inbox.status, 0, inbox.stdout + inbox.stderr);
    assert.match(readFileSync(join(p, "carja/1-workbench/inbox.md"), "utf8"), /hello carja/);

    const log = cli("review-log", "append", JSON.stringify({ severity: "NIT", action: "fixed", category: "correctness", file: "a.js" }));
    assert.equal(log.status, 0, log.stdout + log.stderr);
    assert.match(readFileSync(join(p, "carja/1-workbench/review-log.jsonl"), "utf8"), /"a\.js"/);

    const facts = cli("agents-md", "facts");
    assert.equal(facts.status, 0, facts.stdout + facts.stderr);
    assert.match(facts.stdout, /carja\/3-product-areas\/billing\//);

    assert.equal(existsSync(join(p, "conductor")), false, "no conductor/ folder was recreated");
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});

// Markers: a file written under the new prefix is still recognised as ours.
const carjaMarkers = (text) => text.replace(/<!-- conductor:/g, "<!-- carja:");

test("AGENTS.md: a framework block under carja: markers is replaced, never duplicated", async () => {
  const { renderRootAgentsMd, extractStubNotes } = await import("../src/agents-md.js");
  const first = renderRootAgentsMd(null, "<!-- conductor:framework:begin x -->\nOLD\n<!-- conductor:framework:end -->");
  const carja = carjaMarkers(first) + "\n## Team notes\n\nkeep me\n";
  const out = renderRootAgentsMd(carja, "<!-- conductor:framework:begin x -->\nNEW\n<!-- conductor:framework:end -->");
  assert.match(out, /NEW/);
  assert.doesNotMatch(out, /OLD/);
  assert.equal((out.match(/project-card:begin/g) ?? []).length, 1, "the existing card is kept, not doubled");
  assert.match(out, /keep me/);
  const stub = "<!-- carja:managed:begin -->\nours\n<!-- carja:managed:end -->\n\nmy own note\n";
  assert.equal(extractStubNotes(stub), "my own note");
});

test("project card: a carja: card parses, checks and reports stale sources", async () => {
  const { buildCard, parseCard, stampCard, staleSources } = await import("../src/project-card.js");
  const facts = { codeRoots: ["."], stack: [], commands: [], layout: [], areas: [] };
  const card = carjaMarkers(buildCard({ facts, previous: null }));
  assert.ok(parseCard(card), "the card is found");
  const stamped = carjaMarkers(stampCard(card, { "a.md": "one" }));
  assert.deepEqual(staleSources(stamped, { "a.md": "one" }), []);
  assert.deepEqual(staleSources(stamped, { "a.md": "two" }), ["a.md"]);
});

test("Claude Code shims: a carja:-marked shim is ours to refresh and to remove", async () => {
  const { generateClaudeCommands } = await import("../src/claude-commands.js");
  const root = mkdtempSync(join(tmpdir(), "names-shims-"));
  try {
    mkdirSync(join(root, ".agents/workflows"), { recursive: true });
    writeFileSync(join(root, ".agents/workflows/build.md"), "---\ndescription: Build\n---\n# Build\n");
    mkdirSync(join(root, ".claude/commands"), { recursive: true });
    writeFileSync(join(root, ".claude/commands/build.md"), "<!-- carja:generated-command -->\nstale\n");
    writeFileSync(join(root, ".claude/commands/gone.md"), "<!-- carja:generated-command -->\nold workflow\n");
    writeFileSync(join(root, ".claude/commands/mine.md"), "my own command\n");
    await generateClaudeCommands(root, {});
    assert.doesNotMatch(readFileSync(join(root, ".claude/commands/build.md"), "utf8"), /stale/, "refreshed");
    assert.equal(existsSync(join(root, ".claude/commands/gone.md")), false, "removed");
    assert.equal(readFileSync(join(root, ".claude/commands/mine.md"), "utf8"), "my own command\n", "a user's file is untouched");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("the version stamp: .carja-version.json is read", async () => {
  const { readVersionStamp } = await import("../src/version.js");
  const agents = mkdtempSync(join(tmpdir(), "names-stamp-"));
  try {
    writeFileSync(join(agents, ".carja-version.json"), JSON.stringify({ frameworkVersion: "7.0.0" }));
    assert.equal(readVersionStamp(agents)?.frameworkVersion, "7.0.0");
  } finally {
    rmSync(agents, { recursive: true, force: true });
  }
});
