#!/usr/bin/env bash
# ============================================================
# Carja Loop — REAL-agent end-to-end (opt-in, spawns `claude`)
# ============================================================
# The smoke test (smoke-loop.sh) proves the plumbing with a FAKE agent. This one
# drives a REAL `claude` maker + independent checker on a trivial-but-genuine task
# (implement sum() so `npm test` passes) — the regression guard for the class of
# bugs that are invisible to the fully-stubbed unit/smoke suites (e.g. the checker
# plan-mode bug: a read-only checker can't write its verdict). It runs a single L1
# beat in pair mode, so it needs NO git remote and never opens a PR.
#
# OPT-IN: skipped unless CARJA_E2E_REAL=1 (it costs tokens + needs `claude`
# authed on PATH). Not wired into `npm test` / `test:unit` / `test:smoke`.
#
#   CARJA_E2E_REAL=1 npm run test:e2e
# ============================================================
set -euo pipefail

if [ "${CARJA_E2E_REAL:-0}" != "1" ]; then
  echo "SKIP: real-agent e2e is opt-in. Set CARJA_E2E_REAL=1 to run it (spawns claude, costs tokens)."
  exit 0
fi
if ! command -v claude >/dev/null 2>&1; then
  echo "FAIL: CARJA_E2E_REAL=1 but 'claude' is not on PATH."
  exit 1
fi

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
WORK="$(mktemp -d)"
PROJ="$WORK/proj"
trap 'rm -rf "$WORK"' EXIT

pass=0; fail=0
ok() { echo "  [PASS] $1"; pass=$((pass+1)); }
no() { echo "  [FAIL] $1"; fail=$((fail+1)); }

# ---- 1. A carja project with one real, verifiable task ----
mkdir -p "$PROJ"
node "$REPO_ROOT/bin/carja.js" init "$PROJ" --all >/dev/null 2>&1
mkdir -p "$PROJ/src" "$PROJ/test"
cat > "$PROJ/package.json" <<'PKG'
{ "name": "e2e", "version": "0.0.0", "type": "module", "private": true, "scripts": { "test": "node --test" } }
PKG
cat > "$PROJ/test/sum.test.js" <<'T'
import { test } from "node:test";
import assert from "node:assert/strict";
import { sum } from "../src/sum.js";
test("sum", () => { assert.equal(sum(2, 3), 5); });
T
# src/sum.js intentionally absent → `npm test` fails until the maker implements it.

cd "$PROJ"
git init -q && git config user.email e2e@test.local && git config user.name "E2E"
git add -A >/dev/null 2>&1 && git commit -q -m "seed"

STATE="$PROJ/carja/1-workbench/loop-state.json"
node -e "
const f='$STATE'; const s=require(f);
s.goal_description='Implement the sum(a,b) ESM named export in src/sum.js so that npm test passes';
s.phase='execution'; s.autonomy_level='L1'; s.sandbox='none';
s.verification={command:'npm test',last_exit_code:null,last_output_hash:null};
require('fs').writeFileSync(f, JSON.stringify(s,null,2));
"

# ---- 2. Run the loop with a real claude (L1, no sandbox, no remote) ----
echo "Running: carja loop with a REAL claude agent (this spawns the model)..."
set +e
node "$REPO_ROOT/bin/carja.js" loop "$PROJ" --platform claude --unsafe-no-sandbox > "$WORK/out.log" 2>&1
code=$?
set -e
sed 's/^/    /' "$WORK/out.log"

# ---- 3. Assertions (the real-agent invariants stubs can't check) ----
echo "Assertions:"
[ "$code" -eq 0 ] && ok "exit code 0" || no "exit code was $code"

SLUG="implement-the-sum-a-b-esm-named-export-in-src-sum-js-so-that-npm"
WT=$(node -e "const {worktreePlan}=require('$REPO_ROOT/src/loop/worktree.js'); console.log(worktreePlan('$PROJ', require('$STATE').goal_description).path)" 2>/dev/null || true)
[ -n "$WT" ] || WT="$(ls -d "$PROJ"/.agents/.worktrees/* 2>/dev/null | head -1)"

if [ -n "$WT" ] && [ -f "$WT/src/sum.js" ]; then ok "maker implemented src/sum.js in the isolated worktree"; else no "src/sum.js not found in worktree ($WT)"; fi

if [ -n "$WT" ] && ( cd "$WT" && npm test >/dev/null 2>&1 ); then ok "verify (npm test) is GREEN on the maker's branch"; else no "npm test not green on the branch"; fi

if grep -q 'checker: APPROVED' "$WORK/out.log"; then ok "independent Checker APPROVED a real change (checker could write its verdict)"; else no "checker did not approve (verdict-write / plan-mode regression?)"; fi

if [ -n "$WT" ] && [ -d "$WT" ]; then ok "worktree preserved (work not force-dropped)"; else no "worktree was removed — possible data-loss regression"; fi

echo ""
echo "  e2e: $pass passed, $fail failed"
[ "$fail" -eq 0 ] || exit 1
echo "  STATUS: PASSED ✅"
