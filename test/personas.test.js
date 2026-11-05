// `carja personas` — which domain personas a change needs.
//
// The personas sat unused because nothing loaded them: a prose "persona
// selector" in the loop, and a trigger phrase the human had to remember. Build
// wrote UI without the Designer and auth code without the Security Auditor.
// This maps the paths a change touches to the personas that must judge it, in
// code, so Build, Ship and the loop all get the same answer.

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, readFile, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync, spawnSync } from "node:child_process";
import { matchPersonas, pathWords, resolveRules, extractReviewLens } from "../src/personas.js";
import { personasCommand } from "../src/commands/personas.js";

const TEMPLATES = join(import.meta.dirname, "..", "templates");
const names = (matches) => matches.map((m) => m.name).sort();

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

describe("path words", () => {
  test("splits directories, separators and camelCase into lowercase words", () => {
    assert.deepEqual(pathWords("src/auth/LoginForm.tsx"), ["src", "auth", "login", "form", "tsx"]);
    assert.deepEqual(pathWords("db/migrations/2024_add_user.sql"), ["db", "migrations", "2024", "add", "user", "sql"]);
  });
});

describe("matching", () => {
  const rules = resolveRules({});

  test("a UI component gets the Designer", () => {
    assert.deepEqual(names(matchPersonas(["src/components/Button.tsx"], rules)), ["designer"]);
    assert.deepEqual(names(matchPersonas(["app/styles/main.scss"], rules)), ["designer"]);
  });

  test("an auth file gets the Security Auditor, a login form gets both", () => {
    assert.deepEqual(names(matchPersonas(["src/api/session.py"], rules)), ["security-auditor"]);
    assert.deepEqual(names(matchPersonas(["src/auth/LoginForm.tsx"], rules)), ["designer", "security-auditor"]);
  });

  test("a migration or schema gets the Database Architect", () => {
    assert.deepEqual(names(matchPersonas(["db/migrations/0003_orders.sql"], rules)), ["database-architect"]);
    assert.deepEqual(names(matchPersonas(["prisma/schema.prisma"], rules)), ["database-architect"]);
  });

  test("a cache or worker gets the Performance Optimizer", () => {
    assert.deepEqual(names(matchPersonas(["src/cache/redisCache.ts"], rules)), ["performance-optimizer"]);
  });

  test("a dependency manifest gets the Architect: that is where coupling and lock-in enter", () => {
    assert.deepEqual(names(matchPersonas(["package.json"], rules)), ["architect"]);
    assert.deepEqual(names(matchPersonas(["services/api/pyproject.toml", "go.mod"], rules)), ["architect"]);
    assert.deepEqual(matchPersonas(["src/config/settings.json"], rules), []);
  });

  test("plain logic and documentation get no persona", () => {
    assert.deepEqual(matchPersonas(["src/billing/invoice.js", "README.md", "docs/auth.md"], rules), []);
  });

  test("each match lists the files that triggered it", () => {
    const [m] = matchPersonas(["src/components/A.tsx", "src/x.js", "src/components/B.tsx"], rules);
    assert.equal(m.name, "designer");
    assert.deepEqual(m.files, ["src/components/A.tsx", "src/components/B.tsx"]);
  });
});

describe("project override", () => {
  test("carja.config.json replaces one persona's rules and leaves the others", () => {
    const rules = resolveRules({ personas: { designer: { extensions: ["erb"], words: [] } } });
    assert.deepEqual(names(matchPersonas(["app/views/home.html.erb"], rules)), ["designer"]);
    assert.deepEqual(matchPersonas(["src/components/Button.tsx"], rules), []);
    assert.deepEqual(names(matchPersonas(["src/auth/x.js"], rules)), ["security-auditor"]);
  });

  test("false switches a persona off", () => {
    const rules = resolveRules({ personas: { "performance-optimizer": false } });
    assert.deepEqual(matchPersonas(["src/cache/x.ts"], rules), []);
  });
});

describe("the shipped persona files", () => {
  test("every mapped persona exists and carries a Review Lens of 2 to 5 lines", async () => {
    for (const name of Object.keys(resolveRules({}))) {
      const text = await readFile(join(TEMPLATES, ".agents", "personas", `${name}.md`), "utf8");
      const lens = extractReviewLens(text);
      assert.ok(lens.length >= 2 && lens.length <= 5, `${name}: ${lens.length} review lines`);
    }
  });

  test("the redundant personas are gone and no template points at them", async () => {
    const files = await readdir(join(TEMPLATES, ".agents", "personas"));
    for (const gone of ["maker.md", "tech-lead.md"]) {
      assert.ok(!files.includes(gone), `${gone} still shipped`);
    }
    const r = spawnSync("grep", ["-rlE", "personas/(maker|tech-lead)\\.md|personas/CTO\\.md|Load the \\*\\*Maker\\*\\* persona", TEMPLATES], {
      encoding: "utf8",
    });
    assert.equal(r.stdout, "");
  });
});

