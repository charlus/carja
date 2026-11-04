#!/usr/bin/env bash
# ============================================================
# Carja Framework V6 — Self-Test Suite
# ============================================================
# Validates that all framework files exist, have proper naming,
# and the framework is structurally intact.
#
# Usage:
#   bash .agents/tests/check-carja.sh
#
# Adapted from Antigravity Superpowers' check-antigravity-profile.sh
# ============================================================
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
AGENT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
ROOT_DIR="$(cd "$AGENT_DIR/.." && pwd)"

PASS_COUNT=0
FAIL_COUNT=0

pass() {
  echo "  [PASS] $1"
  PASS_COUNT=$((PASS_COUNT + 1))
}

fail() {
  echo "  [FAIL] $1"
  FAIL_COUNT=$((FAIL_COUNT + 1))
}

require_file() {
  local path="$1"
  if [ -f "$path" ]; then
    pass "File exists: $(basename "$path")"
  else
    fail "Missing file: $path"
  fi
}

require_dir() {
  local path="$1"
  if [ -d "$path" ]; then
    pass "Dir exists: $(basename "$path")"
  else
    fail "Missing dir: $path"
  fi
}

echo "========================================"
echo " Carja Framework V6 — Self-Test"
echo "========================================"
echo ""

# ---- 1. Core Structure ----
echo "1. Core Structure..."

required_dirs=(
  "$ROOT_DIR/carja/0-compass"
  "$ROOT_DIR/carja/1-workbench"
  "$ROOT_DIR/carja/2-backlog"
  "$ROOT_DIR/carja/3-product-areas"
  "$ROOT_DIR/carja/4-context"
  "$ROOT_DIR/carja/5-templates"
  "$ROOT_DIR/carja/6-archive"
  "$AGENT_DIR/workflows"
  "$AGENT_DIR/skills"
  "$AGENT_DIR/personas"
  "$AGENT_DIR/rules"
  "$AGENT_DIR/tests"
)

for dir in "${required_dirs[@]}"; do
  require_dir "$dir"
done

# ---- 2. Core Files ----
echo ""
echo "2. Core Files..."

required_files=(
  "$AGENT_DIR/AGENTS.md"
  "$AGENT_DIR/how-it-works.md"
  "$ROOT_DIR/CHANGELOG.md"
  "$ROOT_DIR/carja/1-workbench/loop-state.json"
)

for file in "${required_files[@]}"; do
  require_file "$file"
done

# ---- 3. Workflows ----
echo ""
echo "3. Workflows..."

workflows=(
  "genesis" "storyboard" "grand-prd" "ux-ui-design-brief"
  "technical-vision" "deepen" "carve" "spec-it" "build" "quick-path"
  "retrospective" "agentic-flow" "ship" "tdd-cycle" "unattended-loop"
)

for workflow in "${workflows[@]}"; do
  require_file "$AGENT_DIR/workflows/$workflow.md"
done

# ---- 4. Personas ----
echo ""
echo "4. Personas..."

personas=(
  "cto" "architect" "product-manager" "designer" "carja-assistant"
  "code-archaeologist" "security-auditor" "database-architect"
  "performance-optimizer" "checker"
)

for persona in "${personas[@]}"; do
  require_file "$AGENT_DIR/personas/$persona.md"
done

# ---- 5. Skills ----
echo ""
echo "5. Skills..."

skills=(
  "brain-dump-to-epics" "system-janitor" "ux-reviewer"
  "verification-gate" "task-tracker" "code-review" "context-updater"
  "systematic-debugging"
  "frontend-design" "design-system"
  "i18n-localization" "git-worktrees"
  "git-workflow" "git-lab-cli" "git-hub-cli"
  "architecture-patterns"
  "lint-and-validate"
  "analyze-tests" "trace-documentation"
  "context-engineering"
  "skill-registry" "grilling" "collaborative-drafting" "handoff"
  "domain-modeling" "subagent-isolation" "model-routing"
  "independent-review" "judge-panel" "behavior-validator"
  "writing-evals" "architecture-checklist"
)

for skill in "${skills[@]}"; do
  require_file "$AGENT_DIR/skills/$skill/SKILL.md"
done

# Level C: Carja's own LLM-judge surfaces must carry a versioned rubric.
judge_surfaces=(
  "skills/judge-panel/SKILL.md"
  "skills/independent-review/SKILL.md"
  "skills/behavior-validator/SKILL.md"
  "workflows/loop-checker.md"
)
for js in "${judge_surfaces[@]}"; do
  if grep -q "Rubric v" "$AGENT_DIR/$js" 2>/dev/null; then
    pass "judge surface carries a versioned rubric: $js"
  else
    fail "judge surface missing a versioned rubric (Level C): $js"
  fi
