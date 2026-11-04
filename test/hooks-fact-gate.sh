#!/usr/bin/env bash
# ============================================================
# The fact gate — PreToolUse BEHAVIOR test (F1).
#
# Self-evaluation does not work: ask a model "are you sure?" and the answer is
# always yes. Asking "which files import this one" does work, because it cannot
# be answered without running a search, and running the search puts the answer
# in the context. The gate does not verify the facts — it cannot. It denies the
# first write to a target and names the facts to gather, then allows the retry.
# What it buys is the investigation, not a proof.
#
# Exercises the REAL templates/.agents/hooks/pretooluse-fact-gate.sh over its
# stdin contract. Exit 2 = denied, 0 = allowed.
# ============================================================
set -uo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
HOOK="$REPO_ROOT/templates/.agents/hooks/pretooluse-fact-gate.sh"
pass=0; fail=0
ok() { echo "  [PASS] $1"; pass=$((pass+1)); }
no() { echo "  [FAIL] $1"; fail=$((fail+1)); }

export CARJA_HOME="$(mktemp -d)"
cleanup() { rm -rf "$CARJA_HOME"; }
trap cleanup EXIT

# Fresh session id per scenario, so scenarios cannot leak state into each other.
new_session() { printf 'sess-%s-%s' "$$" "$RANDOM"; }

# call <session> <tool> <json-payload-body>  → echoes the exit code
call() {
  local sess="$1" tool="$2" body="$3"
  printf '{"session_id":"%s","tool_name":"%s","tool_input":%s}' "$sess" "$tool" "$body" \
    | bash "$HOOK" >/dev/null 2>&1
  printf '%s' "$?"
}

# Same, but echoes stderr instead of the code.
call_out() {
  local sess="$1" tool="$2" body="$3"
  printf '{"session_id":"%s","tool_name":"%s","tool_input":%s}' "$sess" "$tool" "$body" \
    | bash "$HOOK" 2>&1 >/dev/null
}

edit() { printf '{"file_path":"%s","old_string":"a","new_string":"b"}' "$1"; }
write() { printf '{"file_path":"%s","content":"x"}' "$1"; }
bash_cmd() { node -e 'process.stdout.write(JSON.stringify({command: process.argv[1]}))' "$1"; }

if [ ! -f "$HOOK" ]; then
  echo "  [FAIL] pretooluse-fact-gate.sh does not exist"
  echo "STATUS: FAILED ❌"
  exit 1
fi

echo "Fact gate — the three stages:"

# ---- S1: DENY the first edit, ALLOW the retry -----------------------------
S="$(new_session)"
C1="$(call "$S" Edit "$(edit /r/src/app.js)")"
C2="$(call "$S" Edit "$(edit /r/src/app.js)")"
if [ "$C1" = "2" ] && [ "$C2" = "0" ]; then
  ok "S1: first edit DENIED, retry ALLOWED (deny → force → allow)"
else
  no "S1: expected deny then allow, got $C1 then $C2"
fi

# ---- S2: the gate is per FILE, not per session ----------------------------
S="$(new_session)"
call "$S" Edit "$(edit /r/a.js)" >/dev/null
C="$(call "$S" Edit "$(edit /r/b.js)")"
if [ "$C" = "2" ]; then
  ok "S2: a different file is gated on its own first edit"
else
  no "S2: second file was not gated (exit $C) — one denial bought the whole repo"
fi

# ---- S3: Write gets the reuse question, not the importers question --------
S="$(new_session)"
OUT="$(call_out "$S" Write "$(write /r/src/new-thing.js)")"
if printf '%s' "$OUT" | grep -qi "already"; then
  ok "S3: creating a file asks what already does this (reuse before build)"
else
  no "S3: the Write gate never asks whether something already exists"
fi

# ---- S4: the edit gate asks for the failing test --------------------------
# Red-before-green at the moment of action, not at commit time.
S="$(new_session)"
OUT="$(call_out "$S" Edit "$(edit /r/src/app.js)")"
if printf '%s' "$OUT" | grep -qiE "test|eval"; then
  ok "S4: the edit gate asks which failing test this makes pass"
else
  no "S4: the edit gate never mentions the test"
fi

# ---- S5: every gate demands the instruction, verbatim ---------------------
S="$(new_session)"
OUT="$(call_out "$S" Edit "$(edit /r/src/app.js)")"
if printf '%s' "$OUT" | grep -qi "verbatim"; then
  ok "S5: the denial demands the user's instruction verbatim"
