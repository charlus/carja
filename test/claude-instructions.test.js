// test/claude-instructions.test.js
//
// D9: Carja's instructions now live in the root AGENTS.md. Claude Code reads
// it only from v2.1.277, and only when no CLAUDE.md or CLAUDE.local.md sits in
// the working folder. Each of those makes Claude silently skip the framework,
// so init, upgrade, status and the loop warn about them.

import { test } from "node:test";
import assert from "node:assert/strict";
import { parseClaudeVersion, instructionWarnings, MIN_CLAUDE_VERSION } from "../src/claude-instructions.js";

test("parseClaudeVersion reads `claude --version` output", () => {
  assert.deepEqual(parseClaudeVersion("2.1.289 (Claude Code)"), [2, 1, 289]);
  assert.equal(parseClaudeVersion("not a version"), null);
  assert.equal(parseClaudeVersion(""), null);
});

test("instructionWarnings: none for a recent Claude Code and a clean folder", () => {
  assert.deepEqual(instructionWarnings({ claudeVersion: "2.1.289 (Claude Code)", files: [] }), []);
  assert.equal(MIN_CLAUDE_VERSION, "2.1.277");
});

test("instructionWarnings: an old Claude Code is named with the minimum", () => {
  const [w] = instructionWarnings({ claudeVersion: "2.1.276 (Claude Code)", files: [] });
  assert.match(w, /Claude Code 2\.1\.276 does not read AGENTS\.md.*2\.1\.277/);
  assert.match(instructionWarnings({ claudeVersion: "2.0.999", files: [] })[0], /2\.0\.999/);
});

test("instructionWarnings: no claude on PATH, or an unparseable version, is not a warning", () => {
  assert.deepEqual(instructionWarnings({ claudeVersion: null, files: [] }), []);
  assert.deepEqual(instructionWarnings({ claudeVersion: "weird", files: [] }), []);
});

test("instructionWarnings: CLAUDE.md and CLAUDE.local.md each switch AGENTS.md off", () => {
  const w = instructionWarnings({ claudeVersion: "2.1.289", files: ["CLAUDE.md", "CLAUDE.local.md"] });
  assert.equal(w.length, 2);
  assert.match(w[0], /CLAUDE\.md.*instead of AGENTS\.md.*@AGENTS\.md/);
  assert.match(w[1], /CLAUDE\.local\.md/);
});

test("carja status shows the warning when a CLAUDE.md would hide AGENTS.md", async () => {
  const { mkdtemp, writeFile, rm } = await import("node:fs/promises");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const { initCommand } = await import("../src/commands/init.js");
  const { statusCommand } = await import("../src/commands/status.js");
  const dir = await mkdtemp(join(tmpdir(), "status-claude-"));
  const sink = () => ({ text: "", write(s) { this.text += s; } });
  try {
    await initCommand([dir, "--all", "--no-detect"], { cwd: tmpdir(), stdout: sink(), stderr: sink() });
    const clean = sink();
    await statusCommand([dir, "--no-color"], { cwd: dir, stdout: clean, stderr: sink() });
    assert.doesNotMatch(clean.text, /instead of AGENTS\.md/);
    await writeFile(join(dir, "CLAUDE.md"), "# mine\n");
    const out = sink();
    await statusCommand([dir, "--no-color"], { cwd: dir, stdout: out, stderr: sink() });
    assert.match(out.text, /CLAUDE\.md is here: Claude Code reads it instead of AGENTS\.md/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("instructionWarnings: .claude/CLAUDE.md and a CLAUDE file in a parent folder hide AGENTS.md too", () => {
  const w = instructionWarnings({ claudeVersion: "2.1.289", files: [".claude/CLAUDE.md", "../CLAUDE.md"] });
  assert.equal(w.length, 2);
  assert.match(w[0], /\.claude\/CLAUDE\.md.*instead of AGENTS\.md/);
  assert.match(w[1], /\.\.\/CLAUDE\.md.*instead of AGENTS\.md.*claude-md-and-agents-md/);
});

test("instructionWarningsFor walks up the folders, but ~/.claude/CLAUDE.md does not count", async () => {
  const { mkdtemp, mkdir, writeFile, rm } = await import("node:fs/promises");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const { instructionWarningsFor } = await import("../src/claude-instructions.js");
  const home = await mkdtemp(join(tmpdir(), "claude-walk-"));
  const project = join(home, "work", "app");
  try {
    await mkdir(join(home, ".claude"), { recursive: true });
    await mkdir(join(project, ".claude"), { recursive: true });
    await writeFile(join(home, ".claude", "CLAUDE.md"), "# user-level, loads alongside AGENTS.md\n");
    assert.deepEqual(await instructionWarningsFor(project, { home, claudeVersion: "2.1.289" }), []);
    await writeFile(join(home, "work", "CLAUDE.md"), "# parent\n");
    await writeFile(join(project, ".claude", "CLAUDE.md"), "# project, hidden folder\n");
    const w = await instructionWarningsFor(project, { home, claudeVersion: "2.1.289" });
    assert.equal(w.length, 2);
    assert.match(w[0], /\.claude\/CLAUDE\.md/);
    assert.match(w[1], /\.\.\/CLAUDE\.md/);
  } finally {
    await rm(home, { recursive: true, force: true });
  }
});
