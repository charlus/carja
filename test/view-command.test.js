// test/view-command.test.js
//
// The `--out` escape hatch is the one path where a derived view can reach a
// commit. `carja view` with no flags writes into `carja/.views/` and
// adds the ignore entry itself, so the page is invisible to `git status` and to
// `git add -A`. `--out <path>` means "write it exactly here" — often outside the
// repo entirely — so silently editing `.gitignore` for an arbitrary path would
// be wrong. A warning is the honest middle: say so, let the human decide.
//
// The decision is a pure function of git's own answer, so the ignore semantics
// are git's rather than a reimplementation of them here.

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { outPathWarning } from "../src/commands/view.js";

const PATH = "/repo/docs/dashboard.html";

describe("--out warns only when the page could actually be committed", () => {
  test("silent when git says the path is already ignored", () => {
    assert.equal(outPathWarning(PATH, 0), null);
  });

  test("warns when the path is inside a repo and not ignored", () => {
    const warning = outPathWarning(PATH, 1);
    assert.ok(warning, "expected a warning");
    assert.match(warning, /dashboard\.html/, "names the file");
    assert.match(warning, /gitignore/i, "says how to fix it");
    assert.match(warning, /derived/i, "says why it matters");
  });

  test("silent outside a git repo — there is nothing to commit it to", () => {
    assert.equal(outPathWarning(PATH, 128), null);
  });

  test("silent when git could not be run at all — no nagging on a guess", () => {
    assert.equal(outPathWarning(PATH, 127), null);
    assert.equal(outPathWarning(PATH, null), null);
  });
});