done
if grep -q "## Calibration" "$AGENT_DIR/skills/judge-panel/SKILL.md" 2>/dev/null; then
  pass "judge-panel documents the Calibration discipline (who watches the watchers)"
else
  fail "judge-panel missing the Calibration section"
fi

# ---- 5b. Reference Library (docs demoted out of the skill catalog) ----
echo ""
echo "5b. Reference Library..."

references=(
  "clean-code" "testing-patterns" "documentation-templates" "deployment-procedures"
)
for ref in "${references[@]}"; do
  require_file "$AGENT_DIR/references/$ref.md"
done

# A reference doc is only discoverable if something loaded points to it (esp. on
# Claude Code, which has no skill frontmatter to fall back on). Guard against orphans.
if grep -q "references/clean-code.md" "$AGENT_DIR/how-it-works.md" 2>/dev/null; then
  pass "Reference Library has a live referrer (how-it-works.md)"
else
  fail "references/ not referenced from how-it-works.md — demoted docs would be undiscoverable"
fi

# ---- 6. Rules ----
echo ""
echo "6. Rules..."

rules=(
  "prime-directive" "verification-iron-law" "test-driven-law" "live-state-law" "loop-guardrails"
)

for rule in "${rules[@]}"; do
  require_file "$AGENT_DIR/rules/$rule.md"
done

# ---- 7. Naming Convention ----
echo ""
echo "7. Naming Convention (kebab-case)..."

uppercase_found=0
for dir in "$AGENT_DIR/skills"/*/; do
  dirname=$(basename "$dir")
  if [[ "$dirname" =~ [A-Z] ]]; then
    fail "Skill folder not kebab-case: $dirname"
    uppercase_found=1
  fi
done

if [ "$uppercase_found" -eq 0 ]; then
  pass "All skill folders follow kebab-case"
fi

# ---- 8. Version Check ----
echo ""
echo "8. Version Check..."

if grep -q "Carja Framework" "$AGENT_DIR/AGENTS.md"; then
  pass "AGENTS.md references Carja Framework"
else
  fail "AGENTS.md does not reference Carja Framework"
fi

# ---- 9. Dead Path References ----
# Guards against the exact bug the V5 kebab-case migration introduced once:
# renaming files/folders without updating the prose that points at them.
echo ""
echo "9. Dead Path References..."

dead_refs=$(grep -rEl '\.?carja/[0-9]-[A-Z]|\.agents/workflows/[A-Z][a-zA-Z-]*\.md|\.agents/skills/[A-Z][a-zA-Z-]*/SKILL\.md' "$AGENT_DIR" 2>/dev/null || true)

if [ -z "$dead_refs" ]; then
  pass "No dead Title-Case path references found"
else
  fail "Dead Title-Case path references found in:"
  echo "$dead_refs" | while read -r f; do echo "         $f"; done
fi

# ---- 10. Claude Code Slash-Command Bridge ----
# Generated at install time (ADR-0001 D5), not shipped in templates/, so this is
# conditional: it only runs where .claude/commands/ exists (an installed project),
# and is skipped in the framework template repo where the dir is absent.
echo ""
echo "10. Claude Code Slash-Command Bridge..."

