// test/agents-md-command.test.js
//
// `carja agents-md facts|write|check` and the `status` card line, through the
// real IO shell with real git, in both layouts: embedded (the code is in the
// folder) and outer (the code is a gitignored nested repository).

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { initCommand } from "../src/commands/init.js";
import { agentsMdCommand } from "../src/commands/agents-md.js";
import { statusCommand } from "../src/commands/status.js";

const sink = () => ({ text: "", write(s) { this.text += s; } });
const git = (cwd, ...a) => execFileSync("git", a, { cwd, encoding: "utf8" });

async function run(cmd, args, cwd) {
  const out = sink();
  const err = sink();
  const code = await cmd(args, { cwd, stdout: out, stderr: err });
  return { code, out: out.text, err: err.text };
}

async function project(fn) {
  const dir = await mkdtemp(join(tmpdir(), "card-"));
  try {
    git(dir, "init", "-q");
    await initCommand([dir, "--all", "--no-detect"], { cwd: tmpdir(), stdout: sink(), stderr: sink() });
    await mkdir(join(dir, "carja/3-product-areas/billing"), { recursive: true });
    await writeFile(join(dir, "carja/3-product-areas/billing/billing-features.md"), "# Billing\n");
    return await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

const fill = (text) =>
  text
    .replace(/### Purpose\n\nTODO[^\n]*/, "### Purpose\n\nInvoicing for small agencies.")
    .replace(/### Conventions\n\nTODO[^\n]*/, "### Conventions\n\n- Services never import routers.")
    .replace(/billing\/` — TODO[^\n]*/, "billing/` — Invoices and payments");

test("embedded layout: write fills facts from the code, check refuses TODO, then stamps; status reports drift", async () => {
  await project(async (dir) => {
    await writeFile(join(dir, "package.json"), JSON.stringify({ scripts: { test: "vitest", build: "vite build" }, dependencies: { react: "1" }, devDependencies: { vite: "1" } }));
    await mkdir(join(dir, "src"));
    await writeFile(join(dir, "src/main.ts"), "export {}\n");

    const facts = await run(agentsMdCommand, ["facts", dir], dir);
    assert.match(facts.out, /Frameworks: react, vite/);

    assert.equal((await run(agentsMdCommand, ["write", dir], dir)).code, 0);
    let md = await readFile(join(dir, "AGENTS.md"), "utf8");
    assert.match(md, /- test: `npm run test`/);
    assert.match(md, /- `src\/` — 1 file/);
    assert.match(md, /billing\/` — TODO/);
    assert.doesNotMatch(md, /example-auth/, "the template's example areas are not the project's");

    const draft = await run(agentsMdCommand, ["check", dir], dir);
    assert.equal(draft.code, 1);
    assert.match(draft.err, /TODO left in/);
    assert.match((await run(statusCommand, [dir, "--no-color"], dir)).out, /Project card in AGENTS\.md is a draft/);

    await writeFile(join(dir, "AGENTS.md"), fill(md));
    const ok = await run(agentsMdCommand, ["check", dir], dir);
    assert.equal(ok.code, 0, ok.err);
    md = await readFile(join(dir, "AGENTS.md"), "utf8");
    assert.match(md, /project-card:begin status=ok/);
    assert.doesNotMatch((await run(statusCommand, [dir, "--no-color"], dir)).out, /Project card/);

    await writeFile(join(dir, "package.json"), JSON.stringify({ scripts: { test: "vitest run" } }));
    assert.match((await run(statusCommand, [dir, "--no-color"], dir)).out, /Project card in AGENTS\.md is stale: package\.json changed/);

    // A refresh keeps the agent's text.
    await run(agentsMdCommand, ["write", dir], dir);
    assert.match(await readFile(join(dir, "AGENTS.md"), "utf8"), /Invoicing for small agencies\./);
  });
});

test("check refuses an edited fact", async () => {
  await project(async (dir) => {
    await writeFile(join(dir, "package.json"), JSON.stringify({ scripts: { test: "vitest" } }));
    await run(agentsMdCommand, ["write", dir], dir);
    const md = fill(await readFile(join(dir, "AGENTS.md"), "utf8")).replace("`npm run test`", "`npm test -- --watch`");
    await writeFile(join(dir, "AGENTS.md"), md);
    const r = await run(agentsMdCommand, ["check", dir], dir);
    assert.equal(r.code, 1);
    assert.match(r.err, /Commands differs from what the code says/);
  });
});

test("outer layout: the facts come from the nested code repository", async () => {
  await project(async (dir) => {
    await writeFile(join(dir, ".gitignore"), "repo/\n");
    await mkdir(join(dir, "repo/app"), { recursive: true });
    git(join(dir, "repo"), "init", "-q");
    await writeFile(join(dir, "repo/requirements.txt"), "fastapi==0.110\nsqlalchemy\n");
    await writeFile(join(dir, "repo/app/main.py"), "app = None\n");
    const { out } = await run(agentsMdCommand, ["facts", dir], dir);
    assert.match(out, /Code: `repo\/` \(separate git repository\)/);
    assert.match(out, /Frameworks: fastapi, sqlalchemy/);
    assert.match(out, /`repo\/app\/` — 1 file/);
    assert.match(out, /`repo\/requirements\.txt`/);
  });
});
