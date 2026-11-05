#!/usr/bin/env bash
# ============================================================
# Eval-Driven Law — pre-commit gate BEHAVIOR test (Track A).
# Installs the real templates/.agents/hooks into a temp repo and exercises the
# gate: LLM-feature code staged without an eval is blocked; with an eval (or a
# logged waiver) it commits; non-LLM code is untouched. Composes with the TDD
# gate — every case stages a test so only the EVAL dimension is under test.
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
  : > "$d/carja/0-compass/ship-log.md"
  git -C "$d" init -q
  git -C "$d" config user.email t@t.local
  git -C "$d" config user.name t
  git -C "$d" config core.hooksPath .agents/hooks
  printf '%s' "$d"
}

echo "Eval-Driven Law — pre-commit gate:"

# ---- T1: LLM-feature file + test but NO eval → BLOCKED --------------------
D="$(fresh_repo)"
printf 'import OpenAI from "openai";\nexport const c = new OpenAI();\n' > "$D/svc.ts"
printf 'test("x", () => {});\n' > "$D/svc.test.ts"
git -C "$D" add -A >/dev/null 2>&1
if git -C "$D" commit -q -m "llm feature, no eval" >/tmp/t1.out 2>&1; then
  no "T1: LLM-feature code committed WITHOUT an eval (gate did not fire)"
else
  ok "T1: LLM-feature code without an eval is BLOCKED"
fi
rm -rf "$D"

# ---- T2: LLM-feature file + test + eval → COMMITS -------------------------
D="$(fresh_repo)"
printf 'import OpenAI from "openai";\nexport const c = new OpenAI();\n' > "$D/svc.ts"
printf 'test("x", () => {});\n' > "$D/svc.test.ts"
printf 'export const evalset = [{input:"hi", rubric:"greets"}];\n' > "$D/svc.eval.ts"
git -C "$D" add -A >/dev/null 2>&1
if git -C "$D" commit -q -m "llm feature + eval" >/tmp/t2.out 2>&1; then
  ok "T2: LLM-feature code WITH an eval commits cleanly"
else
  no "T2: eval was staged but the commit was still blocked"; cat /tmp/t2.out | sed 's/^/      /'
fi
rm -rf "$D"

# ---- T3: non-LLM file + test, no eval → COMMITS (gate silent) -------------
D="$(fresh_repo)"
printf 'export const add = (a,b) => a+b;\n' > "$D/util.ts"
printf 'test("x", () => {});\n' > "$D/util.test.ts"
git -C "$D" add -A >/dev/null 2>&1
if git -C "$D" commit -q -m "plain util" >/tmp/t3.out 2>&1; then
  ok "T3: non-LLM code needs no eval (gate silent)"
else
  no "T3: non-LLM code was wrongly blocked by the eval gate"; cat /tmp/t3.out | sed 's/^/      /'
fi
rm -rf "$D"

# ---- T4: LLM file + test, no eval, CARJA_NO_EVAL waiver → COMMITS -----
D="$(fresh_repo)"
printf 'from anthropic import Anthropic\nc = Anthropic()\n' > "$D/agent.py"
printf 'def test_x(): pass\n' > "$D/test_agent.py"
git -C "$D" add -A >/dev/null 2>&1
if CARJA_NO_EVAL="prototype, not shipping" git -C "$D" commit -q -m "waived" >/tmp/t4.out 2>&1; then
  ok "T4: CARJA_NO_EVAL waiver lets the commit through"
  if grep -qi "eval" "$D/carja/0-compass/ship-log.md"; then
    ok "T4: the waiver was logged to the ship-log (auditable, not silent)"
  else
    no "T4: waiver was not logged to the ship-log"
  fi
else
  no "T4: CARJA_NO_EVAL waiver did not unblock the commit"; cat /tmp/t4.out | sed 's/^/      /'
fi
rm -rf "$D"

# ---- T6: gates are INDEPENDENT — an eval doesn't satisfy the TDD gate --------
D="$(fresh_repo)"
printf 'import OpenAI from "openai";\nexport const c = new OpenAI();\n' > "$D/svc.ts"
printf 'export const evalset = [{input:"hi", rubric:"greets"}];\n' > "$D/svc.eval.ts"  # eval present, NO test
git -C "$D" add -A >/dev/null 2>&1
if git -C "$D" commit -q -m "eval but no test" >/tmp/t6.out 2>&1; then
  no "T6: LLM code with an eval but NO test committed (TDD gate bypassed by the eval)"
else
  ok "T6: an eval does not satisfy the TDD gate — still blocked for the missing test"
