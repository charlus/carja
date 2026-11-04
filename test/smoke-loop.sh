#!/usr/bin/env bash
# ============================================================
# Carja Loop — end-to-end smoke test (no LLM)
# ============================================================
# Exercises the REAL pipeline — worktree isolation, a maker beat that makes a
# real git commit, the driver's own verification, the independent Checker reading
# a real verdict file, the maker completion signal, and terminal handoff — using
# a FAKE agent binary in place of `claude`. This proves the plumbing end-to-end
# without needing a configured model. A real-LLM run still needs manual
# validation (documented in Remaining work #10).
# ============================================================
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
WORK="$(mktemp -d)"
BIN="$WORK/bin"
PROJ="$WORK/proj"
CALLS_LOG="$WORK/agent-calls.log"   # fake agent records role + permission mode per beat
export CALLS_LOG
trap 'rm -rf "$WORK"' EXIT

pass=0; fail=0
ok()   { echo "  [PASS] $1"; pass=$((pass+1)); }
no()   { echo "  [FAIL] $1"; fail=$((fail+1)); }

# ---- 1. A fake `claude` that plays both maker and checker ----
mkdir -p "$BIN"
cat > "$BIN/claude" <<'FAKE'
#!/usr/bin/env bash
# Fake agent. --version → ok. Otherwise the prompt is the argument after `--`
# (every flag comes first, so a prompt starting with a dash is never an option)
# and the run carries `--permission-mode <mode>`. cwd is the worktree the driver put us in.
# It HONORS the permission mode: `plan` is read-only, so a checker in plan mode
# cannot write its verdict — exactly the real constraint that let the live-run
# bug through when the fake used to ignore the mode. Records each call for asserts.
if [ "${1:-}" = "--version" ]; then echo "fake-claude 1.0"; exit 0; fi
prompt=""
mode=""
while [ $# -gt 0 ]; do
  if [ "$1" = "--permission-mode" ]; then mode="${2:-}"; fi
  if [ "$1" = "--" ]; then prompt="${2:-}"; break; fi
  shift
done
writable=1; [ "$mode" = "plan" ] && writable=0   # plan = read-only
case "$prompt" in
  *"You are the CHECKER"*)
    echo "checker mode=$mode" >> "${CALLS_LOG:-/dev/null}"
    # A read-only checker produces no verdict file (the driver then fails safe).
    if [ "$writable" -eq 1 ]; then
      mkdir -p carja/1-workbench
      printf '{"approved": true, "reason": "smoke: change looks complete"}' \
        > carja/1-workbench/checker-verdict.json
    fi
    ;;
  *)
    echo "maker mode=$mode" >> "${CALLS_LOG:-/dev/null}"
    # Maker: make a real change, then signal completion. It commits ONLY when
    # MAKER_COMMIT=1 (default). MAKER_COMMIT=0 simulates a maker that FORGETS to
    # commit — the P0.1 auto-capture backstop in the real loop must still land the
    # work, or it would be destroyed on teardown (the original data-loss bug).
    date > FEATURE.txt
    if [ "${MAKER_COMMIT:-1}" = "1" ]; then
      git add -A >/dev/null 2>&1
      git commit -q -m "feat: smoke feature" >/dev/null 2>&1 || true
    fi
    mkdir -p carja/1-workbench
    printf '{"done": true}' > carja/1-workbench/maker-signal.json
    ;;
esac
exit 0
FAKE
chmod +x "$BIN/claude"

# ---- 2. A carja project ----
mkdir -p "$PROJ"
node "$REPO_ROOT/bin/carja.js" init "$PROJ" --all >/dev/null 2>&1
cd "$PROJ"
git init -q
git config user.email smoke@test.local
git config user.name "Smoke Test"
git add -A >/dev/null 2>&1
git commit -q -m "init"

STATE="$PROJ/carja/1-workbench/loop-state.json"
node -e "
const f='$STATE'; const s=require(f);
s.goal_description='smoke test goal';
s.phase='execution';
s.autonomy_level='L1';           // single beat → awaiting_review, no merge needed
s.verification={command:'test -f FEATURE.txt',last_exit_code:null,last_output_hash:null};
require('fs').writeFileSync(f, JSON.stringify(s,null,2));
"

# P2.1: seed a recurring failure (2x the same pattern, differing specifics) so the
# post-run self-improvement mining has something to detect. One line in the
# git-dir audit trail (F21), one in the ship-log as installs before 6.44 have it.
mkdir -p "$PROJ/.git/carja-loop-logs"
cat >> "$PROJ/.git/carja-loop-logs/audit.md" <<'SEED'
- [2026-07-20T10:00:00Z] [loop] checker rejected: `npm test` exits non-zero: 2 of 3 fail because src/sum.js is missing
SEED
cat >> "$PROJ/carja/0-compass/ship-log.md" <<'SEED'
- [2026-07-21T11:00:00Z] [loop] checker rejected: `npm test` exits non-zero: 1 of 4 fail because src/multiply.js is missing
SEED
SHIPLOG="$PROJ/carja/0-compass/ship-log.md"
SHIPLOG_BEFORE="$(cat "$SHIPLOG")"

# ---- 3. Run the loop with the fake agent on PATH ----
echo "Running: carja loop (fake agent)..."
set +e
PATH="$BIN:$PATH" node "$REPO_ROOT/bin/carja.js" loop "$PROJ" --unsafe-no-sandbox --platform claude > "$WORK/out.log" 2>&1
code=$?
set -e
sed 's/^/    /' "$WORK/out.log"

