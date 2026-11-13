// test/loop-doctor.test.js
//
// F1/F6 from the first unattended crossing: preparing a project for the loop
// needed six project facts, and the prep notes were proven only by a live run.
// `carja loop doctor` checks them before any beat. `diagnose` is pure over
// gathered facts; the command test runs the real IO on a scratch project.

import { test } from "node:test";
import assert from "node:assert/strict";
import { diagnose, renderDoctor } from "../src/loop/doctor.js";

const ok = {
  state: { phase: "execution", autonomy_level: "L3", sandbox: "cli-native", platform: "claude" },
  preflightHalt: null,
  configErrors: [],
  projectVersion: "6.17.0",
  cliVersion: "6.17.0",
  profile: { credentials: true, strict: true },
  hostTools: { bwrap: true, socat: true },
  claude: { available: true, warnings: [] },
  forge: { needed: true, forge: "glab", host: "code.example.com", authOk: true },
  nestedRepos: [],
  queue: { fromCarja: true, count: 1, requireReady: true },
  dotenv: { present: false, copiedBySetup: false },
  probe: { ran: true, setup: { configured: true, ok: true, secs: 18 }, verify: { command: "pytest -q", exitCode: 0, secs: 11, tail: "639 passed" } },
  beat: null,
};
const by = (checks, id) => checks.find((c) => c.id === id);

test("a ready project passes every check", () => {
  const checks = diagnose(ok);
  assert.deepEqual(checks.filter((c) => c.level !== "pass").map((c) => c.id), []);
  assert.match(renderDoctor(checks), /ready for an unattended run/i);
});

test("an outdated sandbox profile fails: beats could stall or reach the forge", () => {
  const c = by(diagnose({ ...ok, profile: { credentials: false, strict: false } }), "sandbox-profile");
  assert.equal(c.level, "fail");
  assert.match(c.fix, /carja upgrade/);
});

test("a pre-flight halt fails with the driver's own reason", () => {
  const c = by(diagnose({ ...ok, state: { ...ok.state, phase: "discovery" }, preflightHalt: "halted_scoping", preflightReason: "phase is 'discovery'" }), "preflight");
  assert.equal(c.level, "fail");
  assert.match(c.detail, /discovery/);
});

test("missing bubblewrap or socat fails for the cli-native sandbox", () => {
  const c = by(diagnose({ ...ok, hostTools: { bwrap: false, socat: true } }), "host-tools");
  assert.equal(c.level, "fail");
  assert.match(c.fix, /bubblewrap/);
});

test("an unauthenticated forge fails when the run would open a PR", () => {
  const c = by(diagnose({ ...ok, forge: { ...ok.forge, authOk: false } }), "forge");
  assert.equal(c.level, "fail");
  assert.match(c.fix, /glab auth login/);
});

test("an empty queue with require_ready says how to give the loop an item", () => {
  const c = by(diagnose({ ...ok, queue: { fromCarja: true, count: 0, requireReady: true } }), "queue");
  assert.equal(c.level, "warn");
  assert.match(c.fix, /carja loop take/);
});

test("a .env the worktree will not have is a warning, the eurassistant lesson", () => {
  const c = by(diagnose({ ...ok, dotenv: { present: true, copiedBySetup: false } }), "dotenv");
  assert.equal(c.level, "warn");
  assert.match(c.detail, /skip|fail/);
});

test("a red verify in a fresh worktree fails, and points at loop.setup when none is set", () => {
  const checks = diagnose({ ...ok, probe: { ran: true, setup: { configured: false, ok: true }, verify: { command: "pytest -q", exitCode: 127, secs: 0, tail: "pytest: not found" } } });
  const c = by(checks, "verify");
  assert.equal(c.level, "fail");
  assert.match(c.detail, /pytest: not found/);
  assert.match(c.fix, /loop\.setup/);
});

test("a failed setup fails and the verify check is skipped", () => {
  const checks = diagnose({ ...ok, probe: { ran: true, setup: { configured: true, ok: false, reason: "exit 1: mise ERROR" }, verify: null } });
  assert.equal(by(checks, "setup").level, "fail");
  assert.equal(by(checks, "verify"), undefined);
});

test("the probe beat fails when the sandbox blocked or prompted for the project's commands", () => {
  const c = by(diagnose({ ...ok, beat: { ran: true, exitCode: 0, blocked: "This command requires approval" } }), "beat");
  assert.equal(c.level, "fail");
  assert.match(c.detail, /requires approval/);
});

test("the report ends with what to do, and fails count as fails", () => {
  const out = renderDoctor(diagnose({ ...ok, hostTools: { bwrap: false, socat: false } }));
  assert.match(out, /✖/);
  assert.match(out, /1 to fix/);
});

// eurassistant, 2026-10-19: after the loop's MR changed the lock file, the main
// checkout's .venv still held the old SDK, and the owner's next push failed at
// import. Loop runs push from their own worktree, so this is a warning.
test("verify red in the main checkout but green in a fresh worktree warns of a stale environment", () => {
  const c = by(diagnose({ ...ok, rootVerify: { exitCode: 2, tail: "ImportError: cannot import name 'genai' from 'google'" } }), "local-env");
  assert.equal(c.level, "warn");
  assert.match(c.detail, /cannot import name 'genai'/);
  assert.match(c.fix, /reinstall|setup/i);
  assert.equal(by(diagnose({ ...ok, rootVerify: { exitCode: 0 } }), "local-env").level, "pass");
  assert.equal(by(diagnose({ ...ok, probe: { ...ok.probe, verify: { ...ok.probe.verify, exitCode: 1 } }, rootVerify: { exitCode: 1 } }), "local-env"), undefined, "a red base is the verify check's finding, not this one");
});

