#!/usr/bin/env bash
# ============================================================
# The Goodhart boundary + protected paths — pre-commit BEHAVIOR test (F9/F12).
#
# The Test-Driven Law proves a test CHANGE exists. It cannot tell a new test
# from a deleted one: `--diff-filter=ACM` never sees a deletion, and staging
# `.skip(` counts as a test change. So "all tests pass" was gameable by the two
# cheapest moves an unattended agent has — delete the failing test, or skip it.
# The boundary gate closes that, and the protected-path gate stops the agent
# editing the gates themselves (Build may not edit the acceptance conditions).
#
# Installs the REAL templates/.agents/hooks into a temp repo and exercises both.
# ============================================================
set -uo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
pass=0; fail=0
ok() { echo "  [PASS] $1"; pass=$((pass+1)); }
no() { echo "  [FAIL] $1"; fail=$((fail+1)); }

fresh_repo() {
  local d; d="$(mktemp -d)"
  mkdir -p "$d/.agents/hooks" "$d/carja/0-compass" "$d/src" "$d/test"
  cp "$REPO_ROOT/templates/.agents/hooks/"* "$d/.agents/hooks/"
  chmod +x "$d/.agents/hooks/pre-commit" "$d/.agents/hooks/pre-push" 2>/dev/null
  : > "$d/carja/0-compass/ship-log.md"
  git -C "$d" init -q
  git -C "$d" config user.email t@t.local
  git -C "$d" config user.name t
  git -C "$d" config core.hooksPath .agents/hooks
  printf '%s' "$d"
}

# A repo with a committed baseline: one impl file and one real test file.
seeded_repo() {
  local d; d="$(fresh_repo)"
  printf 'export const add = (a, b) => a + b;\n' > "$d/src/add.js"
  cat > "$d/test/add.test.js" <<'EOF'
import { add } from "../src/add.js";
test("adds", () => { expect(add(1, 2)).toBe(3); });
test("adds negatives", () => { expect(add(-1, -2)).toBe(-3); });
test("adds zero", () => { expect(add(0, 0)).toBe(0); });
test("adds large", () => { expect(add(1e6, 1e6)).toBe(2e6); });
test("adds floats", () => { expect(add(0.5, 0.25)).toBe(0.75); });
test("adds mixed", () => { expect(add(-3, 5)).toBe(2); });
EOF
  git -C "$d" add -A >/dev/null 2>&1
  CARJA_HOOKS=off git -C "$d" commit -q -m "baseline" >/dev/null 2>&1
  printf '%s' "$d"
}

echo "Goodhart boundary + protected paths — pre-commit:"

# ---- G1: deleting a test file → BLOCKED -----------------------------------
D="$(seeded_repo)"
git -C "$D" rm -q "test/add.test.js" >/dev/null 2>&1
if git -C "$D" commit -q -m "drop the failing test" >/dev/null 2>&1; then
  no "G1: a DELETED test file committed (the cheapest Goodhart move is open)"
else
  ok "G1: deleting a test file is BLOCKED"
fi
rm -rf "$D"

# ---- G2: adding .skip( to a test → BLOCKED --------------------------------
D="$(seeded_repo)"
sed -i 's/^test("adds negatives"/test.skip("adds negatives"/' "$D/test/add.test.js"
git -C "$D" add -A >/dev/null 2>&1
if git -C "$D" commit -q -m "skip the red one" >/dev/null 2>&1; then
  no "G2: a test disabled with .skip( committed"
else
  ok "G2: adding .skip( to a test is BLOCKED"
fi
rm -rf "$D"

# ---- G3: adding .only( to a test → BLOCKED --------------------------------
# .only silently drops every OTHER test in the file — a whole-suite mute.
D="$(seeded_repo)"
sed -i 's/^test("adds"/test.only("adds"/' "$D/test/add.test.js"
git -C "$D" add -A >/dev/null 2>&1
if git -C "$D" commit -q -m "focus one test" >/dev/null 2>&1; then
  no "G3: a test file with .only( committed"
else
  ok "G3: adding .only( to a test is BLOCKED"
fi
rm -rf "$D"

