#!/usr/bin/env bash
# ============================================================
# The gate batch of 7.1.0 — BEHAVIOUR test on the real hooks.
#
#   A3  pre-push:   a green verify that ran zero tests is not green.
#   A4  pre-commit: a test change that touches no assertion does not satisfy
#                   the Test-Driven Law.
#   A5  pre-commit: an edit that weakens a gate (a type-check or coverage
#                   silencer, a bare `# noqa`, a file-wide eslint-disable,
#                   continue-on-error, --no-verify in a script, a TODO with
#                   no reference) is blocked; pre-push: a `[skip ci]` commit.
#
# The thresholds come from 9,662 real commits of four projects (owner
# decisions D1/D2, docs/roadmap/Harvest-2026-10.md): the allowed cases below
# are the shapes that real, deliberate work used.
# ============================================================
set -uo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
pass=0; fail=0
ok() { echo "  [PASS] $1"; pass=$((pass+1)); }
no() { echo "  [FAIL] $1"; fail=$((fail+1)); }

repo() {
  local d; d="$(mktemp -d)"
  mkdir -p "$d/.agents/hooks" "$d/carja/0-compass" "$d/src" "$d/test" "$d/tests" "$d/scripts"
  cp "$REPO_ROOT/templates/.agents/hooks/"* "$d/.agents/hooks/"
  chmod +x "$d/.agents/hooks/pre-commit" "$d/.agents/hooks/pre-push"
  : > "$d/carja/0-compass/ship-log.md"
  printf 'export const add = (a, b) => a + b;\n' > "$d/src/add.js"
  printf 'def f():\n    return 1\n' > "$d/src/f.py"
  cat > "$d/test/add.test.js" <<'EOF'
import { add } from "../src/add.js";
test("adds", () => { expect(add(1, 2)).toBe(3); });
EOF
  printf 'from src.f import f\n\ndef test_f():\n    assert f() == 1\n' > "$d/tests/test_f.py"
  git -C "$d" init -q
  git -C "$d" config user.email t@t.local
  git -C "$d" config user.name t
  git -C "$d" config core.hooksPath .agents/hooks
  git -C "$d" add -A
  CARJA_HOOKS=off git -C "$d" commit -q -m base >/dev/null 2>&1
  printf '%s' "$d"
}

# commits <name> <dir>: expect the staged commit to go through.
commits() { if git -C "$2" commit -q -m x >/dev/null 2>&1; then ok "$1"; else no "$1 (blocked, should commit)"; fi; }
blocked() { if git -C "$2" commit -q -m x >/dev/null 2>&1; then no "$1 (committed, should be blocked)"; else ok "$1"; fi; }

echo "A4 — the Test-Driven Law needs a touched assertion:"

D="$(repo)"
printf 'export const add = (a, b) => b + a;\n' > "$D/src/add.js"
printf '// covers add\n' >> "$D/test/add.test.js"
git -C "$D" add -A; blocked "T1: code + a test edit that touches no assertion is BLOCKED" "$D"
OUT="$(git -C "$D" commit -m x 2>&1)"
case "$OUT" in *"no assertion"*CARJA_NO_TEST*) ok "T1b: the message names the rule and CARJA_NO_TEST" ;; *) no "T1b: message does not explain: $OUT" ;; esac
rm -rf "$D"

D="$(repo)"
printf 'export const add = (a, b) => a + b + 0;\n' > "$D/src/add.js"
sed -i 's/toBe(3)/toBe(3.0)/' "$D/test/add.test.js"
git -C "$D" add -A; commits "T2: a fix that changes an expected value (+1 −1 assertion) COMMITS" "$D"
rm -rf "$D"

D="$(repo)"
printf 'export const mul = (a, b) => a * b;\n' > "$D/src/mul.js"
printf 'test("mul", () => { expect(2 * 3).toBe(6); });\n' > "$D/test/mul.test.js"
git -C "$D" add -A; commits "T3: code + a new test with an assertion COMMITS" "$D"
rm -rf "$D"

D="$(repo)"
printf 'export const add = (a, b) => b + a;\n' > "$D/src/add.js"
printf '// covers add\n' >> "$D/test/add.test.js"
git -C "$D" add -A
if CARJA_NO_TEST="refactor, behaviour unchanged" git -C "$D" commit -q -m x >/dev/null 2>&1 \
   && grep -q "refactor, behaviour unchanged" "$D/carja/0-compass/ship-log.md"; then
  ok "T4: CARJA_NO_TEST lets it through and logs the reason"
