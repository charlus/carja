// test/hooks-heartbeat.test.js
//
// `carja status` names the commits and pushes that skipped the hooks.
//
// "Gates on" says git is configured to run the hooks. It cannot see a commit
// made with --no-verify or CARJA_HOOKS=off, or by a git client that ignores
// hooks. Taken from AI-DLC (awslabs/aidlc-workflows), which refuses to advance
// when its hooks' heartbeat files show they stopped firing.
//
// Each hook appends a heartbeat line to the git directory. `install-hooks`
// writes the first one, so commits from before the install are never judged.
// Status compares the heartbeats with the reflog, which records every local
// commit and push with its time. Real git, the real hooks, the real commands.

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, readdir, copyFile, chmod, appendFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { collectState } from "../src/carja-state.js";
import { renderStatus } from "../src/view/status.js";
import { installHooksCommand } from "../src/commands/install-hooks.js";

const HOOKS_SRC = fileURLToPath(new URL("../templates/.agents/hooks/", import.meta.url));
const sink = { write() {} };

const git = (dir, args, env = {}) =>
  execFileSync("git", args, { cwd: dir, env: { ...process.env, ...env }, stdio: ["ignore", "pipe", "pipe"] })
    .toString()
    .trim();

async function project({ install = true } = {}) {
  const d = await mkdtemp(join(tmpdir(), "carja-heartbeat-"));
  await mkdir(join(d, ".agents/hooks"), { recursive: true });
  for (const f of await readdir(HOOKS_SRC)) await copyFile(join(HOOKS_SRC, f), join(d, ".agents/hooks", f));
  await chmod(join(d, ".agents/hooks/pre-commit"), 0o755);
  await chmod(join(d, ".agents/hooks/pre-push"), 0o755);
  await mkdir(join(d, "carja/1-workbench"), { recursive: true });
  await mkdir(join(d, "carja/0-compass"), { recursive: true });
  await writeFile(join(d, "carja/1-workbench/inbox.md"), "# Inbox\n");
  await writeFile(join(d, "carja/0-compass/ship-log.md"), "# Ship Log\n");
  await writeFile(join(d, "carja.config.json"), '{ "verify": "true", "eval": "none" }\n');
  git(d, ["init", "-q", "-b", "work"]); // never the remote's main: the default-branch rule would judge these commits
  git(d, ["config", "user.email", "t@t.local"]);
  git(d, ["config", "user.name", "t"]);
  git(d, ["add", "-A"]);
  git(d, ["commit", "-qm", "base"], { CARJA_HOOKS: "off" });
  if (install) await installHooksCommand([], { cwd: d, stdout: sink, stderr: sink });
  return d;
}

async function commitNote(d, text, { args = [], env = {} } = {}) {
  await appendFile(join(d, "notes.md"), `${text}\n`);
  git(d, ["add", "notes.md"]);
  git(d, ["commit", "-qm", text, ...args], env);
  return git(d, ["rev-parse", "--short", "HEAD"]);
}

function remote(d) {
  const b = execFileSync("mktemp", ["-d"]).toString().trim();
  git(b, ["init", "-q", "--bare"]);
  git(d, ["remote", "add", "origin", b]);
}

const skipped = async (d) => (await collectState(d)).state.digest.gates.skipped;
const status = async (d) => renderStatus((await collectState(d)).state, { color: false });

describe("AIDLC-A3 — status names what skipped the hooks", () => {
  test("a commit that ran the hooks is not reported (sensitivity)", async () => {
    const d = await project();
    await commitNote(d, "gated");
    const s = await skipped(d);
    assert.deepEqual(s.commits, []);
    assert.doesNotMatch(await status(d), /skipped the hooks/);
  });

  test("a --no-verify commit is reported by its hash", async () => {
    const d = await project();
    await commitNote(d, "gated");
    const sha = await commitNote(d, "sneaky", { args: ["--no-verify"] });
    const s = await skipped(d);
    assert.deepEqual(s.commits, [sha]);
    assert.match(await status(d), new RegExp(`1 commit skipped the hooks.*${sha}`));
  });

  test("a commit made with CARJA_HOOKS=off is reported", async () => {
    const d = await project();
    const sha = await commitNote(d, "off", { env: { CARJA_HOOKS: "off" } });
    assert.deepEqual((await skipped(d)).commits, [sha]);
  });

  test("a --no-verify push is reported, a gated push is not", async () => {
    const d = await project();
    remote(d);
    await commitNote(d, "one");
    git(d, ["push", "-q", "origin", "HEAD:main"]);
    assert.equal((await skipped(d)).pushes, 0, "a gated push was reported");
    await commitNote(d, "two");
    // Pushes are told apart by their second: one push can update several refs.
    await new Promise((r) => setTimeout(r, 1100));
    git(d, ["push", "-q", "--no-verify", "origin", "HEAD:main"]);
    assert.equal((await skipped(d)).pushes, 1);
    assert.match(await status(d), /1 push skipped the hooks/);
  });

  test("commits made before install-hooks are never judged", async () => {
    const d = await project({ install: false });
    await commitNote(d, "before install", { env: { CARJA_HOOKS: "off" } });
    assert.equal(await skipped(d), null, "no heartbeat yet: status must say nothing");
    await new Promise((r) => setTimeout(r, 1100)); // git records times to the second
    await installHooksCommand([], { cwd: d, stdout: sink, stderr: sink });
    await commitNote(d, "after install");
    assert.deepEqual((await skipped(d)).commits, []);
  });
});
