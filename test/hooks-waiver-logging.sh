#!/usr/bin/env bash
# ============================================================
# Every waiver is logged — BEHAVIOUR matrix (review B5).
#
# The contract every gate shares is "a bypass is allowed, silence is not". Two
# versions of a STRUCTURAL check claimed to prove it and did not: the first
# counted guard shapes, the second read guard bodies — and both passed with an
# `exit 0` placed before the log call, or a log call that existed only in a
# comment. A check that reads the code cannot see what the code does.
#
# So this checks the side effect instead. For every waiver, on the real hooks:
#   1. trip the gate WITHOUT the waiver  → it must block (the setup is real)
#   2. trip it WITH the waiver           → it must pass
#   3. the waiver's unique reason        → must appear in the ship-log
# An exit before the log call, a commented-out call, a misspelt variable: all
# fail step 3, whatever shape they take.
# ============================================================
set -uo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
pass=0; fail=0
ok() { echo "  [PASS] $1"; pass=$((pass+1)); }
no() { echo "  [FAIL] $1"; fail=$((fail+1)); }

repo() {
  local d; d="$(mktemp -d)"
  mkdir -p "$d/.agents/hooks" "$d/carja/0-compass" "$d/src" "$d/test"
  cp "$REPO_ROOT/templates/.agents/hooks/"* "$d/.agents/hooks/"
  chmod +x "$d/.agents/hooks/pre-commit" "$d/.agents/hooks/pre-push"
  : > "$d/carja/0-compass/ship-log.md"
  printf 'export const a = 1;\n' > "$d/src/a.js"
  printf 'test("a", () => { expect(1).toBe(1); });\ntest("b", () => { expect(2).toBe(2); });\n' > "$d/test/a.test.js"
  git -C "$d" init -q
  git -C "$d" config user.email t@t.local
  git -C "$d" config user.name t
  git -C "$d" config core.hooksPath .agents/hooks
  git -C "$d" add -A
  CARJA_HOOKS=off git -C "$d" commit -q -m base >/dev/null 2>&1
  printf '%s' "$d"
}

remote() {
  local d="$1" b; b="$(mktemp -d)"
  git init -q --bare "$b"
  git -C "$d" remote add origin "$b"
  CARJA_HOOKS=off git -C "$d" push -q origin HEAD:main >/dev/null 2>&1
  printf '%s' "$b"
}

logged() { grep -q "$2" "$1/carja/0-compass/ship-log.md"; }

# check <name> <var> <setup-fn> <action: commit|push>
check() {
  local name="$1" var="$2" setup="$3" action="$4"
  # A separate statement: `local` expands every argument before it assigns
  # any, so $var here would still be unset in the line above.
  local token="reason-$var-$$-$RANDOM"
  local D B rc

  D="$(repo)"; B=""; [ "$action" = "push" ] && B="$(remote "$D")"
  "$setup" "$D"
  if [ "$action" = "commit" ]; then git -C "$D" commit -q -m x >/dev/null 2>&1; else git -C "$D" push -q origin HEAD:main >/dev/null 2>&1; fi
  rc=$?
  rm -rf "$D" ${B:+"$B"}
  if [ "$rc" = "0" ]; then
    no "$name: the setup does not trip the gate — this case proves nothing"
    return
  fi

  D="$(repo)"; B=""; [ "$action" = "push" ] && B="$(remote "$D")"
  "$setup" "$D"
  if [ "$action" = "commit" ]; then
    env "$var=$token" git -C "$D" commit -q -m x >/dev/null 2>&1
  else
    env "$var=$token" git -C "$D" push -q origin HEAD:main >/dev/null 2>&1
  fi
  rc=$?
  if [ "$rc" != "0" ]; then
    no "$name: $var did not let the $action through"
  elif ! logged "$D" "$token"; then
    no "$name: $var let the $action through WITHOUT writing its reason to the ship-log"
  else
    ok "$name: blocked without $var; with it, passes and logs the reason"
  fi
  rm -rf "$D" ${B:+"$B"}
}

# ---- setups: each trips exactly one gate ----------------------------------
s_test()      { printf 'export const b = 2;\n' > "$1/src/b.js"; git -C "$1" add -A; }
s_eval()      { printf 'import OpenAI from "openai";\nexport const c = new OpenAI();\n' > "$1/src/llm.js"
                printf 'test("llm", () => { expect(1).toBe(1); });\n' > "$1/test/llm.test.js"; git -C "$1" add -A; }
s_brief()     { mkdir -p "$1/carja/2-implementations/x"
                printf '# Spec\n\n## Scope\nA thing.\n' > "$1/carja/2-implementations/x/feature-spec.md"; git -C "$1" add -A; }
