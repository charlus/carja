import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, copyFileSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { upgradeCommand } from "../src/commands/upgrade.js";
import { packageVersion } from "../src/version.js";
import { renameRecursive } from "../src/kebab.js";

const TEMPLATES = fileURLToPath(new URL("../templates", import.meta.url));

function sink() {
  let out = "";
  return { write: (s) => { out += s; }, get text() { return out; } };
}

async function runUpgrade(targetDir, extraArgs = []) {
  const stdout = sink();
  const stderr = sink();
  const code = await upgradeCommand([targetDir, ...extraArgs], { cwd: tmpdir(), stdout, stderr });
  return { code, stdout: stdout.text, stderr: stderr.text };
}

function tpl(rel) {
  return readFileSync(join(TEMPLATES, ".agents", rel), "utf8");
}

// Build a realistic V5-shape install with: an edited framework workflow, a custom
// skill, a user knowledge file, an edited framework template + a custom template,
// and a v1-schema loop-state.
function makeV5Install() {
  const dir = mkdtempSync(join(tmpdir(), "cond-v5-"));
  const A = join(dir, ".agents");
  mkdirSync(join(A, "workflows"), { recursive: true });
  mkdirSync(join(A, "skills", "code-review"), { recursive: true });
  mkdirSync(join(A, "skills", "acme-custom"), { recursive: true });
  mkdirSync(join(A, "rules"), { recursive: true });

  // Framework file the user edited (must be REPLACED on upgrade).
  writeFileSync(join(A, "workflows", "genesis.md"), tpl("workflows/genesis.md") + "\n<!-- USER EDIT junk -->\n");
  copyFileSync(join(TEMPLATES, ".agents", "AGENTS.md"), join(A, "AGENTS.md"));
  copyFileSync(join(TEMPLATES, ".agents", "skills", "code-review", "SKILL.md"), join(A, "skills", "code-review", "SKILL.md"));
  // Custom skill (must be CARRIED forward).
  writeFileSync(join(A, "skills", "acme-custom", "SKILL.md"), "---\nname: acme-custom\n---\ncustom\n");
  // Selections: user selected code-review + acme-custom.
  writeFileSync(join(A, ".selections.json"), JSON.stringify({ version: 1, skills: ["code-review", "acme-custom"], rules: [], workflows: ["genesis"], bundles: [] }));

  // A CLAUDE.md stub with an old managed block + a user note below it.
  writeFileSync(join(dir, "CLAUDE.md"),
    "<!-- carja:managed:begin — managed -->\n# Carja Framework V5\nOLD STUB BODY\n<!-- carja:managed:end -->\n\nMY CLAUDE NOTES\n");

  // carja/ — user knowledge (must be PRESERVED), framework 5-templates, v1 loop-state.
  const C = join(dir, "carja");
  mkdirSync(join(C, "0-compass"), { recursive: true });
  writeFileSync(join(C, "0-compass", "north-star.md"), "MY APP KNOWLEDGE — do not touch\n");
  mkdirSync(join(C, "5-templates", "genesis-workflow"), { recursive: true });
  writeFileSync(join(C, "5-templates", "genesis-workflow", "problem-solar-system-template.md"), "OLD FRAMEWORK TEMPLATE\n");
  writeFileSync(join(C, "5-templates", "my-custom-template.md"), "MY CUSTOM TEMPLATE\n");
  mkdirSync(join(C, "1-workbench"), { recursive: true });
  writeFileSync(join(C, "1-workbench", "loop-state.json"), JSON.stringify({
    schema_version: 1, goal_description: "ship it",
    telemetry: { tokens_spent: 4321, consecutive_stalls: 2 },
  }));
  return dir;
}

