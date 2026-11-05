// The documentation follows the code: what ships is documented, what is gone
// is not.
//
// Prose about the framework drifts silently: a persona is removed and README
// still counts it, a command is added and only `--help` knows it. These checks
// are the grep-able part of that rule. Anything they cannot see (the meaning of
// a paragraph) is the author's job, per CLAUDE.md "How to Work".

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(import.meta.dirname, "..");
const AGENTS = join(ROOT, "templates", ".agents");
const read = (...p) => readFileSync(join(ROOT, ...p), "utf8");

const README = read("README.md");
// The credits quote other projects' counts ("Now 47 skills"): not ours.
const README_OWN = README.slice(0, README.indexOf("## Credits"));
const CLAUDE = read("CLAUDE.md");
const HOW = read("templates", ".agents", "how-it-works.md");

const personas = readdirSync(join(AGENTS, "personas")).filter((f) => f.endsWith(".md")).map((f) => f.replace(/\.md$/, ""));
const skills = readdirSync(join(AGENTS, "skills")).filter((d) => statSync(join(AGENTS, "skills", d)).isDirectory());
const workflows = readdirSync(join(AGENTS, "workflows")).filter((f) => f.endsWith(".md"));
const commands = [...read("src", "cli.js").matchAll(/case "([a-z-]+)":/g)].map((m) => m[1]);

describe("README counts what ships", () => {
  for (const [label, re, n] of [
    ["personas", /\b(\d+) (?:Personas|thinking partners)\b/g, personas.length],
    ["skills", /\b(\d+) (?:Skills|modular skills|core skills|skills,)/g, skills.length],
    ["workflows", /\b(\d+) (?:Workflows|workflows)\b/g, workflows.length],
  ]) {
    test(`every ${label} count in README is ${n}`, () => {
      const found = [...README_OWN.matchAll(re)].map((m) => Number(m[1]));
      assert.ok(found.length > 0, `README states no ${label} count`);
      assert.deepEqual([...new Set(found)], [n], `README says ${found.join(", ")} ${label}, templates ship ${n}`);
    });
  }
});

describe("every CLI command is documented", () => {
  test("in README", () => {
    const missing = commands.filter((c) => !new RegExp(`carja(-framework)? ${c}\\b`).test(README));
    assert.deepEqual(missing, [], `README never shows: ${missing.join(", ")}`);
  });

  test("in CLAUDE.md", () => {
    const missing = commands.filter((c) => !new RegExp(`carja ${c}\\b|\\b${c}\\.js\\b`).test(CLAUDE));
    assert.deepEqual(missing, [], `CLAUDE.md never names: ${missing.join(", ")}`);
  });
});

describe("how-it-works registries list exactly what ships", () => {
  const section = (title) => {
    const start = HOW.indexOf(title);
    const end = HOW.indexOf("\n## ", start + 1);
    return HOW.slice(start, end < 0 ? undefined : end);
  };

  test("the Persona Registry has one row per persona file, and none for a removed one", () => {
    const table = section("## Persona Registry");
    const rows = [...table.matchAll(/^\| \*\*([^*]+)\*\* \|/gm)].map((m) => m[1].toLowerCase().replace(/ /g, "-"));
    assert.deepEqual(rows.sort(), [...personas].sort());
  });

  test("every skill directory appears in how-it-works, and every skill named there exists", () => {
    const named = new Set([...HOW.matchAll(/^\| `([a-z0-9-]+)` \|/gm)].map((m) => m[1]));
    const missing = skills.filter((s) => !named.has(s));
    assert.deepEqual(missing, [], `skills not in how-it-works: ${missing.join(", ")}`);
    const gone = [...named].filter((n) => !skills.includes(n));
    assert.deepEqual(gone, [], `how-it-works lists skills that no longer ship: ${gone.join(", ")}`);
  });
});