fi
rm -rf "$D"

# ---- T5: files that only MENTION a provider (shell/docs/config) are NOT -----
# flagged — the framework's own lib.sh/pre-commit/eval-skill name providers.
# shellcheck source=/dev/null
. "$REPO_ROOT/templates/.agents/hooks/lib.sh"
D="$(mktemp -d)"
printf '# uses the openai and anthropic and cohere providers\n' > "$D/notes.md"
printf 'PROVIDERS="openai anthropic ollama"\n' > "$D/setup.sh"
cp "$REPO_ROOT/templates/.agents/hooks/lib.sh" "$D/lib.sh"   # the real regex string
t5=0
for f in notes.md setup.sh lib.sh; do
  if carja_is_llm_feature_file "$D/$f"; then no "T5: '$f' (only mentions a provider) was wrongly flagged as an LLM feature"; t5=1; fi
done
[ "$t5" = "0" ] && ok "T5: shell/docs/config that only mention a provider are NOT flagged (impl-only)"
rm -rf "$D"

# ============================================================
# Eval-Driven Law — pre-push RUN-gate (v2): presence isn't passing. If the repo
# has evalsets and an eval command, they must pass or the push is blocked.
# ============================================================
echo ""
echo "Eval-Driven Law — pre-push run-gate:"

# A repo with a tracked eval file, an eval command, and NO verify command (so the
# verify block is inert and only the eval behavior is under test).
run_repo() {  # $1 = eval command (config value, may be empty)
  local d; d="$(fresh_repo)"
  printf 'export const evalset=[{input:"hi",rubric:"greets"}];\n' > "$d/answer.eval.ts"
  if [ -n "$1" ]; then printf '{"eval": "%s"}\n' "$1" > "$d/carja.config.json"; fi
  git -C "$d" add -A >/dev/null 2>&1
  CARJA_NO_EVAL=setup CARJA_NO_TEST=setup git -C "$d" commit -q -m seed >/dev/null 2>&1
  printf '%s' "$d"
}
run_prepush() { ( cd "$1" && bash .agents/hooks/pre-push </dev/null >/tmp/pp.out 2>&1 ); }  # returns exit code

# R1: eval command PASSES → push allowed (exit 0)
D="$(run_repo 'true')"; run_prepush "$D"
[ "$?" -eq 0 ] && ok "R1: evals present + passing command → push allowed" || { no "R1: passing evals blocked the push"; sed 's/^/      /' /tmp/pp.out; }
rm -rf "$D"

# R2: eval command FAILS → push blocked (exit 1)
D="$(run_repo 'false')"; run_prepush "$D"
[ "$?" -ne 0 ] && ok "R2: failing evals BLOCK the push" || no "R2: failing evals did not block the push"
rm -rf "$D"

# R3: eval files exist but NO eval command → warn, do not block (exit 0)
D="$(run_repo '')"; run_prepush "$D"
if [ "$?" -eq 0 ] && grep -qi "eval command" /tmp/pp.out; then
  ok "R3: evals present but no command → warns, does not block"
else
  no "R3: missing-eval-command case did not warn-and-continue"; sed 's/^/      /' /tmp/pp.out
fi
rm -rf "$D"

# R4: NO eval files → run-gate silent (exit 0)
D="$(fresh_repo)"; printf 'x\n' > "$D/readme.txt"; git -C "$D" add -A >/dev/null 2>&1
CARJA_NO_TEST=x git -C "$D" commit -q -m seed >/dev/null 2>&1
run_prepush "$D"
[ "$?" -eq 0 ] && ! grep -qi "running evals" /tmp/pp.out && ok "R4: no evalsets → run-gate silent" || no "R4: run-gate fired with no evalsets"
rm -rf "$D"

# R5: failing evals + CARJA_SKIP_EVAL waiver → allowed (exit 0) + logged
D="$(run_repo 'false')"
( cd "$D" && CARJA_SKIP_EVAL="prototype" bash .agents/hooks/pre-push </dev/null >/tmp/pp.out 2>&1 )
if [ "$?" -eq 0 ] && grep -qi "eval" "$D/carja/0-compass/ship-log.md"; then
  ok "R5: CARJA_SKIP_EVAL waiver unblocks + is logged"
else
  no "R5: eval run-gate waiver did not unblock/log"; sed 's/^/      /' /tmp/pp.out
fi
rm -rf "$D"

echo ""
echo "  hooks-eval-gate: $pass passed, $fail failed"
[ "$fail" -eq 0 ] || exit 1
echo "  STATUS: PASSED ✅"
