// DESIGN.md — one file that keeps the UI coherent, months after the first build.
//
// carja/4-context/design/ shipped three files (design-system, ui-components,
// brand-assets) that no workflow filled before Build and only one skill read.
// They are replaced by one DESIGN.md at the code repository root, which travels
// with the code even when carja/ lives in a separate outer repository.
//
// `carja design migrate` carries whatever a project wrote in the old folder
// into DESIGN.md: every section is mapped by its heading, sections still equal
// to the shipped template are dropped, and each migrated source becomes a
// pointer so the two copies cannot drift. Nothing is deleted.

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, readFile, readdir } from "node:fs/promises";
import { existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync, spawnSync } from "node:child_process";
import { resolveRules } from "../src/personas.js";
import { DESIGN_SECTIONS, splitSections, buildDesignMd } from "../src/design-md.js";
import { designCommand, designMigrationHint } from "../src/commands/design.js";

const ROOT = join(import.meta.dirname, "..");
const LEGACY = JSON.parse(readFileSync(join(ROOT, "src", "retired-design-templates.json"), "utf8")).files;

function io() {
  let out = "";
  let err = "";
  return {
    stdout: { write: (s) => (out += s) },
    stderr: { write: (s) => (err += s) },
    get out() { return out; },
    get err() { return err; },
  };
}

// A project that filled its colours and logo, left everything else as shipped,
// and added a file of its own plus an image.
async function project({ nested = false } = {}) {
  const root = await mkdtemp(join(tmpdir(), "cond-design-"));
  const dir = join(root, "carja", "4-context", "design");
  await mkdir(dir, { recursive: true });
  const ds = LEGACY["design-system.md"].replace(
    "| Primary | #000000 | (e.g., Buttons, links) |",
    "| Primary | #0077B6 | Buttons, links |",
  );
  await writeFile(join(dir, "design-system.md"), ds);
  await writeFile(join(dir, "ui-components.md"), LEGACY["ui-components.md"]);
  await writeFile(
    join(dir, "brand-assets.md"),
    LEGACY["brand-assets.md"].replace("- **Primary:** (link or path)", "- **Primary:** /public/logo.svg"),
  );
  await writeFile(join(dir, "motion.md"), "# Motion\n\n## Transitions\n\nEase-out, 150ms, never on page load.\n");
  await writeFile(join(dir, "logo.svg"), "<svg/>");
  let code = root;
  if (nested) {
    const git = (cwd, ...a) => execFileSync("git", a, { cwd, stdio: "pipe" });
    git(root, "init", "-q");
    await writeFile(join(root, ".gitignore"), "app/\n");
    code = join(root, "app");
    await mkdir(code);
    git(code, "init", "-q");
  }
  return { root, dir, code };
}

