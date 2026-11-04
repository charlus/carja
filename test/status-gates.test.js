// test/status-gates.test.js
//
// `carja status` shows whether the gates are armed.
//
// The hooks only enforce anything when git runs them, and git runs them only
// when `core.hooksPath` points at `.agents/hooks`. A repo cloned after init, a
// custom hooksPath, or a lost executable bit leaves every law as prose, and
// nothing on the daily screen said so. The same screen now shows the waivers
// logged in the last 30 days, because a gate waived every week is a gate in
// name only, and the two opt-in Claude Code guards, because "opt-in" means
// most installs do not have them.
//
// Fixtures use the exact waiver line the hooks write (lib.sh
// carja_log_waiver), and the git cases run real git in a temp repo.

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, chmod } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { summariseWaivers, buildState, collectState } from "../src/carja-state.js";
import { renderStatus } from "../src/view/status.js";

const NOW = Date.UTC(2026, 8, 24, 12, 0);

const SHIP_LOG = `# Ship Log

## 2026-09-20 — Billing export
- **What:** CSV export.
- [2026-09-21 10:02] Hook waiver (Boundary): removed obsolete v1 export tests
- [2026-09-22 16:40] Hook waiver (Protected): carja upgrade
- [2026-09-23 09:15] Hook waiver (Protected): carja upgrade
- [2026-07-01 08:00] Hook waiver (TDD): docs only
`;

const render = (gateWiring, shipLogMd = "") =>
  renderStatus(
    buildState({ root: "/p", projectName: "p", docs: [], shipLogMd, gateWiring, now: NOW }),
    { color: false },
  );

describe("summariseWaivers", () => {
  test("counts the waivers inside the window, by kind, most frequent first", () => {
    const w = summariseWaivers(SHIP_LOG, { now: NOW, days: 30 });
    assert.equal(w.count, 3);
    assert.deepEqual(w.byKind, [
      { kind: "Protected", count: 2 },
      { kind: "Boundary", count: 1 },
    ]);
  });

  test("an empty or missing ship-log has no waivers", () => {
    assert.equal(summariseWaivers("", { now: NOW }).count, 0);
    assert.equal(summariseWaivers(undefined, { now: NOW }).count, 0);
  });
});

describe("the Gates line", () => {
  test("hooks not wired: loud, and it carries its own fix", () => {
    const out = render({ hooks: "off", guards: { bypass: false, factGate: false } });
    assert.match(out, /Gates\s+OFF — commits and pushes are not checked · fix: carja install-hooks/);
  });

  test("a custom hooksPath names the path instead of claiming the gates are on", () => {
    const out = render({ hooks: "custom", customPath: ".husky", guards: { bypass: false, factGate: false } });
    assert.match(out, /Gates\s+not wired — core\.hooksPath is '\.husky'/);
  });

  test("hooks directory missing points at upgrade", () => {
    const out = render({ hooks: "missing", guards: { bypass: false, factGate: false } });
    assert.match(out, /Gates\s+OFF — \.agents\/hooks\/ is missing · fix: carja upgrade/);
  });

  test("armed, with the opt-in guards reported", () => {
    assert.match(
      render({ hooks: "on", guards: { bypass: true, factGate: false } }),
      /Gates\s+on · commit \+ push · agent guard: bypass blocker/,
    );
    assert.match(
      render({ hooks: "on", guards: { bypass: false, factGate: false } }),
      /Gates\s+on · commit \+ push · agent guards: none \(opt-in\)/,
    );
  });

  test("waivers in the last 30 days are shown by kind", () => {
    const out = render({ hooks: "on", guards: { bypass: false, factGate: false } }, SHIP_LOG);
    assert.match(out, /Waivers\s+3 in 30 days · Protected ×2, Boundary ×1/);
  });

  test("no waivers says so", () => {
    const out = render({ hooks: "on", guards: { bypass: false, factGate: false } });
    assert.match(out, /Waivers\s+none in 30 days/);
  });

  test("outside a git repo there is nothing to wire, and no waiver line", () => {
    const out = render({ hooks: "not-git", guards: { bypass: false, factGate: false } });
    assert.match(out, /Gates\s+not a git repository/);
    assert.doesNotMatch(out, /Waivers/);
  });
});

