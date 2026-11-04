#!/usr/bin/env bash
# ============================================================
# Gates fire on code, not on project state — BEHAVIOUR test (F4).
#
# Real usage (eurassistant, autopportunity, 2026-10):
#   - a backlog-only push ran 29 live LLM evals and failed on a flaky one;
#   - one-off scripts archived under carja/6-archive/ needed 5 TDD waivers;
#   - every waiver left an uncommitted ship-log line, which needed a chore
#     commit, which ran the evals again.
#
# Checked on real git and the real hooks:
#   - files under carja/ are not implementation code (TDD gate)
#   - a push that changes only carja/ runs no verify and no evals, and a
#     push that changes code still does (sensitivity)
#   - a commit's own waiver line is in that commit: the tree ends clean
#   - a push waiver line rides the next commit: no chore commit
#   - a hand-written ship-log edit is never staged by the hook
# ============================================================
set -uo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
pass=0; fail=0
ok() { echo "  [PASS] $1"; pass=$((pass+1)); }
no() { echo "  [FAIL] $1"; fail=$((fail+1)); }
gitq() { git "$@" >/dev/null 2>&1; }

repo() {
  local d; d="$(mktemp -d)"
  mkdir -p "$d/.agents/hooks" "$d/carja/0-compass" "$d/carja/2-backlog" "$d/src" "$d/test" "$d/evals"
  cp "$REPO_ROOT/templates/.agents/hooks/"* "$d/.agents/hooks/"
  printf '# Ship Log\n' > "$d/carja/0-compass/ship-log.md"
  printf '# Backlog\n' > "$d/carja/2-backlog/task-backlog.md"
  printf 'export const a = 1;\n' > "$d/src/a.js"
  printf 'test("a", () => { expect(1).toBe(1); });\n' > "$d/test/a.test.js"
  printf 'case\n' > "$d/evals/a.eval.yaml"
  printf '{ "verify": "%s", "eval": "%s" }\n' "${1:-true}" "${2:-true}" > "$d/carja.config.json"
  git -C "$d" init -q
  git -C "$d" config user.email t@t.local
  git -C "$d" config user.name t
  git -C "$d" config core.hooksPath .agents/hooks
  git -C "$d" add -A
  CARJA_HOOKS=off gitq -C "$d" commit -q -m base
  printf '%s' "$d"
}
remote() { local b; b="$(mktemp -d)"; git init -q --bare "$b"; git -C "$1" remote add origin "$b"; CARJA_HOOKS=off gitq -C "$1" push -q origin HEAD:main; printf '%s' "$b"; }
clean() { [ -z "$(git -C "$1" status --porcelain)" ]; }

echo "=== files under carja/ are not implementation code ==="
D="$(repo)"
mkdir -p "$D/carja/6-archive"; printf 'print(1)\n' > "$D/carja/6-archive/backfill.py"; git -C "$D" add -A
if git -C "$D" commit -q -m archive >/dev/null 2>&1; then ok "a script archived under carja/ commits without a test"; else no "a script under carja/ was blocked by the TDD gate"; fi
printf 'export const b = 2;\n' > "$D/src/b.js"; git -C "$D" add -A
if git -C "$D" commit -q -m b >/dev/null 2>&1; then no "code under src/ with no test passed (the gate is off)"; else ok "code under src/ with no test is still blocked"; fi
rm -rf "$D"

echo "=== a push that changes only carja/ runs no verify and no evals ==="
D="$(repo false false)"; B="$(remote "$D")"
printf -- '- item\n' >> "$D/carja/2-backlog/task-backlog.md"; git -C "$D" add -A; gitq -C "$D" commit -q -m backlog
out="$(CARJA_EVIDENCE=off git -C "$D" push -q origin HEAD:main 2>&1)"; rc=$?
[ "$rc" = "0" ] && ok "a carja/-only push is not blocked by a failing verify or eval" || no "a carja/-only push was blocked: $out"
printf 'export const c = 3;\n' > "$D/src/c.js"; printf 'test("c", () => { expect(3).toBe(3); });\n' > "$D/test/c.test.js"
git -C "$D" add -A; gitq -C "$D" commit -q -m c
if CARJA_EVIDENCE=off git -C "$D" push -q origin HEAD:main >/dev/null 2>&1; then no "a push with code skipped the failing verify"; else ok "a push with code still runs verify"; fi
rm -rf "$D" "$B"