describe("splitting and mapping", () => {
  test("a file splits into its preamble and its H2 sections", () => {
    const s = splitSections("# T\n\nintro\n\n---\n\n## Colors\n\nred\n\n## Fonts\n\nInter\n");
    assert.deepEqual(s.map((x) => x.title), [null, "Colors", "Fonts"]);
    assert.equal(s[1].body.trim(), "red");
  });

  test("sections land under the canonical heading their title names", async () => {
    const { dir } = await project();
    const files = {};
    for (const f of await readdir(dir)) files[f] = await readFile(join(dir, f), "utf8");
    const { markdown } = buildDesignMd(files, { legacy: LEGACY, source: "carja/4-context/design" });
    const section = (title) => {
      const start = markdown.indexOf(`## ${title}`);
      const next = markdown.indexOf("\n## ", start + 1);
      return markdown.slice(start, next < 0 ? undefined : next);
    };
    assert.match(section("Colour Palette & Roles"), /#0077B6/);
    assert.match(section("Brand Assets"), /\/public\/logo\.svg/);
    assert.match(section("Other Notes"), /Ease-out, 150ms/);
    assert.match(section("Brand Assets"), /logo\.svg/, "a non-text file is listed, not lost");
  });

  test("sections still equal to the shipped template are dropped", async () => {
    const { dir } = await project();
    const files = {};
    for (const f of await readdir(dir)) files[f] = await readFile(join(dir, f), "utf8");
    const { markdown, migrated, templateOnly } = buildDesignMd(files, { legacy: LEGACY, source: "x" });
    assert.doesNotMatch(markdown, /\(e\.g\., Inter\)/, "template typography placeholder copied");
    assert.doesNotMatch(markdown, /Skeletons\? Spinners\?/, "template component placeholder copied");
    assert.deepEqual(templateOnly, ["ui-components.md"]);
    assert.deepEqual(migrated.sort(), ["brand-assets.md", "design-system.md", "motion.md"]);
  });

  test("every canonical section appears, in order, even when empty", () => {
    const { markdown } = buildDesignMd({}, { legacy: LEGACY, source: "x" });
    let at = -1;
    for (const title of DESIGN_SECTIONS.map((s) => s.title)) {
      const i = markdown.indexOf(`## ${title}`);
      assert.ok(i > at, `${title} missing or out of order`);
      at = i;
    }
  });

  test("the greenfield template uses the same canonical sections as the migration", () => {
    const tpl = readFileSync(join(ROOT, "templates", "carja", "5-templates", "design-md.md"), "utf8");
    const headings = [...tpl.matchAll(/^## (.+)$/gm)].map((m) => m[1].trim());
    assert.deepEqual(headings, DESIGN_SECTIONS.map((s) => s.title));
  });
});

describe("carja design migrate", () => {
  test("writes DESIGN.md at the root and turns each migrated source into a pointer", async () => {
    const { root, dir } = await project();
    const s = io();
    assert.equal(await designCommand(["migrate", root], { cwd: root, ...s }), 0, s.err);
    const design = await readFile(join(root, "DESIGN.md"), "utf8");
    assert.match(design, /#0077B6/);
    for (const f of ["design-system.md", "brand-assets.md", "motion.md", "ui-components.md"]) {
      assert.match(await readFile(join(dir, f), "utf8"), /Moved to `?DESIGN\.md`?/, `${f} is not a pointer`);
    }
    assert.equal(await readFile(join(dir, "logo.svg"), "utf8"), "<svg/>", "a non-text file was touched");
  });

  test("in the outer layout DESIGN.md goes to the nested code repository", async () => {
    const { root, code } = await project({ nested: true });
    const s = io();
    assert.equal(await designCommand(["migrate", root], { cwd: root, ...s }), 0, s.err);
    assert.ok(existsSync(join(code, "DESIGN.md")), "not written in the code repo");
    assert.ok(!existsSync(join(root, "DESIGN.md")), "written in the outer repo");
  });

  test("an existing DESIGN.md is never overwritten", async () => {
    const { root, dir } = await project();
    await writeFile(join(root, "DESIGN.md"), "mine\n");
    const s = io();
    assert.equal(await designCommand(["migrate", root], { cwd: root, ...s }), 1);
    assert.equal(await readFile(join(root, "DESIGN.md"), "utf8"), "mine\n");
    assert.match(await readFile(join(dir, "motion.md"), "utf8"), /Ease-out/, "sources changed after a refusal");
  });

  test("--dry-run prints the result and writes nothing", async () => {
    const { root, dir } = await project();
    const s = io();
    assert.equal(await designCommand(["migrate", root, "--dry-run"], { cwd: root, ...s }), 0);
    assert.match(s.out, /#0077B6/);
    assert.ok(!existsSync(join(root, "DESIGN.md")));
    assert.match(await readFile(join(dir, "motion.md"), "utf8"), /Ease-out/);
  });

  test("upgrade's hint shows before migration and disappears after it", async () => {
    const { root } = await project();
    assert.match(await designMigrationHint(root), /carja design migrate/);
    await designCommand(["migrate", root], { cwd: root, ...io() });
    assert.equal(await designMigrationHint(root), null);
  });

  test("a folder of untouched templates writes no DESIGN.md: Build would skip extracting a real one", async () => {
    const root = await mkdtemp(join(tmpdir(), "cond-design-tpl-"));
    const dir = join(root, "carja", "4-context", "design");
    await mkdir(dir, { recursive: true });
    for (const [f, text] of Object.entries(LEGACY)) await writeFile(join(dir, f), text);
    const s = io();
    assert.equal(await designCommand(["migrate", root], { cwd: root, ...s }), 0);
    assert.ok(!existsSync(join(root, "DESIGN.md")), "an empty skeleton was written");
    assert.match(s.out, /design-system/);
    assert.equal(await readFile(join(dir, "design-system.md"), "utf8"), LEGACY["design-system.md"], "sources changed");
    assert.equal(await designMigrationHint(root), null, "upgrade keeps nagging about untouched templates");
  });

  test("no design folder: nothing to migrate, exit 0", async () => {
    const root = await mkdtemp(join(tmpdir(), "cond-design-empty-"));
    const s = io();
    assert.equal(await designCommand(["migrate", root], { cwd: root, ...s }), 0);
    assert.match(s.out, /Nothing to migrate/);
  });
});

describe("the framework uses DESIGN.md", () => {
  const read = (...p) => readFileSync(join(ROOT, "templates", ...p), "utf8");

  test("new installs no longer get the three design files", () => {
    assert.ok(!existsSync(join(ROOT, "templates", "carja", "4-context", "design")));
  });

  test("no template points at the retired design files", () => {
    const r = spawnSync("grep", ["-rlE", "4-context/design|design-system\\.md|ui-components\\.md|brand-assets\\.md",
      join(ROOT, "templates")], { encoding: "utf8" });
    // Only the migration instructions may name the old folder.
    const allowed = [/skills\/design-system\/SKILL\.md$/, /\.agents\/how-it-works\.md$/];
    const offenders = r.stdout.split("\n").filter((f) => f && !allowed.some((re) => re.test(f)));
    assert.deepEqual(offenders, []);
  });

  test("the UX/UI Brief creates DESIGN.md with the design-system skill", () => {
    const brief = read(".agents", "workflows", "ux-ui-design-brief.md");
    assert.match(brief, /DESIGN\.md/);
    assert.match(brief, /skills\/design-system\/SKILL\.md/);
  });

  test("carja personas hands the Designer DESIGN.md and the design-system skill", () => {
    const ctx = resolveRules({}).designer.context;
    assert.ok(ctx.includes("DESIGN.md"));
    assert.ok(ctx.includes(".agents/skills/design-system/SKILL.md"));
  });

  test("Build reads the UX/UI Brief and DESIGN.md before it builds a screen", () => {
    const build = read(".agents", "workflows", "build.md");
    const phase0 = build.slice(build.indexOf("## Phase 0"), build.indexOf("## Phase 1"));
    assert.match(phase0, /blueprint\/ux-ui-design-brief\.md/, "Build never reads the screen design");
    assert.match(phase0, /DESIGN\.md/);
    assert.doesNotMatch(phase0, /\(Technical, Design\)/, "still points at the retired design folder");
  });

  test("the Designer always gets DESIGN.md as context", () => {
    const designer = read(".agents", "personas", "designer.md");
    assert.match(designer, /DESIGN\.md/);
    assert.doesNotMatch(designer, /4-context\/design/);
  });
});
