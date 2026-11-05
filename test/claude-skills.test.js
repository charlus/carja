// test/claude-skills.test.js
//
// The Claude Code skill bridge. Claude Code discovers skills only under
// `.claude/skills/<name>/SKILL.md`; Carja installs them under
// `.agents/skills/`. Before this bridge, a skill no workflow loads by path —
// `handoff` — was unreachable in Claude Code except by an `@` file reference.

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { generateClaudeSkills } from "../src/claude-commands.js";
import { initCommand } from "../src/commands/init.js";

function sink() {
  let out = "";
  return { write: (s) => { out += s; }, get text() { return out; } };
}

function frontmatter(text) {
  const m = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text);
  assert.ok(m, "shim has frontmatter");
  const fields = {};
  for (const line of m[1].split(/\r?\n/)) {
    const kv = /^(\w[\w-]*):\s*(.*)$/.exec(line);
    // A double-quoted YAML scalar is a JSON string for everything we emit.
    if (kv) fields[kv[1]] = kv[2].startsWith('"') ? JSON.parse(kv[2]) : kv[2];
  }
  return fields;
}

function installWithSkill(name, description) {
  const dir = mkdtempSync(join(tmpdir(), "cond-skills-"));
  mkdirSync(join(dir, ".agents", "skills", name), { recursive: true });
  writeFileSync(
    join(dir, ".agents", "skills", name, "SKILL.md"),
    `---\nname: ${name}\ndescription: ${description}\n---\n\n# body\n`
  );
  return dir;
}

test("each installed skill gets a Claude Code skill that points at the real file", async () => {
  const dir = installWithSkill("handoff", '"Compact the conversation: use when context is long."');
  const { written } = await generateClaudeSkills(dir);
  assert.equal(written, 1);

  const shim = readFileSync(join(dir, ".claude", "skills", "handoff", "SKILL.md"), "utf8");
  const fm = frontmatter(shim);
  assert.equal(fm.name, "handoff");
  assert.equal(fm.description, "Compact the conversation: use when context is long.");
  assert.match(shim, /\.agents\/skills\/handoff\/SKILL\.md/);
});

test("an unquoted description containing a colon still yields valid YAML", async () => {
  const dir = installWithSkill("code-review", "Two-stage review: spec first, then quality");
  await generateClaudeSkills(dir);
  const fm = frontmatter(readFileSync(join(dir, ".claude", "skills", "code-review", "SKILL.md"), "utf8"));
  assert.equal(fm.description, "Two-stage review: spec first, then quality");
});

test("a removed skill loses its shim; the user's own Claude skills are never touched", async () => {
  const dir = installWithSkill("handoff", "Hand off.");
  await generateClaudeSkills(dir);

  const own = join(dir, ".claude", "skills", "my-own");
  mkdirSync(own, { recursive: true });
  writeFileSync(join(own, "SKILL.md"), "---\nname: my-own\ndescription: mine\n---\n");

  const { rmSync } = await import("node:fs");
  rmSync(join(dir, ".agents", "skills", "handoff"), { recursive: true });
  const { removed } = await generateClaudeSkills(dir);

  assert.equal(removed, 1);
  assert.ok(!existsSync(join(dir, ".claude", "skills", "handoff")));
  assert.ok(existsSync(join(own, "SKILL.md")), "user skill kept");
});

test("a user skill with the same name as a Carja skill is kept, not overwritten", async () => {
  const dir = installWithSkill("handoff", "Hand off.");
  const own = join(dir, ".claude", "skills", "handoff");
  mkdirSync(own, { recursive: true });
  const mine = "---\nname: handoff\ndescription: my handoff\n---\nmine\n";
  writeFileSync(join(own, "SKILL.md"), mine);

  const { written, skipped } = await generateClaudeSkills(dir);
  assert.equal(written, 0);
  assert.deepEqual(skipped, ["handoff"]);
  assert.equal(readFileSync(join(own, "SKILL.md"), "utf8"), mine);
});

test("init exposes every shipped skill to Claude Code, handoff included", async () => {
  const dir = mkdtempSync(join(tmpdir(), "cond-init-skills-"));
  const code = await initCommand([dir, "--all"], { cwd: tmpdir(), stdout: sink(), stderr: sink() });
  assert.equal(code ?? 0, 0);

  const installed = readdirSync(join(dir, ".agents", "skills")).filter((n) =>
    existsSync(join(dir, ".agents", "skills", n, "SKILL.md"))
  );
  assert.ok(installed.includes("handoff"));
  for (const name of installed) {
    const shim = join(dir, ".claude", "skills", name, "SKILL.md");
    assert.ok(existsSync(shim), `missing Claude Code skill for ${name}`);
    assert.equal(frontmatter(readFileSync(shim, "utf8")).name, name);
  }
});

test("upgrade gives an existing install its Claude Code skills", async () => {
  const { rmSync } = await import("node:fs");
  const { upgradeCommand } = await import("../src/commands/upgrade.js");
  const dir = mkdtempSync(join(tmpdir(), "cond-upgrade-skills-"));
  await initCommand([dir, "--all"], { cwd: tmpdir(), stdout: sink(), stderr: sink() });
  rmSync(join(dir, ".claude", "skills"), { recursive: true }); // an install from before the bridge

  const stderr = sink();
  const code = await upgradeCommand([dir], { cwd: tmpdir(), stdout: sink(), stderr });
  assert.equal(code ?? 0, 0, stderr.text);
  assert.ok(existsSync(join(dir, ".claude", "skills", "handoff", "SKILL.md")));
});