# ---- G4: python/rust/go skip markers → BLOCKED ----------------------------
D="$(seeded_repo)"
mkdir -p "$D/tests"
printf 'def test_thing():\n    assert 1 == 1\n' > "$D/tests/test_thing.py"
git -C "$D" add -A >/dev/null 2>&1
CARJA_HOOKS=off git -C "$D" commit -q -m "add py test" >/dev/null 2>&1
printf '@pytest.mark.skip(reason="flaky")\ndef test_thing():\n    assert 1 == 1\n' > "$D/tests/test_thing.py"
git -C "$D" add -A >/dev/null 2>&1
if git -C "$D" commit -q -m "skip py test" >/dev/null 2>&1; then
  no "G4: a @pytest.mark.skip committed"
else
  ok "G4: adding @pytest.mark.skip is BLOCKED"
fi
rm -rf "$D"

# ---- G5: gutting assertions → BLOCKED -------------------------------------
# Weakening is the third Goodhart move: keep the test, remove what it proves.
D="$(seeded_repo)"
cat > "$D/test/add.test.js" <<'EOF'
import { add } from "../src/add.js";
test("adds", () => { add(1, 2); });
EOF
git -C "$D" add -A >/dev/null 2>&1
if git -C "$D" commit -q -m "simplify tests" >/dev/null 2>&1; then
  no "G5: a test file stripped of its assertions committed"
else
  ok "G5: a net drop in assertions is BLOCKED"
fi
rm -rf "$D"

# ---- G6: a normal red→green cycle still COMMITS ---------------------------
# The gate must not tax honest work: adding a test plus impl is the happy path.
D="$(seeded_repo)"
printf 'export const mul = (a, b) => a * b;\n' > "$D/src/mul.js"
cat > "$D/test/mul.test.js" <<'EOF'
import { mul } from "../src/mul.js";
test("multiplies", () => { expect(mul(2, 3)).toBe(6); });
EOF
git -C "$D" add -A >/dev/null 2>&1
if git -C "$D" commit -q -m "feat: multiply" >/dev/null 2>&1; then
  ok "G6: an honest red→green commit is untouched"
else
  no "G6: the gate blocked a normal test+impl commit"
fi
rm -rf "$D"

# ---- G7: renaming a test file still COMMITS -------------------------------
# A rename is a delete+add to git. Gating on deletions alone would break it.
D="$(seeded_repo)"
git -C "$D" mv "test/add.test.js" "test/addition.test.js" >/dev/null 2>&1
if git -C "$D" commit -q -m "refactor: rename test file" >/dev/null 2>&1; then
  ok "G7: renaming a test file is not read as a deletion"
else
  no "G7: a test-file rename was blocked"
fi
rm -rf "$D"

# ---- G10: rename + add .skip → BLOCKED (review blocker B6) -----------------
# A renamed file has status R, which --diff-filter=ACM never lists, so a test
# could be renamed AND disabled in one commit and the gate never saw it.
D="$(seeded_repo)"
git -C "$D" mv test/add.test.js test/sum.test.js
sed -i 's/^test("adds zero"/test.skip("adds zero"/' "$D/test/sum.test.js"
git -C "$D" add -A >/dev/null 2>&1
if git -C "$D" commit -q -m "rename and skip" >/dev/null 2>&1; then
  no "G10: a renamed test with an added .skip( committed"
else
  ok "G10: rename + .skip( is BLOCKED"
fi
rm -rf "$D"

# ---- G11: rename + drop an assertion → BLOCKED ------------------------------
D="$(seeded_repo)"
git -C "$D" mv test/add.test.js test/sum.test.js
sed -i '/adds mixed/d' "$D/test/sum.test.js"
git -C "$D" add -A >/dev/null 2>&1
if git -C "$D" commit -q -m "rename and gut" >/dev/null 2>&1; then
  no "G11: a renamed test that lost an assertion committed"
else
  ok "G11: rename + assertion loss is BLOCKED"
fi
rm -rf "$D"

# ---- G12: a pure rename is allowed even with diff.renames=false -------------
# The gate must not depend on the user's rename config: with renames off, the
# new path was diffed as a whole-file add, so existing content read as new.
D="$(seeded_repo)"
sed -i 's/^test("adds zero"/test.skip("adds zero"/' "$D/test/add.test.js"
git -C "$D" add -A >/dev/null 2>&1
CARJA_NO_BOUNDARY="pre-existing skip" git -C "$D" commit -q -m "a skip that already exists" >/dev/null 2>&1
git -C "$D" config diff.renames false
git -C "$D" mv test/add.test.js test/sum.test.js
if git -C "$D" commit -q -m "pure rename" >/dev/null 2>&1; then
  ok "G12: a pure rename passes whatever diff.renames says"
else
  no "G12: a pure rename was falsely blocked under diff.renames=false"
