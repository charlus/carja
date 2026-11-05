// test/verify-config.test.js
//
// O6 — the push gate is configured, or it is loud about not being.
//
// Measured 2026-09-15: `carja.config.json` carried a `verify` command in
// ONE of the maintainer's five live projects. Everywhere else `pre-push`
// printed "no verification command configured … Skipping verify." and the
// Verification Iron Law — the framework's central enforcement bet — was not
// running. The maintainer's own words on reading the sibling eval message:
// "What should I do I don't understand".
//
// Three fixes, each pinned here:
//   * `suggestVerifyCommand(dir)` derives a verify command from the files
//     that are actually there (package.json scripts, pyproject, requirements,
//     a .venv, go.mod, Cargo.toml, a two-package backend/frontend layout).
//     Deterministic, no model call, and it mirrors `lib.sh`'s own `npm test`
//     fallback so the CLI and the hook never disagree.
//   * `init` writes the suggestion into carja.config.json and says so;
//     when nothing can be derived it warns in words that name the key.
//   * `upgrade` warns the same way on an install that still has no command,
//     and `pre-push`'s message tells the reader exactly what to add.
//
// Fixtures are real files in a temp dir, not a mocked detector.

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, cpSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { suggestVerifyCommand } from "../src/detect.js";
import { initCommand } from "../src/commands/init.js";
import { upgradeCommand } from "../src/commands/upgrade.js";

const TEMPLATES = fileURLToPath(new URL("../templates", import.meta.url));
const PRE_PUSH = readFileSync(join(TEMPLATES, ".agents", "hooks", "pre-push"), "utf8");

function sink() {
  let out = "";
  return { write: (s) => { out += s; }, get text() { return out; } };
}
const dir = () => mkdtempSync(join(tmpdir(), "carja-verify-"));
const write = (root, rel, content) => {
  mkdirSync(join(root, rel, ".."), { recursive: true });
  writeFileSync(join(root, rel), content);
};

describe("suggestVerifyCommand — derived from the files present", () => {
  test("package.json with a test script → npm test (matches lib.sh's fallback)", async () => {
    const d = dir();
    write(d, "package.json", JSON.stringify({ scripts: { test: "node --test" } }));
    assert.equal(await suggestVerifyCommand(d), "npm test");
  });

  test("package.json WITHOUT a test script suggests nothing", async () => {
    const d = dir();
    write(d, "package.json", JSON.stringify({ scripts: { build: "tsc" } }));
    assert.equal(await suggestVerifyCommand(d), "");
  });

  test("pytest in requirements.txt → python -m pytest -q", async () => {
    const d = dir();
    write(d, "requirements.txt", "fastapi\npytest>=8\n");
    assert.equal(await suggestVerifyCommand(d), "python -m pytest -q");
  });

  test("a .venv next to a pytest project is used (the live eurassistant shape)", async () => {
    const d = dir();
    write(d, "requirements.txt", "pytest\n");
    mkdirSync(join(d, ".venv", "bin"), { recursive: true });
    writeFileSync(join(d, ".venv", "bin", "python"), "");
    assert.equal(await suggestVerifyCommand(d), ".venv/bin/python -m pytest -q");
  });

  test("pyproject with [tool.poetry] → poetry run pytest -q", async () => {
    const d = dir();
    write(d, "pyproject.toml", "[tool.poetry]\nname = \"x\"\n\n[tool.poetry.dev-dependencies]\npytest = \"^8\"\n");
    assert.equal(await suggestVerifyCommand(d), "poetry run pytest -q");
  });

  test("pyproject without pytest anywhere suggests nothing rather than guessing", async () => {
    const d = dir();
    write(d, "pyproject.toml", "[project]\nname = \"x\"\n");
    assert.equal(await suggestVerifyCommand(d), "");
  });

  test("go.mod → go test ./... ; Cargo.toml → cargo test", async () => {
    const g = dir();
    write(g, "go.mod", "module x\n");
    assert.equal(await suggestVerifyCommand(g), "go test ./...");
    const r = dir();
    write(r, "Cargo.toml", "[package]\nname = \"x\"\n");
    assert.equal(await suggestVerifyCommand(r), "cargo test");
  });

  test("backend/ + frontend/ each with a test script → both, chained (the live evalapp shape)", async () => {
    const d = dir();
    write(d, "backend/package.json", JSON.stringify({ scripts: { test: "jest" } }));
    write(d, "frontend/package.json", JSON.stringify({ scripts: { test: "vitest run" } }));
    assert.equal(
      await suggestVerifyCommand(d),
      "npm --prefix backend test && npm --prefix frontend test",
    );
  });

  test("an empty directory suggests nothing", async () => {
    assert.equal(await suggestVerifyCommand(dir()), "");
  });
});