else no "T4: the CARJA_NO_TEST waiver did not work"; fi
rm -rf "$D"

D="$(repo)"
printf 'def f():\n    raise ValueError()\n' > "$D/src/f.py"
printf '\ndef test_f_raises():\n    with pytest.raises(ValueError):\n        f()\n' >> "$D/tests/test_f.py"
git -C "$D" add -A; commits "T5: pytest.raises counts as an assertion" "$D"
rm -rf "$D"

D="$(repo)"
mkdir -p "$D/pkg"
printf 'package pkg\nfunc Add(a, b int) int { return a + b }\n' > "$D/pkg/add.go"
printf 'package pkg\nimport "testing"\nfunc TestAdd(t *testing.T) {\n\tif Add(1, 2) != 3 {\n\t\tt.Errorf("bad")\n\t}\n}\n' > "$D/pkg/add_test.go"
git -C "$D" add -A; commits "T6: Go t.Errorf counts as an assertion" "$D"
rm -rf "$D"

D="$(repo)"
printf '// a note\n' >> "$D/test/add.test.js"
git -C "$D" add -A; commits "T7: a test-only edit with no code change COMMITS (A4 needs code)" "$D"
rm -rf "$D"

echo "A5 — edits that weaken a gate (pre-commit):"

# weak <name> <file> <line> <expect: blocked|commits>
weak() {
  local name="$1" file="$2" line="$3" want="$4" D
  D="$(repo)"
  mkdir -p "$D/$(dirname "$file")"
  printf '%s\n' "$line" >> "$D/$file"
  # Code files need a test that touches an assertion, so only A5 decides.
  printf 'test("w", () => { expect(1).toBe(1); });\n' > "$D/test/w.test.js"
  git -C "$D" add -A
  "$want" "$name" "$D"
  rm -rf "$D"
}
weak "I1: # type: ignore in code is BLOCKED"            src/f.py  'x = f()  # type: ignore'            blocked
weak "I2: @ts-ignore in code is BLOCKED"                src/add.js '// @ts-ignore'                     blocked
weak "I3: @ts-expect-error in code is BLOCKED"          src/add.js '// @ts-expect-error wrong type'    blocked
weak "I4: a bare # noqa is BLOCKED"                     src/f.py  'import os  # noqa'                  blocked
weak "I5: # noqa with a rule code COMMITS"              src/f.py  'import os  # noqa: F401'            commits
weak "I6: a file-wide eslint-disable is BLOCKED"        src/add.js '/* eslint-disable */'              blocked
weak "I7: eslint-disable-next-line with a rule COMMITS" src/add.js '// eslint-disable-next-line no-console' commits
weak "I8: pragma: no cover in code is BLOCKED"          src/f.py  'if x:  # pragma: no cover'          blocked
weak "I9: pragma: no cover in a test COMMITS"           tests/test_f.py 'if x:  # pragma: no cover'    commits
weak "I10: istanbul ignore in code is BLOCKED"          src/add.js '/* istanbul ignore next */'        blocked
weak "I11: continue-on-error in a workflow is BLOCKED"  .github/workflows/ci.yml '        continue-on-error: true' blocked
weak "I12: allow_failure in .gitlab-ci.yml is BLOCKED"  .gitlab-ci.yml '  allow_failure: true'        blocked
weak "I13: --no-verify in a script is BLOCKED"          scripts/release.sh 'git push --no-verify'      blocked
weak "I14: --no-verify in a Markdown doc COMMITS"       docs/notes.md 'never use git push --no-verify' commits
weak "I15: a TODO with no reference is BLOCKED"         src/add.js '// TODO: handle overflow'          blocked
weak "I16: a TODO with an issue number COMMITS"         src/add.js '// TODO(#42): handle overflow'     commits
weak "I17: a TODO with a tracker key COMMITS"           src/f.py  '# TODO PROJ-12 handle overflow'     commits
weak "I18: a TODO with a link COMMITS"                  src/f.py  '# TODO see https://x.test/i/3'      commits
weak "I19: a TODO in a test COMMITS"                    tests/test_f.py '# TODO: more cases'           commits
weak "I20: a pragma under carja/ COMMITS (state, not code)" carja/scripts/x.py 'x = 1  # type: ignore' commits