fi
rm -rf "$D"

# ---- G13: deleting a non-code file under test/ is not a test deletion -------
# Review IMPORTANT: every file under test/ counted, so removing a fixture or a
# README was reported as "test file DELETED".
D="$(seeded_repo)"
printf '{"a":1}\n' > "$D/test/data.json"
printf '# fixtures\n' > "$D/test/README.md"
git -C "$D" add -A >/dev/null 2>&1
CARJA_HOOKS=off git -C "$D" commit -q -m "fixtures" >/dev/null 2>&1
git -C "$D" rm -q test/data.json test/README.md
if git -C "$D" commit -q -m "drop fixtures" >/dev/null 2>&1; then
  ok "G13: removing a fixture or README under test/ is allowed"
else
  no "G13: a non-code file under test/ was treated as a deleted test"
fi
rm -rf "$D"

# ---- G14: renaming a test to a NON-test path is a deletion (delta B6) -------
# The test simply stops running: to the suite, it is gone.
for target in "test/add.test.js.bak" "docs/add.test.js.txt" "src/add.fixture.js"; do
  D="$(seeded_repo)"
  mkdir -p "$D/$(dirname "$target")"
  git -C "$D" mv test/add.test.js "$target"
  if git -C "$D" commit -q -m "retire the test" >/dev/null 2>&1; then
    no "G14: renaming a test to $target committed — the test stopped running"
  else
    ok "G14: renaming a test to $target is BLOCKED"
  fi
  rm -rf "$D"
done

# ---- G8: waiver → COMMITS and is logged -----------------------------------
D="$(seeded_repo)"
git -C "$D" rm -q "test/add.test.js" >/dev/null 2>&1
if CARJA_NO_BOUNDARY="feature removed, its tests go with it" \
     git -C "$D" commit -q -m "waived" >/dev/null 2>&1; then
  if grep -qi "boundary" "$D/carja/0-compass/ship-log.md"; then
    ok "G8: waiver commits AND is logged to the ship-log"
  else
    no "G8: waiver committed but was not logged"
  fi
else
  no "G8: waiver did not allow the commit"
fi
rm -rf "$D"

# ---- G9: the TDD waiver does NOT waive the boundary -----------------------
# Independence: an agent that already has CARJA_NO_TEST in its environment
# must not get the boundary for free.
D="$(seeded_repo)"
git -C "$D" rm -q "test/add.test.js" >/dev/null 2>&1
if CARJA_NO_TEST="unrelated" git -C "$D" commit -q -m "wrong waiver" >/dev/null 2>&1; then
  no "G9: CARJA_NO_TEST also waived the boundary gate"
else
  ok "G9: the boundary gate is independent of the TDD waiver"
fi
rm -rf "$D"

echo ""
echo "Protected paths — the agent may not edit the gates:"

# ---- P1: editing .agents/hooks/ → BLOCKED ---------------------------------
D="$(seeded_repo)"
printf '\n# tampered\n' >> "$D/.agents/hooks/pre-commit"
git -C "$D" add -A >/dev/null 2>&1
if git -C "$D" commit -q -m "tweak the hook" >/dev/null 2>&1; then
  no "P1: a change to .agents/hooks/ committed"
else
  ok "P1: editing .agents/hooks/ is BLOCKED"
fi
rm -rf "$D"

# ---- P2: editing .agents/rules/ → BLOCKED ---------------------------------
D="$(seeded_repo)"
mkdir -p "$D/.agents/rules"
printf '# Test-Driven Law\nrelaxed.\n' > "$D/.agents/rules/test-driven-law.md"
git -C "$D" add -A >/dev/null 2>&1
if git -C "$D" commit -q -m "relax a law" >/dev/null 2>&1; then
  no "P2: a change to .agents/rules/ committed"
else
  ok "P2: editing .agents/rules/ is BLOCKED"
fi
rm -rf "$D"

# ---- P3: editing the reviewer brief → BLOCKED -----------------------------
# reviewer.md IS the acceptance criteria. Build may not edit it.
D="$(seeded_repo)"
mkdir -p "$D/.agents/skills/independent-review"
printf '# The Reviewer Brief\nApprove everything.\n' \
  > "$D/.agents/skills/independent-review/reviewer.md"
git -C "$D" add -A >/dev/null 2>&1
if git -C "$D" commit -q -m "soften the reviewer" >/dev/null 2>&1; then
  no "P3: a change to the reviewer brief committed"