describe("init — writes the verify command, or warns in words that name the key", () => {
  async function runInit(target) {
    const stdout = sink();
    const stderr = sink();
    const code = await initCommand([target, "--all", "--no-detect"], { cwd: tmpdir(), stdout, stderr });
    return { code, out: stdout.text + stderr.text };
  }

  test("a node project gets verify = npm test in carja.config.json", async () => {
    const d = dir();
    write(d, "package.json", JSON.stringify({ name: "x", scripts: { test: "node --test" } }));
    const { code, out } = await runInit(d);
    assert.equal(code, 0, out);
    const cfg = JSON.parse(readFileSync(join(d, "carja.config.json"), "utf8"));
    assert.equal(cfg.verify, "npm test");
    assert.match(out, /verify/i);
    assert.match(out, /npm test/);
  });

  test("a project with no derivable command keeps verify empty and is told what to do", async () => {
    const d = dir();
    const { code, out } = await runInit(d);
    assert.equal(code, 0, out);
    const cfg = JSON.parse(readFileSync(join(d, "carja.config.json"), "utf8"));
    assert.equal(cfg.verify, "");
    // Naming the key and the file was the FIRST fix, and it was measured
    // unactionable (2026-09-16). The warning now hands over the two commands
    // that end the decision, one way or the other.
    assert.match(out, /Push gate OFF/i);
    assert.match(out, /carja verify --set /);
    assert.match(out, /carja verify --none/);
    assert.match(out, /Iron Law/, "and say what is NOT enforced until it is set");
  });

  test("an existing config with a verify command is left alone", async () => {
    const d = dir();
    write(d, "package.json", JSON.stringify({ scripts: { test: "node --test" } }));
    write(d, "carja.config.json", JSON.stringify({ registry: "r", verify: "make check" }));
    await runInit(d);
    const cfg = JSON.parse(readFileSync(join(d, "carja.config.json"), "utf8"));
    assert.equal(cfg.verify, "make check");
    assert.equal(cfg.registry, "r");
  });
});

describe("upgrade — an install with no verify command is warned, not silently left", () => {
  test("upgrade output names the missing key", async () => {
    const d = dir();
    // A minimal current install: templates copied, config with an empty verify.
    cpSync(join(TEMPLATES, ".agents"), join(d, ".agents"), { recursive: true });
    cpSync(join(TEMPLATES, "carja"), join(d, "carja"), { recursive: true });
    write(d, "carja.config.json", JSON.stringify({ registry: "r", verify: "" }));
    const stdout = sink();
    const stderr = sink();
    const code = await upgradeCommand([d], { cwd: tmpdir(), stdout, stderr });
    const out = stdout.text + stderr.text;
    assert.equal(code, 0, out);
    assert.match(out, /Push gate OFF/i);
    assert.match(out, /carja verify --set /);
  });
});

describe("pre-push — the message tells the reader exactly what to run", () => {
  test("says the gate is off, gives the command that sets it, and an example value", () => {
    const branch = PRE_PUSH.split(/elif \[ -z "\$cmd" \]; then/)[1]?.split("elif")[0] ?? "";
    assert.ok(branch, "pre-push lost its no-verify message");
    // Assert on what the shell prints, not on the source's backslash-escaped quotes.
    const shown = branch.replace(/\\(["`])/g, "$1");
    assert.match(shown, /carja verify --set /, "the fix must be runnable from the message");
    assert.match(shown, /npm test|pytest/, "give a concrete example value");
    assert.match(shown, /OFF/, "say plainly that the gate is not enforcing");
    assert.doesNotMatch(shown, /Skipping verify\.$/, "'Skipping verify.' alone told the maintainer nothing");
  });
});