D="$(repo true false)"; B="$(remote "$D")"
printf 'export const e = 5;\n' > "$D/src/e.js"; printf 'test("e", () => { expect(5).toBe(5); });\n' > "$D/test/e.test.js"
git -C "$D" add -A; gitq -C "$D" commit -q -m e
if CARJA_EVIDENCE=off git -C "$D" push -q origin HEAD:main >/dev/null 2>&1; then no "a push with code skipped the failing evals"; else ok "a push with code still runs the evals"; fi
rm -rf "$D" "$B"

echo "=== \"eval\": \"none\" is a declared opt-out ==="
D="$(repo true none)"; B="$(remote "$D")"
printf 'export const n = 1;\n' > "$D/src/n.js"; printf 'test("n", () => { expect(1).toBe(1); });\n' > "$D/test/n.test.js"
git -C "$D" add -A; gitq -C "$D" commit -q -m n
out="$(CARJA_EVIDENCE=off git -C "$D" push -q origin HEAD:main 2>&1)"; rc=$?
if [ "$rc" = "0" ] && ! printf '%s' "$out" | grep -q "NOT enforced"; then ok "eval none: the push passes without the not-enforced notice"; else no "eval none was not honoured: $out"; fi
rm -rf "$D" "$B"

echo "=== waiver lines ride the commit ==="
D="$(repo)"
printf 'export const f = 6;\n' > "$D/src/f.js"; git -C "$D" add -A
token="commit-waiver-$$-$RANDOM"
CARJA_NO_TEST="$token" gitq -C "$D" commit -q -m f
if git -C "$D" show HEAD:carja/0-compass/ship-log.md | grep -q "$token" && clean "$D"; then
  ok "a commit's waiver line is in that commit, and the tree is clean"
else
  no "the waiver line was not committed with its commit (status: $(git -C "$D" status --porcelain | tr '\n' ' '))"
fi
rm -rf "$D"

D="$(repo false)"; B="$(remote "$D")"
printf 'export const g = 7;\n' > "$D/src/g.js"; printf 'test("g", () => { expect(7).toBe(7); });\n' > "$D/test/g.test.js"
git -C "$D" add -A; gitq -C "$D" commit -q -m g
token="push-waiver-$$-$RANDOM"
CARJA_EVIDENCE=off CARJA_SKIP_VERIFY="$token" gitq -C "$D" push -q origin HEAD:main
printf 'export const h = 8;\n' > "$D/src/h.js"; printf 'test("h", () => { expect(8).toBe(8); });\n' > "$D/test/h.test.js"
git -C "$D" add src test; gitq -C "$D" commit -q -m h
if git -C "$D" show HEAD:carja/0-compass/ship-log.md | grep -q "$token" && clean "$D"; then
  ok "a push waiver line rides the next commit, with no chore commit"
else
  no "the push waiver line was left behind (status: $(git -C "$D" status --porcelain | tr '\n' ' '))"
fi
rm -rf "$D" "$B"

D="$(repo)"
printf '\n## Draft entry by hand\n' >> "$D/carja/0-compass/ship-log.md"
printf 'export const i = 9;\n' > "$D/src/i.js"; git -C "$D" add src
CARJA_NO_TEST="hand-edit-$$" gitq -C "$D" commit -q -m i
if git -C "$D" show HEAD:carja/0-compass/ship-log.md | grep -q "Draft entry by hand"; then
  no "the hook committed a hand-written ship-log edit"
else
  ok "a hand-written ship-log edit is never staged by the hook"
fi
rm -rf "$D"

echo ""
echo "  hooks-no-code: $pass passed, $fail failed"
[ "$fail" = "0" ] && echo "  STATUS: PASSED ✅" && exit 0
echo "  STATUS: FAILED ❌"; exit 1
