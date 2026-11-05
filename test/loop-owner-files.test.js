// test/loop-owner-files.test.js
//
// I6 (owner, 2026-10-23): after the two runs the owner's folder held a changed
// inbox.md (the loop's escalations) and two untracked loop reports, so
// `git status` was never clean. The loop's messages, reports, waiting question
// rounds and proposals now stay out of git, and `carja status` and
// `carja inbox list` still show them.

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync, spawnSync } from "node:child_process";
import { ensureOwnerFilesExcluded, appendLoopMessage, readLoopMessages, MESSAGES_REL } from "../src/loop/owner-files.js";

const REPO = new URL("..", import.meta.url).pathname;
const G = (cwd, ...a) => execFileSync("git", a, { cwd, stdio: "pipe" }).toString().trim();
const cli = (cwd, ...a) => spawnSync("node", [join(REPO, "bin/carja.js"), ...a], { cwd, encoding: "utf8", env: { ...process.env, NO_COLOR: "1" } });

function install() {
  const base = mkdtempSync(join(tmpdir(), "owner-files-"));
  const root = join(base, "p");
  execFileSync("node", [join(REPO, "bin/carja.js"), "init", root, "--all", "--no-detect"], { stdio: "pipe" });
  G(root, "init", "-q", "-b", "main");
  G(root, "config", "user.email", "t@t");
  G(root, "config", "user.name", "t");
  G(root, "add", "-A");
  G(root, "commit", "-qm", "init");
  return { base, root };
}

test("what the loop writes for the owner leaves `git status` clean, and the files stay readable", async () => {
  const { base, root } = install();
  try {
    await ensureOwnerFilesExcluded(root);
    await appendLoopMessage(root, "\n## [loop] Escalation — awaiting_review\ntask slice:km/08 would conflict on merge.\n");
    await appendLoopMessage(root, "\n## [loop] Questions\ntask slice:km/09 has 1 question waiting for you.\n");
    writeFileSync(join(root, "carja/1-workbench/loop-report-km.md"), "# Loop report: km\n");
    mkdirSync(join(root, "carja/1-workbench/questions/answered"), { recursive: true });
    writeFileSync(join(root, "carja/1-workbench/questions/slice-km-09.md"), "# Questions: slice:km/09 (dependencies)\n");
    writeFileSync(join(root, "carja/1-workbench/loop-improvements.md"), "# proposals\n");
    assert.equal(G(root, "status", "--porcelain"), "", "the owner's folder is clean");
    // An answered round is not hidden: it rides the item's branch as the record.
    writeFileSync(join(root, "carja/1-workbench/questions/answered/slice-km-09.md"), "answered\n");
    assert.match(G(root, "status", "--porcelain", "-uall"), /questions\/answered\/slice-km-09\.md/);
    rmSync(join(root, "carja/1-workbench/questions/answered"), { recursive: true, force: true });

    const msgs = await readLoopMessages(root);
    assert.deepEqual(msgs.map((m) => m.title), ["Escalation — awaiting_review", "Questions"]);
    assert.match(msgs[0].text, /would conflict on merge/);

    const status = cli(root, "status");
    assert.match(status.stdout, new RegExp(`2 loop messages in ${MESSAGES_REL.replace(/\./g, "\\.")}\\. Newest: Questions: task slice:km/09`));
    assert.match(status.stdout, /Loop report: carja\/1-workbench\/loop-report-km\.md\. Merge with \/merge-stack <project>\./);
    const inbox = cli(root, "inbox", "list");
    assert.match(inbox.stdout, /2 loop messages — carja\/1-workbench\/loop-messages\.md/);
    assert.match(inbox.stdout, /· Escalation — awaiting_review: task slice:km\/08 would conflict on merge\./);
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});
