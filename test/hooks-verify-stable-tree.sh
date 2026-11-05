#!/usr/bin/env bash
# ============================================================
# A verify run that changes files does not pass the push gate — BEHAVIOUR test.
#
# Taken from AI-DLC (awslabs/aidlc-workflows), whose verification check fails
# a command that changes files while it runs. A verify command that rewrites
# snapshots, fixes lint or updates a lockfile passes against code that is not
# the code being pushed.
#
# Checked on real git and the real pre-push hook, with the real CLI on PATH:
#   - a verify command that edits a tracked file blocks the push, and names it
#   - a verify command that writes only an ignored file does not (sensitivity)
#   - a verify command that changes nothing passes (sensitivity)
# ============================================================
set -uo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
pass=0; fail=0
ok() { echo "  [PASS] $1"; pass=$((pass+1)); }
no() { echo "  [FAIL] $1"; fail=$((fail+1)); }
gitq() { git "$@" >/dev/null 2>&1; }

BIN="$(mktemp -d)"
printf '#!/usr/bin/env bash\nexec node "%s/bin/carja.js" "$@"\n' "$REPO_ROOT" > "$BIN/carja"
chmod +x "$BIN/carja"
export PATH="$BIN:$PATH"
export CARJA_HOME="$(mktemp -d)"

repo() {
  local d; d="$(mktemp -d)"
  mkdir -p "$d/.agents/hooks" "$d/carja/0-compass" "$d/src"
  cp "$REPO_ROOT/templates/.agents/hooks/"* "$d/.agents/hooks/"
  printf '# Ship Log\n' > "$d/carja/0-compass/ship-log.md"
  printf 'export const a = 1;\n' > "$d/src/a.js"
  printf '*.log\n' > "$d/.gitignore"
  printf '{ "verify": "%s", "eval": "none" }\n' "$1" > "$d/carja.config.json"
  git -C "$d" init -q
  git -C "$d" config user.email t@t.local
  git -C "$d" config user.name t
  git -C "$d" config core.hooksPath .agents/hooks
  git -C "$d" add -A
  CARJA_HOOKS=off gitq -C "$d" commit -q -m base
  local b; b="$(mktemp -d)"; git init -q --bare "$b"; git -C "$d" remote add origin "$b"
  CARJA_HOOKS=off gitq -C "$d" push -q origin HEAD:main
  printf 'export const b = 2;\n' > "$d/src/b.js"
  printf 'test("b", () => {});\n' > "$d/src/b.test.js"
  git -C "$d" add -A; gitq -C "$d" commit -q -m b
  printf '%s' "$d"
}

echo "=== a verify run that changes files does not pass the push gate ==="
D="$(repo "echo // >> src/a.js")"
out="$(git -C "$D" push origin HEAD:main 2>&1)"; rc=$?
if [ "$rc" != "0" ] && printf '%s' "$out" | grep -q "src/a.js"; then
  ok "a verify command that edits a tracked file blocks the push and names the file"
else
  no "a verify command that edits a tracked file did not block the push (rc=$rc): $out"
fi
rm -rf "$D"

D="$(repo "echo noise > run.log")"
out="$(git -C "$D" push origin HEAD:main 2>&1)"; rc=$?
[ "$rc" = "0" ] && ok "a verify command that writes only an ignored file passes" || no "an ignored-file write blocked the push: $out"
rm -rf "$D"

D="$(repo "true")"
out="$(git -C "$D" push origin HEAD:main 2>&1)"; rc=$?
[ "$rc" = "0" ] && ok "a verify command that changes nothing passes" || no "a clean verify blocked the push: $out"
rm -rf "$D"

rm -rf "$BIN" "$CARJA_HOME"
echo ""
echo "  hooks-verify-stable-tree: $pass passed, $fail failed"
[ "$fail" = "0" ] && echo "  STATUS: PASSED ✅" && exit 0
echo "  STATUS: FAILED ❌"; exit 1