# An edited line that already carried the pragma is not a new pragma.
D="$(repo)"
printf 'x = f()  # type: ignore\n' >> "$D/src/f.py"
git -C "$D" add -A; CARJA_HOOKS=off git -C "$D" commit -q -m seed >/dev/null 2>&1
sed -i 's/^x = f()  # type: ignore$/y = f()  # type: ignore/' "$D/src/f.py"
printf 'test("w", () => { expect(1).toBe(1); });\n' > "$D/test/w.test.js"
git -C "$D" add -A; commits "I21: editing a line that already had the pragma COMMITS (net count)" "$D"
rm -rf "$D"

D="$(repo)"
printf 'x = f()  # type: ignore\n' >> "$D/src/f.py"
printf 'test("w", () => { expect(1).toBe(1); });\n' > "$D/test/w.test.js"
git -C "$D" add -A
OUT="$(git -C "$D" commit -m x 2>&1)"
case "$OUT" in *"src/f.py"*"type: ignore"*CARJA_NO_INTEGRITY*) ok "I22: the message names the file, the pragma and CARJA_NO_INTEGRITY" ;; *) no "I22: message: $OUT" ;; esac
if CARJA_NO_INTEGRITY="stub types missing upstream" git -C "$D" commit -q -m x >/dev/null 2>&1 \
   && grep -q "stub types missing upstream" "$D/carja/0-compass/ship-log.md"; then
  ok "I23: CARJA_NO_INTEGRITY lets it through and logs the reason"
else no "I23: the CARJA_NO_INTEGRITY waiver did not work"; fi
rm -rf "$D"

# The other gates are independent: CARJA_NO_TEST never waives A5.
D="$(repo)"
printf 'export const z = 1; // @ts-ignore\n' > "$D/src/z.js"
git -C "$D" add -A
if CARJA_NO_TEST="config only" git -C "$D" commit -q -m x >/dev/null 2>&1; then
  no "I24: CARJA_NO_TEST also waived the integrity gate"
else ok "I24: CARJA_NO_TEST does not waive the integrity gate"; fi
rm -rf "$D"

echo "A5 + A3 — pre-push:"

remote_repo() {
  local d="$1" b; b="$(mktemp -d)"
  git init -q --bare "$b"
  git -C "$d" remote add origin "$b"
  CARJA_HOOKS=off git -C "$d" push -q origin HEAD:main >/dev/null 2>&1
  printf '%s' "$b"
}
# with_verify <dir> <script body>: the project's verify prints the body and exits 0.
with_verify() {
  printf '%s\n' "$2" > "$1/verify.sh"
  printf '{ "verify": "bash verify.sh" }\n' > "$1/carja.config.json"
  git -C "$1" add -A; CARJA_HOOKS=off git -C "$1" commit -q -m cfg >/dev/null 2>&1
}
code_commit() {
  printf 'export const v = %s;\n' "$RANDOM" > "$1/src/v.js"
  git -C "$1" add -A; CARJA_HOOKS=off git -C "$1" commit -q -m "${2:-work}" >/dev/null 2>&1
}
pushes()   { if git -C "$2" push -q origin HEAD:main >/dev/null 2>&1; then ok "$1"; else no "$1 (blocked, should push)"; fi; }
refused()  { if git -C "$2" push -q origin HEAD:main >/dev/null 2>&1; then no "$1 (pushed, should be blocked)"; else ok "$1"; fi; }

# zero <name> <verify output> <expect: refused|pushes>
zero() {
  local D B
  D="$(repo)"; B="$(remote_repo "$D")"
  with_verify "$D" "$2"; code_commit "$D"
  CARJA_EVIDENCE=off "$3" "$1" "$D"
  rm -rf "$D" "$B"
}
zero "Z1: node --test that found no file (ℹ tests 0) is BLOCKED" \
  "printf 'ℹ tests 0\nℹ suites 0\nℹ pass 0\nℹ fail 0\n'" refused
zero "Z2: pytest 'no tests ran' is BLOCKED"                  "echo 'collected 0 items'; echo '===== no tests ran in 0.01s ====='" refused
zero "Z3: vitest passWithNoTests is BLOCKED (colour codes stripped)" \
  "printf '\033[33mNo test files found, exiting with code 0\033[39m\n'" refused
