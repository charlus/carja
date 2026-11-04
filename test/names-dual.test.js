// test/names-dual.test.js
//
// Rename to Carja (docs/roadmap/Rename-To-Carja.md, 7.0.0). Writers use
// `carja`. Through 7.x every reader still accepts the 6.x name, `conductor`
// (D1). The names are spelled out here on purpose: a bulk rename must not turn
// these tests into carja-against-carja.

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { stateDirName, statePath, configFileName, mirrorEnv, machineHome, configHome, isOldLayout, MARKER_NAMES, CURRENT } from "../src/names.js";

const REPO = new URL("..", import.meta.url).pathname;
const NEW = "carja";
const OLD = ["con", "ductor"].join("");
const OLD_ENV = OLD.toUpperCase() + "_";
const toOld = (text) => text.replace(new RegExp(`<!-- ${NEW}:`, "g"), `<!-- ${OLD}:`);

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

test("writers use carja; readers accept the 6.x name", () => {
  assert.equal(CURRENT, NEW);
  assert.deepEqual(MARKER_NAMES, [NEW, OLD]);
});

test("the state folder: carja/ when present, a 6.x folder otherwise, carja/ for a new one", () => {
  const old = dir({ [`${OLD}/1-workbench`]: null });
  const neu = dir({ [`${NEW}/1-workbench`]: null });
  const google = dir({ [`${NEW}/1-workbench`]: null, [`${OLD}/product.md`]: "Google's file\n" });
  const none = dir();
  try {
    assert.equal(stateDirName(old), OLD);
    assert.equal(stateDirName(neu), NEW);
    assert.equal(stateDirName(google), NEW, "a folder left for Google Conductor's files is not ours");
    assert.equal(stateDirName(none), NEW);
    assert.equal(statePath(old, `${NEW}/1-workbench/inbox.md`), `${OLD}/1-workbench/inbox.md`);
    assert.equal(isOldLayout(old), true);
    assert.equal(isOldLayout(neu), false);
    assert.equal(isOldLayout(google), false, "Google's files alone are not a 6.x install");
  } finally {
    for (const d of [old, neu, google, none]) rmSync(d, { recursive: true, force: true });
  }
});

test("the config file: carja.config.json, else the 6.x one", () => {
  const old = dir({ [`${OLD}.config.json`]: "{}" });
  const none = dir();
  try {
    assert.equal(configFileName(old), `${OLD}.config.json`);
    assert.equal(configFileName(none), `${NEW}.config.json`);
  } finally {
    for (const d of [old, none]) rmSync(d, { recursive: true, force: true });
  }
});

test("6.x variables still work; an explicit CARJA_* value wins", () => {
  const env = { [`${OLD_ENV}HOME`]: "/h", [`${OLD_ENV}NO_TEST`]: "old", CARJA_NO_TEST: "new", PATH: "/bin" };
  const copied = mirrorEnv(env);
  assert.equal(env.CARJA_HOME, "/h");
  assert.equal(env.CARJA_NO_TEST, "new");
  assert.deepEqual(copied, [`${OLD_ENV}HOME`]);
});

