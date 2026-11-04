#!/usr/bin/env bash
# Carja — Verification Iron Law for interactive Claude Code sessions (ADR-0001 D1,
# parallel track). Wire as a `Stop` hook in .claude/settings.json (see hooks/README.md).
# OPT-IN and OFF by default: interactive stop-gating can over-block, so you enable it
# deliberately. When enabled, it refuses to let the session end "done" while tracked
# source files differ from HEAD and the verification command is red.
#
# TRUST BOUNDARY (E4). Hooks bypass the permission system, so the command this hook
# runs executes with no human in the loop — and it is read from a file INSIDE the repo
# (carja.config.json / package.json). A cloned, forked or contributed repo can
# therefore name any command. So a declared command NEVER runs here until the operator
# has recorded it once, from inside the repo:
#
#     carja trust-verify
#
# Untrusted (or changed) commands do not block the stop; the hook allows with a one-line
# note naming the fix. Fail-open is correct for this direction: refusing to run an
# unvetted command must not become a way to hold a session hostage, and pre-push still
# enforces the Iron Law at the push boundary where the operator typed the command.
#
# Claude Code passes hook JSON on stdin; exit 2 blocks the stop and feeds stderr back
# to the model. Any other non-zero is a non-blocking error shown to the user.
set -uo pipefail

ROOT="$(git rev-parse --show-toplevel 2>/dev/null || true)"
[ -z "$ROOT" ] && exit 0
# shellcheck source=/dev/null
. "$ROOT/.agents/hooks/lib.sh"

# 6.x names still work through 7.x: each CONDUCTOR_X sets CARJA_X when unset.
for _k in $(compgen -e); do case "$_k" in CONDUCTOR_*) _n="CARJA_${_k#CONDUCTOR_}"; [ -n "${!_n:-}" ] || export "$_n=${!_k}" ;; esac; done
[ "${CARJA_HOOKS:-on}" = "off" ] && exit 0

INPUT=""
[ -t 0 ] || INPUT="$(cat)"

# Claude Code re-runs Stop hooks after a block (stop_hook_active=true). A re-entry is
# NOT a free pass — the gate re-runs, so an agent cannot clear a red suite by simply
# stopping again. But it IS bounded: a check that can never go green (a genuinely
# broken environment) must not trap the session forever, so at the bound the hook
# allows with a loud warning and leaves the decision to the human.
MAX_REENTRY_BLOCKS=3
REENTRY_FILE="${TMPDIR:-/tmp}/carja-stop-reentry-$(carja_sha256 "$(carja_trust_key "$ROOT")" | cut -c1-16)"
if printf '%s' "$INPUT" | grep -q '"stop_hook_active"[[:space:]]*:[[:space:]]*true'; then
  COUNT=$(( $(cat "$REENTRY_FILE" 2>/dev/null || echo 0) + 1 ))
else
  COUNT=0
fi
printf '%s' "$COUNT" > "$REENTRY_FILE" 2>/dev/null || true

# Only engage when implementation code actually changed since the last commit.
changed="$(cd "$ROOT" && git diff --name-only HEAD 2>/dev/null || true)"
touched_impl=0
while IFS= read -r f; do
  [ -z "$f" ] && continue
  if carja_is_impl_file "$f"; then touched_impl=1; break; fi
done <<< "$changed"
[ "$touched_impl" = "0" ] && { rm -f "$REENTRY_FILE" 2>/dev/null; exit 0; }

cmd="$(carja_verify_cmd "$ROOT")"
[ -z "$cmd" ] && exit 0
# `carja verify --none`: a declared OFF is not a command. Never eval it.
[ "$cmd" = "none" ] && exit 0

if ! carja_verify_trusted "$ROOT" "$cmd"; then
  echo "Carja: verification command not trusted for this repo, so the stop gate is inactive."
  echo "  Declared: $cmd"
  echo "  Run \`carja trust-verify\` from inside the repo to enable it."
  exit 0
fi

if [ "$COUNT" -ge "$MAX_REENTRY_BLOCKS" ]; then
  echo "⚠️  Carja: verification still failing after $COUNT stop-gate blocks — allowing the session to end."
  echo "    The check (\`$cmd\`) never went green. Treat this as UNVERIFIED work, not as done."
  rm -f "$REENTRY_FILE" 2>/dev/null
  exit 0
fi

if ( cd "$ROOT" && eval "$cmd" >/dev/null 2>&1 ); then
  rm -f "$REENTRY_FILE" 2>/dev/null
  exit 0
fi

echo "Verification Iron Law: you changed implementation code but the verification command (\`$cmd\`) is failing. Do not claim completion — run it, read the failure, and fix it before finishing." >&2
exit 2
