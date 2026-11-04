// test/agents-md.test.js
//
// Root AGENTS.md (docs/roadmap/Agents-MD-Project-Card.md, D5/D8): the one
// instruction file every harness loads. Its framework block is GENERATED from
// .agents/ (the classifier + the rules marked `inline: true`), so .agents/ stays
// the only place framework text is edited. CLAUDE.md / GEMINI.md are migrated
// into it and removed.

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  buildFrameworkBlock,
  renderRootAgentsMd,
  extractStubNotes,
  FRAMEWORK_BEGIN,
  FRAMEWORK_END,
  CARD_BEGIN,
  CARD_END,
} from "../src/agents-md.js";

const TEMPLATE_AGENTS = fileURLToPath(new URL("../templates/.agents", import.meta.url));

async function agentsDir(files) {
  const dir = await mkdtemp(join(tmpdir(), "agentsmd-"));
  for (const [rel, text] of Object.entries(files)) {
    await mkdir(join(dir, rel, ".."), { recursive: true });
    await writeFile(join(dir, rel), text);
  }
  return dir;
}

test("buildFrameworkBlock: classifier + inline rules, frontmatter stripped, rule headings demoted", async () => {
  const dir = await agentsDir({
    "AGENTS.md": "---\ntrigger: manual\n---\n\n# Carja Framework\n\nCLASSIFIER\n",
    "rules/b-law.md": "---\ntrigger: manual\ninline: true\n---\n\n# B Law\n\nB BODY\n\n## Detail\n",
    "rules/a-law.md": "---\ntrigger: manual\ninline: true\n---\n\n# A Law\n\nA BODY\n",
    "rules/loop-only.md": "---\ntrigger: manual\n---\n\n# Loop\n\nLOOP BODY\n",
  });
  try {
    const block = await buildFrameworkBlock(dir);
    assert.ok(block.startsWith(FRAMEWORK_BEGIN));
    assert.ok(block.trimEnd().endsWith(FRAMEWORK_END));
    assert.doesNotMatch(block, /trigger:|inline:/);
    assert.match(block, /# Carja Framework\n\nCLASSIFIER/);
    assert.ok(block.indexOf("## A Law") < block.indexOf("## B Law"), "rules in file-name order");
    assert.match(block, /### Detail/);
    assert.doesNotMatch(block, /LOOP BODY/, "a rule without inline: true stays on demand");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("buildFrameworkBlock on the shipped templates inlines the three laws, not the loop guardrails", async () => {
  const block = await buildFrameworkBlock(TEMPLATE_AGENTS);
  assert.match(block, /## The Prime Directive/);
  assert.match(block, /## Test-Driven Law/);
  assert.match(block, /## Verification Iron Law/);
  assert.doesNotMatch(block, /Loop Guardrails/);
  assert.match(block, /## Request Classifier/);
});

const FW = `${FRAMEWORK_BEGIN}\nNEW FRAMEWORK\n${FRAMEWORK_END}`;

test("renderRootAgentsMd: a new file gets the framework block and a draft card", () => {
  const out = renderRootAgentsMd(null, FW);
  assert.ok(out.startsWith(FW));
  assert.ok(out.includes(CARD_BEGIN) && out.includes(CARD_END));
  assert.match(out, /status=draft/);
});

test("renderRootAgentsMd: a refresh replaces only the framework block", () => {
  const existing = `${FRAMEWORK_BEGIN}\nOLD\n${FRAMEWORK_END}\n\n${CARD_BEGIN.replace("draft", "ok")}\nMY CARD\n${CARD_END}\n\n## My notes\nKEEP\n`;
  const out = renderRootAgentsMd(existing, FW);
  assert.match(out, /NEW FRAMEWORK/);
  assert.doesNotMatch(out, /\nOLD\n/);
  assert.match(out, /MY CARD/);
  assert.match(out, /## My notes\nKEEP\n$/);
  assert.equal(renderRootAgentsMd(out, FW), out, "idempotent");
});

test("renderRootAgentsMd: a team-written AGENTS.md keeps every byte, below the inserted blocks", () => {
  const team = "# Company OS\n\nUse pnpm.\n";
  const out = renderRootAgentsMd(team, FW);
  assert.ok(out.startsWith(FW));
  assert.ok(out.endsWith(team));
  assert.equal(renderRootAgentsMd(out, FW), out, "idempotent");
});

test("extractStubNotes: managed stub → only the user's text, without our comments or frontmatter", () => {
  const stub =
    "---\ntrigger: always_on\n---\n\n<!-- carja:managed:begin — x -->\n# Carja Framework V6\nREAD .agents/AGENTS.md\n<!-- carja:managed:end -->\n\n<!-- Add your project-specific instructions below this line; they are preserved across `carja upgrade`. -->\n\nUse plan mode for billing.\n";
  assert.equal(extractStubNotes(stub), "Use plan mode for billing.");
});

test("extractStubNotes: managed stub with nothing of the user's → empty", () => {
  const stub = "<!-- carja:managed:begin — x -->\nFRAMEWORK\n<!-- carja:managed:end -->\n\n<!-- Add your project-specific instructions below this line; they are preserved across `carja upgrade`. -->\n";
  assert.equal(extractStubNotes(stub), "");
});

test("extractStubNotes: a stub without our markers is entirely the user's", () => {
  assert.equal(extractStubNotes("# Notes\n\nUse pnpm.\n"), "# Notes\n\nUse pnpm.");
});

test("appendMovedNotes: adds the notes once, under a heading naming the old file", async () => {
  const { appendMovedNotes } = await import("../src/agents-md.js");
  const once = appendMovedNotes("BASE\n", "CLAUDE.md", "Use plan mode.");
  assert.match(once, /## Notes moved from CLAUDE\.md\n\n<!--[^\n]*-->\n\nUse plan mode\.\n$/);
  assert.equal(appendMovedNotes(once, "CLAUDE.md", "Use plan mode."), once);
  assert.equal(appendMovedNotes("BASE\n", "CLAUDE.md", ""), "BASE\n");
});

// Seen on real installs: old pointer-only stubs without our markers (a V5
// GEMINI.md, a team's "Company OS" stubs). Moving them would copy boilerplate
// into AGENTS.md. Pointer lines and frontmatter go; headings alone are not notes.
test("extractStubNotes: an old pointer-only stub without markers has no notes", () => {
  const v5 = "# Carja Framework V5\n\n> This is a platform stub for auto-discovery. The full system instructions live in `.agents/AGENTS.md`.\n\nRead and follow the instructions in `.agents/AGENTS.md` before any action.\n";
  assert.equal(extractStubNotes(v5), "");
  const team = "---\ntrigger: always_on\n---\n\n# Company OS Architect\n\n> This is a platform stub for auto-discovery. The full system instructions live in `AGENTS.md`.\n\nRead and follow the instructions in `AGENTS.md` before any action.\n";
  assert.equal(extractStubNotes(team), "");
});

test("extractStubNotes: real notes under a heading keep the heading", () => {
  const stub = "# Local instructions\n\n## Level and tone\n\nUse simple sentences.\n";
  assert.equal(extractStubNotes(stub), stub.trim());
});
