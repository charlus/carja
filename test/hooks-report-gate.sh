#!/usr/bin/env bash
# ============================================================
# Report shape — pre-commit gate BEHAVIOR test (A4).
# Installs the real templates/.agents/hooks into a temp repo: a ship-log whose
# NEWEST entry has no "**For you**" block is blocked; with the block, with a
# waiver, with no dated entry at all, or with hooks off, it commits. Newest is
# by date, not by file order — one live log had 07-15 written after 07-16.
# ============================================================
set -uo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
pass=0; fail=0
ok() { echo "  [PASS] $1"; pass=$((pass+1)); }
no() { echo "  [FAIL] $1"; fail=$((fail+1)); }

fresh_repo() {
  local d; d="$(mktemp -d)"
  mkdir -p "$d/.agents/hooks" "$d/carja/0-compass"
  cp "$REPO_ROOT/templates/.agents/hooks/"* "$d/.agents/hooks/"
  chmod +x "$d/.agents/hooks/pre-commit" "$d/.agents/hooks/pre-push" 2>/dev/null
  git -C "$d" init -q
  git -C "$d" config user.email t@t.local
  git -C "$d" config user.name t
  git -C "$d" config core.hooksPath .agents/hooks
  printf '%s' "$d"
}
LOG=carja/0-compass/ship-log.md
WITH_BLOCK=$'## 2026-09-16 — Thing\n\n**For you**\n- **Impact:** users can page results\n- **Cost:** none\n- **Risk:** none\n- **Decide:** none\n\n**For the record**\n- **Quality:** review APPROVE\n'
NO_BLOCK=$'## 2026-09-16 — Thing\n- **What:** something\n- **Quality:** review APPROVE\n'

echo "Report shape — pre-commit gate:"

# ---- R1: newest entry without the block → BLOCKED -------------------------
D="$(fresh_repo)"; printf '%s' "$NO_BLOCK" > "$D/$LOG"
git -C "$D" add -A >/dev/null 2>&1
if git -C "$D" commit -q -m "ship-log without For you" >/dev/null 2>&1; then
  no "R1: ship-log committed WITHOUT a For-you block (gate did not fire)"
else
  ok "R1: ship-log whose newest entry lacks the block is BLOCKED"
fi
rm -rf "$D"

# ---- R2: newest entry with the block → COMMITS ----------------------------
D="$(fresh_repo)"; printf '%s' "$WITH_BLOCK" > "$D/$LOG"
git -C "$D" add -A >/dev/null 2>&1
if git -C "$D" commit -q -m "ship-log with For you" >/dev/null 2>&1; then
  ok "R2: ship-log with the block COMMITS"
else
  no "R2: ship-log with the block was blocked"
fi
rm -rf "$D"

# ---- R3: newest is by DATE, not file order --------------------------------
# An older, block-less entry written AFTER the newest one must not trip the gate.
D="$(fresh_repo)"
{ printf '%s' "$WITH_BLOCK"; printf '\n## 2026-07-15 — Older\n- **What:** legacy\n'; } > "$D/$LOG"
git -C "$D" add -A >/dev/null 2>&1
if git -C "$D" commit -q -m "older entry last in file" >/dev/null 2>&1; then
  ok "R3: newest is chosen by date, not by position in the file"
else
  no "R3: gate fired on an older entry that appears last in the file"
fi
rm -rf "$D"

# ---- R4: waiver → COMMITS and is logged -----------------------------------
D="$(fresh_repo)"; printf '%s' "$NO_BLOCK" > "$D/$LOG"
git -C "$D" add -A >/dev/null 2>&1
if CARJA_NO_REPORT="editing a pre-A4 entry" git -C "$D" commit -q -m "waived" >/dev/null 2>&1; then
  if grep -qi "report" "$D/$LOG"; then
    ok "R4: waiver commits AND is logged to the ship-log"
  else
    no "R4: waiver committed but was not logged"
  fi
else
  no "R4: waiver did not allow the commit"
fi
rm -rf "$D"

# ---- R5: a log with no dated entry is not gated ---------------------------
D="$(fresh_repo)"; printf '# Ship Log\n\nNothing shipped yet.\n' > "$D/$LOG"
git -C "$D" add -A >/dev/null 2>&1
if git -C "$D" commit -q -m "empty ship-log" >/dev/null 2>&1; then
  ok "R5: a ship-log with no dated entry commits"