test("upgrade replaces framework instructions, carries custom, preserves knowledge", async () => {
  const dir = makeV5Install();
  const { code } = await runUpgrade(dir);
  assert.equal(code, 0);

  // Framework file REPLACED (edit gone; matches current template).
  const genesis = readFileSync(join(dir, ".agents", "workflows", "genesis.md"), "utf8");
  assert.ok(!genesis.includes("USER EDIT junk"), "user edit to framework file should be overwritten");
  assert.equal(genesis, tpl("workflows/genesis.md"), "framework file should match current template");

  // Custom skill CARRIED forward.
  assert.ok(existsSync(join(dir, ".agents", "skills", "acme-custom", "SKILL.md")), "custom skill preserved");

  // New primitives LANDED (they postdate the selections file but are core).
  assert.ok(existsSync(join(dir, ".agents", "skills", "grilling", "SKILL.md")), "new core skill installed");

  // User knowledge PRESERVED untouched.
  assert.equal(readFileSync(join(dir, "carja", "0-compass", "north-star.md"), "utf8"), "MY APP KNOWLEDGE — do not touch\n");

  // 5-templates: framework template refreshed, custom template kept.
  const refreshed = readFileSync(join(dir, "carja", "5-templates", "genesis-workflow", "problem-solar-system-template.md"), "utf8");
  assert.ok(!refreshed.includes("OLD FRAMEWORK TEMPLATE"), "framework template refreshed");
  assert.ok(existsSync(join(dir, "carja", "5-templates", "my-custom-template.md")), "custom template carried");

  // loop-state migrated v1 → v2 (fields folded, no data lost).
  const ls = JSON.parse(readFileSync(join(dir, "carja", "1-workbench", "loop-state.json"), "utf8"));
  assert.equal(ls.schema_version, 2);
  assert.equal(ls.budget.tokens_spent, 4321, "tokens_spent folded into budget");
  assert.equal(ls.stall.consecutive, 2, "consecutive_stalls folded into stall");
  assert.equal(ls.goal_description, "ship it", "user goal preserved");

  // CLAUDE.md is migrated into the root AGENTS.md and removed (D5/D8): the
  // framework block is generated, the user's note moves, the old stub body does not.
  assert.ok(!existsSync(join(dir, "CLAUDE.md")), "CLAUDE.md removed");
  const agentsMd = readFileSync(join(dir, "AGENTS.md"), "utf8");
  assert.ok(agentsMd.includes("carja:framework:begin"), "framework block written");
  assert.ok(agentsMd.includes("## Request Classifier"), "framework block generated from .agents/");
  assert.ok(agentsMd.includes("## Notes moved from CLAUDE.md"), "notes section added");
  assert.ok(agentsMd.includes("MY CLAUDE NOTES"), "user note moved");
  assert.ok(!agentsMd.includes("OLD STUB BODY"), "old managed block not carried");

  // Version stamp written.
  const stamp = JSON.parse(readFileSync(join(dir, ".agents", ".carja-version.json"), "utf8"));
  assert.equal(stamp.frameworkVersion, packageVersion());

  // Backup created, containing the OLD edited file; gitignore updated.
  const backupRoot = join(dir, ".carja-backup");
  assert.ok(existsSync(backupRoot), "backup dir created");
  const stampDir = join(backupRoot, readdirSync(backupRoot)[0]);
  assert.ok(readFileSync(join(stampDir, ".agents", "workflows", "genesis.md"), "utf8").includes("USER EDIT junk"), "backup holds the old edit");
  assert.ok(readFileSync(join(dir, ".gitignore"), "utf8").includes(".carja-backup/"), "gitignore updated");
});

test("upgrade migrates a V4-style root-folder install", async () => {
  const dir = mkdtempSync(join(tmpdir(), "cond-v4-"));
  // Root numbered folders (no carja/ wrapper), Title-Case, with user knowledge.
  mkdirSync(join(dir, "0-Compass"), { recursive: true });
  writeFileSync(join(dir, "0-Compass", "north-star.md"), "V4 KNOWLEDGE\n");
  // A minimal .agents/ with no checksums (the silent-no-op case).
  mkdirSync(join(dir, ".agents", "workflows"), { recursive: true });
  writeFileSync(join(dir, ".agents", "workflows", "genesis.md"), "STALE V4 GENESIS\n");
  copyFileSync(join(TEMPLATES, ".agents", "AGENTS.md"), join(dir, ".agents", "AGENTS.md"));

  const { code } = await runUpgrade(dir);
  assert.equal(code, 0);

  // Root folder migrated into carja/ and kebab-cased; knowledge preserved.
  assert.ok(existsSync(join(dir, "carja", "0-compass", "north-star.md")), "root folder migrated + kebabbed");
  assert.equal(readFileSync(join(dir, "carja", "0-compass", "north-star.md"), "utf8"), "V4 KNOWLEDGE\n");
  assert.ok(!existsSync(join(dir, "0-Compass")), "old root folder removed");

  // Stale instruction REPLACED even with no checksum baseline (no silent no-op).
  const genesis = readFileSync(join(dir, ".agents", "workflows", "genesis.md"), "utf8");
  assert.ok(!genesis.includes("STALE V4 GENESIS"), "stale instruction replaced despite missing checksums");
  assert.ok(existsSync(join(dir, ".agents", ".carja-version.json")), "stamped");
});

