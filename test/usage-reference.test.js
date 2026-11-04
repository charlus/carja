// test/usage-reference.test.js
//
// The owner could not keep up with what the CLI offers (2026-10-20). The usage
// reference lives in one source, src/usage.js, rendered into `--help`,
// `carja help`, and docs/Using-Carja.md. This test fails when:
//   - a command parses a flag, or the config reads a key, that the source omits;
//   - a command in the dispatcher has no entry, or an entry no command;
//   - the page's reference is not the rendering of the source;
//   - `--help` does not print it, or the CLI stops saying what to do next.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, mkdtempSync, rmSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { COMMANDS, CONFIG_KEYS, commandHelp, mainHelp, renderReference, REFERENCE_START, REFERENCE_END } from "../src/usage.js";
import { nextAfterLoop, nextAfterStatus, nextAfterDoctor } from "../src/next-step.js";
import { runCli } from "../src/cli.js";

const REPO = new URL("..", import.meta.url).pathname;
const src = (rel) => readFileSync(join(REPO, rel), "utf8");

// Flags of other tools (git, claude) that the command files pass on, not parse.
const NOT_OURS = {
  "install-hooks": ["--get", "--git-path", "--is-inside-work-tree", "--local", "--unset"],
  loop: ["--verify", "--is-ancestor", "--heads", "-e", "-b", "-h", "--help", "--path-format=absolute", "--path-format", "--git-common-dir", "--git-path", "--hostname", "--name-only", "--porcelain", "-q", "--beat", "--others", "--exclude-standard"],
  "loop-doctor": ["--path-format", "--git-common-dir", "-c", "--detach", "--force", "--hostname", "--output-format", "-p", "--permission-mode", "-q", "--settings"],
  "loop-on": ["--error-unmatch", "-c"],
  "loop-take": ["--git-common-dir"],
  watch: ["--path-format=absolute", "--path-format", "--git-common-dir"],
  work: ["-c"],
  personas: ["--exclude-standard", "--name-only", "--others"],
  "trust-verify": ["-c", "--show-toplevel"],
  upgrade: ["-c", "-z", "--cached", "--git-path", "--is-inside-work-tree", "-m", "--porcelain", "-q", "--quiet", "--short", "--verify", "--path-format=absolute", "--git-common-dir"],
  view: ["--quiet"],
};
const COMMAND_FOR_FILE = { "loop-doctor": "loop", "loop-on": "loop", "loop-profile": "loop", "loop-take": "loop" };

test("every flag a command parses is in the usage source", () => {
  for (const f of readdirSync(join(REPO, "src/commands")).filter((x) => x.endsWith(".js"))) {
    const file = f.replace(/\.js$/, "");
    const c = COMMANDS.find((x) => x.name === (COMMAND_FOR_FILE[file] ?? file));
    assert.ok(c, `src/commands/${f} has no entry in src/usage.js`);
    const known = [c.usage, ...c.flags.flat()].join(" ");
    const parsed = [...new Set([...src(`src/commands/${f}`).matchAll(/"(--?[a-z][a-z-]*)"/g)].map((m) => m[1]))];
    for (const flag of parsed) {
      if ((NOT_OURS[file] ?? []).includes(flag)) continue;
      assert.match(known, new RegExp(`(^|[^a-z-])${flag}([^a-z-]|$)`), `${c.name}: ${flag} is parsed but not in src/usage.js`);
    }
  }
});

test("every command the CLI dispatches has an entry, and every entry a command", () => {
  const dispatched = [...src("src/cli.js").matchAll(/case "([a-z-]+)":/g)].map((m) => m[1]).sort();
  assert.deepEqual(COMMANDS.map((c) => c.name).sort(), dispatched);
});