else
  no "S5: the denial does not ask for the instruction"
fi

echo ""
echo "Fact gate — what it must NOT gate:"

# ---- S6: reading is the investigation; never block it ---------------------
S="$(new_session)"
allowed_all=1
for tool in Read Grep Glob; do
  C="$(call "$S" "$tool" '{"pattern":"x"}')"
  [ "$C" = "0" ] || allowed_all=0
done
if [ "$allowed_all" = "1" ]; then
  ok "S6: Read/Grep/Glob always pass — they ARE the forced investigation"
else
  no "S6: the gate blocked the very tools it demands be used"
fi

# ---- S7: ordinary Bash is not gated ---------------------------------------
# ECC gates routine shell once per session. Our loop runs many commands a beat,
# so a denial there is pure cost with no investigation to buy.
S="$(new_session)"
C="$(call "$S" Bash "$(bash_cmd 'npm test')")"
if [ "$C" = "0" ]; then
  ok "S7: ordinary Bash is not gated"
else
  no "S7: an ordinary command was denied (exit $C)"
fi

# ---- S8: destructive Bash is gated EVERY time -----------------------------
# Unlike a file edit, there is no "already investigated this target" — each
# destructive command destroys something different.
S="$(new_session)"
C1="$(call "$S" Bash "$(bash_cmd 'rm -rf build/')")"
C2="$(call "$S" Bash "$(bash_cmd 'rm -rf dist/')")"
if [ "$C1" = "2" ] && [ "$C2" = "2" ]; then
  ok "S8: destructive commands are gated every time, not once"
else
  no "S8: expected both destructive commands denied, got $C1 and $C2"
fi

# ---- S9: the destructive gate demands a rollback --------------------------
S="$(new_session)"
OUT="$(call_out "$S" Bash "$(bash_cmd 'git reset --hard HEAD~3')")"
if printf '%s' "$OUT" | grep -qi "rollback\|recover"; then
  ok "S9: the destructive gate demands a rollback line"
else
  no "S9: no rollback demanded before a destructive command"
fi

# ---- S9b: the same destructive command may be retried after the facts -----
# Review IMPORTANT: the denial said "the retry is allowed" and then denied
# every retry, so the agent retried into a permanent wall — the repetition
# loop the dampening exists to prevent. Deny, state the facts, allow the retry:
# keyed on the exact command, so a DIFFERENT destructive command is still new.
S="$(new_session)"
C1="$(call "$S" Bash "$(bash_cmd 'rm -rf build/')")"
C2="$(call "$S" Bash "$(bash_cmd 'rm -rf build/')")"
C3="$(call "$S" Bash "$(bash_cmd 'rm -rf dist/')")"
if [ "$C1" = "2" ] && [ "$C2" = "0" ] && [ "$C3" = "2" ]; then
  ok "S9b: identical retry allowed, a different destructive command still gated"
else
  no "S9b: expected 2/0/2, got $C1/$C2/$C3"
fi

# ---- S9c: the Bash denial never offers Edit-shaped facts ------------------
S="$(new_session)"
export CARJA_FACT_GATE_FULL_DENIALS=0
OUT="$(call_out "$S" Bash "$(bash_cmd 'git reset --hard HEAD~1')")"
unset CARJA_FACT_GATE_FULL_DENIALS
if printf '%s' "$OUT" | grep -qi "importer\|failing test"; then
  no "S9c: the condensed Bash denial asks for importers / a failing test"
else
  ok "S9c: the condensed Bash denial names Bash facts, not Edit facts"
fi

echo ""
echo "Fact gate — the destructive list (review IMPORTANT):"

# The second half of this list is the delta review's regression: an anchored
# rm pattern stopped gating rm -rf behind a shell, a path or a wrapper, all of
# which the version before it caught.
for c in 'git push -f origin main' 'git checkout -- .' 'git restore .' 'find . -delete' 'git stash drop' 'git stash clear' 'cd x && rm -rf y' \
         'sh -c "rm -rf build"' "bash -c 'rm -rf build'" '/bin/rm -rf build' 'time rm -rf build' 'command rm -rf build' 'nohup rm -rf build' 'env rm -rf build' 'git push origin +main'; do
  S="$(new_session)"; C="$(call "$S" Bash "$(bash_cmd "$c")")"
  if [ "$C" = "2" ]; then ok "D+: gated — $c"; else no "D+: MISSED destructive — $c (exit $C)"; fi
