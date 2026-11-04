#!/usr/bin/env bash
# test/hooks-trust-store.sh — E4 behavior test for the verify-command trust
# boundary and the bounded stop-hook re-entry.
#
# This is a BEHAVIOR test, not a structural one: it builds a throwaway repo,
# runs the real `carja trust-verify` (Node) and the real stop hook (bash),
# and asserts on exit codes and on whether the declared command actually ran.
# The cross-implementation check matters most — the hook reads a store the CLI
# wrote, and a hash-format disagreement between them would silently disable the
# gate while every other suite stayed green.

set -uo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
TMP="$(mktemp -d "${TMPDIR:-/tmp}/carja-trust-XXXXXX")"
export CARJA_HOME="$TMP/home"
PASS=0
FAIL=0

cleanup() { rm -rf "$TMP"; }
trap cleanup EXIT

ok()   { echo "  [PASS] $1"; PASS=$((PASS+1)); }
bad()  { echo "  [FAIL] $1"; FAIL=$((FAIL+1)); }
check(){ if [ "$2" = "$3" ]; then ok "$1"; else bad "$1 (expected '$3', got '$2')"; fi; }

# --- a throwaway project with the framework's hooks in place -----------------
PROJ="$TMP/proj"
mkdir -p "$PROJ"
node "$REPO_ROOT/bin/carja.js" init "$PROJ" --all >/dev/null 2>&1
cd "$PROJ" || exit 1
git init -q .
git config user.email t@t.t
git config user.name T

# A verification command whose EXECUTION is observable: it touches a marker.
MARKER="$TMP/verify-ran"
cat > carja.config.json <<JSON
{ "verify": "touch '$MARKER'; exit \${VERIFY_EXIT:-0}" }
JSON

# An implementation file, committed, then modified — the stop hook only engages
# when tracked impl code differs from HEAD.
mkdir -p src
echo 'export const a = 1;' > src/app.js
git add -A >/dev/null 2>&1
CARJA_HOOKS=off git commit -qm init >/dev/null 2>&1
echo 'export const a = 2;' > src/app.js

STOP_HOOK="$PROJ/.agents/hooks/verification-stop-hook.sh"
chmod +x "$STOP_HOOK" 2>/dev/null

run_stop_hook() { # $1 = stdin json, $2.. = env assignments
  rm -f "$MARKER"
  local input="$1"; shift
  env "$@" bash "$STOP_HOOK" <<<"$input" >"$TMP/out" 2>"$TMP/err"
  echo $?
}

echo "=== E4: verify-command trust boundary ==="

# 1. Untrusted by default: the gate must not run an unvetted command.
code=$(run_stop_hook '{}')
check "untrusted command does not block the stop" "$code" "0"
if [ -f "$MARKER" ]; then
  bad "untrusted command WAS EXECUTED — the trust boundary is not holding"
else
  ok "untrusted command was never executed"
fi
if grep -q "trust-verify" "$TMP/out"; then
  ok "the hook names the fix (carja trust-verify)"
else
  bad "the hook does not tell the operator how to enable the gate"
fi

# 2. After trusting, a RED command blocks the stop.
node "$REPO_ROOT/bin/carja.js" trust-verify >/dev/null 2>&1
code=$(run_stop_hook '{}' VERIFY_EXIT=1)
check "trusted + red verification blocks the stop (exit 2)" "$code" "2"
if [ -f "$MARKER" ]; then
  ok "the trusted command actually ran (Node-written store read by bash)"
else
  bad "the trusted command did not run — CLI/lib.sh hash mismatch"
fi
if grep -qi "iron law" "$TMP/err"; then
  ok "the block feeds the Iron Law message back to the agent on stderr"
else
  bad "no Iron Law message on stderr"
fi

# 3. Trusted + GREEN allows the stop.
code=$(run_stop_hook '{}' VERIFY_EXIT=0)
check "trusted + green verification allows the stop" "$code" "0"

# 4. Editing the declared command invalidates trust (hash is over the command).
cat > carja.config.json <<JSON
{ "verify": "touch '$MARKER'; exit 1" }
JSON
code=$(run_stop_hook '{}')
check "a changed command is untrusted again — no block" "$code" "0"
if [ -f "$MARKER" ]; then
  bad "the CHANGED command was executed without fresh consent"
else
  ok "the changed command was not executed"
fi

# 5. Revoke removes the grant.
cat > carja.config.json <<JSON
{ "verify": "touch '$MARKER'; exit \${VERIFY_EXIT:-0}" }
JSON
node "$REPO_ROOT/bin/carja.js" trust-verify >/dev/null 2>&1
node "$REPO_ROOT/bin/carja.js" trust-verify --revoke >/dev/null 2>&1
code=$(run_stop_hook '{}' VERIFY_EXIT=1)
check "after --revoke the gate is inactive again" "$code" "0"

# 6. The grant is auditable.
if [ -s "$CARJA_HOME/verify-trust-grants.log" ]; then
  ok "every grant is appended to verify-trust-grants.log"
else
  bad "no audit trail for trust grants"
fi
perms=$(stat -c '%a' "$CARJA_HOME/verify-trust" 2>/dev/null || echo "")
check "the trust store is mode 0600" "$perms" "600"

echo "=== E4: bounded stop-hook re-entry ==="

# Re-entry must NOT be a free pass (a red suite still blocks), but must be
# BOUNDED so a permanently red check cannot trap the session forever.
node "$REPO_ROOT/bin/carja.js" trust-verify >/dev/null 2>&1
rm -f "${TMPDIR:-/tmp}"/carja-stop-reentry-* 2>/dev/null

code=$(run_stop_hook '{"stop_hook_active": true}' VERIFY_EXIT=1)
check "re-entry #1 on a red check still blocks" "$code" "2"
code=$(run_stop_hook '{"stop_hook_active": true}' VERIFY_EXIT=1)
check "re-entry #2 on a red check still blocks" "$code" "2"
code=$(run_stop_hook '{"stop_hook_active": true}' VERIFY_EXIT=1)
check "re-entry #3 hits the bound and allows, loudly" "$code" "0"
if grep -qi "UNVERIFIED" "$TMP/out"; then
  ok "the bounded release says the work is UNVERIFIED, not done"
else
  bad "the bounded release does not warn that the work is unverified"
fi

# A green run must reset the counter, so the next red episode gets full blocks.
run_stop_hook '{}' VERIFY_EXIT=0 >/dev/null
code=$(run_stop_hook '{"stop_hook_active": true}' VERIFY_EXIT=1)
check "a green run resets the re-entry counter" "$code" "2"

echo
echo "  hooks-trust-store: $PASS passed, $FAIL failed"
if [ "$FAIL" -gt 0 ]; then
  echo "STATUS: FAILED ❌"
  exit 1
fi
echo "STATUS: PASSED ✅"