zero "Z4: jest passWithNoTests is BLOCKED"                    "echo 'No tests found, exiting with code 0'" refused
zero "Z5: go test with only [no test files] is BLOCKED"       "printf '?   \tex/a\t[no test files]\n?   \tex/b\t[no test files]\n'" refused
zero "Z6: go test with one ok package PUSHES"                 "printf '?   \tex/a\t[no test files]\nok  \tex/b\t0.01s\n'" pushes
# Real summary lines from the four projects' verify runs (2026-11-05).
zero "Z7: pytest '641 passed, 3 skipped' PUSHES"              "echo '641 passed, 3 skipped, 3 warnings in 9.73s'" pushes
zero "Z8: jest 'Tests: 767 passed' PUSHES"                    "printf 'Test Suites: 52 passed, 52 total\nTests:       767 passed, 767 total\n'" pushes
zero "Z9: vitest 'Tests 124 passed | 1 expected fail' PUSHES" "printf ' Test Files  8 passed (8)\n      Tests  124 passed | 1 expected fail | 2 todo (127)\n'" pushes
zero "Z10: two suites, one empty, one ran tests PUSHES"       "echo 'No test files found, exiting with code 0'; echo '12 passed in 0.5s'" pushes
zero "Z11: a verify with no recognised summary PUSHES (count unknown)" "echo 'lint clean'" pushes
zero "Z12: a red verify stays red"                            "echo '3 passed'; exit 1" refused

D="$(repo)"; B="$(remote_repo "$D")"
with_verify "$D" "echo 'no tests ran in 0.01s'"; code_commit "$D"
OUT="$(CARJA_EVIDENCE=off git -C "$D" push origin HEAD:main 2>&1)"
case "$OUT" in *"ran no test"*CARJA_NO_TESTS_RAN*) ok "Z13: the message says no test ran and names CARJA_NO_TESTS_RAN" ;; *) no "Z13: message: $OUT" ;; esac
if CARJA_EVIDENCE=off CARJA_NO_TESTS_RAN="tests live in CI only" git -C "$D" push -q origin HEAD:main >/dev/null 2>&1 \
   && grep -q "tests live in CI only" "$D/carja/0-compass/ship-log.md"; then
  ok "Z14: CARJA_NO_TESTS_RAN lets it through and logs the reason"
else no "Z14: the CARJA_NO_TESTS_RAN waiver did not work"; fi
rm -rf "$D" "$B"

# With the evidence ledger on, the zero-run must not be recorded as green
# evidence: the second push would then find it FRESH and skip the run.
BIN="$(mktemp -d)"
printf '#!/usr/bin/env bash\nexec node "%s/bin/carja.js" "$@"\n' "$REPO_ROOT" > "$BIN/carja"; chmod +x "$BIN/carja"
D="$(repo)"; B="$(remote_repo "$D")"
with_verify "$D" "echo 'no tests ran in 0.01s'"; code_commit "$D"
PATH="$BIN:$PATH" git -C "$D" push -q origin HEAD:main >/dev/null 2>&1
if PATH="$BIN:$PATH" git -C "$D" push -q origin HEAD:main >/dev/null 2>&1; then
  no "Z15: the second push passed on FRESH evidence from the zero-test run"
else ok "Z15: with the evidence ledger on, the second push is still BLOCKED"; fi
rm -rf "$D" "$B" "$BIN"

D="$(repo)"; B="$(remote_repo "$D")"
with_verify "$D" "echo '3 passed'"; code_commit "$D" "chore: bump [skip ci]"
CARJA_EVIDENCE=off refused "S1: a pushed commit whose message says [skip ci] is BLOCKED" "$D"
if CARJA_EVIDENCE=off CARJA_NO_INTEGRITY="docs-only release" git -C "$D" push -q origin HEAD:main >/dev/null 2>&1 \
   && grep -q "docs-only release" "$D/carja/0-compass/ship-log.md"; then
  ok "S2: CARJA_NO_INTEGRITY lets the [skip ci] push through and logs the reason"
else no "S2: the CARJA_NO_INTEGRITY push waiver did not work"; fi
rm -rf "$D" "$B"

D="$(repo)"; B="$(remote_repo "$D")"
with_verify "$D" "echo '3 passed'"; code_commit "$D" "fix: skip ci-only paths in the router"
CARJA_EVIDENCE=off pushes "S3: 'skip ci' without brackets PUSHES" "$D"
rm -rf "$D" "$B"

echo ""
echo "  Passed: $pass"
echo "  Failed: $fail"
[ "$fail" -eq 0 ] && echo "STATUS: PASSED ✅" || echo "STATUS: FAILED ❌"
exit "$fail"