s_report()    { printf '# Ship Log\n\n## 2026-09-24 — shipped a thing\n\nNo for-you block.\n' > "$1/carja/0-compass/ship-log.md"; git -C "$1" add -A; }
s_boundary()  { git -C "$1" rm -q test/a.test.js; }
s_protected() { printf '\n# changed\n' >> "$1/.agents/hooks/pre-push"; git -C "$1" add -A; }
# The committed library is unusable (empty): the fail-closed path, which logs
# through its own fallback writer because lib.sh's writer is not available.
s_libgone()   { : > "$1/.agents/hooks/lib.sh"; git -C "$1" add -A
                CARJA_HOOKS=off git -C "$1" commit -q -m "break lib" >/dev/null 2>&1
                printf 'export const d = 4;\n' > "$1/src/d.js"; git -C "$1" add -A; }
s_verify()    { printf '{ "verify": "false" }\n' > "$1/carja.config.json"; git -C "$1" add -A
                CARJA_HOOKS=off git -C "$1" commit -q -m cfg >/dev/null 2>&1; }
s_evalrun()   { mkdir -p "$1/evals"; printf 'export const e = [];\n' > "$1/evals/x.eval.js"
                printf '{ "verify": "true", "eval": "false" }\n' > "$1/carja.config.json"; git -C "$1" add -A
                CARJA_HOOKS=off git -C "$1" commit -q -m evals >/dev/null 2>&1; }
# The REMOTE's committed library is unusable: pre-push's own fail-closed path,
# which logs through the fallback writer (final review, NB3).
s_pushlib()   { : > "$1/.agents/hooks/lib.sh"; git -C "$1" add -A
                CARJA_HOOKS=off git -C "$1" commit -q -m "break lib" >/dev/null 2>&1
                CARJA_HOOKS=off git -C "$1" push -q origin HEAD:main >/dev/null 2>&1
                printf 'export const e = 5;\n' > "$1/src/e.js"
                printf 'test("e", () => { expect(5).toBe(5); });\n' > "$1/test/e.test.js"
                git -C "$1" add -A; CARJA_HOOKS=off git -C "$1" commit -q -m "work" >/dev/null 2>&1; }
s_integrity() { printf 'export const i = 1; // @ts-ignore\n' > "$1/src/i.js"
                printf 'test("i", () => { expect(1).toBe(1); });\n' > "$1/test/i.test.js"; git -C "$1" add -A; }
s_noassert()  { printf 'export const a = 2;\n' > "$1/src/a.js"; printf '// note\n' >> "$1/test/a.test.js"; git -C "$1" add -A; }
s_zerorun()   { printf '{ "verify": "echo no tests ran" }\n' > "$1/carja.config.json"; git -C "$1" add -A
                CARJA_HOOKS=off git -C "$1" commit -q -m cfg >/dev/null 2>&1; }
s_skipci()    { printf '{ "verify": "echo 3 passed" }\n' > "$1/carja.config.json"; git -C "$1" add -A
                CARJA_HOOKS=off git -C "$1" commit -q -m "cfg [skip ci]" >/dev/null 2>&1; }
s_rmhook()    { git -C "$1" rm -q .agents/hooks/pre-commit
                CARJA_HOOKS=off git -C "$1" commit -q -m "rm hook" >/dev/null 2>&1; }

echo "Every waiver is logged — behaviour, on the real hooks:"
echo "  pre-commit"
check "W1 Test-Driven Law"          CARJA_NO_TEST      s_test      commit
check "W2 Eval-Driven Law"          CARJA_NO_EVAL      s_eval      commit
check "W3 brief check"              CARJA_NO_BRIEF     s_brief     commit
check "W4 report shape"             CARJA_NO_REPORT    s_report    commit
check "W5 Goodhart boundary"        CARJA_NO_BOUNDARY  s_boundary  commit
check "W6 protected paths"          CARJA_NO_PROTECTED s_protected commit
check "W7 library unavailable"      CARJA_NO_PROTECTED s_libgone   commit
check "W12 no assertion touched"     CARJA_NO_TEST      s_noassert  commit
check "W13 gate integrity"           CARJA_NO_INTEGRITY s_integrity commit
echo "  pre-push"
check "W8 Verification Iron Law"    CARJA_SKIP_VERIFY  s_verify    push
check "W9 Eval-Driven Law (run)"    CARJA_SKIP_EVAL    s_evalrun   push
check "W10 hook removal"            CARJA_NO_PROTECTED s_rmhook    push
check "W11 remote library unusable" CARJA_NO_PROTECTED s_pushlib   push
check "W14 verify ran no test"       CARJA_NO_TESTS_RAN s_zerorun   push
check "W15 [skip ci] in a commit"    CARJA_NO_INTEGRITY s_skipci    push

echo ""
echo "  Passed: $pass"
echo "  Failed: $fail"
[ "$fail" -eq 0 ] && echo "STATUS: PASSED ✅" || echo "STATUS: FAILED ❌"
exit "$fail"