# ---- 4. Assertions ----
echo "Assertions:"
[ "$code" -eq 0 ] && ok "exit code 0 (clean handoff)" || no "exit code was $code"

status="$(node -e "console.log(require('$STATE').status)")"
[ "$status" = "awaiting_review" ] && ok "terminal status = awaiting_review" || no "status was '$status'"

WT="$PROJ/.agents/.worktrees/smoke-test-goal"
if [ -f "$WT/FEATURE.txt" ]; then ok "maker made a real commit in the isolated worktree"; else no "FEATURE.txt not found in worktree"; fi

if git -C "$PROJ" branch --list 'carja/loop/smoke-test-goal' | grep -q .; then
  ok "maker worked on the dedicated loop branch"
else no "loop branch not created"; fi

AUDIT="$PROJ/.git/carja-loop-logs/audit.md"
if [ "$(grep -c '\[loop\]' "$AUDIT")" -gt 1 ]; then ok "auditable action trail written to the git dir"; else no "no audit trail in $AUDIT"; fi
if [ "$(cat "$SHIPLOG")" = "$SHIPLOG_BEFORE" ]; then ok "the tracked ship-log is untouched by the driver"; else no "the driver wrote to the ship-log"; fi

if grep -q 'checker: APPROVED' "$WORK/out.log"; then ok "independent Checker consumed its verdict file"; else no "checker verdict not consumed"; fi

# Regression guard for the live-run plan-mode bug: the Checker MUST be invoked with
# a write-capable permission mode, or it can't write checker-verdict.json and the
# loop can never approve. The fake agent above honors this (plan = no verdict).
cmode="$(grep '^checker mode=' "$CALLS_LOG" 2>/dev/null | head -1 | sed 's/^checker mode=//')"
if [ -n "$cmode" ] && [ "$cmode" != "plan" ]; then
  ok "Checker invoked write-capable (mode=$cmode, not read-only 'plan')"
else
  no "Checker invoked with mode='$cmode' — read-only 'plan' blocks the verdict write (the live-run bug)"
fi

# P2.1: the post-run self-improvement should have mined the seeded recurring
# failure (2×) and proposed a rule — without auto-editing .agents/rules/.
IMP="$PROJ/carja/1-workbench/loop-improvements.md"
if [ -f "$IMP" ] && grep -q 'seen 2' "$IMP"; then
  ok "self-improvement mined the recurring failure → loop-improvements.md proposal"
else
  no "self-improvement proposal not produced from the recurring ship-log failure"
fi
if [ -z "$(ls -A "$PROJ/.agents/rules" 2>/dev/null | grep -v -E 'prime-directive|verification-iron-law|test-driven-law|live-state-law|loop-guardrails')" ]; then
  ok "self-improvement did NOT auto-write any rule into .agents/rules/ (propose-only)"
else
  no "self-improvement unexpectedly added a file to .agents/rules/ (should propose, not activate)"
fi

# ============================================================
# Scenario 2 — maker FORGETS to commit → P0.1 auto-capture must still land the
# work end-to-end (the original data-loss chain, closed by the backstop).
# ============================================================
echo ""
echo "Scenario 2: maker forgets to commit (auto-capture backstop)..."
PROJ2="$WORK/proj2"
mkdir -p "$PROJ2"
node "$REPO_ROOT/bin/carja.js" init "$PROJ2" --all >/dev/null 2>&1
cd "$PROJ2"
git init -q
git config user.email smoke@test.local
git config user.name "Smoke Test"
git add -A >/dev/null 2>&1
git commit -q -m "init"

STATE2="$PROJ2/carja/1-workbench/loop-state.json"
node -e "
const f='$STATE2'; const s=require(f);
s.goal_description='backstop test goal';
s.phase='execution';
s.autonomy_level='L1';
s.verification={command:'test -f FEATURE.txt',last_exit_code:null,last_output_hash:null};
require('fs').writeFileSync(f, JSON.stringify(s,null,2));
"

set +e
MAKER_COMMIT=0 PATH="$BIN:$PATH" node "$REPO_ROOT/bin/carja.js" loop "$PROJ2" --unsafe-no-sandbox --platform claude > "$WORK/out2.log" 2>&1
code2=$?
set -e
sed 's/^/    /' "$WORK/out2.log"

echo "Assertions (scenario 2):"
[ "$code2" -eq 0 ] && ok "exit code 0 despite the maker never committing" || no "exit code was $code2"

# The backstop must have logged an auto-capture (the maker left an uncommitted file).
if grep -q 'auto-captured uncommitted maker changes' "$WORK/out2.log"; then
  ok "P0.1 backstop auto-captured the uncommitted maker change"
else
  no "no auto-capture logged — the forgotten commit was not backstopped"
fi

# And the work is durable: FEATURE.txt is COMMITTED on the loop branch (not just a
# stray working-tree file that teardown would have destroyed).
WT2="$PROJ2/.agents/.worktrees/backstop-test-goal"
if git -C "$PROJ2" show "carja/loop/backstop-test-goal:FEATURE.txt" >/dev/null 2>&1; then
  ok "auto-captured work is a real commit on the loop branch (survives teardown)"
else
  no "FEATURE.txt is not committed on the loop branch — work would be lost"
fi

status2="$(node -e "console.log(require('$STATE2').status)")"
[ "$status2" = "awaiting_review" ] && ok "terminal status = awaiting_review (clean handoff)" || no "status was '$status2'"

echo ""
echo "  smoke: $pass passed, $fail failed"
[ "$fail" -eq 0 ] || exit 1
echo "  STATUS: PASSED ✅"