describe("the command", () => {
  async function repo() {
    const root = await mkdtemp(join(tmpdir(), "cond-personas-"));
    await mkdir(join(root, ".agents", "personas"), { recursive: true });
    for (const name of Object.keys(resolveRules({}))) {
      const src = await readFile(join(TEMPLATES, ".agents", "personas", `${name}.md`), "utf8");
      await writeFile(join(root, ".agents", "personas", `${name}.md`), src);
    }
    return root;
  }

  test("explicit paths: prints each persona, its trigger files and its Review Lens", async () => {
    const root = await repo();
    const s = io();
    const code = await personasCommand(["src/components/Card.tsx", "src/util.js"], { cwd: root, ...s });
    assert.equal(code, 0);
    assert.match(s.out, /designer/);
    assert.match(s.out, /\.agents\/personas\/designer\.md/);
    assert.match(s.out, /src\/components\/Card\.tsx/);
    assert.match(s.out, /Review Lens/);
    assert.doesNotMatch(s.out, /security-auditor/);
  });

  test("--json is machine-readable", async () => {
    const root = await repo();
    const s = io();
    await personasCommand(["--json", "src/auth/token.ts"], { cwd: root, ...s });
    const data = JSON.parse(s.out);
    assert.equal(data.personas[0].name, "security-auditor");
    assert.ok(data.personas[0].review.length >= 2);
  });

  test("no paths: reads the branch diff, uncommitted and untracked files included", async () => {
    const root = await repo();
    const git = (...a) => execFileSync("git", a, { cwd: root, stdio: "pipe" });
    git("init", "-q", "-b", "main");
    git("-c", "user.email=t@t", "-c", "user.name=t", "commit", "-q", "--allow-empty", "-m", "base");
    git("checkout", "-q", "-b", "feat");
    await mkdir(join(root, "db", "migrations"), { recursive: true });
    await writeFile(join(root, "db", "migrations", "001_init.sql"), "create table t();\n");
    git("add", ".");
    git("-c", "user.email=t@t", "-c", "user.name=t", "commit", "-q", "-m", "migration");
    await mkdir(join(root, "src", "components"), { recursive: true });
    await writeFile(join(root, "src", "components", "New.tsx"), "export {}\n");
    const s = io();
    await personasCommand(["--json", "--base", "main"], { cwd: root, ...s });
    assert.deepEqual(names(JSON.parse(s.out).personas), ["database-architect", "designer"]);
  });

  test("with several code repositories, the Designer gets the DESIGN.md of the repository it touches", async () => {
    // One install, two products (a public site and a CMS) with different designs.
    const root = await repo();
    const git = (cwd, ...a) => execFileSync("git", a, { cwd, stdio: "pipe" });
    git(root, "init", "-q");
    await writeFile(join(root, ".gitignore"), "site/\ncms/\n");
    for (const r of ["site", "cms"]) {
      await mkdir(join(root, r), { recursive: true });
      git(join(root, r), "init", "-q");
    }
    const s = io();
    await personasCommand(["--json", "cms/src/components/Editor.tsx"], { cwd: root, ...s });
    const designer = JSON.parse(s.out).personas.find((p) => p.name === "designer");
    assert.ok(designer.context.includes("cms/DESIGN.md"), designer.context.join(", "));
    assert.ok(!designer.context.includes("site/DESIGN.md"));
    assert.ok(!designer.context.includes("DESIGN.md"), "the bare, ambiguous path is still listed");
  });

  test("no paths, outer layout: reads each nested code repository's diff too (F6)", async () => {
    // website, 2026-10: `carja personas` at Ship printed "No domain persona
    // for these 0 path(s)" because the change lived in a nested repository.
    const root = await repo();
    const git = (cwd, ...a) => execFileSync("git", a, { cwd, stdio: "pipe" });
    git(root, "init", "-q", "-b", "main");
    await writeFile(join(root, ".gitignore"), "cms/\n");
    git(root, "add", ".");
    git(root, "-c", "user.email=t@t", "-c", "user.name=t", "commit", "-q", "-m", "outer");
    await mkdir(join(root, "cms"), { recursive: true });
    git(join(root, "cms"), "init", "-q", "-b", "main");
    git(join(root, "cms"), "-c", "user.email=t@t", "-c", "user.name=t", "commit", "-q", "--allow-empty", "-m", "base");
    git(join(root, "cms"), "checkout", "-q", "-b", "feat");
    await mkdir(join(root, "cms", "src", "components"), { recursive: true });
    await writeFile(join(root, "cms", "src", "components", "InlinePdfUpload.tsx"), "export {}\n");
    const s = io();
    await personasCommand(["--json"], { cwd: root, ...s });
    const data = JSON.parse(s.out);
    const designer = data.personas.find((p) => p.name === "designer");
    assert.ok(designer, `no Designer for a nested UI change: ${s.out}`);
    assert.deepEqual(designer.files, ["cms/src/components/InlinePdfUpload.tsx"]);
    assert.ok(designer.context.includes("cms/DESIGN.md"));
  });

  test("a server-side template gets the Designer (F6)", () => {
    for (const p of ["src/api/templates/usage.jinja2", "views/report.hbs", "app/views/home.html.erb", "src/emails/digest.njk"]) {
      assert.ok(names(matchPersonas([p], resolveRules({}))).includes("designer"), p);
    }
  });

  test("nothing matched says so and exits 0", async () => {
    const root = await repo();
    const s = io();
    assert.equal(await personasCommand(["src/math.js"], { cwd: root, ...s }), 0);
    assert.match(s.out, /No domain persona/);
  });
});