test("every carja.config.json key the CLI reads is in the usage source", () => {
  const keys = CONFIG_KEYS.map(([k]) => k);
  for (const m of src("src/loop/config.js").matchAll(/raw\.([a-z_]+)/g)) assert.ok(keys.includes(`loop.${m[1]}`), `loop.${m[1]} is read but not documented`);
  for (const k of Object.keys(JSON.parse(src("templates/carja.config.json")))) assert.ok(keys.includes(k), `${k} ships in the config template but is not documented`);
  for (const k of ["eval", "repos"]) assert.ok(keys.includes(k));
  for (const c of COMMANDS) for (const k of c.config ?? []) assert.ok(keys.includes(k), `${c.name} names an unknown config key ${k}`);
});

test("docs/Using-Carja.md carries the rendering of the source (run scripts/write-usage-reference.js)", () => {
  const page = src("docs/Using-Carja.md");
  const between = page.slice(page.indexOf(REFERENCE_START) + REFERENCE_START.length, page.indexOf(REFERENCE_END));
  assert.equal(between.trim(), renderReference().trim());
  assert.match(src("README.md"), /docs\/Using-Carja\.md/, "the README points at the page");
});

const io = (cwd) => {
  const out = { text: "", write(s) { this.text += s; } };
  const err = { text: "", write(s) { this.text += s; } };
  return { stdout: out, stderr: err, cwd: () => cwd };
};

test("`carja <command> --help` and `carja help <command>` print the command's reference, without running it", async () => {
  for (const c of COMMANDS) {
    const a = io(tmpdir());
    assert.equal(await runCli([c.name, "--help"], a), 0, c.name);
    assert.equal(a.stdout.text.trim(), commandHelp(c.name).trim(), `${c.name} --help`);
    const b = io(tmpdir());
    await runCli(["help", c.name], b);
    assert.equal(b.stdout.text.trim(), commandHelp(c.name).trim(), `help ${c.name}`);
  }
  const e = io(tmpdir());
  await runCli(["evidence", "run", "--label", "x", "--", "grep", "-h"], e);
  assert.doesNotMatch(e.stdout.text, /Record and check verification evidence/, "a flag after -- belongs to the wrapped command");
});

test("a bare `carja` in a project says where it stands and the next command; outside one, the help", async () => {
  const dir = mkdtempSync(join(tmpdir(), "usage-"));
  try {
    const outside = io(dir);
    await runCli([], outside);
    assert.equal(outside.stdout.text.trim(), mainHelp().trim());
    mkdirSync(join(dir, "carja/1-workbench/questions"), { recursive: true });
    writeFileSync(join(dir, "carja/1-workbench/questions/task-a.md"), "# Questions: task:a (build)\n\n## Q1. X?\nC.\n\n1. A — a\n2. B — b\n\n**Recommendation:** 1, because c\n**If wrong:** d\n\nAnswer:\n");
    const inside = io(dir);
    await runCli([], inside);
    assert.match(inside.stdout.text, /Carja project:/);
    assert.match(inside.stdout.text, /Next: answer carja\/1-workbench\/questions\/task-a\.md/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("the Next line names the command for each way a run or a check ends", () => {
  assert.match(nextAfterLoop("awaiting_answers"), /Answer each question/);
  assert.match(nextAfterLoop("completed", { prUrls: ["u1"] }), /merge the MR \(u1\)/);
  assert.match(nextAfterLoop("escalated"), /loop-messages\.md/);
  // A6 (2026-10-22): an L3 run whose MR could not be opened also ends awaiting_review.
  assert.match(nextAfterLoop("awaiting_review"), /loop-messages\.md.*could not be opened/);
  assert.match(nextAfterLoop("budget_exceeded"), /budget/);
  assert.match(nextAfterLoop("stalled"), /loop doctor/);
  assert.equal(nextAfterLoop("idle"), null);
  assert.match(nextAfterDoctor(true), /--dry-run/);
  assert.match(nextAfterStatus({ loopItems: ["notes 01-a"] }), /notes 01-a/);
  assert.match(nextAfterStatus({ verifyConfigured: false }), /verify --detect/);
  assert.match(nextAfterStatus({}), /inbox add/);
});
