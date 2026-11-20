---
description: Merge Stack (Merge a Loop Run's MRs in Order, Stop Only Where the Owner Must Act)
---

# Workflow: Merge Stack — Merge a Loop Run's MRs in Order

> **System Instruction:** Upon triggering this workflow, you MUST read the entire content of this file again to load the latest protocols. Do not rely on previous memory.

**Trigger:** "/merge-stack <project>", "Merge the stack", "Help me merge the loop's MRs", "Guide me through the loop report", or after a `carja loop` run ends with MRs to merge.
**Goal:** Every MR of a stacked run is merged in the right order, with the fewest turns from the owner. The owner acts only where a person must: the steps around an item's merge, a deploy, a production test, a product choice.
**Output:** The MRs merged, or the item the walk stopped at and the one thing the owner does next.

---

`carja merge-stack <project>` does the merges. It checks each MR on the forge, merges bottom first (code MR, then state MR, no squash, source branch deleted, only the head it checked, only on a green pipeline), and stops before an item with owner actions, after an item the owner confirmed, and at the first red pipeline, conflict or closed MR. Never merge in another way: no `glab mr merge`, no `gh pr merge`, no push to the default branch. Run every step you have access to: a query, a migration, a script, a deploy. A step that changes production (schema, data, a deploy): one line saying what it changes, wait for "go", run it, show the result. Never hand the owner a script to read or SQL to paste.

After a backlog run (no project), `carja merge-stack --backlog` replaces `carja merge-stack <project>`.

Live State Law: the command reads the forge on each run. Do not repeat its checks.

## How you write

- One line per item. Detail only for an item that stops the walk.
- Give each rule once per walk (no squash, code MR first). Do not repeat it at each item.
- Do not say how you ran a check. Say what it found.
- End each message with the one thing the owner does next, or "Nothing needed from you."

## 1. Read and check

1. Read `carja/1-workbench/loop-messages.md` for anything the run said after the report. A question round waiting in `carja/1-workbench/questions/` comes first: the owner answers it before anything is merged.
2. Run `carja merge-stack <project> --dry-run`. It lists each item: ready, blocked or needs you.
3. Nothing blocked: go to step 2 without asking. The owner's trigger is the go-ahead. Blocked: show that line and stop.

## 2. Merge

1. Run `carja merge-stack <project>`. It merges every item it can and stops at the first item that needs the owner.
2. **It stopped before an item with owner actions.** Split its steps into "before the merge" (a backup, a decision to overrule) and "after the merge" (a migration, an environment variable, a deploy). Do every step you have access to, production ones after their "go". Give the owner one numbered list of the rest only: an access you lack (one line they run with `!`, whose output you read), a test in the app. When they say done, run the `--confirm` line it printed.
3. **It stopped after a confirmed item.** Same rule for the "after" steps: do yours, list theirs. When the owner says done, run `carja merge-stack <project>` again.
4. **It stopped on a red pipeline, a conflict or a closed MR.** A red pipeline was retried once: read the failed job, push a fix. A conflict: merge the target into the item's branch, resolve (Carja documents: keep both sides), run verify, push. Ask the owner only for a product choice. Then run the command again.

Tell the owner to deploy once at the end, unless an item says otherwise.

## 3. When the owner changes the plan

- **The owner rejects an item:** they close its MR. The next `carja loop <project>` rebuilds everything above it.
- **The owner wants to change an item:** they push to its branch. The next run keeps their change and rebuilds the items above.
- **The owner wants to merge by hand:** give the dry run's order and the two rules (no squash, delete the source branch), once.

## 4. At the end

Say what is merged and what is not, then the deploy and production test the items need, in one list. Then `git pull` in the project folder (it removes merged worktrees), and `carja loop <project>` when items are left to build.
