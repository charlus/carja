#!/usr/bin/env bash
# ============================================================
# The gates guard the code in the outer layout — BEHAVIOUR test (D2).
#
# In the outer layout, carja/ and .agents/ sit in an outer repository and
# the team's code is a gitignored nested repository. `install-hooks` used to
# wire only the outer repository, so no TDD, eval or verify gate ever ran on a
# product commit (website, autopportunity, 2026-10), while `carja status`
# printed "Gates on".
#
# Checked on real git, real hooks, real `carja install-hooks`:
#   - install-hooks wires each nested code repository to the outer hooks
#   - a nested commit of code with no test is blocked, with a test it passes
#   - a nested waiver is logged in the OUTER ship-log
#   - the library comes from the outer COMMITTED copy: a working-tree edit
#     that disables a gate does not disable it
#   - pre-push runs the nested repository's own verify command from
#     carja.config.json "repos"
#   - a nested repository with its own hooks is left alone
#   - --uninstall unwires the nested repositories
#   - status no longer says "on" while a nested repository is unwired
# ============================================================
set -uo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
CLI="$REPO_ROOT/bin/carja.js"
pass=0; fail=0
ok() { echo "  [PASS] $1"; pass=$((pass+1)); }
no() { echo "  [FAIL] $1"; fail=$((fail+1)); }

gitq() { git "$@" >/dev/null 2>&1; }

# outer layout: <d>/ outer repo with .agents + carja, <d>/app nested code repo
layout() {
  local d; d="$(mktemp -d)"
  mkdir -p "$d/.agents/hooks" "$d/carja/0-compass"
  cp "$REPO_ROOT/templates/.agents/hooks/"* "$d/.agents/hooks/"
  : > "$d/carja/0-compass/ship-log.md"
  printf '{ "verify": "none", "repos": { "app": { "verify": "%s" } } }\n' "${1:-true}" > "$d/carja.config.json"
  printf 'app/\n' > "$d/.gitignore"
  git -C "$d" init -q
  git -C "$d" config user.email t@t.local
  git -C "$d" config user.name t
  git -C "$d" add -A
  CARJA_HOOKS=off gitq -C "$d" commit -q -m outer

  mkdir -p "$d/app/src" "$d/app/test"
  printf 'export const a = 1;\n' > "$d/app/src/a.js"
  printf 'test("a", () => { expect(1).toBe(1); });\n' > "$d/app/test/a.test.js"
  git -C "$d/app" init -q
  git -C "$d/app" config user.email t@t.local
  git -C "$d/app" config user.name t
  git -C "$d/app" add -A
  gitq -C "$d/app" commit -q -m base
  printf '%s' "$d"
}

impl_only() { printf 'export const b = 2;\n' > "$1/app/src/b.js"; git -C "$1/app" add -A; }

echo "=== nested code repositories are gated ==="

D="$(layout)"
node "$CLI" install-hooks "$D" >/dev/null 2>&1
hp="$(git -C "$D/app" config --local --get core.hooksPath || true)"
[ "$hp" = "$D/.agents/hooks" ] && ok "install-hooks wires the nested repository to the outer hooks" \
  || no "nested core.hooksPath is '$hp', expected '$D/.agents/hooks'"

impl_only "$D"
if git -C "$D/app" commit -q -m x >/dev/null 2>&1; then no "a nested commit of code with no test passed"; else ok "a nested commit of code with no test is blocked"; fi

printf 'test("b", () => { expect(2).toBe(2); });\n' > "$D/app/test/b.test.js"; git -C "$D/app" add -A
if git -C "$D/app" commit -q -m x >/dev/null 2>&1; then ok "a nested commit with its test passes"; else no "a nested commit with its test was blocked"; fi

printf 'export const c = 3;\n' > "$D/app/src/c.js"; git -C "$D/app" add -A
token="nested-waiver-$$-$RANDOM"
if CARJA_NO_TEST="$token" git -C "$D/app" commit -q -m x >/dev/null 2>&1 && grep -q "$token" "$D/carja/0-compass/ship-log.md"; then
  ok "a nested waiver passes and is logged in the outer ship-log"
else
  no "a nested waiver was not let through, or not logged in the outer ship-log"
fi
rm -rf "$D"