commands_dir="$ROOT_DIR/.claude/commands"
workflows_dir="$AGENT_DIR/workflows"
if [ -d "$commands_dir" ] && [ -d "$workflows_dir" ]; then
  missing_shims=""
  for wf in "$workflows_dir"/*.md; do
    [ -e "$wf" ] || continue
    name="$(basename "$wf")"
    if [ ! -f "$commands_dir/$name" ]; then
      missing_shims="$missing_shims $name"
    fi
  done
  if [ -z "$missing_shims" ]; then
    pass "Every workflow has a Claude Code slash command"
  else
    fail "Workflows missing a .claude/commands shim:$missing_shims"
  fi
else
  pass "Slash-command bridge check skipped (no .claude/commands — template repo)"
fi

# ---- 11. Enforcement Hooks ----
echo ""
echo "11. Enforcement Hooks (deterministic laws)..."

hook_files=(
  "$AGENT_DIR/hooks/pre-commit"
  "$AGENT_DIR/hooks/pre-push"
  "$AGENT_DIR/hooks/lib.sh"
  "$AGENT_DIR/hooks/README.md"
)
for hf in "${hook_files[@]}"; do
  require_file "$hf"
done

if [ -f "$AGENT_DIR/hooks/pre-commit" ] && [ -x "$AGENT_DIR/hooks/pre-commit" ]; then
  pass "pre-commit hook is executable"
else
  fail "pre-commit hook is not executable"
fi

# Eval-Driven Law: the gate + its detection helpers must be present.
for helper in carja_is_llm_feature_file carja_is_eval_file; do
  if grep -q "$helper" "$AGENT_DIR/hooks/lib.sh" 2>/dev/null; then
    pass "lib.sh defines eval-gate helper: $helper"
  else
    fail "lib.sh missing eval-gate helper: $helper"
  fi
done
if grep -q "Eval-Driven Law" "$AGENT_DIR/hooks/pre-commit" 2>/dev/null; then
  pass "pre-commit enforces the Eval-Driven Law (presence)"
else
  fail "pre-commit does not enforce the Eval-Driven Law"
fi
for helper in carja_eval_cmd carja_has_eval_files; do
  if grep -q "$helper" "$AGENT_DIR/hooks/lib.sh" 2>/dev/null; then
    pass "lib.sh defines eval run-gate helper: $helper"
  else
    fail "lib.sh missing eval run-gate helper: $helper"
  fi
done
if grep -q "Eval-Driven Law" "$AGENT_DIR/hooks/pre-push" 2>/dev/null; then
  pass "pre-push enforces the Eval-Driven Law run-gate"
else
  fail "pre-push does not enforce the Eval-Driven Law run-gate"
fi

# ---- 12. Autonomous Loop Backend (V6 driver + v2 state) ----
echo ""
echo "12. Autonomous Loop Backend (deterministic driver)..."

LOOP_STATE="$ROOT_DIR/carja/1-workbench/loop-state.json"
if [ -f "$LOOP_STATE" ]; then
  for field in '"schema_version": 2' '"budget"' '"verification"' '"stall"' '"maker_reported_done"' '"platform"' '"sandbox"' '"checker_votes"'; do
    if grep -q "$field" "$LOOP_STATE"; then
      pass "loop-state.json has v2 field: $field"
    else
      fail "loop-state.json missing v2 field: $field"
    fi
  done
else
  fail "Missing file: $LOOP_STATE"
fi

# Phase 3 isolation assets ship in the framework.
require_file "$AGENT_DIR/workflows/loop-checker.md"
require_file "$AGENT_DIR/sandbox/README.md"
require_file "$AGENT_DIR/sandbox/Dockerfile.sandbox"

# The soft layer must NOT re-implement driver-owned bookkeeping.
GUARDRAILS="$AGENT_DIR/rules/loop-guardrails.md"
WORKFLOW="$AGENT_DIR/workflows/unattended-loop.md"
if [ -f "$WORKFLOW" ] && ! grep -q "maker_active" "$WORKFLOW"; then
  pass "unattended-loop.md dropped the retired 'maker_active' status"
else
  fail "unattended-loop.md still references 'maker_active' (soft layer not reconciled)"
fi
if [ -f "$GUARDRAILS" ] && ! grep -q "last_tool_invoked" "$GUARDRAILS"; then
  pass "loop-guardrails.md dropped the un-observable last_tool_invoked stall signal"
else
  fail "loop-guardrails.md still references last_tool_invoked"
fi

# The driver module ships in package source (src/), not into user installs.
# Only assert it when running inside the framework repo; skip in installs.
PKG_ROOT="$(cd "$ROOT_DIR/.." && pwd)"
if [ -f "$PKG_ROOT/src/loop/driver.js" ]; then
  require_file "$PKG_ROOT/src/loop/driver.js"
  require_file "$PKG_ROOT/src/commands/loop.js"
  require_file "$PKG_ROOT/src/loop/adapters/index.js"
  require_file "$PKG_ROOT/src/loop/adapters/claude.js"
  require_file "$PKG_ROOT/src/loop/adapters/antigravity.js"
  require_file "$PKG_ROOT/src/loop/adapters/codex.js"
  require_file "$PKG_ROOT/src/loop/worktree.js"
  require_file "$PKG_ROOT/src/loop/checker.js"
  require_file "$PKG_ROOT/src/loop/merge.js"
  require_file "$PKG_ROOT/src/loop/swarm.js"
  # The driver must not hardcode a platform (Phase 2 — swappable adapters).
  if grep -q "antigravity run" "$PKG_ROOT/src/loop/driver.js"; then
    fail "driver.js hardcodes a platform ('antigravity run')"
  else
    pass "driver.js is platform-agnostic (no hardcoded CLI)"
  fi
else
  pass "Driver module check skipped (installed context — src/ not present)"
fi

# ---- Summary ----
echo ""
echo "========================================"
echo " Summary"
echo "========================================"
echo "  Passed: $PASS_COUNT"
echo "  Failed: $FAIL_COUNT"
echo ""

if [ "$FAIL_COUNT" -gt 0 ]; then
  echo "STATUS: FAILED"
  exit 1
fi

echo "STATUS: PASSED ✅"


