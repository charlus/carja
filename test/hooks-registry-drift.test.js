// Hook registry drift (F3).
//
// ECC pins its hook graph with a fingerprinted sidecar so a reorder or an
// edited command that skips the sidecar fails CI. We have no hooks.json to
// mirror, so copying the sidecar would be cargo cult. What we DO have is three
// places that must agree and are only kept in sync by someone remembering:
//
//   1. the hook files on disk
//   2. the table in hooks/README.md that tells the user they exist
//   3. EXECUTABLE_HOOKS in install-hooks.js, which sets the executable bit
//
// Adding this session's two gates I had to update all three by hand, and
// missing (3) would have shipped a hook that silently never runs. That is the
// drift worth pinning.
//
// Deliberately NOT a content checksum. A hash that fails on every legitimate
// edit gets regenerated without being read, which is how a safety check gets
// trained out. These assert AGREEMENT between sources, not immutability.

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(fileURLToPath(new URL(".", import.meta.url)), "..");
const HOOKS = join(ROOT, "templates/.agents/hooks");
const read = (p) => readFileSync(p, "utf8");

const README = read(join(HOOKS, "README.md"));
const INSTALL = read(join(ROOT, "src/commands/install-hooks.js"));

/** Hook entry points: everything in hooks/ that is not the README or the shared lib. */
const hookFiles = readdirSync(HOOKS).filter((f) => f !== "README.md" && f !== "lib.sh");

describe("F3 — the hook registry cannot drift", () => {
  test("every hook file is documented in the README table", () => {
    const missing = hookFiles.filter((f) => !README.includes(f));
    assert.deepEqual(
      missing,
      [],
      `hook files with no README row: ${missing.join(", ")}. A gate the user ` +
        `cannot discover is a gate they will not wire up.`,
    );
  });

  test("every hook the README names exists on disk", () => {
    // Rows reference the file in a code span or a path.
    const named = [...README.matchAll(/`([a-z0-9-]+\.sh)`|\.agents\/hooks\/([a-z0-9-]+\.sh)/g)]
      .map((m) => m[1] || m[2])
      .filter((v, i, a) => a.indexOf(v) === i);
    const onDisk = new Set([...hookFiles, "lib.sh"]); // lib.sh has a README row too
    const ghosts = named.filter((f) => !onDisk.has(f));
    assert.deepEqual(ghosts, [], `README documents hooks that do not exist: ${ghosts.join(", ")}`);
  });

  test("every hook entry point is in install-hooks' executable list", () => {
    // The bit matters: a copied hook without +x is a hook that never fires,
    // and nothing else in the suite would notice.
    const missing = hookFiles.filter((f) => !INSTALL.includes(`"${f}"`));
    assert.deepEqual(
      missing,
      [],
      `hooks missing from EXECUTABLE_HOOKS in src/commands/install-hooks.js: ${missing.join(", ")}`,
    );
  });

  test("pre-push carries the fingerprint of the pre-commit it ships with", () => {
    // pre-push accepts an edit to pre-commit, without a waiver, only when the
    // result is byte-for-byte the pre-commit released alongside it. If the two
    // drift, every upgrade asks for a waiver again — and nothing else says so.
    const { createHash } = require("node:crypto");
    const actual = createHash("sha256").update(readFileSync(join(HOOKS, "pre-commit"))).digest("hex");
    const m = read(join(HOOKS, "pre-push")).match(/^CARJA_OFFICIAL_PRECOMMIT_SHA256="([0-9a-f]{64})"$/m);
    assert.ok(m, "pre-push declares no CARJA_OFFICIAL_PRECOMMIT_SHA256");
    assert.equal(
      m[1],
      actual,
      `pre-commit changed but pre-push still fingerprints the old one. Update it:\n` +
        `  sed -i 's/^CARJA_OFFICIAL_PRECOMMIT_SHA256=.*/CARJA_OFFICIAL_PRECOMMIT_SHA256="${actual}"/' templates/.agents/hooks/pre-push`,
    );
  });

  test("git hooks keep their extensionless names", () => {
    // git only runs core.hooksPath entries named exactly pre-commit / pre-push.
    for (const name of ["pre-commit", "pre-push"]) {
      assert.ok(hookFiles.includes(name), `${name} must exist, unsuffixed, for git to run it`);
    }
  });
});