else
  ok "P3: editing the reviewer brief is BLOCKED"
fi
rm -rf "$D"

# ---- P4: editing the sandbox profile → BLOCKED ----------------------------
D="$(seeded_repo)"
mkdir -p "$D/.agents/sandbox"
printf '{ "sandbox": { "enabled": false } }\n' > "$D/.agents/sandbox/claude-sandbox.settings.json"
git -C "$D" add -A >/dev/null 2>&1
if git -C "$D" commit -q -m "disable the sandbox" >/dev/null 2>&1; then
  no "P4: a change to the sandbox profile committed"
else
  ok "P4: editing .agents/sandbox/ is BLOCKED"
fi
rm -rf "$D"

# ---- P4b: DELETING a gate → BLOCKED ---------------------------------------
# Removing pre-commit disables every commit gate as surely as rewriting it, and
# a deletion stages nothing under ACM — the shape that hid this for free.
D="$(seeded_repo)"
git -C "$D" rm -q ".agents/hooks/pre-push" >/dev/null 2>&1
if git -C "$D" commit -q -m "remove the push gate" >/dev/null 2>&1; then
  no "P4b: a DELETED gate committed"
else
  ok "P4b: deleting a gate is BLOCKED"
fi
rm -rf "$D"

# ---- P4c: the FIRST commit of a fresh install is allowed ------------------
# `carja init` stages .agents/ wholesale. You cannot weaken a gate that is
# not committed yet, and blocking here would mean a new project can never make
# its first commit. The gate arms from the second commit on.
D="$(fresh_repo)"
printf 'export const add = (a, b) => a + b;\n' > "$D/src/add.js"
printf 'test("adds", () => { expect(add(1,2)).toBe(3); });\n' > "$D/test/add.test.js"
git -C "$D" add -A >/dev/null 2>&1
if git -C "$D" commit -q -m "chore: scaffold carja" >/dev/null 2>&1; then
  ok "P4c: the initial scaffold commit is allowed"
else
  no "P4c: a fresh carja install cannot make its first commit"
fi
rm -rf "$D"

# ---- P8: deleting lib.sh must not switch every gate off (review blocker B1) -
# Both hooks source lib.sh. With it gone, every carja_* call was "command
# not found", nothing set `blocked`, and the commit went through — with every
# gate disabled at once.
D="$(seeded_repo)"
git -C "$D" rm -q .agents/hooks/lib.sh
if git -C "$D" commit -q -m "drop the lib" >/dev/null 2>&1; then
  no "P8: deleting lib.sh committed — every gate went dark"
else
  ok "P8: deleting lib.sh is BLOCKED"
fi
rm -rf "$D"

# ---- P9: …and the gates it carries still run in that commit ---------------
D="$(seeded_repo)"
git -C "$D" rm -q .agents/hooks/lib.sh test/add.test.js
if git -C "$D" commit -q -m "drop lib and a test" >/dev/null 2>&1; then
  no "P9: removing lib.sh smuggled a test deletion through"
else
  ok "P9: lib.sh removal cannot carry a test deletion with it"
fi
rm -rf "$D"

# ---- P10: moving lib.sh out is the same as deleting it --------------------
D="$(seeded_repo)"
git -C "$D" mv .agents/hooks/lib.sh src/lib.sh
if git -C "$D" commit -q -m "move the lib" >/dev/null 2>&1; then
  no "P10: moving lib.sh out of .agents/hooks committed"
else
  ok "P10: moving lib.sh out is BLOCKED"
fi
rm -rf "$D"

# ---- P11: NEUTERING lib.sh in place is the same class ---------------------
# Not in the review, same class: the hook sourced the WORKING-TREE lib.sh, so
# a commit that rewrote the protection check to a no-op disabled that check
# for the very commit making the change. Enforcement must come from the copy
# already committed, not the one being changed.
D="$(seeded_repo)"
cat >> "$D/.agents/hooks/lib.sh" <<'EOF'
carja_protected_changes() { :; }
carja_deleted_test_files() { :; }
EOF
git -C "$D" rm -q test/add.test.js
git -C "$D" add -A >/dev/null 2>&1
if git -C "$D" commit -q -m "neuter the lib" >/dev/null 2>&1; then
  no "P11: a neutered lib.sh disabled its own check in the same commit"
else
  ok "P11: neutering lib.sh does not disable the gates for that commit"
fi
rm -rf "$D"