test("machine folders: ~/.carja, else an existing 6.x ~/.<old>, and the same for ~/.config", () => {
  const home = mkdtempSync(join(tmpdir(), "names-machine-"));
  try {
    assert.equal(machineHome({ HOME: home }), join(home, `.${NEW}`), "a new machine gets ~/.carja");
    mkdirSync(join(home, `.${OLD}`));
    mkdirSync(join(home, ".config", OLD), { recursive: true });
    assert.equal(machineHome({ HOME: home }), join(home, `.${OLD}`), "a 6.x machine keeps its trust consents and records");
    assert.equal(configHome({ HOME: home }), join(home, ".config", OLD));
    mkdirSync(join(home, `.${NEW}`));
    assert.equal(machineHome({ HOME: home }), join(home, `.${NEW}`));
    assert.equal(machineHome({ HOME: home, CARJA_HOME: "/x" }), "/x");
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test("the 6.x command and variable still work, each with one notice", () => {
  const home = mkdtempSync(join(tmpdir(), "names-home-"));
  try {
    mkdirSync(join(home, "proj-x"));
    writeFileSync(join(home, "loop-projects.json"), JSON.stringify({ projects: [join(home, "proj-x")] }));
    const env = { ...process.env, [`${OLD_ENV}HOME`]: home };
    delete env.CARJA_HOME;
    const r = spawnSync("node", [join(REPO, `bin/${OLD}.js`), "watch", "--all"], { encoding: "utf8", env, timeout: 20000 });
    assert.match(r.stdout, /proj-x/, r.stdout + r.stderr);
    assert.match(r.stderr, new RegExp(`\`${OLD}\` is now \`carja\``));
    assert.match(r.stderr, new RegExp(`${OLD_ENV}HOME is read as CARJA_\\*`));
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

// A 6.x install not upgraded yet: the commands an agent or the owner runs work
// on it; the ones that write state unattended refuse it.
test("on a 6.x layout: status, inbox, review-log, agents-md work; loop, loop doctor and work refuse", () => {
  const base = mkdtempSync(join(tmpdir(), "names-cli-"));
  const p = join(base, "p");
  const cli = (...args) => spawnSync("node", [join(REPO, "bin/carja.js"), ...args], { cwd: p, encoding: "utf8", timeout: 60000 });
  try {
    spawnSync("node", [join(REPO, "bin/carja.js"), "init", p, "--all", "--no-detect"], { encoding: "utf8" });
    spawnSync("git", ["init", "-q"], { cwd: p });
    // Make it look like 6.x: the old folder and config names.
    spawnSync("mv", [join(p, NEW), join(p, OLD)]);
    const cfg = JSON.parse(readFileSync(join(p, `${NEW}.config.json`), "utf8"));
    rmSync(join(p, `${NEW}.config.json`));
    writeFileSync(join(p, `${OLD}.config.json`), JSON.stringify({ ...cfg, verify: "echo old-verify" }));
    mkdirSync(join(p, `${OLD}/3-product-areas/billing`), { recursive: true });
    writeFileSync(join(p, `${OLD}/3-product-areas/billing/README.md`), "# Billing\n");

    const status = cli("status");
    assert.equal(status.status, 0, status.stdout + status.stderr);
    assert.match(status.stdout, /echo old-verify/);

    assert.equal(cli("inbox", "add", "hello").status, 0);
    assert.match(readFileSync(join(p, `${OLD}/1-workbench/inbox.md`), "utf8"), /hello/);

    assert.equal(cli("review-log", "append", JSON.stringify({ severity: "NIT", action: "fixed", category: "correctness", file: "a.js" })).status, 0);
    assert.match(readFileSync(join(p, `${OLD}/1-workbench/review-log.jsonl`), "utf8"), /"a\.js"/);

    const facts = cli("agents-md", "facts");
    assert.match(facts.stdout, new RegExp(`${OLD}/3-product-areas/billing/`));

    for (const args of [["loop", "--dry-run"], ["loop", "doctor"], ["work", "some-item"]]) {
      const r = cli(...args);
      assert.notEqual(r.status, 0, args.join(" "));
      assert.match(r.stdout + r.stderr, /Run `carja upgrade` there first/, args.join(" "));
    }
    assert.equal(existsSync(join(p, NEW)), false, "nothing created a carja/ folder");
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});

test("the 6.x flag --from-<old> still takes the work from carja/", () => {
  const base = mkdtempSync(join(tmpdir(), "names-flag-"));
  const p = join(base, "p");
  try {
    spawnSync("node", [join(REPO, "bin/carja.js"), "init", p, "--all", "--no-detect"], { encoding: "utf8" });
    spawnSync("git", ["init", "-q"], { cwd: p });
    const r = spawnSync("node", [join(REPO, "bin/carja.js"), "loop", `--from-${OLD}`, "--dry-run"], { cwd: p, encoding: "utf8", timeout: 20000 });
    assert.match(r.stdout, /harvested: \d+ work item\(s\) from carja\//, r.stdout + r.stderr);
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});

// Review F3: the hooks obey CONDUCTOR_HOOKS=off through 7.x, so the bypass guard must see it too.
test("the bypass guard blocks the 6.x CONDUCTOR_HOOKS=off as it blocks CARJA_HOOKS=off", () => {
  const hook = join(REPO, "templates/.agents/hooks/pretooluse-no-bypass.sh");
  for (const name of ["CARJA_HOOKS", `${OLD_ENV}HOOKS`]) {
    const input = JSON.stringify({ tool_name: "Bash", tool_input: { command: `${name}=off git commit -m x` } });
    const r = spawnSync("bash", [hook], { input, encoding: "utf8", env: { ...process.env, CARJA_HOOKS: "", [`${OLD_ENV}HOOKS`]: "" } });
    assert.equal(r.status, 2, `${name}=off: ${r.stdout}${r.stderr}`);
  }
});

test("AGENTS.md: a framework block under 6.x markers is replaced, never duplicated", async () => {
  const { renderRootAgentsMd, extractStubNotes, FRAMEWORK_BEGIN, FRAMEWORK_END } = await import("../src/agents-md.js");
  const first = renderRootAgentsMd(null, `${FRAMEWORK_BEGIN}\nOLD\n${FRAMEWORK_END}`);
  const out = renderRootAgentsMd(toOld(first) + "\n## Team notes\n\nkeep me\n", `${FRAMEWORK_BEGIN}\nNEW\n${FRAMEWORK_END}`);
  assert.match(out, /NEW/);
  assert.doesNotMatch(out, /OLD/);
  assert.equal((out.match(/project-card:begin/g) ?? []).length, 1, "the existing card is kept, not doubled");
  assert.match(out, /keep me/);
  assert.equal(extractStubNotes(`<!-- ${OLD}:managed:begin -->\nours\n<!-- ${OLD}:managed:end -->\n\nmy own note\n`), "my own note");
});

test("project card: a 6.x card parses and reports stale sources", async () => {
  const { buildCard, parseCard, stampCard, staleSources } = await import("../src/project-card.js");
  const facts = { codeRoots: ["."], stack: [], commands: [], layout: [], areas: [] };
  const card = toOld(buildCard({ facts, previous: null }));
  assert.ok(parseCard(card));
  const stamped = toOld(stampCard(card, { "a.md": "one" }));
  assert.deepEqual(staleSources(stamped, { "a.md": "one" }), []);
  assert.deepEqual(staleSources(stamped, { "a.md": "two" }), ["a.md"]);
});

test("Claude Code shims: a 6.x-marked shim is ours to refresh and to remove", async () => {
  const { generateClaudeCommands } = await import("../src/claude-commands.js");
  const root = mkdtempSync(join(tmpdir(), "names-shims-"));
  try {
    mkdirSync(join(root, ".agents/workflows"), { recursive: true });
    writeFileSync(join(root, ".agents/workflows/build.md"), "---\ndescription: Build\n---\n# Build\n");
    mkdirSync(join(root, ".claude/commands"), { recursive: true });
    writeFileSync(join(root, ".claude/commands/build.md"), `<!-- ${OLD}:generated-command -->\nstale\n`);
    writeFileSync(join(root, ".claude/commands/gone.md"), `<!-- ${OLD}:generated-command -->\nold workflow\n`);
    writeFileSync(join(root, ".claude/commands/mine.md"), "my own command\n");
    await generateClaudeCommands(root, {});
    const build = readFileSync(join(root, ".claude/commands/build.md"), "utf8");
    assert.doesNotMatch(build, /stale/);
    assert.match(build, /<!-- carja:generated-command -->/);
    assert.equal(existsSync(join(root, ".claude/commands/gone.md")), false);
    assert.equal(readFileSync(join(root, ".claude/commands/mine.md"), "utf8"), "my own command\n");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("the version stamp: a 6.x stamp is read", async () => {
  const { readVersionStamp } = await import("../src/version.js");
  const agents = mkdtempSync(join(tmpdir(), "names-stamp-"));
  try {
    writeFileSync(join(agents, `.${OLD}-version.json`), JSON.stringify({ frameworkVersion: "6.54.0" }));
    assert.equal(readVersionStamp(agents)?.frameworkVersion, "6.54.0");
  } finally {
    rmSync(agents, { recursive: true, force: true });
  }
});
