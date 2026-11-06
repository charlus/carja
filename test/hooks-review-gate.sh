#!/usr/bin/env bash
# ============================================================
# The review gate (7.2.0) — BEHAVIOUR test on the real pre-push hook and the
# real `carja review-log verdict` command.
#
# A change of consequence (50+ changed non-test lines of code, or a risk path)
# pushes only with an independent APPROVE recorded for the pushed commit, or
# for an earlier commit followed only by carja/ state or Markdown. Anything
# smaller, any test-only, state-only or framework-only change, pushes as before.
# CARJA_NO_REVIEW="why" lets it through and logs the reason.
# ============================================================
set -uo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
CARJA="node $REPO_ROOT/bin/carja.js"
pass=0; fail=0
ok() { echo "  [PASS] $1"; pass=$((pass+1)); }
no() { echo "  [FAIL] $1"; fail=$((fail+1)); }

repo() {
  local d b; d="$(mktemp -d)"; b="$(mktemp -d)"
  mkdir -p "$d/.agents/hooks" "$d/carja/0-compass" "$d/src" "$d/tests"
  cp "$REPO_ROOT/templates/.agents/hooks/"* "$d/.agents/hooks/"
  chmod +x "$d/.agents/hooks/pre-commit" "$d/.agents/hooks/pre-push"
  : > "$d/carja/0-compass/ship-log.md"
  printf '{ "verify": "echo 3 passed" }\n' > "$d/carja.config.json"
  printf 'def f():\n    return 1\n' > "$d/src/f.py"
  printf 'from src.f import f\n\ndef test_f():\n    assert f() == 1\n' > "$d/tests/test_f.py"
  git -C "$d" init -q -b main
  git -C "$d" config user.email t@t.local
  git -C "$d" config user.name t
  git -C "$d" config core.hooksPath .agents/hooks
  git -C "$d" add -A
  CARJA_HOOKS=off git -C "$d" commit -q -m base >/dev/null 2>&1
  git init -q --bare "$b"
  git -C "$d" remote add origin "$b"
  CARJA_HOOKS=off git -C "$d" push -q origin main >/dev/null 2>&1
  git -C "$d" fetch -q origin
  git -C "$d" remote set-head origin main >/dev/null 2>&1
  git -C "$d" checkout -q -b feature
  printf '%s' "$d"
}

# code <dir> <file> <n lines>: write n lines of code and commit them (hooks off: the commit gates are not under test).
code() {
  mkdir -p "$(dirname "$1/$2")"
  for i in $(seq 1 "$3"); do printf 'x%s = %s\n' "$i" "$i"; done >> "$1/$2"
  git -C "$1" add -A; CARJA_HOOKS=off git -C "$1" commit -q -m "code $2" >/dev/null 2>&1
}
pushes()  { if CARJA_EVIDENCE=off git -C "$2" push -q origin "${3:-feature}" >/dev/null 2>&1; then ok "$1"; else no "$1 (blocked, should push)"; fi; }
refused() { if CARJA_EVIDENCE=off git -C "$2" push -q origin "${3:-feature}" >/dev/null 2>&1; then no "$1 (pushed, should be blocked)"; else ok "$1"; fi; }
approve() { ( cd "$1" && $CARJA review-log verdict APPROVE >/dev/null 2>&1 ); }

echo "Review gate — pre-push:"

D="$(repo)"; code "$D" src/small.py 20
pushes "R1: 20 changed lines of code, no risk path, PUSHES without a review" "$D"
rm -rf "$D"

D="$(repo)"; code "$D" src/big.py 60
refused "R2: 60 changed lines of code with no review recorded is BLOCKED" "$D"
OUT="$(CARJA_EVIDENCE=off git -C "$D" push origin feature 2>&1)"
case "$OUT" in *"review-log verdict APPROVE"*CARJA_NO_REVIEW*) ok "R2b: the message names the command and the waiver" ;; *) no "R2b: message does not explain: $OUT" ;; esac
approve "$D"
pushes "R3: the same change after \`carja review-log verdict APPROVE\` PUSHES" "$D"
rm -rf "$D"

