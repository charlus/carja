#!/usr/bin/env bash
# ============================================================
# Merging a newer Carja into an older branch — BEHAVIOUR test (F11).
#
# autopportunity, 2026-10: a branch cut before an upgrade merged main. The merge
# had a conflict, so `git commit` ran pre-commit, which loads lib.sh from HEAD:
# the OLD branch's library, missing the newer helpers. It failed closed with
# "That is normal for the one commit that upgrades Carja itself", and the
# agent bypassed it with CARJA_NO_PROTECTED. During a merge, the library of
# the branch being merged (MERGE_HEAD) is committed too, and is used instead;
# a protected file staged exactly as MERGE_HEAD has it is not this change's edit.
# ============================================================
set -uo pipefail
REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
pass=0; fail=0
ok() { echo "  [PASS] $1"; pass=$((pass+1)); }
no() { echo "  [FAIL] $1"; fail=$((fail+1)); }
G() { git -C "$D" -c user.email=t@t -c user.name=t "$@"; }

# Drop one helper the current hooks require: an older library.
strip_helper() {
  python3 -c '
import re, sys
p = sys.argv[1]; s = open(p).read()
s = re.sub(r"\ncarja_deleted_test_files\(\) \{.*?\n\}\n", "\n", s, flags=re.S)
open(p, "w").write(s)
' "$1"
}

# Leaves $D on branch `feature`, mid-merge of `main`, with a conflict on notes.txt.
setup() {
  D="$(mktemp -d)"
  mkdir -p "$D/.agents/hooks" "$D/carja/0-compass"
  cp "$REPO_ROOT/templates/.agents/hooks/"* "$D/.agents/hooks/"
  : > "$D/carja/0-compass/ship-log.md"
  printf 'shared = 1\n' > "$D/notes.txt"
  G init -q -b main
  G config core.hooksPath .agents/hooks
  strip_helper "$D/.agents/hooks/lib.sh"
  G add -A; CARJA_HOOKS=off G commit -q -m "old carja"
  G switch -q -c feature
  printf 'shared = feature\n' > "$D/notes.txt"; CARJA_HOOKS=off G commit -qam "feature work"
  G switch -q main
  cp "$REPO_ROOT/templates/.agents/hooks/lib.sh" "$D/.agents/hooks/lib.sh"
  printf 'shared = main\n' > "$D/notes.txt"
  G add -A; CARJA_HOOKS=off G commit -q -m "upgrade carja"
  G switch -q feature
  G merge -q main >/dev/null 2>&1   # conflicts on notes.txt
  printf 'shared = both\n' > "$D/notes.txt"; G add notes.txt
}

setup
if out="$(G commit -q --no-edit 2>&1)"; then ok "the merge commit passes with the merged branch's library, no waiver"; else no "the merge commit failed: $(printf '%s' "$out" | head -3)"; fi
grep -q "Hook waiver" "$D/carja/0-compass/ship-log.md" && no "a waiver was logged" || ok "no waiver needed"
rm -rf "$D"

setup
printf '\n# edited while resolving\n' >> "$D/.agents/hooks/lib.sh"; G add .agents/hooks/lib.sh
if G commit -q --no-edit >/dev/null 2>&1; then no "a protected file edited during the merge passed"; else ok "a protected file edited during the merge is still blocked"; fi
rm -rf "$D"

setup
G merge --abort >/dev/null 2>&1
printf 'x\n' > "$D/other.txt"; G add other.txt
if G commit -q -m x >/dev/null 2>&1; then no "outside a merge, an incomplete library did not fail closed"; else ok "outside a merge, an incomplete library still fails closed"; fi
rm -rf "$D"

echo ""
echo "  hooks-merge-upgrade: $pass passed, $fail failed"
[ "$fail" = "0" ] && echo "  STATUS: PASSED ✅" && exit 0
echo "  STATUS: FAILED ❌"; exit 1