test("--dry-run writes nothing", async () => {
  const dir = makeV5Install();
  const { code, stdout } = await runUpgrade(dir, ["--dry-run"]);
  assert.equal(code, 0);
  assert.match(stdout, /dry run/i);
  // Nothing changed.
  assert.ok(readFileSync(join(dir, ".agents", "workflows", "genesis.md"), "utf8").includes("USER EDIT junk"), "file untouched");
  assert.ok(!existsSync(join(dir, ".agents", ".carja-version.json")), "no stamp written");
  assert.ok(!existsSync(join(dir, ".carja-backup")), "no backup written");
});

test("kebab rename leaves canonically-cased framework files (Dockerfile) alone", async () => {
  const dir = mkdtempSync(join(tmpdir(), "cond-kebab-"));
  mkdirSync(join(dir, "sandbox"), { recursive: true });
  writeFileSync(join(dir, "sandbox", "Dockerfile.sandbox"), "FROM node\n");
  writeFileSync(join(dir, "sandbox", "Some-Doc.md"), "x\n"); // this one SHOULD kebab
  await renameRecursive(dir);
  assert.ok(existsSync(join(dir, "sandbox", "Dockerfile.sandbox")), "Dockerfile.sandbox untouched");
  assert.ok(!existsSync(join(dir, "sandbox", "dockerfile.sandbox")), "no lowercase duplicate");
  assert.ok(existsSync(join(dir, "sandbox", "some-doc.md")), "ordinary file kebab-cased");
});

test("upgrade is idempotent (second run succeeds and stays current)", async () => {
  const dir = makeV5Install();
  assert.equal((await runUpgrade(dir)).code, 0);
  const { code, stdout } = await runUpgrade(dir);
  assert.equal(code, 0);
  assert.match(stdout, new RegExp(`Already on ${packageVersion().replace(/\./g, "\\.")}`));
});

// ---------------------------------------------------------------------------
// The upgrade commits itself (maintainer: remove upgrade friction).
//
// An upgrade rewrites the enforcement hooks, so its commit needs the
// CARJA_NO_PROTECTED waiver. Making every user discover and type that was
// the friction. `carja upgrade` now commits exactly the framework files it
// wrote, with the waiver set (so it is still logged), and never sweeps in the
// user's own work. When it cannot do that safely it prints the one command.
// ---------------------------------------------------------------------------
import { execFileSync } from "node:child_process";
import { initCommand } from "../src/commands/init.js";

const g = (dir, ...a) => execFileSync("git", ["-C", dir, ...a], { encoding: "utf8", env: { ...process.env, CARJA_HOOKS: "off" } }).trim();

/** A git repo holding an OLDER install: current templates with lib.sh edited, committed. */
// The upgrade commit, wherever it sits: upgrade may follow it with a commit of
// the waiver line its own hooks logged.
const upgradeCommit = (dir) => g(dir, "log", "-1", "--format=%H", "--grep=^chore: upgrade Carja");

async function makeGitInstall() {
  const dir = mkdtempSync(join(tmpdir(), "cond-git-"));
  execFileSync("git", ["-C", dir, "init", "-q"]);
  g(dir, "config", "user.email", "t@t.local");
  g(dir, "config", "user.name", "t");
  await initCommand([dir, "--all"], { cwd: tmpdir(), stdout: sink(), stderr: sink() });
  // An older release: a protected file differs, exactly what a real upgrade replaces.
  writeFileSync(join(dir, ".agents/hooks/lib.sh"), readFileSync(join(dir, ".agents/hooks/lib.sh"), "utf8") + "\n# older release\n");
  g(dir, "add", "-A");
  g(dir, "commit", "-q", "-m", "an older carja install");
  return dir;
}

