// test/verify-command.test.js
//
// The push gate must be configurable WITHOUT knowing the framework's internals.
//
// Measured 2026-09-16 on the maintainer's own `autopportunity` install: upgrade
// printed "No verify command could be derived … set \"verify\" in
// carja.config.json" — and that file did not exist, because neither `init`
// nor `upgrade` creates one when nothing can be derived. The maintainer, who
// helped BUILD this feature, could not act on the message. Their words: "I have
// no idea how to enable it and the message is not self explanatory."
//
// Three things are pinned here:
//   * `carja verify` — one command that SHOWS the gate, SETS it (proving the
//     command runs before writing it), or declares there is nothing to verify.
//   * `"verify": "none"` — an explicit, honest OFF. A docs/state repo can never
//     satisfy the gate; without this the warning is permanent noise, which
//     teaches the reader to ignore a safety message.
//   * every message that mentions the gate names a command you can paste, not a
//     JSON key you have to go and find.

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, cpSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { verifyCommand } from "../src/commands/verify.js";
import { gateStateFrom, NO_VERIFY_WARNING } from "../src/verify-config.js";
import { upgradeCommand } from "../src/commands/upgrade.js";
import { buildState } from "../src/carja-state.js";
import { renderStatus } from "../src/view/status.js";

const TEMPLATES = fileURLToPath(new URL("../templates", import.meta.url));
const PRE_PUSH = readFileSync(join(TEMPLATES, ".agents", "hooks", "pre-push"), "utf8");

function sink() {
  let out = "";
  return { write: (s) => { out += s; }, get text() { return out; } };
}
const dir = () => mkdtempSync(join(tmpdir(), "carja-gate-"));
const write = (root, rel, content) => {
  mkdirSync(join(root, rel, ".."), { recursive: true });
  writeFileSync(join(root, rel), content);
};
const config = (root) => JSON.parse(readFileSync(join(root, "carja.config.json"), "utf8"));

async function run(args, cwd) {
  const stdout = sink();
  const stderr = sink();
  const code = await verifyCommand(args, { cwd, stdout, stderr });
  return { code, out: stdout.text + stderr.text };
}

// ---------------------------------------------------------------------------

describe("gateStateFrom — one resolver, three honest states", () => {
  test("a command in the config is SET", () => {
    const g = gateStateFrom(JSON.stringify({ verify: "make test" }), null);
    assert.equal(g.state, "set");
    assert.equal(g.command, "make test");
    assert.equal(g.source, "carja.config.json");
  });

  test("the package.json test script is a SET gate, but the source says it is a fallback", () => {
    const g = gateStateFrom(null, JSON.stringify({ scripts: { test: "node --test" } }));
    assert.equal(g.state, "set");
    assert.equal(g.command, "npm test");
    assert.equal(g.source, "package.json");
  });

  test('"none" is NOT a command — it is a declared OFF, and it beats the fallback', () => {
    const g = gateStateFrom(
      JSON.stringify({ verify: "none" }),
      JSON.stringify({ scripts: { test: "node --test" } }),
    );
    assert.equal(g.state, "none");
    assert.equal(g.command, null, "'none' must never be handed to a shell");
  });

  test("nothing anywhere is UNSET, which is the only state that warns", () => {
    assert.equal(gateStateFrom(null, null).state, "unset");
    assert.equal(gateStateFrom(JSON.stringify({ verify: "   " }), null).state, "unset");
  });
});

describe("carja verify — show", () => {
  test("an unconfigured project is told the two commands that fix it", async () => {
    const d = dir();
    const { code, out } = await run([], d);
    assert.equal(code, 0, out);
    assert.match(out, /carja verify --set /, "give a command to paste, not a JSON key to find");
    assert.match(out, /carja verify --none/, "and the honest way out for a repo with nothing to verify");
    assert.match(out, /push/i, "say what is not happening on push");
  });

  test("a configured gate shows the command and where it came from", async () => {
    const d = dir();
    write(d, "carja.config.json", JSON.stringify({ verify: "make test" }));
    const { code, out } = await run([], d);
    assert.equal(code, 0, out);
    assert.match(out, /make test/);
    assert.match(out, /carja\.config\.json/);
  });

  test("a package.json fallback is shown as a fallback, not as a configured gate", async () => {
    const d = dir();
    write(d, "package.json", JSON.stringify({ scripts: { test: "node --test" } }));
    const { code, out } = await run([], d);
    assert.equal(code, 0, out);
    assert.match(out, /npm test/);
    assert.match(out, /package\.json/);
  });

  test("a declared OFF says so calmly and says how to turn it back on", async () => {
    const d = dir();
    write(d, "carja.config.json", JSON.stringify({ verify: "none" }));
    const { code, out } = await run([], d);
    assert.equal(code, 0, out);
    assert.doesNotMatch(out, /⚠️/, "a deliberate choice is not a warning");
    assert.match(out, /carja verify --set /, "but it must still be reversible in one command");
  });
});