describe("F3 — every gate's waiver is implemented and documented", () => {
  // The contract a user actually depends on: the escape hatch printed in a
  // denial must exist in the code, and every hatch the code honours must be
  // written down. An undocumented waiver is a trapdoor; a documented one that
  // does nothing is worse — it looks like an answer and blocks anyway.
  const gateSources = ["pre-commit", "pre-push", "verification-stop-hook.sh", "pretooluse-no-bypass.sh"]
    .map((f) => read(join(HOOKS, f)))
    .join("\n");

  const envVars = (text) =>
    [...text.matchAll(/CARJA_(?:NO|SKIP)_[A-Z_]+/g)]
      .map((m) => m[0])
      .filter((v, i, a) => a.indexOf(v) === i)
      .sort();

  test("every waiver the hooks honour is documented in the README", () => {
    const implemented = envVars(gateSources);
    const undocumented = implemented.filter((v) => !README.includes(v));
    assert.deepEqual(
      undocumented,
      [],
      `waivers the hooks accept but the README never mentions: ${undocumented.join(", ")}`,
    );
  });

  test("every waiver the README promises is honoured by a hook", () => {
    const documented = envVars(README);
    const phantom = documented.filter((v) => !gateSources.includes(v));
    assert.deepEqual(
      phantom,
      [],
      `waivers the README promises but no hook reads: ${phantom.join(", ")}`,
    );
  });

  test("every waiver reference has a recognised, logged shape", () => {
    // What this does NOT prove: that a waiver is logged at runtime. Reading
    // code cannot — an `exit 0` before the log call, or the call left only in
    // a comment, passed both earlier versions of this check (independent
    // review, B5 and again in the delta round). The runtime guarantee is the
    // behaviour matrix in test/hooks-waiver-logging.sh, which trips every gate
    // and asserts the reason reaches the ship-log.
    //
    // What this DOES prove, cheaply and first: no waiver variable is read in
    // a shape nobody has checked. Every reference, in code that is not a
    // comment, must be either
    //   (a) a guard `if|elif [ -n "${X:-}" ]; then` whose branch calls the
    //       log writer in CODE (not in a comment), or
    //   (b) the waiver's value or name being logged or echoed back.
    // A bare reference such as `printenv CARJA_SKIP_EVAL && exit 0` is
    // neither, and fails.
    //
    // The two PreToolUse hooks are not scanned: they accept no waivers, and
    // their mentions are message strings inside an embedded node script.
    const SOURCES = ["pre-commit", "pre-push", "verification-stop-hook.sh"];
    const REFERENCE = /\b(CARJA_(?:NO|SKIP)_[A-Z_]+)\b/;
    const GUARD = /^(\s*)(?:if|elif) \[ -n "\$\{(CARJA_(?:NO|SKIP)_[A-Z_]+):-\}" \]; then\s*$/;
    const REPORTING = /^\s*(?:carja_log_waiver(?:_fallback)?|echo)\b/;
    const LOGS = /^\s*carja_log_waiver(?:_fallback)?\b/;
    const isComment = (l) => /^\s*#/.test(l);

    const problems = [];
    let guards = 0;
    for (const file of SOURCES) {
      const lines = read(join(HOOKS, file)).split("\n");
      lines.forEach((line, n) => {
        if (isComment(line)) return;
        const ref = line.match(REFERENCE);
        if (!ref) return;
        const guard = line.match(GUARD);
        if (guard) {
          guards += 1;
          const indent = guard[1].length;
          const body = [];
          for (let k = n + 1; k < lines.length; k++) {
            const m = lines[k].match(/^(\s*)(else|elif|fi)\b/);
            if (m && m[1].length === indent) break;
            body.push(lines[k]);
          }
          // Code only: a log call that survives in a comment logs nothing.
          if (!body.filter((b) => !isComment(b)).some((b) => LOGS.test(b))) {
            problems.push(`${file}:${n + 1} — ${guard[2]} is accepted without a log call in code`);
          }
          return;
        }
        if (REPORTING.test(line)) return;
        problems.push(`${file}:${n + 1} — ${ref[1]} is read in a shape this check does not recognise: ${line.trim()}`);
      });
    }

    assert.ok(guards > 0, "found no waiver guards at all — the scan itself is broken");
    assert.deepEqual(problems, [], `\n  ${problems.join("\n  ")}`);
  });

  test("every documented waiver has at least one logged guard", () => {
    // The mirror of the above: a waiver the README promises must actually be
    // honoured somewhere, by a guard of the recognised shape.
    const code = ["pre-commit", "pre-push", "verification-stop-hook.sh"]
      .map((f) => read(join(HOOKS, f)))
      .join("\n");
    const missing = envVars(README).filter(
      (v) => !new RegExp(`(?:if|elif) \\[ -n "\\$\\{${v}:-\\}" \\]; then`).test(code),
    );
    assert.deepEqual(missing, [], `documented but never guarded: ${missing.join(", ")}`);
  });
});