test("upgrade commits the framework files itself, with the waiver", async () => {
  const dir = await makeGitInstall();
  const before = g(dir, "rev-parse", "HEAD");
  const { code, stdout } = await runUpgrade(dir);
  assert.equal(code, 0, stdout);
  assert.notEqual(g(dir, "rev-parse", "HEAD"), before, "no commit was made");
  assert.match(g(dir, "log", "-1", "--format=%s", upgradeCommit(dir)), new RegExp(`^chore: upgrade Carja to ${packageVersion()}`));
  assert.equal(g(dir, "status", "--porcelain", "--", ".agents"), "", "framework files left uncommitted");
  assert.match(stdout, /Push as usual/);
});

test("upgrade leaves a clean tree: it commits the waiver line its own commit logged", async () => {
  const dir = await makeGitInstall();
  // A real ship-log whose newest entry predates the For-you rule: the report
  // gate used to block committing the waiver line, leaving the repo dirty.
  writeFileSync(join(dir, "carja/0-compass/ship-log.md"), "# Ship Log\n\n## 2026-09-16 — Thing\n- **What:** something\n");
  g(dir, "add", "-A");
  g(dir, "commit", "-q", "-m", "an old ship-log");
  const { code, stdout } = await runUpgrade(dir);
  assert.equal(code, 0, stdout);
  assert.equal(g(dir, "status", "--porcelain"), "", "upgrade left uncommitted changes");
  assert.match(readFileSync(join(dir, "carja/0-compass/ship-log.md"), "utf8"), /Hook waiver \(Protected\): carja upgrade/);
});

// F7 (first real crossing, 2026-10-19): the message said "No waiver needed"
// and the next commit logged a waiver. The upgrade does need the
// protected-path waiver; it sets and logs it itself, so the user types none.
test("the upgrade message names the waiver it logged instead of denying it", async () => {
  for (const withRemoteToo of [false, true]) {
    const dir = await makeGitInstall();
    if (withRemoteToo) await withRemote(dir);
    const { code, stdout } = await runUpgrade(dir);
    assert.equal(code, 0, stdout);
    assert.doesNotMatch(stdout, /no waiver needed/i);
    const waiverSha = g(dir, "log", "-1", "--format=%h", "--grep", "upgrade waiver");
    assert.ok(waiverSha, "the waiver line was not committed");
    assert.match(stdout, new RegExp(`waiver.*${waiverSha}`, "i"));
    assert.match(stdout, /you type nothing|nothing to type/i);
  }
});

test("upgrade never sweeps the user's own staged work into its commit", async () => {
  const dir = await makeGitInstall();
  writeFileSync(join(dir, "mine.txt"), "my work in progress\n");
  g(dir, "add", "mine.txt");
  await runUpgrade(dir);
  assert.ok(!g(dir, "show", "--name-only", "--format=", upgradeCommit(dir)).split("\n").includes("mine.txt"), "user file was committed");
  assert.match(g(dir, "status", "--porcelain", "--", "mine.txt"), /^A /, "user file is no longer staged");
});

test("upgrade does not commit over the user's uncommitted framework edits", async () => {
  // Their notes in AGENTS.md outside the framework block are theirs; committing
  // them unasked would be a surprise. Print the one command instead.
  const dir = await makeGitInstall();
  // An older framework block, so the upgrade rewrites the file the note is in.
  writeFileSync(join(dir, "AGENTS.md"), readFileSync(join(dir, "AGENTS.md"), "utf8").replace(/(carja:framework:begin[^\n]*\n)/, "$1OLD FRAMEWORK LINE\n"));
  g(dir, "commit", "-qam", "an older framework block");
  writeFileSync(join(dir, "AGENTS.md"), readFileSync(join(dir, "AGENTS.md"), "utf8") + "\nMY UNCOMMITTED NOTE\n");
  const before = g(dir, "rev-parse", "HEAD");
  const { stdout } = await runUpgrade(dir);
  assert.equal(g(dir, "rev-parse", "HEAD"), before, "it committed over uncommitted user edits");
  assert.match(stdout, /CARJA_NO_PROTECTED="carja upgrade" git commit/);
  assert.match(stdout, /AGENTS\.md/);
  assert.match(readFileSync(join(dir, "AGENTS.md"), "utf8"), /MY UNCOMMITTED NOTE/, "the note survived the refresh");
  // F23: the first porcelain line lost its leading space, so the path lost its first letter.
  assert.match(stdout, /uncommitted changes in AGENTS\.md\b/);
  assert.match(stdout, /the upgrade changed (it|them) too/);
});