else
  no "R5: gate fired on a ship-log with nothing shipped yet"
fi
rm -rf "$D"

# ---- R7: a staged change that only adds waiver lines is bookkeeping -------
# The hooks append "Hook waiver" lines themselves (carja upgrade does it on
# every run). Blocking the commit of that line, on a log whose newest entry
# predates the For-you rule, left every upgraded repository dirty.
D="$(fresh_repo)"; printf '%s' "$NO_BLOCK" > "$D/$LOG"
git -C "$D" add -A >/dev/null 2>&1; CARJA_HOOKS=off git -C "$D" commit -q -m "old entry" >/dev/null 2>&1
printf -- '- [2026-10-06 14:43] Hook waiver (Protected): carja upgrade to 6.8.2\n' >> "$D/$LOG"
git -C "$D" add -A >/dev/null 2>&1
if git -C "$D" commit -q -m "log waiver" >/dev/null 2>&1; then
  ok "R7: a waiver-line-only change to the ship-log commits"
else
  no "R7: the gate blocked a waiver line the hooks wrote themselves"
fi
rm -rf "$D"

# ---- R8: a waiver line does not smuggle in a report without For you -------
D="$(fresh_repo)"; printf '%s' "$NO_BLOCK" > "$D/$LOG"
git -C "$D" add -A >/dev/null 2>&1; CARJA_HOOKS=off git -C "$D" commit -q -m "old entry" >/dev/null 2>&1
printf -- '- [2026-10-06 14:43] Hook waiver (Protected): x\n- **What:** a real change\n' >> "$D/$LOG"
git -C "$D" add -A >/dev/null 2>&1
if git -C "$D" commit -q -m "waiver plus report" >/dev/null 2>&1; then
  no "R8: a report line rode in with a waiver line"
else
  ok "R8: a waiver line plus any other line is still gated"
fi
rm -rf "$D"

# ---- R9: the loop's own audit lines are bookkeeping, not a report -------
# evalapp-v2, 2026-10-19: carja loop appended "[loop]" lines to the
# ship-log, and the gate then blocked the owner's next commit.
D="$(fresh_repo)"; printf '%s' "$NO_BLOCK" > "$D/$LOG"
git -C "$D" add -A >/dev/null 2>&1; CARJA_HOOKS=off git -C "$D" commit -q -m "old entry" >/dev/null 2>&1
printf -- '- [2026-10-19T13:26:31.120Z] [loop] swarm start: 1 tasks, concurrency=1\n- [2026-10-19T13:33:05.002Z] [loop] run cost: ≈ $0.73 at list price\n' >> "$D/$LOG"
git -C "$D" add -A >/dev/null 2>&1
if git -C "$D" commit -q -m "loop audit lines" >/dev/null 2>&1; then
  ok "R9: the loop's [loop] audit lines commit without a For you block"
else
  no "R9: the gate blocked the loop's own audit lines"
fi
rm -rf "$D"

# ---- R10: loop lines do not smuggle in a report without For you ---------
D="$(fresh_repo)"; printf '%s' "$NO_BLOCK" > "$D/$LOG"
git -C "$D" add -A >/dev/null 2>&1; CARJA_HOOKS=off git -C "$D" commit -q -m "old entry" >/dev/null 2>&1
printf -- '- [2026-10-19T13:26:31.120Z] [loop] swarm start\n- **What:** a real change\n' >> "$D/$LOG"
git -C "$D" add -A >/dev/null 2>&1
if git -C "$D" commit -q -m "loop line plus report" >/dev/null 2>&1; then
  no "R10: a report line rode in with a loop line"
else
  ok "R10: a loop line plus any other line is still gated"
fi
rm -rf "$D"

# ---- R6: hooks off → gate silent ------------------------------------------
D="$(fresh_repo)"; printf '%s' "$NO_BLOCK" > "$D/$LOG"
git -C "$D" add -A >/dev/null 2>&1
if CARJA_HOOKS=off git -C "$D" commit -q -m "hooks off" >/dev/null 2>&1; then
  ok "R6: CARJA_HOOKS=off disables the gate"
else
  no "R6: gate still fired with CARJA_HOOKS=off"
fi
rm -rf "$D"

echo ""
echo "  Passed: $pass"
echo "  Failed: $fail"
[ "$fail" -eq 0 ] && echo "STATUS: PASSED ✅" || echo "STATUS: FAILED ❌"
exit "$fail"
