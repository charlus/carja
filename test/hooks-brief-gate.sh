#!/usr/bin/env bash
# ============================================================
# Outward Rigour — pre-commit brief-check gate BEHAVIOR test (A5 / D1).
# Installs the real templates/.agents/hooks into a temp repo and exercises the
# gate: a feature-spec.md staged without a "Brief check" section is blocked;
# with the section, or with a logged waiver, it commits; other markdown is
# untouched. Presence is gated, not quality — same call as the Eval-Driven Law.
# ============================================================
set -uo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
pass=0; fail=0
ok() { echo "  [PASS] $1"; pass=$((pass+1)); }
no() { echo "  [FAIL] $1"; fail=$((fail+1)); }

fresh_repo() {
  local d; d="$(mktemp -d)"
  mkdir -p "$d/.agents/hooks" "$d/carja/0-compass" "$d/carja/2-implementations/01-thing"
  cp "$REPO_ROOT/templates/.agents/hooks/"* "$d/.agents/hooks/"
  chmod +x "$d/.agents/hooks/pre-commit" "$d/.agents/hooks/pre-push" 2>/dev/null
  : > "$d/carja/0-compass/ship-log.md"
  git -C "$d" init -q
  git -C "$d" config user.email t@t.local
  git -C "$d" config user.name t
  git -C "$d" config core.hooksPath .agents/hooks
  printf '%s' "$d"
}
SPEC_DIR="carja/2-implementations/01-thing"

echo "Outward Rigour — pre-commit brief-check gate:"

# ---- B1: feature-spec with no Brief check → BLOCKED -----------------------
D="$(fresh_repo)"
printf '# Feature Spec\n\n## Scope\nA thing.\n' > "$D/$SPEC_DIR/feature-spec.md"
git -C "$D" add -A >/dev/null 2>&1
if git -C "$D" commit -q -m "spec without brief check" >/dev/null 2>&1; then
  no "B1: feature-spec committed WITHOUT a Brief check (gate did not fire)"
else
  ok "B1: feature-spec without a Brief check is BLOCKED"
fi
rm -rf "$D"

# ---- B2: feature-spec WITH Brief check → COMMITS --------------------------
D="$(fresh_repo)"
printf '# Feature Spec\n\n## Brief check\nNone found.\n\n## Scope\nA thing.\n' > "$D/$SPEC_DIR/feature-spec.md"
git -C "$D" add -A >/dev/null 2>&1
if git -C "$D" commit -q -m "spec with brief check" >/dev/null 2>&1; then
  ok "B2: feature-spec with a Brief check COMMITS"
else
  no "B2: feature-spec with a Brief check was blocked"
fi
rm -rf "$D"

# ---- B3: waiver → COMMITS and is logged -----------------------------------
D="$(fresh_repo)"
printf '# Feature Spec\n\n## Scope\nA thing.\n' > "$D/$SPEC_DIR/feature-spec.md"
git -C "$D" add -A >/dev/null 2>&1
if CARJA_NO_BRIEF="carried over from a pre-A5 spec" git -C "$D" commit -q -m "waived" >/dev/null 2>&1; then
  if grep -qi "brief" "$D/carja/0-compass/ship-log.md"; then
    ok "B3: waiver commits AND is logged to the ship-log"
  else
    no "B3: waiver committed but was not logged"
  fi
else
  no "B3: waiver did not allow the commit"
fi
rm -rf "$D"

# ---- B4: other markdown is untouched --------------------------------------
D="$(fresh_repo)"
printf '# Notes\nsome notes\n' > "$D/carja/notes.md"
git -C "$D" add -A >/dev/null 2>&1
if git -C "$D" commit -q -m "unrelated markdown" >/dev/null 2>&1; then
  ok "B4: unrelated markdown is untouched by the gate"
else
  no "B4: the gate fired on unrelated markdown"
fi
rm -rf "$D"

# ---- B5: hooks off → gate silent ------------------------------------------
D="$(fresh_repo)"
printf '# Feature Spec\n\n## Scope\nA thing.\n' > "$D/$SPEC_DIR/feature-spec.md"
git -C "$D" add -A >/dev/null 2>&1
if CARJA_HOOKS=off git -C "$D" commit -q -m "hooks off" >/dev/null 2>&1; then
  ok "B5: CARJA_HOOKS=off disables the gate"
else
  no "B5: gate still fired with CARJA_HOOKS=off"
fi
rm -rf "$D"

echo ""
echo "  Passed: $pass"
echo "  Failed: $fail"
[ "$fail" -eq 0 ] && echo "STATUS: PASSED ✅" || echo "STATUS: FAILED ❌"
exit "$fail"