describe("collectState reads the real wiring", () => {
  async function repo() {
    const dir = await mkdtemp(join(tmpdir(), "status-gates-"));
    execFileSync("git", ["init", "-q"], { cwd: dir });
    await mkdir(join(dir, "carja", "1-workbench"), { recursive: true });
    await writeFile(join(dir, "carja", "1-workbench", "inbox.md"), "# Inbox\n");
    await mkdir(join(dir, ".agents", "hooks"), { recursive: true });
    await writeFile(join(dir, ".agents", "hooks", "pre-commit"), "#!/bin/sh\n");
    await writeFile(join(dir, ".agents", "hooks", "pre-push"), "#!/bin/sh\n");
    await chmod(join(dir, ".agents", "hooks", "pre-commit"), 0o755);
    await chmod(join(dir, ".agents", "hooks", "pre-push"), 0o755);
    return dir;
  }

  test("no core.hooksPath → off", async () => {
    const dir = await repo();
    const { state } = await collectState(dir, { now: NOW });
    assert.equal(state.digest.gates.hooks, "off");
  });

  test("core.hooksPath → .agents/hooks with executable hooks → on", async () => {
    const dir = await repo();
    execFileSync("git", ["config", "core.hooksPath", ".agents/hooks"], { cwd: dir });
    const { state } = await collectState(dir, { now: NOW });
    assert.equal(state.digest.gates.hooks, "on");
  });

  test("wired but pre-commit lost its executable bit → off (git skips it silently)", async () => {
    const dir = await repo();
    execFileSync("git", ["config", "core.hooksPath", ".agents/hooks"], { cwd: dir });
    await chmod(join(dir, ".agents", "hooks", "pre-commit"), 0o644);
    const { state } = await collectState(dir, { now: NOW });
    assert.equal(state.digest.gates.hooks, "off");
  });

  test("a foreign hooksPath → custom, with the path", async () => {
    const dir = await repo();
    execFileSync("git", ["config", "core.hooksPath", ".husky"], { cwd: dir });
    const { state } = await collectState(dir, { now: NOW });
    assert.equal(state.digest.gates.hooks, "custom");
    assert.equal(state.digest.gates.customPath, ".husky");
  });

  test("the PreToolUse guards are read from .claude/settings.json and settings.local.json", async () => {
    const dir = await repo();
    await mkdir(join(dir, ".claude"), { recursive: true });
    const hook = (name) => ({
      hooks: {
        PreToolUse: [
          { matcher: "Bash", hooks: [{ type: "command", command: `$CLAUDE_PROJECT_DIR/.agents/hooks/${name}` }] },
        ],
      },
    });
    await writeFile(join(dir, ".claude", "settings.json"), JSON.stringify(hook("pretooluse-no-bypass.sh")));
    await writeFile(join(dir, ".claude", "settings.local.json"), JSON.stringify(hook("pretooluse-fact-gate.sh")));
    const { state } = await collectState(dir, { now: NOW });
    assert.deepEqual(state.digest.gates.guards, { bypass: true, factGate: true });
  });

  test("a guard mentioned outside a PreToolUse entry does not count", async () => {
    const dir = await repo();
    await mkdir(join(dir, ".claude"), { recursive: true });
    await writeFile(
      join(dir, ".claude", "settings.json"),
      JSON.stringify({ hooks: { Stop: [{ hooks: [{ type: "command", command: ".agents/hooks/pretooluse-no-bypass.sh" }] }] } }),
    );
    const { state } = await collectState(dir, { now: NOW });
    assert.equal(state.digest.gates.guards.bypass, false);
  });

  test("not a git repository → not-git", async () => {
    const dir = await mkdtemp(join(tmpdir(), "status-gates-nogit-"));
    await mkdir(join(dir, "carja", "1-workbench"), { recursive: true });
    await writeFile(join(dir, "carja", "1-workbench", "inbox.md"), "# Inbox\n");
    const { state } = await collectState(dir, { now: NOW });
    assert.equal(state.digest.gates.hooks, "not-git");
  });
});