describe("carja verify --set — proves the command before trusting it", () => {
  test("a passing command is run once, then written", async () => {
    const d = dir();
    const { code, out } = await run(["--set", "exit 0"], d);
    assert.equal(code, 0, out);
    assert.equal(config(d).verify, "exit 0");
    assert.match(out, /exit 0/);
  });

  test("a FAILING command is not written — a gate that cannot pass is worse than none", async () => {
    const d = dir();
    const { code, out } = await run(["--set", "exit 3"], d);
    assert.equal(code, 1);
    assert.equal(existsSync(join(d, "carja.config.json")), false, "nothing was written");
    assert.match(out, /--no-run/, "and the escape hatch is named");
  });

  test("--no-run writes it without running it", async () => {
    const d = dir();
    const { code } = await run(["--set", "exit 3", "--no-run"], d);
    assert.equal(code, 0);
    assert.equal(config(d).verify, "exit 3");
  });

  test("the config file is CREATED when missing (the autopportunity failure)", async () => {
    const d = dir();
    await run(["--set", "exit 0"], d);
    assert.ok(existsSync(join(d, "carja.config.json")));
  });

  test("other config keys survive the write", async () => {
    const d = dir();
    write(d, "carja.config.json", JSON.stringify({ registry: "https://example.com/r", eval: "npm run eval" }));
    await run(["--set", "exit 0"], d);
    assert.equal(config(d).registry, "https://example.com/r");
    assert.equal(config(d).eval, "npm run eval");
    assert.equal(config(d).verify, "exit 0");
  });
});

describe("carja verify --none / --detect", () => {
  test("--none records the declared OFF in the config", async () => {
    const d = dir();
    const { code, out } = await run(["--none"], d);
    assert.equal(code, 0, out);
    assert.equal(config(d).verify, "none");
  });

  test("--detect derives from the project's files and sets it", async () => {
    const d = dir();
    write(d, "package.json", JSON.stringify({ scripts: { test: "node --test" } }));
    const { code, out } = await run(["--detect", "--no-run"], d);
    assert.equal(code, 0, out);
    assert.equal(config(d).verify, "npm test");
  });

  test("--detect on a project with nothing derivable fails loudly rather than writing a guess", async () => {
    const d = dir();
    const { code, out } = await run(["--detect"], d);
    assert.equal(code, 1);
    assert.equal(existsSync(join(d, "carja.config.json")), false);
    assert.match(out, /--set|--none/);
  });
});

describe("the messages that led here", () => {
  test("the init/upgrade warning names the command, not the JSON key", () => {
    assert.match(NO_VERIFY_WARNING, /carja verify --set /);
    assert.match(NO_VERIFY_WARNING, /carja verify --none/);
  });

  test("upgrade CREATES carja.config.json so the file it names exists", async () => {
    const d = dir();
    cpSync(join(TEMPLATES, ".agents"), join(d, ".agents"), { recursive: true });
    cpSync(join(TEMPLATES, "carja"), join(d, "carja"), { recursive: true });
    const stdout = sink();
    const stderr = sink();
    const code = await upgradeCommand([d], { cwd: tmpdir(), stdout, stderr });
    assert.equal(code, 0, stdout.text + stderr.text);
    assert.ok(
      existsSync(join(d, "carja.config.json")),
      "the warning names this file — it must be there to edit",
    );
  });

  test("`carja status` prints a runnable fix, and shows a declared OFF as a choice", () => {
    const base = { root: "/repo", projectName: "repo", now: Date.now() };
    const off = renderStatus(buildState({ ...base, verifyCommand: null }), { color: false });
    assert.match(off, /carja verify --set /, "the status line must carry the fix");

    const declared = renderStatus(buildState({ ...base, verifyCommand: "none" }), { color: false });
    assert.match(declared, /choice|declared/i);
    assert.doesNotMatch(declared, /NOT CONFIGURED/);
  });

  test("pre-push never shells out to the literal 'none', and points at the command", () => {
    assert.match(PRE_PUSH, /\[ "\$cmd" = "none" \]/, "pre-push must special-case the declared OFF");
    // The OFF branch is what the reader sees when the gate is not configured.
    const branch = PRE_PUSH.split(/elif \[ -z "\$cmd" \]; then/)[1]?.split("elif")[0] ?? "";
    const shown = branch.replace(/\\(["`])/g, "$1");
    assert.match(shown, /carja verify --set /, "the fix is a command, not a JSON key");
    assert.match(shown, /carja verify --none/);
    assert.match(shown, /OFF/, "and it says plainly that nothing is enforced");
  });
});

describe("--repo: the push check of a nested code repository (outer layout)", () => {
  test("--set writes repos.<dir>.verify and keeps the outer verify", async () => {
    const root = dir();
    write(root, "carja.config.json", '{ "verify": "none" }\n');
    mkdirSync(join(root, "app"));
    const r = await run(["--repo", "app", "--set", "true"], root);
    assert.equal(r.code, 0, r.out);
    assert.deepEqual(config(root), { verify: "none", repos: { app: { verify: "true" } } });
  });

  test("--set runs the command inside the nested repository", async () => {
    const root = dir();
    mkdirSync(join(root, "app"));
    write(root, "app/marker", "x");
    const r = await run(["--repo", "app", "--set", "test -f marker"], root);
    assert.equal(r.code, 0, r.out);
  });

  test("--none declares that repository has nothing to verify", async () => {
    const root = dir();
    mkdirSync(join(root, "app"));
    await run(["--repo", "app", "--none"], root);
    assert.equal(config(root).repos.app.verify, "none");
  });

  test("showing the state reads the repository's own command", async () => {
    const root = dir();
    write(root, "carja.config.json", '{ "verify": "none", "repos": { "app": { "verify": "make check" } } }\n');
    mkdirSync(join(root, "app"));
    const r = await run(["--repo", "app"], root);
    assert.match(r.out, /make check/);
  });

  test("an unknown directory is refused", async () => {
    const root = dir();
    const r = await run(["--repo", "nope", "--set", "true"], root);
    assert.equal(r.code, 1);
  });
});
