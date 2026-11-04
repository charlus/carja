// test/loop-field-report.test.js
//
// Regressions for the 6.5.0 field report (F2–F9). Each test names its finding.

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, rm, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { loopCommand } from "../src/commands/loop.js";
import { harvestWorkQueue } from "../src/loop/harvester.js";

const STATE_REL = "carja/1-workbench/loop-state.json";

function sink() {
  let text = "";
  return { write: (s) => (text += s), get text() { return text; } };
}

async function withState(state, fn) {
  const dir = await mkdtemp(join(tmpdir(), "carja-field-"));
  try {
    await mkdir(join(dir, "carja/1-workbench"), { recursive: true });
    await writeFile(join(dir, STATE_REL), JSON.stringify(state), "utf8");
    return await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

// F9: `carja loop --help` printed the sandbox refusal instead of help.
for (const flag of ["--help", "-h"]) {
  test(`F9: 'loop ${flag}' prints the loop help and exits 0, even with sandbox none`, async () => {
    await withState({ schema_version: 2, sandbox: "none" }, async (dir) => {
      const stdout = sink();
      const stderr = sink();
      const code = await loopCommand([dir, flag], { cwd: dir, stdout, stderr });
      assert.equal(code, 0);
      assert.match(stdout.text, /carja loop \[dir\]/);
      assert.match(stdout.text, /--dry-run/);
      assert.doesNotMatch(stderr.text, /UNSANDBOXED/);
    });
  });
}

test("F9: 'loop --help' works without a loop-state.json", async () => {
  const dir = await mkdtemp(join(tmpdir(), "carja-field-"));
  try {
    const stdout = sink();
    const code = await loopCommand(["--help"], { cwd: dir, stdout, stderr: sink() });
    assert.equal(code, 0);
    assert.match(stdout.text, /carja loop/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

// ---- F2–F5 through the real IO shell, via --dry-run (spawns no agent) -------

async function withProject({ state, config, backlog, inbox, remote }, fn) {
  return withState(state, async (dir) => {
    if (config) await writeFile(join(dir, "carja.config.json"), JSON.stringify(config), "utf8");
    if (backlog) {
      await mkdir(join(dir, "carja/2-backlog"), { recursive: true });
      await writeFile(join(dir, "carja/2-backlog/task-backlog.md"), backlog, "utf8");
    }
    if (inbox) await writeFile(join(dir, "carja/1-workbench/inbox.md"), inbox, "utf8");
    execFileSync("git", ["init", "-q"], { cwd: dir });
    if (remote) execFileSync("git", ["remote", "add", "origin", remote], { cwd: dir });
    return fn(dir);
  });
}

const L3 = { schema_version: 2, phase: "execution", autonomy_level: "L3", sandbox: "cli-native", verification: { command: "true" } };

async function dry(dir, extra = []) {
  const stdout = sink();
  const stderr = sink();
  const code = await loopCommand([dir, "--dry-run", ...extra], { cwd: dir, stdout, stderr });
  return { code, out: stdout.text, err: stderr.text };
}

test("F4: dry-run names glab for a self-hosted GitLab origin, even when gh is installed", async () => {
  await withProject({ state: L3, remote: "git@code.euranova.eu:team/app.git" }, async (dir) => {
    const { out } = await dry(dir);
    assert.match(out, /forge:\s+glab \(origin host code\.euranova\.eu\)/);
  });
});

test("F4: loop.forge overrides the origin host", async () => {
  await withProject({ state: L3, remote: "git@code.euranova.eu:team/app.git", config: { loop: { forge: "gh" } } }, async (dir) => {
    assert.match((await dry(dir)).out, /forge:\s+gh \(loop\.forge\)/);
  });
});

test("F4: no origin and no loop.forge → the dry-run flags it and exits 1", async () => {
  await withProject({ state: L3 }, async (dir) => {
    const { code, out } = await dry(dir);
    assert.match(out, /forge:\s+⛔ cannot tell the forge/);
    assert.equal(code, 1);
  });
});

test("F2/F3: dry-run shows the setup command and the extra sandbox domains", async () => {
  const config = { loop: { setup: "npm ci", allowed_domains: ["api.example.com", "code.example.com"] } };
  await withProject({ state: L3, config, remote: "https://github.com/a/b.git" }, async (dir) => {
    const { out } = await dry(dir);
    assert.match(out, /setup:\s+npm ci/);
    assert.match(out, /network:\s+\+ api\.example\.com, code\.example\.com\n/);
  });
});

test("F3: an invalid loop setting stops the run, dry-run included", async () => {
  await withProject({ state: L3, config: { loop: { allowed_domains: ["*"] } } }, async (dir) => {
    const { code, err } = await dry(dir);
    assert.equal(code, 1);
    assert.match(err, /Invalid loop settings/);
    assert.match(err, /'\*' is not a hostname/);
  });
});

const BACKLOG = `# Backlog

## P1 - High Priority
- [ ] T1 Export invoices loop-ready
  - Fix: add GET /invoices.csv
- [ ] ⛔ BLOCKED T2 SSO loop-ready
- [ ] T4 Rename settings page
## P2 - Medium Priority
- [ ] T5 Tidy CSS loop-ready
`;
const INBOX = "# Inbox\n\n---\n\n- a raw thought\n";

test("F5: --from-carja honours require_ready, --priority and --no-inbox", async () => {
  await withProject({ state: L3, backlog: BACKLOG, inbox: INBOX, config: { loop: { require_ready: true } }, remote: "https://github.com/a/b.git" }, async (dir) => {
    const { out } = await dry(dir, ["--from-carja", "--priority", "P1"]);
    assert.match(out, /harvested: 1 work item\(s\) from carja\/ \(taken or loop-ready only, priorities P1\)/);
    assert.match(out, /T1 Export invoices/);
    assert.doesNotMatch(out, /T2|T4|T5|raw thought/);
  });
  await withProject({ state: L3, backlog: BACKLOG, inbox: INBOX, remote: "https://github.com/a/b.git" }, async (dir) => {
    const { out } = await dry(dir, ["--from-carja", "--no-inbox"]);
    assert.match(out, /harvested: 3 work item\(s\) from carja\/ \(no inbox\)/);
    assert.doesNotMatch(out, /T2|raw thought/);
  });
});

test("F5: --priority with a bad value is refused", async () => {
  await withProject({ state: L3 }, async (dir) => {
    const { code, err } = await dry(dir, ["--from-carja", "--priority", "high"]);
    assert.equal(code, 1);
    assert.match(err, /--priority: 'high' is not a priority/);
  });
});

// F12: the shipped backlog held six example tasks, so --from-carja on a fresh
// install dispatched agents on fake work. The templates must harvest to nothing.
test("F12: a fresh install's inbox and backlog harvest to zero work items", async () => {
  const backlogMd = await readFile(new URL("../templates/carja/2-backlog/task-backlog.md", import.meta.url), "utf8");
  const inboxMd = await readFile(new URL("../templates/carja/1-workbench/inbox.md", import.meta.url), "utf8");
  assert.deepEqual(harvestWorkQueue({ backlogMd, inboxMd }), []);
});

// D1: an outer carja repo with the code in a gitignored nested repo cannot
// work (the loop's worktrees never contain the code). It ran silently against
// the outer repo; it must refuse and say why.
async function withNestedRepo(config, fn) {
  return withProject({ state: L3, config, remote: "https://github.com/a/b.git" }, async (dir) => {
    await writeFile(join(dir, ".gitignore"), "repo/\n", "utf8");
    await mkdir(join(dir, "repo"));
    execFileSync("git", ["init", "-q"], { cwd: join(dir, "repo") });
    return fn(dir);
  });
}

test("D1: a gitignored nested git repo at the top level stops the run, dry-run included", async () => {
  await withNestedRepo(null, async (dir) => {
    const { code, err } = await dry(dir);
    assert.equal(code, 1);
    assert.match(err, /'repo\/' is a separate git repository that this repo ignores/);
  });
});

test("D1: loop.allow_nested_repo: true lets the run proceed", async () => {
  await withNestedRepo({ loop: { allow_nested_repo: true } }, async (dir) => {
    const { code, err } = await dry(dir);
    assert.doesNotMatch(err, /separate git repository/);
    assert.notEqual(code, undefined);
  });
});

test("D1: a gitignored directory that is not a git repo is fine", async () => {
  await withProject({ state: L3, remote: "https://github.com/a/b.git" }, async (dir) => {
    await writeFile(join(dir, ".gitignore"), "node_modules/\n", "utf8");
    await mkdir(join(dir, "node_modules"));
    await writeFile(join(dir, "node_modules", "x.js"), "", "utf8");
    assert.doesNotMatch((await dry(dir)).err, /separate git repository/);
  });
});

// F17 through the real IO shell: a finished run with an old clock is announced
// as a new run, with the beat counter back at 0. Dry-run writes nothing.
test("F17: after a finished run, the next run starts with fresh counters", async () => {
  const finished = { ...L3, status: "awaiting_review", iterations: { current: 7, max_allowed: 20 }, budget: { started_at: "2026-01-01T00:00:00.000Z" } };
  await withProject({ state: finished, remote: "https://github.com/a/b.git" }, async (dir) => {
    const before = await readFile(join(dir, STATE_REL), "utf8");
    const { out } = await dry(dir);
    assert.match(out, /new run: the previous one ended 'awaiting_review'/);
    assert.match(out, /beats:\s+0\/20/);
    assert.equal(await readFile(join(dir, STATE_REL), "utf8"), before);
  });
});