test("carja loop doctor runs the real checks on a scratch project", async () => {
  const { mkdtemp, writeFile, rm, readFile } = await import("node:fs/promises");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const { execFileSync } = await import("node:child_process");
  const { initCommand } = await import("../src/commands/init.js");
  const { loopCommand } = await import("../src/commands/loop.js");
  const dir = await mkdtemp(join(tmpdir(), "doctor-"));
  const sink = () => ({ text: "", write(s) { this.text += s; } });
  try {
    await initCommand([dir, "--all", "--no-detect"], { cwd: tmpdir(), stdout: sink(), stderr: sink() });
    const statePath = join(dir, "carja/1-workbench/loop-state.json");
    const state = JSON.parse(await readFile(statePath, "utf8"));
    Object.assign(state, { phase: "execution", autonomy_level: "L1", sandbox: "none" });
    state.verification = { ...state.verification, command: "test -f marker.txt" };
    await writeFile(statePath, JSON.stringify(state, null, 2));
    const git = (...a) => execFileSync("git", a, { cwd: dir, stdio: "pipe" });
    git("init", "-q", "-b", "master");
    git("add", "-A");
    git("-c", "user.email=a@b", "-c", "user.name=t", "commit", "-qm", "init");

    const red = sink();
    const code = await loopCommand(["doctor", dir], { cwd: tmpdir(), stdout: red, stderr: sink() });
    assert.equal(code, 1, red.text);
    assert.match(red.text, /✖ .*verify/i);

    await writeFile(join(dir, "marker.txt"), "x");
    git("add", "-A");
    git("-c", "user.email=a@b", "-c", "user.name=t", "commit", "-qm", "marker");
    const green = sink();
    const code2 = await loopCommand(["doctor", dir], { cwd: tmpdir(), stdout: green, stderr: sink() });
    assert.match(green.text, /✔ .*verify/i, green.text);
    assert.equal(code2, 0, green.text);
    assert.equal(execFileSync("git", ["worktree", "list"], { cwd: dir }).toString().trim().split("\n").length, 1, "the probe worktree is removed");

    // A main checkout that drifted from HEAD: red here, green in a fresh worktree.
    await rm(join(dir, "marker.txt"));
    const drift = sink();
    await loopCommand(["doctor", dir], { cwd: tmpdir(), stdout: drift, stderr: sink() });
    assert.match(drift.text, /⚠ .*main checkout/i, drift.text);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

// Harness Engineering 101 harvest, F4: the loop trusts the Checker's approval
// without a second look, so the Checker must not run on a weaker model than the
// Maker whose work it judges. Since 7.4.0 (Model-Roles.md, D3) the ranking is the
// project's models.rank, never a list of families built into Carja:
// test/model-roles.test.js covers it.
test("doctor warns when the Checker runs on a weaker model than the Maker", () => {
  const weaker = diagnose({ state: {}, models: { maker: "opus", checker: "haiku" }, modelRank: ["opus", "sonnet", "haiku"] }).find((c) => c.id === "models");
  assert.equal(weaker?.level, "warn");
  assert.match(weaker.title, /checker.*haiku.*maker.*opus/i);
  for (const models of [
    { maker: "sonnet", checker: "sonnet" },
    { maker: "sonnet", checker: "opus" },
    { maker: "opus", checker: null },
    { maker: null, checker: "haiku" },
  ]) {
    assert.equal(diagnose({ state: {}, models, modelRank: ["opus", "sonnet", "haiku"] }).find((c) => c.id === "models"), undefined, JSON.stringify(models));
  }
});

// 2026-10-22, autopportunity: the owner gave doctor a project's backlog path
// instead of the project folder. Doctor answered "run carja init" on an
// installed project. A path inside a project names the project folder, and a
// project's own folder names `loop on`, which is how a project is chosen.
test("doctor on a path inside a project names the project folder, not init", async () => {
  const { mkdtemp, mkdir, writeFile, rm } = await import("node:fs/promises");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const { loopCommand } = await import("../src/commands/loop.js");
  const dir = await mkdtemp(join(tmpdir(), "doctor-path-"));
  const sink = () => ({ text: "", write(s) { this.text += s; } });
  try {
    await mkdir(join(dir, "carja/1-workbench"), { recursive: true });
    await writeFile(join(dir, "carja/1-workbench/loop-state.json"), "{}");
    await mkdir(join(dir, "carja/2-backlog/project-backlog/cop-availability"), { recursive: true });

    // A typo'd name that is not a folder still finds the project, and lists the projects.
    for (const [arg, on] of [["carja/2-backlog/project-backlog/cop-availability", "carja loop on cop-availability`"], ["carja/2-backlog/project-backlog/cop-availability~", "carja loop on`"]]) {
      const out = sink();
      const code = await loopCommand(["doctor", arg], { cwd: dir, stdout: out, stderr: sink() });
      assert.equal(code, 1, out.text);
      assert.match(out.text, /not the project folder/i, out.text);
      assert.ok(out.text.includes("carja loop doctor .`"), out.text);
      assert.ok(out.text.includes(on), out.text);
      assert.doesNotMatch(out.text, /carja init/, out.text);
    }
    const nested = sink();
    await loopCommand(["doctor", join(dir, "carja")], { cwd: tmpdir(), stdout: nested, stderr: sink() });
    assert.ok(nested.text.includes(`carja loop doctor ${dir}\``), nested.text);

    const elsewhere = await mkdtemp(join(tmpdir(), "doctor-none-"));
    try {
      const out = sink();
      assert.equal(await loopCommand(["doctor", elsewhere], { cwd: tmpdir(), stdout: out, stderr: sink() }), 1);
      assert.match(out.text, /carja init/, out.text);
    } finally {
      await rm(elsewhere, { recursive: true, force: true });
    }
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
