---
description: Merge Stack (Walk the Owner Through a Loop Run's MRs, in Order)
---

# Workflow: Merge Stack — Walk the Owner Through a Loop Run's MRs, in Order

> **System Instruction:** Upon triggering this workflow, you MUST read the entire content of this file again to load the latest protocols. Do not rely on previous memory.

**Trigger:** "/merge-stack <project>", "Help me merge the loop's MRs", "Guide me through the loop report", or after `carja loop <project>` ends with MRs to merge.
**Goal:** The owner merges every MR of a stacked run in the right order, and does each manual step (backup, migration, environment variable, install, command) at the right moment, without reading the report alone.
**Output:** The MRs merged, or the first one the owner stopped at, and nothing done in the owner's place.

---

You guide; the owner acts. Never merge, push, run a migration or change a production setting yourself: name the step, give the exact command, wait for the owner to say it is done. Live State Law: every state you name (open, merged, its target branch, its pipeline) is checked on the forge in the same turn, never taken from the report.

## 1. Read the report

1. Read `carja/1-workbench/loop-report-<project>.md`. Git does not track it; it is there after any `carja loop <project>` run. No report: say so and stop. Several projects and none named: list the reports and ask which.
2. Read `carja/1-workbench/loop-messages.md` for anything the run said after the report (a stop, a question round). A question round waiting in `carja/1-workbench/questions/` comes first: the owner answers it before anything is merged.
3. Tell the owner in three lines: how many items, the order, and the owner actions in the whole stack (count of migrations, environment variables, dependencies). Ask nothing yet.

## 2. One item at a time, bottom first

For each item, in the report's order:

1. **Check it live.** `glab mr view <url>` or `gh pr view <url>` for each of its MRs (the code MR first, then the Carja state MR): its state, its target branch, its pipeline. Already merged: say so and go to the next item. Closed: stop the walk and say what that means (the next `carja loop <project>` rebuilds this item and everything above it).
2. **The target must be the default branch.** Bottom item: it is. Any other item: its target is the default branch only once the item below is merged and its source branch deleted. A target that still names the item below after that merge: tell the owner to change the target on the forge to the default branch, then check again.
3. **Before the merge:** the item's "Owner actions" that come before a merge (a backup before a migration, reading changed deployment files, a decision taken for them they want to overrule). Give each with its exact command, one at a time, and wait for "done".
4. **The merge:** name the MR to merge, with two rules: no squash (the items above are built on its commits) and delete the source branch (so the item above moves to the default branch). Code MR first, then the state MR. Carja documents the report says were "merged from both sides": ask the owner to read them in the MR before merging.
5. **After the merge:** the item's other actions (run the migration, set the environment variable, install the dependency where the product runs, run the one-off command), one at a time, waiting for "done" each time. Then check the MR live again: merged.

## 3. When something goes wrong

- **A pipeline is red or the forge shows a conflict:** stop the walk. Say which MR and what the forge says. A conflict in Carja documents only: the owner can resolve it on the forge, keeping both sides. A conflict in code: stop; the owner decides.
- **The owner rejects an item:** they close its MR. Everything above it is rebuilt by the next `carja loop <project>`; say that, and stop the walk.
- **The owner wants to change an item:** they push to its branch. The next run keeps their change and rebuilds the items above.

## 4. At the end

Say what is merged, what is not and why, and the next command: `carja loop <project>` when items are left to build, else nothing. Then `git pull` in the project folder: it removes the merged items' worktrees.