echo "=== a worktree of the nested repository is gated too ==="
D="$(layout)"; W="$(mktemp -d)/wt"
node "$CLI" install-hooks "$D" >/dev/null 2>&1
gitq -C "$D/app" worktree add -q -b wt "$W"
printf 'export const w = 1;\n' > "$W/src/w.js"; git -C "$W" add -A
if git -C "$W" commit -q -m x >/dev/null 2>&1; then no "a worktree commit of code with no test passed"; else ok "a worktree commit of code with no test is blocked"; fi
token="wt-waiver-$$-$RANDOM"
if CARJA_NO_TEST="$token" git -C "$W" commit -q -m x >/dev/null 2>&1 && grep -q "$token" "$D/carja/0-compass/ship-log.md"; then
  ok "a worktree waiver is logged in the outer ship-log"
else
  no "a worktree waiver was not logged in the outer ship-log"
fi
rm -rf "$D" "$(dirname "$W")"

echo "=== the library is the outer committed copy ==="
D="$(layout)"
node "$CLI" install-hooks "$D" >/dev/null 2>&1
printf '\ncarja_is_impl_file() { return 1; }\n' >> "$D/.agents/hooks/lib.sh"
impl_only "$D"
if git -C "$D/app" commit -q -m x >/dev/null 2>&1; then no "an uncommitted outer lib.sh edit disabled the nested TDD gate"; else ok "an uncommitted outer lib.sh edit does not disable the nested gate"; fi
rm -rf "$D"

echo "=== pre-push runs the nested repository's own verify command ==="
for case in false true; do
  D="$(layout "$case")"; B="$(mktemp -d)"
  git init -q --bare "$B"
  git -C "$D/app" remote add origin "$B"
  node "$CLI" install-hooks "$D" >/dev/null 2>&1
  printf 'export const d = 4;\n' > "$D/app/src/d.js"; printf 'test("d", () => { expect(4).toBe(4); });\n' > "$D/app/test/d.test.js"
  git -C "$D/app" add -A; gitq -C "$D/app" commit -q -m d
  out="$(CARJA_EVIDENCE=off git -C "$D/app" push -q origin HEAD:main 2>&1)"; rc=$?
  if [ "$case" = "false" ]; then
    [ "$rc" != "0" ] && ok "a failing per-repository verify command blocks the push" || no "a failing per-repository verify command did not block: $out"
  else
    [ "$rc" = "0" ] && ok "a passing per-repository verify command lets the push through" || no "a passing verify command blocked the push: $out"
  fi
  rm -rf "$D" "$B"
done

echo "=== a nested repository with its own hooks is left alone ==="
D="$(layout)"
git -C "$D/app" config core.hooksPath .husky
node "$CLI" install-hooks "$D" >/dev/null 2>&1
[ "$(git -C "$D/app" config --get core.hooksPath)" = ".husky" ] && ok "a foreign nested hooksPath is kept" || no "a foreign nested hooksPath was overwritten"
rm -rf "$D"

D="$(layout)"
printf '#!/bin/sh\nexit 0\n' > "$D/app/.git/hooks/pre-commit"; chmod +x "$D/app/.git/hooks/pre-commit"
node "$CLI" install-hooks "$D" >/dev/null 2>&1
[ -z "$(git -C "$D/app" config --get core.hooksPath || true)" ] && ok "a nested repository with live .git/hooks is not rewired" || no "live .git/hooks were silently disabled"
rm -rf "$D"

echo "=== uninstall and status ==="
D="$(layout)"
node "$CLI" install-hooks "$D" >/dev/null 2>&1
node "$CLI" install-hooks "$D" --uninstall >/dev/null 2>&1
[ -z "$(git -C "$D/app" config --get core.hooksPath || true)" ] && ok "--uninstall unwires the nested repository" || no "--uninstall left the nested repository wired"
git -C "$D" config core.hooksPath .agents/hooks
chmod +x "$D/.agents/hooks/pre-commit" "$D/.agents/hooks/pre-push"
status="$(cd "$D" && node "$CLI" status 2>&1)"
if printf '%s' "$status" | grep -Ei 'gates' | grep -qi 'app'; then ok "status names the unwired nested repository"; else no "status does not name the unwired nested repository: $(printf '%s' "$status" | grep -i gates)"; fi
rm -rf "$D"

echo ""
echo "  hooks-nested-repos: $pass passed, $fail failed"
[ "$fail" = "0" ] && echo "  STATUS: PASSED ✅" && exit 0
echo "  STATUS: FAILED ❌"; exit 1