// F23 (2026-10-22, four product upgrades): a loop run leaves loop-state.json
// modified, the upgrade does not touch it, and yet the upgrade refused to commit
// and printed a command that committed it. Now the upgrade commits its own files
// and leaves the user's untouched uncommitted file out.
test("an uncommitted file the upgrade did not touch stays out of its commit, and the upgrade still commits", async () => {
  const dir = await makeGitInstall();
  await runUpgrade(dir); // current release first, so the next upgrade only refreshes
  writeFileSync(join(dir, ".agents/hooks/lib.sh"), readFileSync(join(dir, ".agents/hooks/lib.sh"), "utf8") + "\n# older release\n");
  g(dir, "add", "-A");
  g(dir, "commit", "-q", "-m", "an older carja install");
  const statePath = join(dir, "carja/1-workbench/loop-state.json");
  // As a loop run leaves it: a v2 state, written the way the driver writes it.
  const mine = `${JSON.stringify({ ...JSON.parse(readFileSync(statePath, "utf8")), status: "completed" }, null, 2)}\n`;
  writeFileSync(statePath, mine);
  const before = g(dir, "rev-parse", "HEAD");
  const { code, stdout } = await runUpgrade(dir);
  assert.equal(code, 0, stdout);
  assert.notEqual(g(dir, "rev-parse", "HEAD"), before, `no commit was made: ${stdout}`);
  assert.ok(!g(dir, "show", "--name-only", "--format=", upgradeCommit(dir)).split("\n").includes("carja/1-workbench/loop-state.json"), "the user's file was committed");
  assert.equal(readFileSync(statePath, "utf8"), mine, "the user's change is intact");
  assert.match(g(dir, "status", "--porcelain", "--", "carja/1-workbench/loop-state.json"), /^M /, "still modified, not staged (g trims the leading space)");
  assert.match(stdout, /carja\/1-workbench\/loop-state\.json/);
  assert.doesNotMatch(stdout, /(^|[^c])onductor\/1-workbench/m, "a path lost its first letter");
});

