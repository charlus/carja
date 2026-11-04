#!/usr/bin/env bash
# ============================================================
# Hook-bypass blocker — PreToolUse BEHAVIOR test (F11).
#
# Every Carja gate lives in a git hook, and `git commit --no-verify` skips
# all of them in one flag, silently, with no ship-log line. Our only defence
# was a sentence in hooks/README.md asking nicely. This hook makes it a block.
#
# Exercises the REAL templates/.agents/hooks/pretooluse-no-bypass.sh by feeding
# it Claude Code PreToolUse JSON on stdin. Exit 2 = blocked, 0 = allowed.
# ============================================================
set -uo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
HOOK="$REPO_ROOT/templates/.agents/hooks/pretooluse-no-bypass.sh"
pass=0; fail=0
ok() { echo "  [PASS] $1"; pass=$((pass+1)); }
no() { echo "  [FAIL] $1"; fail=$((fail+1)); }

# Feed a Bash command to the hook; echo its exit code.
run_cmd() {
  printf '{"tool_name":"Bash","tool_input":{"command":%s}}' "$(node -e \
    'process.stdout.write(JSON.stringify(process.argv[1]))' "$1")" \
    | bash "$HOOK" >/dev/null 2>&1
  printf '%s' "$?"
}

blocked() {
  local code; code="$(run_cmd "$2")"
  if [ "$code" = "2" ]; then ok "$1"; else no "$1 (exit $code, expected 2)"; fi
}

allowed() {
  local code; code="$(run_cmd "$2")"
  if [ "$code" = "0" ]; then ok "$1"; else no "$1 (exit $code, expected 0)"; fi
}

if [ ! -f "$HOOK" ]; then
  echo "  [FAIL] pretooluse-no-bypass.sh does not exist"
  echo "STATUS: FAILED ❌"
  exit 1
fi

echo "Hook-bypass blocker — blocked commands:"

blocked "N1: git commit --no-verify"            'git commit --no-verify -m "x"'
blocked "N2: git commit -n (the shorthand)"     'git commit -n -m "x"'
blocked "N3: git push --no-verify"              'git push --no-verify origin main'
blocked "N4: -c core.hooksPath= override"       'git -c core.hooksPath=/dev/null commit -m "x"'
blocked "N5: an abbreviated --no-veri prefix"   'git commit --no-veri -m "x"'
blocked "N6: a bypass later in a chain"         'npm test && git commit --no-verify -m "x"'
blocked "N7: CARJA_HOOKS=off on a commit"   'CARJA_HOOKS=off git commit -m "x"'

echo ""
echo "Hook-bypass blocker — the independent review's counterexamples (B2):"

# The first version split on whitespace and blanked quoted spans. git and the
# shell do neither, so each of these reached git as a real bypass and passed.
blocked "R1: grouped short flags, -nm"             'git commit -nm x'
blocked "R2: grouped short flags, -anm"            'git commit -anm x'
blocked "R3: -an then a separate -m"               'git commit -an -m x'
blocked "R4: the '\'' quoting idiom"                "git commit -m 'it'\\''s' --no-verify"
blocked "R5: env prefix"                           'env CARJA_HOOKS=off git commit -m x'
blocked "R6: command prefix"                       'command git commit --no-verify'
blocked "R7: sh -c wrapper"                        'sh -c "git commit --no-verify"'
blocked "R8: bash -c with single quotes"           "bash -c 'git commit -n -m x'"
blocked "R9: a QUOTED flag is still a flag to git"  'git commit "--no-verify" -m x'
blocked "R10: sudo with an option"                 'sudo -u bob git commit --no-verify'
blocked "R11: inside \$(…)"                        'echo $(git commit --no-verify -m x)'

echo ""
echo "Hook-bypass blocker — the delta review's counterexamples (B2, standard: the ordinary bypass):"

blocked "R12: timeout wrapper"                     'timeout 60 git commit --no-verify -m x'
blocked "R13: timeout with options"                'timeout -s KILL 60 git commit -n -m x'
blocked "R14: xargs wrapper"                       'xargs git commit -n'
blocked "R15: xargs with a value option"           'xargs -n 1 git commit --no-verify'
blocked "R16: env -S split string"                 'env -S "git commit --no-verify"'
blocked "R17: ANSI-C quoting"                      "git commit \$'--no-verify' -m x"
blocked "R18: GIT_CONFIG_KEY_n=core.hooksPath"     'GIT_CONFIG_COUNT=1 GIT_CONFIG_KEY_0=core.hooksPath GIT_CONFIG_VALUE_0=/dev/null git commit -m x'
blocked "R19: GIT_CONFIG_PARAMETERS"               "GIT_CONFIG_PARAMETERS=\"'core.hooksPath=/dev/null'\" git commit -m x"
blocked "R20: stdbuf wrapper"                      'stdbuf -oL git commit -n -m x'
blocked "R21: flock wrapper"                       'flock /tmp/l git commit --no-verify -m x'

echo ""
echo "Hook-bypass blocker — the final review's counterexamples (NB2):"

