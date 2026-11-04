---
name: git-worktrees
description: Use before interactive Spec-It, Build or Ship - work in the item's hidden worktree (carja work <item>); the owner's folder stays on its default branch
---

# Using Git Worktrees

## The rule

The owner's folder, and its nested code repository, stay on their **default branch**. Every item (a carved slice, a backlog item, a Quick-Path) is built on its own branch, in its own hidden worktree, and reaches the default branch only through a merged MR. Never switch the branch of the owner's checkout: another session may be working in it, and its next commit lands on your branch.

The `pre-commit` hook enforces it: a commit of code on the default branch is refused (only Carja's own files, such as `carja/`, may still be committed there).

**Announce at start:** "Working in the item's worktree."

## Make or reuse the item's worktree

```bash
carja work <project>/<NN-slice>     # a carved slice, e.g. cop-availability/01-cockpit-access
carja work <backlog item name>      # a backlog item or a Quick-Path
```

(When `carja` is not on PATH: `npx -y github:charlus/carja work …`.)

It prints the folder. It:

- makes `.agents/.worktrees/work-<slug>` on branch `carja/work/<slug>`, from the default branch (`origin/HEAD`), never from the branch the owner has checked out. The folder is git-excluded.
- in the outer layout, makes a worktree of each nested code repository inside it (`<folder>/repo/`, same branch name, from the code repository's default branch), and runs `loop.setup` there once.
- reuses both when they exist. Spec-It, Build and Ship of the same item share one worktree and one branch.

Then **edit, test and commit only under that folder** (`cd` into it for every shell command, give file tools its absolute paths). The `carja/` bookkeeping of the item is committed in the same worktree.

In a `carja loop` beat you are already in the item's worktree (the driver made it): do nothing here. `carja work` says so and makes nothing.

## Baseline

Before the first change, run the project's tests in the worktree (the `verify` command in `carja.config.json`, or the code repository's test command). If they fail before you touch anything, say so in one line and note it in the tracker: a red baseline hides new failures.

## Cleanup

Nobody removes a worktree by hand. A worktree whose branch is merged goes, with its local branch:

- on the owner's next `git pull` (the `post-merge` hook), in each repository;
- at the start of a `carja loop` run;
- with `carja work clean`.

Kept, with the reason: a worktree with uncommitted changes, one a live loop run holds, a branch with no commit of its own yet, and an outer worktree whose code worktree's MR is still open. `carja status` names merged worktrees still on disk, and warns when the owner's folder or a code repository is off its default branch.

## Red flags

- `git checkout <branch>` or `git switch` in the owner's folder: never.
- A commit refused with "code on the default branch": you are in the owner's folder. Run `carja work <item>` and commit there.
- `git worktree add` by hand, or a worktree outside `.agents/.worktrees/`: the cleanup will not find it.
