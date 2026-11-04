// test/template-integrity.test.js
//
// E5 — the drift gate for `templates/.agents/`.
//
// WHY A GATE AND NOT A GENERATOR. gstack generates its SKILL.md files from
// templates and gates freshness with `--dry-run && git diff --exit-code`. That
// is the right answer for them because their skill docs are largely mechanical
// (a command table derived from source). Ours are not: `registry.json` and
// `how-it-works.md` carry hand-written descriptions and a curated routing
// table, and those are the most valuable prose in the repo. Generating them
// would destroy information to solve a problem we do not have.
//
// The problem we DO have is drift: add a skill or a workflow, forget to wire it
// up, and nothing notices. This gate caught two real ones on its first run:
//
//   * `agentic-flow.md` shipped in every install and was DOCUMENTED (a row in
//     the Cross-Cutting table, an entry in registry.json) but no file path or
//     trigger pointed at it, so a user typing "design a flow" could never
//     reach it. Documented is not the same as routable — which is precisely
//     why this check looks for a reference to the FILE, not a mention of the
//     name.
//   * `loop-checker.md` and `unattended-loop.md` had empty descriptions in
//     registry.json, so the one place an agent looks a workflow up said
//     nothing about what they do.
//
// Structural checks, and honest about it: they prove a file is REACHABLE, not
// that the routing is good. Whether the model actually picks the right workflow
// is the routing eval's job (test/evals/routing-eval.mjs).

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, existsSync, statSync } from "node:fs";
import { join } from "node:path";

const ROOT = new URL("..", import.meta.url).pathname;
const AGENTS = join(ROOT, "templates", ".agents");

const read = (p) => readFileSync(p, "utf8");
const registry = JSON.parse(read(join(AGENTS, "registry.json")));
const agentsMd = read(join(AGENTS, "AGENTS.md"));
const howItWorks = read(join(AGENTS, "how-it-works.md"));

const dirsIn = (p) =>
  existsSync(p) ? readdirSync(p).filter((d) => statSync(join(p, d)).isDirectory()).sort() : [];
const mdIn = (p) =>
  existsSync(p) ? readdirSync(p).filter((f) => f.endsWith(".md")).sort() : [];

const skillsOnDisk = dirsIn(join(AGENTS, "skills"));
const workflowsOnDisk = mdIn(join(AGENTS, "workflows")).map((f) => f.replace(/\.md$/, ""));
const rulesOnDisk = mdIn(join(AGENTS, "rules")).map((f) => f.replace(/\.md$/, ""));

const listed = (kind) =>
  (registry[kind] ?? []).map((e) => String(e.dir ?? e.file ?? "").replace(/\.md$/, "")).sort();

/** Every template file except the one under test — used for reachability. */
function allTemplateText(excludePath, skipRel = () => false) {
  const out = [];
  const walk = (dir, rel = "") => {
    for (const name of readdirSync(dir)) {
      const p = join(dir, name);
      const r = rel ? `${rel}/${name}` : name;
      const st = statSync(p);
      if (st.isDirectory()) walk(p, r);
      else if (/\.(md|json|sh)$/.test(name) && p !== excludePath && !skipRel(r)) out.push(read(p));
    }
  };
  walk(AGENTS);
  return out.join("\n");
}

describe("E5.1 — registry.json matches what actually ships", () => {
  for (const [kind, onDisk] of [
    ["skills", skillsOnDisk],
    ["workflows", workflowsOnDisk],
    ["rules", rulesOnDisk],
  ]) {
    test(`every ${kind.slice(0, -1)} on disk is listed in registry.json`, () => {
      const missing = onDisk.filter((n) => !listed(kind).includes(n));
      assert.deepEqual(
        missing,
        [],
        `${kind} on disk but absent from registry.json: ${missing.join(", ")}. ` +
          `An unlisted capability cannot be discovered.`,
      );
    });

    test(`every ${kind.slice(0, -1)} in registry.json exists on disk`, () => {
      const phantom = listed(kind).filter((n) => !onDisk.includes(n));
      assert.deepEqual(
        phantom,
        [],
        `registry.json lists ${kind} that do not exist: ${phantom.join(", ")}. ` +
          `A phantom entry sends an agent to a missing file.`,
      );
    });
  }

  test("every registry entry carries a non-empty description", () => {
    const bare = [];
    for (const kind of ["skills", "workflows", "rules"]) {
      for (const e of registry[kind] ?? []) {
        if (!String(e.description ?? "").trim()) bare.push(`${kind}/${e.dir ?? e.file}`);
      }
    }
    assert.deepEqual(bare, [], `registry entries with no description: ${bare.join(", ")}`);
  });
});