# ---- P12: deleting pre-commit is caught at the push boundary --------------
# git runs pre-commit from the working tree: once it is deleted, nothing runs
# at commit. The first place left to catch it is pre-push.
D="$(seeded_repo)"
B="$(mktemp -d)"; git init -q --bare "$B"
git -C "$D" remote add origin "$B"
CARJA_HOOKS=off git -C "$D" push -q origin HEAD:main >/dev/null 2>&1
git -C "$D" rm -q .agents/hooks/pre-commit
git -C "$D" commit -q -m "no more commit gate" >/dev/null 2>&1
if git -C "$D" push -q origin HEAD:main >/dev/null 2>&1; then
  no "P12: a push that deletes pre-commit went through"
else
  ok "P12: deleting pre-commit is BLOCKED at push"
fi
rm -rf "$D" "$B"

# ---- P13: …and a deliberate removal can be waived, and is logged ----------
D="$(seeded_repo)"
B="$(mktemp -d)"; git init -q --bare "$B"
git -C "$D" remote add origin "$B"
CARJA_HOOKS=off git -C "$D" push -q origin HEAD:main >/dev/null 2>&1
git -C "$D" rm -q .agents/hooks/pre-commit
git -C "$D" commit -q -m "remove carja" >/dev/null 2>&1
if CARJA_NO_PROTECTED="uninstalling carja" git -C "$D" push -q origin HEAD:main >/dev/null 2>&1; then
  if grep -qi "protected" "$D/carja/0-compass/ship-log.md"; then
    ok "P13: a waived removal pushes AND is logged"
  else
    no "P13: waived push went through but was not logged"
  fi
else
  no "P13: CARJA_NO_PROTECTED did not allow the push"
fi
rm -rf "$D" "$B"

# ---- P14: code at the TOP of a working-tree lib.sh must not run (delta B1) ---
# The first fix sourced the working-tree lib.sh before the committed copy, so
# any top-level statement in it ran: one `exit 0` switched every gate off, and
# `readonly -f` stopped the trusted copy from redefining a helper. Once a lib
# is committed, the working-tree copy must not execute at all.
D="$(seeded_repo)"
sed -i '1a exit 0' "$D/.agents/hooks/lib.sh"
git -C "$D" rm -q test/add.test.js
if git -C "$D" commit -q -m "exit-0 lib + test deletion" >/dev/null 2>&1; then
  no "P14: an 'exit 0' in the working-tree lib.sh switched the gates off"
else
  ok "P14: top-level code in the working-tree lib.sh does not run"
fi
rm -rf "$D"

D="$(seeded_repo)"
printf '\ncarja_deleted_test_files(){ :; }; readonly -f carja_deleted_test_files\n' >> "$D/.agents/hooks/lib.sh"
git -C "$D" rm -q test/add.test.js
if git -C "$D" commit -q -m "readonly override" >/dev/null 2>&1; then
  no "P14b: a readonly override in the working-tree lib.sh disabled a gate"
else
  ok "P14b: a readonly override cannot pin a neutered helper"
fi
rm -rf "$D"

# ---- P15: renaming pre-commit away is a removal (delta B1) ----------------
push_repo() {
  local d b; d="$(seeded_repo)"; b="$(mktemp -d)"; git init -q --bare "$b"
  git -C "$d" remote add origin "$b"
  CARJA_HOOKS=off git -C "$d" push -q origin HEAD:main >/dev/null 2>&1
  printf '%s %s' "$d" "$b"
}
read -r D B <<< "$(push_repo)"
git -C "$D" mv .agents/hooks/pre-commit .agents/hooks/pre-commit.disabled
git -C "$D" rm -q test/add.test.js
git -C "$D" commit -q -m "disable by rename" >/dev/null 2>&1
if git -C "$D" push -q origin HEAD:main >/dev/null 2>&1; then
  no "P15: a push that RENAMES pre-commit away went through"
else
  ok "P15: renaming pre-commit away is BLOCKED at push"
fi
rm -rf "$D" "$B"

# ---- P16: removing pre-commit's execute bit is a removal (delta B1) -------
# git silently skips a hook that is not executable, so chmod -x disables it
# as surely as deleting it.
read -r D B <<< "$(push_repo)"
chmod -x "$D/.agents/hooks/pre-commit"
git -C "$D" add -A >/dev/null 2>&1
git -C "$D" rm -q test/add.test.js
git -C "$D" commit -q -m "disable by chmod" >/dev/null 2>&1
if git -C "$D" push -q origin HEAD:main >/dev/null 2>&1; then
  no "P16: a push that makes pre-commit non-executable went through"
