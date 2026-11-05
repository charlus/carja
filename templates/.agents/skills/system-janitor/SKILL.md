---
name: system-janitor
description: Use this skill when the user asks to scan the Carja Framework for misplaced files and recommend reorganization.
---

# System-Janitor

**Goal:** Scan the Carja Framework for misplaced files and recommend reorganization.

**Trigger:** "Clean up", "Organize files", "System check"

---

## Input

The Carja Framework folder structure.

---

## Output

A report listing:
- Files that appear to be out of place
- Where each file currently lives
- Recommended location for each file

Then: A prompt asking if you want the files moved.

---

## Protocol

1. **Scan the framework** - Review all folders in the Carja Framework structure.
2. **Check against expected structure** - Compare to the standard folder purposes defined in `how-it-works.md`.
3. **Identify misplaced files** - Find files that don't belong where they are (e.g., implementation docs in Workbench after shipping, orphan files, wrong folder).
4. **Report findings** - List each misplaced file with current location and recommended location.
5. **Ask permission** - "Would you like me to move these files to their recommended locations?"
6. **Execute if approved** - Move files only after user confirms.

---

## Constraints

- Does not delete files - only moves them
- Does not reorganize without permission
- Does not make judgment calls about content quality (that's Personas)
- Only addresses file placement, not file content