D="$(repo)"; code "$D" src/big.py 60; approve "$D"
printf -- '- shipped\n' >> "$D/carja/0-compass/ship-log.md"; printf 'notes\n' > "$D/NOTES.md"
git -C "$D" add -A; CARJA_HOOKS=off git -C "$D" commit -q -m "ship log" >/dev/null 2>&1
pushes "R4: an approved commit followed only by carja/ state and Markdown PUSHES" "$D"
rm -rf "$D"

D="$(repo)"; code "$D" src/big.py 60; approve "$D"; code "$D" src/more.py 60
refused "R5: an approved commit followed by 60 more lines of code is BLOCKED" "$D"
rm -rf "$D"

D="$(repo)"; code "$D" src/big.py 60; approve "$D"; code "$D" src/more.py 5
pushes "R5b: an approved commit followed by a 5-line fix (an IMPORTANT after the verdict) PUSHES" "$D"
rm -rf "$D"

D="$(repo)"; code "$D" src/big.py 60; approve "$D"; code "$D" src/auth/token.py 2
refused "R5c: an approved commit followed by 2 lines on a risk path is BLOCKED" "$D"
rm -rf "$D"

D="$(repo)"; code "$D" src/auth/login.py 5
refused "R6: 5 lines on a risk path (auth) is BLOCKED" "$D"
rm -rf "$D"

D="$(repo)"; code "$D" migrations/0042_add_column.py 4
refused "R7: 4 lines in a migration is BLOCKED" "$D"
rm -rf "$D"

D="$(repo)"; code "$D" tests/test_big.py 80; code "$D" src/fix.py 5
pushes "R8: 80 lines of tests plus 5 of code PUSHES (tests are not counted)" "$D"
rm -rf "$D"

D="$(repo)"; code "$D" .agents/skills/x/SKILL.py 120; code "$D" carja/2-backlog/plan.py 120
pushes "R9: framework (.agents/) and carja/ changes PUSH without a review" "$D"
rm -rf "$D"

D="$(repo)"; code "$D" src/big.py 60
if CARJA_EVIDENCE=off CARJA_NO_REVIEW="hotfix, reviewed on the MR" git -C "$D" push -q origin feature >/dev/null 2>&1 \
   && grep -q "hotfix, reviewed on the MR" "$D/carja/0-compass/ship-log.md"; then
  ok "R10: CARJA_NO_REVIEW lets it through and logs the reason"
else no "R10: the CARJA_NO_REVIEW waiver did not work"; fi
rm -rf "$D"

D="$(repo)"; git -C "$D" checkout -q main; code "$D" src/big.py 60
refused "R11: 60 lines pushed straight to the default branch is BLOCKED" "$D" main
rm -rf "$D"

D="$(repo)"; code "$D" src/big.py 60; approve "$D"
git -C "$D" commit -q --amend -m "reworded" >/dev/null 2>&1
refused "R12: an approval does not survive a rewrite of the commit (new sha)" "$D"
rm -rf "$D"

D="$(repo)"; code "$D" src/big.py 60
if ( cd "$D" && $CARJA review-log verdict CHANGES >/dev/null 2>&1 ); then
  no "R13: \`verdict\` accepted something other than APPROVE"
else ok "R13: \`verdict\` records APPROVE only"; fi
rm -rf "$D"

D="$(repo)"; code "$D" src/big.py 60; approve "$D"
git -C "$D" checkout -q main; WT="$(mktemp -d)"; rmdir "$WT"; git -C "$D" worktree add -q "$WT" feature
pushes "R14: an approval recorded in the main checkout counts in a worktree of the same repo" "$WT"
git -C "$D" worktree remove --force "$WT" 2>/dev/null; rm -rf "$D" "$WT"

echo ""
echo "Review gate: $pass passed, $fail failed"
[ "$fail" = "0" ]