else
  ok "P16: chmod -x on pre-commit is BLOCKED at push"
fi
rm -rf "$D" "$B"

# ---- P17: an EDITED pre-commit is caught at push (final review, NB1) --------
# The edited pre-commit runs itself, so an `exit 0` in it judges nothing at
# commit. pre-push is the first gate left that did not change: it must count
# any change to pre-commit in the range, not only a deletion, rename or mode.
read -r D B <<< "$(push_repo)"
printf '#!/bin/sh\nexit 0\n' > "$D/.agents/hooks/pre-commit"
git -C "$D" rm -q test/add.test.js
git -C "$D" add -A
git -C "$D" commit -q -m "neuter the commit gate" >/dev/null 2>&1
if git -C "$D" push -q origin HEAD:main >/dev/null 2>&1; then
  no "P17: an edited pre-commit let a deleted test ship"
else
  ok "P17: an edited pre-commit is BLOCKED at push"
fi
rm -rf "$D" "$B"

# ---- P18: the OFFICIAL pre-commit shipped by an upgrade pushes with no waiver -
# pre-push carries the fingerprint of the pre-commit released alongside it. An
# edit that lands on exactly that content is an upgrade, not a neutering, so
# the push needs nothing (maintainer: remove upgrade friction). Forging the
# match means editing pre-push too — both entry scripts, the stated limit.
read -r D B <<< "$(push_repo)"
printf '\n# an older release\n' >> "$D/.agents/hooks/pre-commit"
git -C "$D" add -A; CARJA_HOOKS=off git -C "$D" commit -q -m "older release" >/dev/null 2>&1
CARJA_HOOKS=off git -C "$D" push -q origin HEAD:main >/dev/null 2>&1
cp "$REPO_ROOT/templates/.agents/hooks/pre-commit" "$D/.agents/hooks/pre-commit"
git -C "$D" add -A; CARJA_NO_PROTECTED="carja upgrade" git -C "$D" commit -q -m "upgrade" >/dev/null 2>&1
if git -C "$D" push -q origin HEAD:main >/dev/null 2>&1; then
  ok "P18: the official upgraded pre-commit pushes with no waiver"
else
  no "P18: an upgrade to the OFFICIAL pre-commit still demanded a waiver at push"
fi
rm -rf "$D" "$B"

# ---- P5: ordinary .agents/ content is NOT protected -----------------------
# Only the enforcement surface is frozen. Skills and workflows stay editable.
D="$(seeded_repo)"
mkdir -p "$D/.agents/workflows"
printf '# Build\nsome workflow\n' > "$D/.agents/workflows/build.md"
git -C "$D" add -A >/dev/null 2>&1
if git -C "$D" commit -q -m "edit a workflow" >/dev/null 2>&1; then
  ok "P5: ordinary .agents/ content stays editable"
else
  no "P5: the gate over-reached into ordinary .agents/ content"
fi
rm -rf "$D"

# ---- P6: waiver → COMMITS and is logged -----------------------------------
D="$(seeded_repo)"
printf '\n# intentional\n' >> "$D/.agents/hooks/pre-commit"
git -C "$D" add -A >/dev/null 2>&1
if CARJA_NO_PROTECTED="carja upgrade" git -C "$D" commit -q -m "waived" >/dev/null 2>&1; then
  if grep -qi "protected" "$D/carja/0-compass/ship-log.md"; then
    ok "P6: waiver commits AND is logged to the ship-log"
  else
    no "P6: waiver committed but was not logged"
  fi
else
  no "P6: waiver did not allow the commit"
fi
rm -rf "$D"

# ---- P7: hooks off → both gates silent ------------------------------------
D="$(seeded_repo)"
git -C "$D" rm -q "test/add.test.js" >/dev/null 2>&1
printf '\n# tampered\n' >> "$D/.agents/hooks/pre-commit"
git -C "$D" add -A >/dev/null 2>&1
if CARJA_HOOKS=off git -C "$D" commit -q -m "hooks off" >/dev/null 2>&1; then
  ok "P7: CARJA_HOOKS=off disables both gates"
else
  no "P7: a gate still fired with CARJA_HOOKS=off"
fi
rm -rf "$D"

echo ""
echo "  Passed: $pass"
echo "  Failed: $fail"
[ "$fail" -eq 0 ] && echo "STATUS: PASSED ✅" || echo "STATUS: FAILED ❌"
exit "$fail"