# A shell keyword opened the segment, so the first word was `then`, `do`,
# `{` or `!` — never git — and the bypass after it was never read.
blocked "R22: if … then"                            'if true; then git commit --no-verify -m x; fi'
blocked "R23: the ordinary one-liner"               'if ! git diff --cached --quiet; then git commit -n -m x; fi'
blocked "R24: for … do"                             'for i in 1; do git commit -n -m x; done'
blocked "R25: a { } group"                          '{ git commit --no-verify -m x; }'
blocked "R26: ! negation"                           '! git commit -n -m x'
blocked "R27: else branch"                          'if false; then :; else git commit --no-verify -m x; fi'
blocked "R28: while body"                           'while false; do git push --no-verify; done'

echo ""
echo "Hook-bypass blocker — allowed commands:"

allowed "A1: an ordinary commit"                'git commit -m "feat: thing"'
allowed "A2: an ordinary push"                  'git push origin main'
allowed "A3: a logged Carja waiver"         'CARJA_NO_TEST="config only" git commit -m "x"'
allowed "A4: -n on a command that is not commit" 'git clean -n'
allowed "A5: --no-verify inside a quoted string" 'git commit -m "document --no-verify here"'
allowed "A6: a non-git command"                 'npm run build --no-verify-ssl'
allowed "A7: reading the hook config"           'git config --get core.hooksPath'
allowed "A8: -am is add+message, not -n"          'git commit -am "x"'
allowed "A9: -n as the VALUE of -m"               'git commit -m -n'
allowed "A10: a mention inside echo"              'echo "git commit --no-verify"'
allowed "A11: sh -c running something harmless"   'sh -c "echo hi"'
allowed "A12: git -C before the subcommand"       'git -C . commit -m x'
allowed "A13: --message= with a dash value"       'git commit --message=-n'
allowed "A14: timeout around an ordinary commit"  'timeout 60 git commit -m x'
allowed "A15: xargs -n running something else"    'xargs -n 1 echo'
allowed "A17: a keyword around an ordinary commit"  'if true; then git commit -m x; fi'
allowed "A16: GIT_CONFIG_* for an unrelated key"  'GIT_CONFIG_COUNT=1 GIT_CONFIG_KEY_0=user.name GIT_CONFIG_VALUE_0=x git commit -m x'

echo ""
echo "Hook-bypass blocker — envelope:"

# E1: a non-Bash tool is none of this hook's business.
code="$(printf '{"tool_name":"Write","tool_input":{"file_path":"/tmp/x"}}' \
  | bash "$HOOK" >/dev/null 2>&1; printf '%s' "$?")"
if [ "$code" = "0" ]; then ok "E1: non-Bash tools pass through"; else no "E1: blocked a non-Bash tool (exit $code)"; fi

# E2: malformed stdin must FAIL OPEN. A hook that blocks on its own parse error
# would wedge every Bash call in the session.
code="$(printf 'not json at all' | bash "$HOOK" >/dev/null 2>&1; printf '%s' "$?")"
if [ "$code" = "0" ]; then ok "E2: malformed input fails open"; else no "E2: malformed input blocked the call (exit $code)"; fi

# E3: empty stdin must also fail open.
code="$(printf '' | bash "$HOOK" >/dev/null 2>&1; printf '%s' "$?")"
if [ "$code" = "0" ]; then ok "E3: empty input fails open"; else no "E3: empty input blocked the call (exit $code)"; fi

# E4: the denial must name the logged alternative, or the reader learns nothing.
out="$(printf '{"tool_name":"Bash","tool_input":{"command":"git commit --no-verify -m x"}}' \
  | bash "$HOOK" 2>&1)"
if printf '%s' "$out" | grep -q "CARJA_NO_TEST"; then
  ok "E4: the denial points at the logged waiver instead"
else
  no "E4: the denial does not tell the caller what to do instead"
fi

# E5: CARJA_HOOKS=off disables this hook too — one master switch, not two.
code="$(printf '{"tool_name":"Bash","tool_input":{"command":"git commit --no-verify -m x"}}' \
  | CARJA_HOOKS=off bash "$HOOK" >/dev/null 2>&1; printf '%s' "$?")"
if [ "$code" = "0" ]; then ok "E5: CARJA_HOOKS=off disables the hook"; else no "E5: hook still fired with CARJA_HOOKS=off (exit $code)"; fi

# E6: bounded without coreutils `timeout` (stock macOS) — same run_bounded.
FAKE="$(mktemp -d)"
printf '#!/bin/sh\n/bin/sleep 30\n' > "$FAKE/node"; chmod +x "$FAKE/node"
ln -s "$(command -v perl)" "$FAKE/perl"
START=$(date +%s)
code="$(printf '{"tool_name":"Bash","tool_input":{"command":"git commit --no-verify -m x"}}' \
  | PATH="$FAKE" CARJA_HOOK_TIMEOUT=2 /bin/bash "$HOOK" >/dev/null 2>&1; printf '%s' "$?")"
ELAPSED=$(( $(date +%s) - START ))
rm -rf "$FAKE"
if [ "$code" = "0" ] && [ "$ELAPSED" -lt 8 ]; then ok "E6: bounded without a timeout binary (${ELAPSED}s)"; else no "E6: unbounded without coreutils timeout (exit $code after ${ELAPSED}s)"; fi

echo ""
echo "  Passed: $pass"
echo "  Failed: $fail"
[ "$fail" -eq 0 ] && echo "STATUS: PASSED ✅" || echo "STATUS: FAILED ❌"
exit "$fail"