done
# `git clean -f -n` is a dry run whatever order the flags come in: allowing it
# is correct, not a regression.
# The last four are the final review's NI1: text that only MENTIONS a
# destructive command, and git's own rm behind -C.
for c in 'git clean -nd' 'git clean --dry-run -fd' 'git clean -f -n' 'git rm -r src' 'git push --force-with-lease' 'git restore --staged src/a.js' 'git checkout main' 'farm -rf x' \
         'grep -rn "rm -rf" src' 'git commit -m "drop rm -f usage"' 'git commit -m "undo the git reset --hard"' 'git -C sub rm -rf x'; do
  S="$(new_session)"; C="$(call "$S" Bash "$(bash_cmd "$c")")"
  if [ "$C" = "0" ]; then ok "D-: not gated — $c"; else no "D-: FALSE positive — $c (exit $C)"; fi
done

echo ""
echo "Fact gate — the envelope:"

# ---- S10: denial dampening --------------------------------------------------
# Textually identical denials push a model into a repetition loop. After the
# budget, the denial must still deny but must not repeat itself verbatim.
S="$(new_session)"
export CARJA_FACT_GATE_FULL_DENIALS=2
A="$(call_out "$S" Edit "$(edit /r/1.js)")"
B="$(call_out "$S" Edit "$(edit /r/2.js)")"
C="$(call_out "$S" Edit "$(edit /r/3.js)")"
D="$(call_out "$S" Edit "$(edit /r/4.js)")"
unset CARJA_FACT_GATE_FULL_DENIALS
if [ "${#C}" -lt "${#A}" ] && [ "$C" != "$D" ]; then
  ok "S10: past the budget, denials shorten AND stay distinct"
else
  no "S10: denials did not dampen (len A=${#A} C=${#C}; C==D? $([ "$C" = "$D" ] && echo yes || echo no))"
fi

# ---- S11: still DENIES after dampening ------------------------------------
S="$(new_session)"
export CARJA_FACT_GATE_FULL_DENIALS=0
C="$(call "$S" Edit "$(edit /r/x.js)")"
unset CARJA_FACT_GATE_FULL_DENIALS
if [ "$C" = "2" ]; then
  ok "S11: dampening shortens the message, it never stops the gate"
else
  no "S11: a dampened denial stopped denying (exit $C)"
fi

# ---- S12: sessions are isolated -------------------------------------------
S1="$(new_session)"; S2="$(new_session)"
call "$S1" Edit "$(edit /r/shared.js)" >/dev/null
C="$(call "$S2" Edit "$(edit /r/shared.js)")"
if [ "$C" = "2" ]; then
  ok "S12: a second session does not inherit the first's clearances"
else
  no "S12: session state leaked (exit $C)"
fi

# ---- S13: malformed input fails OPEN --------------------------------------
for payload in 'not json' '' '{"tool_name":"Edit"}' '{"tool_name":"Edit","tool_input":{}}'; do
  C="$(printf '%s' "$payload" | bash "$HOOK" >/dev/null 2>&1; printf '%s' "$?")"
  if [ "$C" != "0" ]; then
    no "S13: input $(printf '%.20s' "$payload") blocked the call (exit $C)"
    break
  fi
done
[ "$C" = "0" ] && ok "S13: malformed, empty and partial input all fail open"

# ---- S14: an unwritable state dir fails OPEN ------------------------------
# A gate that cannot remember what it cleared would deny the same edit forever.
S="$(new_session)"
C="$(CARJA_HOME=/dev/null/nope call "$S" Edit "$(edit /r/z.js)")"
if [ "$C" = "0" ]; then
  ok "S14: an unusable state dir fails open, never denies forever"
else
  no "S14: unwritable state produced a denial (exit $C)"
fi

# ---- S14b: a hook that would HANG is bounded and fails open ---------------
# Real landmine, found by this test: on this kernel mkdirSync(recursive) never
# returns for a path under /proc. A hook in front of every tool call must be
# bounded by its own clock, not by the harness's.
S="$(new_session)"
START=$(date +%s)
C="$(CARJA_HOME=/proc/nonexistent/nope CARJA_HOOK_TIMEOUT=2 call "$S" Edit "$(edit /r/h.js)")"
ELAPSED=$(( $(date +%s) - START ))
if [ "$C" = "0" ] && [ "$ELAPSED" -lt 8 ]; then
  ok "S14b: a hanging hook is bounded (${ELAPSED}s) and fails open"