describe("E5.2 — every workflow is reachable", () => {
  // Both of these are INVENTORIES: they enumerate what exists so it can be
  // looked up or verified. Neither is a ROUTE, so neither counts as
  // reachability — being in a stock list is not the same as a request being
  // able to arrive at you.
  const INVENTORIES = [join(AGENTS, "registry.json"), join(AGENTS, "tests", "check-carja.sh")];

  for (const wf of workflowsOnDisk) {
    test(`${wf}.md is reachable from something other than an inventory`, () => {
      const own = join(AGENTS, "workflows", `${wf}.md`);
      let corpus = allTemplateText(own);
      for (const inv of INVENTORIES) corpus = corpus.replace(read(inv), "");
      assert.ok(
        corpus.includes(wf),
        `nothing points at the PATH workflows/${wf}.md outside an inventory — no classifier ` +
          `trigger, no routing-table link, no other workflow chaining to it. Being named in prose ` +
          `is not a route: it ships in every install and no request can arrive at it. Add a ` +
          `classifier row to AGENTS.md, or a link from how-it-works.md, or remove the file.`,
      );
    });
  }
});

describe("E5.3 — the classifier and the routing table point at real files", () => {
  test("every workflows/<name>.md named in AGENTS.md exists", () => {
    const named = [...agentsMd.matchAll(/workflows\/([a-z0-9-]+)\.md/g)].map((m) => m[1]);
    const broken = [...new Set(named)].filter((n) => !workflowsOnDisk.includes(n));
    assert.deepEqual(broken, [], `AGENTS.md routes to missing workflows: ${broken.join(", ")}`);
  });

  test("every workflows/<name>.md named in how-it-works.md exists", () => {
    const named = [...howItWorks.matchAll(/workflows\/([a-z0-9-]+)\.md/g)].map((m) => m[1]);
    const broken = [...new Set(named)].filter((n) => !workflowsOnDisk.includes(n));
    assert.deepEqual(broken, [], `how-it-works.md routes to missing workflows: ${broken.join(", ")}`);
  });

  test("every skills/<dir> named anywhere in the templates exists", () => {
    // `references/` is excluded: each reference file opens with a provenance
    // note ("Demoted from `skills/clean-code/` in the skill-catalog audit"),
    // which names a skill that deliberately no longer exists. That is accurate
    // history, not a broken route.
    const corpus = allTemplateText(null, (rel) => rel.startsWith("references/"));
    const named = [...corpus.matchAll(/skills\/([a-z0-9-]+)\//g)].map((m) => m[1]);
    const broken = [...new Set(named)].filter((n) => !skillsOnDisk.includes(n));
    assert.deepEqual(broken, [], `templates reference missing skills: ${broken.join(", ")}`);
  });

  test("every rules/<name>.md named anywhere in the templates exists", () => {
    const corpus = allTemplateText(null);
    const named = [...corpus.matchAll(/rules\/([a-z0-9-]+)\.md/g)].map((m) => m[1]);
    const broken = [...new Set(named)].filter((n) => !rulesOnDisk.includes(n));
    assert.deepEqual(broken, [], `templates reference missing rules: ${broken.join(", ")}`);
  });
});

describe("E5.4 — every skill is routable by its own frontmatter", () => {
  // Progressive Disclosure means the router reads frontmatter to decide what to
  // load. A skill with no name or no description cannot be routed to without
  // reading its whole body, which defeats the point.
  for (const dir of skillsOnDisk) {
    test(`skills/${dir} declares name + description in frontmatter`, () => {
      const text = read(join(AGENTS, "skills", dir, "SKILL.md"));
      const fm = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text);
      assert.ok(fm, `skills/${dir}/SKILL.md has no frontmatter`);
      assert.match(fm[1], /^name:\s*\S/m, `skills/${dir} frontmatter has no name`);
      assert.match(fm[1], /^description:\s*\S/m, `skills/${dir} frontmatter has no description`);
    });
  }
});

describe("E5.5 — host integration points are the only host-specific references", () => {
  // Carja installs `.agents/`, the cross-tool convention, so the
  // methodology is host-neutral by construction and needs no per-host
  // compilation. This test PINS that: a `.claude/` reference is allowed only in
  // the few files that legitimately wire up Claude Code (settings.json, slash
  // commands), never in a workflow, skill, rule or persona.
  const ALLOWED = new Set([
    "hooks/README.md",
    "hooks/verification-stop-hook.sh",
    // PreToolUse is a Claude Code mechanism with no cross-host equivalent, so
    // the bypass blocker is an integration point like the Stop hook above, not
    // methodology. Its own header states the reach limit and names the
    // after-the-fact fallback the other engines get.
    "hooks/pretooluse-no-bypass.sh",
    "hooks/pretooluse-fact-gate.sh",
    "sandbox/README.md",
    "how-it-works.md",
    "tests/check-carja.sh",
  ]);

  test("no workflow, skill, rule or persona hardcodes a host path", () => {
    const offenders = [];
    const walk = (dir, rel = "") => {
      for (const name of readdirSync(dir)) {
        const p = join(dir, name);
        const r = rel ? `${rel}/${name}` : name;
        if (statSync(p).isDirectory()) walk(p, r);
        else if (/\.(md|sh)$/.test(name) && !ALLOWED.has(r) && /\.claude\/|~\/\.claude/.test(read(p))) {
          offenders.push(r);
        }
      }
    };
    walk(AGENTS);
    assert.deepEqual(
      offenders,
      [],
      `host-specific paths leaked into the methodology: ${offenders.join(", ")}. ` +
        `Carja is host-neutral by installing .agents/ — keep host wiring in the integration files.`,
    );
  });

  test("platform-specific tool names always carry a fallback", () => {
    // "Task tool" is Claude Code's; every mention must be paired with guidance
    // for a platform that has no such primitive, or Antigravity/Codex users hit
    // an instruction they cannot follow.
    const walk = (dir) => {
      const out = [];
      for (const name of readdirSync(dir)) {
        const p = join(dir, name);
        if (statSync(p).isDirectory()) out.push(...walk(p));
        else if (name.endsWith(".md")) out.push([p, read(p)]);
      }
      return out;
    };
    for (const [p, text] of walk(AGENTS)) {
      if (!/Task tool/.test(text)) continue;
      assert.match(
        text,
        /sub-?agent primitive|Antigravity|no sub-?agent/i,
        `${p.replace(ROOT, "")} names Claude Code's Task tool with no fallback for other platforms`,
      );
    }
  });
});

describe("the state files stay readable raw", () => {
  // `carja view` renders documents, so a pipe table in a DOCUMENT is an
  // asset there — dense and scannable. These three are different: they are the
  // high-churn state files, read and edited straight in a terminal and diffed
  // line-by-line in git. A table in one of them is unreadable with `cat` and
  // noisy in a diff, so it stays out.
  const STATE_FILES = [
    "carja/1-workbench/inbox.md",
    "carja/1-workbench/scratchpad.md",
    "carja/2-backlog/task-backlog.md",
  ];

  for (const rel of STATE_FILES) {
    test(`${rel} has no pipe table`, () => {
      const path = join(ROOT, "templates", rel);
      assert.ok(existsSync(path), `${rel} is missing from templates/`);
      const lines = read(path).split(/\r?\n/);
      const offender = lines.findIndex((l) => /^\s*\|/.test(l));
      assert.equal(
        offender,
        -1,
        `${rel}:${offender + 1} starts a markdown table — these files are read raw in a terminal`,
      );
    });
  }
});