test("upgrade migrates a tracked CLAUDE.md and GEMINI.md: notes into AGENTS.md, deletions committed", async () => {
  const dir = await makeGitInstall();
  writeFileSync(join(dir, "CLAUDE.md"), "<!-- carja:managed:begin — x -->\nOLD\n<!-- carja:managed:end -->\n\nUse plan mode for billing.\n");
  writeFileSync(join(dir, "GEMINI.md"), "---\ntrigger: always_on\n---\n\n<!-- carja:managed:begin — x -->\nOLD\n<!-- carja:managed:end -->\n");
  g(dir, "add", "-A");
  g(dir, "commit", "-q", "-m", "old stubs");
  const { code, stdout } = await runUpgrade(dir);
  assert.equal(code, 0, stdout);
  assert.ok(!existsSync(join(dir, "CLAUDE.md")) && !existsSync(join(dir, "GEMINI.md")));
  const agentsMd = readFileSync(join(dir, "AGENTS.md"), "utf8");
  assert.match(agentsMd, /## Notes moved from CLAUDE\.md[\s\S]*Use plan mode for billing\./);
  assert.doesNotMatch(agentsMd, /Notes moved from GEMINI\.md/, "a stub with no user text moves nothing");
  assert.equal(g(dir, "status", "--porcelain", "--", "AGENTS.md", "CLAUDE.md", "GEMINI.md"), "", "the deletions and AGENTS.md were committed");
  assert.match(g(dir, "show", "--name-status", "--format=", upgradeCommit(dir)), /D\tCLAUDE\.md/);
});

test("upgrade keeps every byte of a team-written AGENTS.md, below the framework block", async () => {
  const dir = await makeGitInstall();
  const team = "# Company OS\n\nUse pnpm. Never push to main.\n";
  writeFileSync(join(dir, "AGENTS.md"), team);
  g(dir, "add", "-A");
  g(dir, "commit", "-q", "-m", "team agents file");
  const { code, stdout } = await runUpgrade(dir);
  assert.equal(code, 0, stdout);
  const agentsMd = readFileSync(join(dir, "AGENTS.md"), "utf8");
  assert.ok(agentsMd.startsWith("<!-- carja:framework:begin"));
  assert.ok(agentsMd.endsWith(team));
});

test("--no-commit prints the exact command and commits nothing", async () => {
  const dir = await makeGitInstall();
  const before = g(dir, "rev-parse", "HEAD");
  const { stdout } = await runUpgrade(dir, ["--no-commit"]);
  assert.equal(g(dir, "rev-parse", "HEAD"), before);
  assert.match(stdout, /CARJA_NO_PROTECTED="carja upgrade" git commit/);
});

test("the printed command works as printed", async () => {
  const dir = await makeGitInstall();
  const { stdout } = await runUpgrade(dir, ["--no-commit"]);
  const cmd = stdout.split("\n").map((l) => l.trim()).find((l) => l.startsWith("git add"));
  assert.ok(cmd, "no command printed");
  execFileSync("bash", ["-c", cmd], { cwd: dir, env: process.env });
  assert.equal(g(dir, "status", "--porcelain", "--", ".agents"), "", "the printed command left files uncommitted");
});

// ---------------------------------------------------------------------------
// 6.5.0 upgrade safety — each test reproduces a failure seen when upgrading a
// COPY of a real install (2026-09-24), not an invented shape.
// ---------------------------------------------------------------------------

test("R1: the upgrade commit includes the .claude/skills shims it generated, and never the user's own skill", async () => {
  const dir = await makeGitInstall();
  // An install from before the skill bridge: no .claude/skills at all.
  g(dir, "rm", "-r", "-q", ".claude/skills");
  g(dir, "commit", "-q", "-m", "an install that predates .claude/skills");
  mkdirSync(join(dir, ".claude", "skills", "my-own"), { recursive: true });
  writeFileSync(join(dir, ".claude", "skills", "my-own", "SKILL.md"), "---\nname: my-own\ndescription: mine\n---\n");

  const { code, stdout } = await runUpgrade(dir);
  assert.equal(code, 0, stdout);
  assert.ok(upgradeCommit(dir), "no upgrade commit");
  assert.equal(g(dir, "status", "--porcelain", "--", ".claude/skills/handoff"), "", "generated shim left uncommitted");
  assert.match(g(dir, "status", "--porcelain", "--", ".claude/skills/my-own"), /^\?\? /, "the user's own skill was swept into the upgrade commit");
});

test("R3: a V4 .conductor/ install gets its framework names kebab-cased at every level, and keeps the user's names", async () => {
  const dir = mkdtempSync(join(tmpdir(), "cond-v4-deep-"));
  const C = join(dir, ".conductor");
  // Names taken from a real V4 install's tree.
  const files = {
    "0-Compass/North-Star.md": "north star\n",
    "1-Workbench/Inbox.md": "- an inbox item\n",
    "2-Backlog/Task-Backlog.md": "tasks\n",
    "2-Backlog/Project-Backlog/Nexus/Genesis/Problem-Solar-System.md": "problem\n",
    "2-Backlog/Project-Backlog/Nexus/Blueprint/Grand-PRD.md": "prd\n",
    "2-Backlog/Project-Backlog/Nexus/Blueprint/UX-UI-Design-Brief.md": "ux\n",
    "2-Backlog/Project-Backlog/Nexus/Implementations/01-Foundation-Auth/Feature-Spec.md": "spec\n",
    "2-Backlog/Project-Backlog/Nexus/Implementations/01-Foundation-Auth/Task-Tracker.md": "tracker\n",
    "2-Backlog/Project-Backlog/Nexus/Nexus-Documentation/Project-Documentation.md": "docs\n",
    "3-Product-Areas/Nexus/Nexus-Features.md": "features\n",
    "4-Context/Meta/Glossary.md": "glossary\n",
    "4-Context/Technical/API-Discovery.md": "user file\n",
    "4-Context/Design/DESIGN.md": "user file\n",
    "4-Context/Design/Design-System.md": "our colours\n",
    "6-Archive/Completed-Implementations/03-AI-Follow-Up-Routing/Feature-Spec.md": "archived\n",
  };
  for (const [rel, body] of Object.entries(files)) {
    mkdirSync(join(C, rel, ".."), { recursive: true });
    writeFileSync(join(C, rel), body);
  }
  mkdirSync(join(dir, ".agents", "workflows"), { recursive: true });
  copyFileSync(join(TEMPLATES, ".agents", "AGENTS.md"), join(dir, ".agents", "AGENTS.md"));

  const { code, stdout } = await runUpgrade(dir);
  assert.equal(code, 0, stdout);

  const K = join(dir, "carja");
  const expected = {
    "0-compass/north-star.md": "north star\n",
    "1-workbench/inbox.md": "- an inbox item\n",
    "2-backlog/task-backlog.md": "tasks\n",
    "2-backlog/project-backlog/Nexus/genesis/problem-solar-system.md": "problem\n",
    "2-backlog/project-backlog/Nexus/blueprint/grand-prd.md": "prd\n",
    "2-backlog/project-backlog/Nexus/blueprint/ux-ui-design-brief.md": "ux\n",
    "2-backlog/project-backlog/Nexus/implementations/01-Foundation-Auth/feature-spec.md": "spec\n",
    "2-backlog/project-backlog/Nexus/implementations/01-Foundation-Auth/task-tracker.md": "tracker\n",
    "2-backlog/project-backlog/Nexus/Nexus-documentation/project-documentation.md": "docs\n",
    "3-product-areas/Nexus/Nexus-features.md": "features\n",
    "4-context/meta/glossary.md": "glossary\n",
    // Not framework names: left exactly as the user named them.
    "4-context/technical/API-Discovery.md": "user file\n",
    "4-context/design/DESIGN.md": "user file\n",
    // Retired scaffold: still renamed, so `carja design migrate` finds it.
    "4-context/design/design-system.md": "our colours\n",
    "6-archive/completed-implementations/03-AI-Follow-Up-Routing/feature-spec.md": "archived\n",
  };
  for (const [rel, body] of Object.entries(expected)) {
    assert.ok(existsSync(join(K, rel)), `missing after upgrade: carja/${rel}`);
    assert.equal(readFileSync(join(K, rel), "utf8"), body, `content changed: ${rel}`);
  }
  assert.ok(!readdirSync(join(K, "2-backlog")).includes("Project-Backlog"), "Title-Case framework folder left behind");
});

test("R3b: an install with no checksums loses the framework files Carja retired, and keeps its own", async () => {
  const dir = mkdtempSync(join(tmpdir(), "cond-v4-retired-"));
  mkdirSync(join(dir, ".conductor", "0-Compass"), { recursive: true });
  writeFileSync(join(dir, ".conductor", "0-Compass", "North-Star.md"), "n\n");
  const A = join(dir, ".agents");
  // Paths a real V4 install still held: a retired always-on rule and a retired skill.
  mkdirSync(join(A, "rules"), { recursive: true });
  writeFileSync(join(A, "rules", "Conductor-System.md"), "V4 rule pointing at .conductor/2-Backlog/\n");
  mkdirSync(join(A, "skills", "Clean-Code"), { recursive: true });
  writeFileSync(join(A, "skills", "Clean-Code", "SKILL.md"), "---\nname: Clean-Code\n---\n");
  mkdirSync(join(A, "skills", "acme-custom"), { recursive: true });
  writeFileSync(join(A, "skills", "acme-custom", "SKILL.md"), "---\nname: acme-custom\n---\ncustom\n");
  copyFileSync(join(TEMPLATES, ".agents", "AGENTS.md"), join(A, "AGENTS.md"));

  const { code, stdout } = await runUpgrade(dir);
  assert.equal(code, 0, stdout);
  assert.ok(!existsSync(join(A, "rules", "conductor-system.md")), "retired always-on rule carried forward");
  assert.ok(!existsSync(join(A, "skills", "clean-code")), "retired skill carried forward");
  assert.ok(existsSync(join(A, "skills", "acme-custom", "SKILL.md")), "the user's own skill was removed");
  assert.match(stdout, /rules\/conductor-system\.md/, "the removal is not reported");
});

test("the retired-file list never names a file Carja still ships", async () => {
  const { listFiles } = await import("../src/update.js");
  const retired = JSON.parse(readFileSync(new URL("../src/retired-framework-files.json", import.meta.url), "utf8")).files;
  const shipped = new Set(listFiles(join(TEMPLATES, ".agents")));
  assert.ok(retired.includes("rules/conductor-system.md"));
  for (const rel of retired) assert.ok(!shipped.has(rel), `${rel} is shipped again: re-run scripts/capture-retired-files.js`);
});

test("R4: upgrade refuses an agent-only repo with no carja/ and no version stamp, unless --force", async () => {
  const dir = mkdtempSync(join(tmpdir(), "cond-agent-only-"));
  mkdirSync(join(dir, ".agents", "skills", "Coherence-Gate"), { recursive: true });
  writeFileSync(join(dir, ".agents", "skills", "Coherence-Gate", "SKILL.md"), "---\nname: Coherence-Gate\n---\n");
  writeFileSync(join(dir, "CLAUDE.md"), "# Company OS\n\nRead AGENTS.md.\n");

  const refused = await runUpgrade(dir);
  assert.equal(refused.code, 1);
  assert.match(refused.stderr, /--force/);
  assert.ok(!existsSync(join(dir, "carja")), "refused, but still created carja/");
  assert.ok(!existsSync(join(dir, ".agents", "workflows")), "refused, but still installed workflows");
  assert.equal(readFileSync(join(dir, "CLAUDE.md"), "utf8"), "# Company OS\n\nRead AGENTS.md.\n");

  const forced = await runUpgrade(dir, ["--force"]);
  assert.equal(forced.code, 0, forced.stderr);
  assert.ok(existsSync(join(dir, ".agents", "workflows", "genesis.md")));
});

// ---------------------------------------------------------------------------
// F5 — the upgrade commit goes where a merge request can carry it.
//
// Real usage (2026-10): upgrade committed on local master in evalapp-v2, where
// the commits sat unpushed for a week in an MR-only repo; on an unrelated
// branch in website; and rode a feature MR in eurassistant. With a remote, the
// upgrade now commits on its own branch from the default branch, and does not
// commit on any other branch.
// ---------------------------------------------------------------------------

async function withRemote(dir) {
  const bare = mkdtempSync(join(tmpdir(), "cond-remote-"));
  execFileSync("git", ["init", "-q", "--bare", bare]);
  const branch = g(dir, "rev-parse", "--abbrev-ref", "HEAD");
  g(dir, "remote", "add", "origin", bare);
  g(dir, "push", "-q", "origin", `HEAD:${branch}`);
  g(dir, "remote", "set-head", "origin", branch);
  return branch;
}

test("on the default branch with a remote, upgrade commits on its own branch", async () => {
  const dir = await makeGitInstall();
  const main = await withRemote(dir);
  const before = g(dir, "rev-parse", main);
  const { code, stdout } = await runUpgrade(dir);
  assert.equal(code, 0, stdout);
  assert.equal(g(dir, "rev-parse", main), before, "upgrade committed on the default branch");
  const branch = `chore/carja-${packageVersion()}`;
  assert.equal(g(dir, "rev-parse", "--abbrev-ref", "HEAD"), branch);
  assert.ok(upgradeCommit(dir), "no upgrade commit on the new branch");
  assert.match(stdout, new RegExp(`git push -u origin ${branch.replace(/\./g, "\\.")}`));
  assert.match(stdout, /merge request|pull request/i);
  assert.doesNotMatch(stdout, /push as usual/i);
});

test("on another branch, upgrade does not commit and says why", async () => {
  const dir = await makeGitInstall();
  await withRemote(dir);
  g(dir, "switch", "-q", "-c", "feat/something");
  const before = g(dir, "rev-parse", "HEAD");
  const { code, stdout } = await runUpgrade(dir);
  assert.equal(code, 0, stdout);
  assert.equal(g(dir, "rev-parse", "HEAD"), before, "upgrade committed on a feature branch");
  assert.match(stdout, /feat\/something/);
  assert.match(stdout, /merge request|pull request/i);
});