else
  no "S14b: hook not bounded (exit $C after ${ELAPSED}s)"
fi

# ---- S14c: bounded even where coreutils `timeout` is absent (stock macOS) ---
# Review IMPORTANT: run_bounded fell back to an UNBOUNDED node when `timeout`
# was missing. Simulated here with a PATH that has no timeout/gtimeout, and a
# node that never returns.
FAKE="$(mktemp -d)"
printf '#!/bin/sh\n/bin/sleep 30\n' > "$FAKE/node"; chmod +x "$FAKE/node"
ln -s "$(command -v perl)" "$FAKE/perl"
S="$(new_session)"
START=$(date +%s)
C="$(printf '{"session_id":"%s","tool_name":"Edit","tool_input":%s}' "$S" "$(edit /r/m.js)" \
  | PATH="$FAKE" CARJA_HOOK_TIMEOUT=2 /bin/bash "$HOOK" >/dev/null 2>&1; printf '%s' "$?")"
ELAPSED=$(( $(date +%s) - START ))
rm -rf "$FAKE"
if [ "$C" = "0" ] && [ "$ELAPSED" -lt 8 ]; then
  ok "S14c: with no timeout binary, perl bounds it (${ELAPSED}s) and it fails open"
else
  no "S14c: unbounded without coreutils timeout (exit $C after ${ELAPSED}s)"
fi

# ---- S14d: a sub-second timeout still bounds it (delta review) --------------
# perl's alarm takes whole seconds, and `alarm 0` means NO alarm — so a 0.5
# became unbounded. Any value that is not a positive number falls back to 5.
FAKE="$(mktemp -d)"
printf '#!/bin/sh\n/bin/sleep 30\n' > "$FAKE/node"; chmod +x "$FAKE/node"
ln -s "$(command -v perl)" "$FAKE/perl"
for t in 0.5 0 garbage; do
  S="$(new_session)"; START=$(date +%s)
  C="$(printf '{"session_id":"%s","tool_name":"Edit","tool_input":%s}' "$S" "$(edit /r/t.js)" \
    | PATH="$FAKE" CARJA_HOOK_TIMEOUT="$t" /bin/bash "$HOOK" >/dev/null 2>&1; printf '%s' "$?")"
  ELAPSED=$(( $(date +%s) - START ))
  if [ "$C" = "0" ] && [ "$ELAPSED" -lt 9 ]; then ok "S14d: CARJA_HOOK_TIMEOUT=$t is still bounded (${ELAPSED}s)"; else no "S14d: CARJA_HOOK_TIMEOUT=$t unbounded (exit $C after ${ELAPSED}s)"; fi
done
rm -rf "$FAKE"

# ---- S15: the master switch ------------------------------------------------
S="$(new_session)"
C="$(printf '{"session_id":"%s","tool_name":"Edit","tool_input":%s}' "$S" "$(edit /r/q.js)" \
  | CARJA_HOOKS=off bash "$HOOK" >/dev/null 2>&1; printf '%s' "$?")"
if [ "$C" = "0" ]; then
  ok "S15: CARJA_HOOKS=off disables the gate"
else
  no "S15: gate still fired with CARJA_HOOKS=off (exit $C)"
fi

# ---- S16: its own switch, for turning off just this gate ------------------
S="$(new_session)"
C="$(printf '{"session_id":"%s","tool_name":"Edit","tool_input":%s}' "$S" "$(edit /r/q2.js)" \
  | CARJA_FACT_GATE=off bash "$HOOK" >/dev/null 2>&1; printf '%s' "$?")"
if [ "$C" = "0" ]; then
  ok "S16: CARJA_FACT_GATE=off disables this gate alone"
else
  no "S16: CARJA_FACT_GATE=off did not disable it (exit $C)"
fi

# ---- S17: the denial says how to turn it off ------------------------------
# A gate with no visible exit is one a frustrated user kills globally.
S="$(new_session)"
OUT="$(call_out "$S" Edit "$(edit /r/esc.js)")"
if printf '%s' "$OUT" | grep -q "CARJA_FACT_GATE"; then
  ok "S17: the denial names its own off switch"
else
  no "S17: the denial gives the reader no way out"
fi

echo ""
echo "  Passed: $pass"
echo "  Failed: $fail"
[ "$fail" -eq 0 ] && echo "STATUS: PASSED ✅" || echo "STATUS: FAILED ❌"
exit "$fail"
