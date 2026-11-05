---
name: git-workflow
description: Core git workflow conventions — commit messages, branch naming, PR/MR descriptions. Use whenever committing, branching, or creating pull/merge requests.
---

# Git Workflow Conventions

## Purpose

Standard git conventions for all projects using the Carja Framework. Ensures consistent commit history, meaningful branch names, and structured PR/MR descriptions.

---

## Commit Messages — Conventional Commits

Use the [Conventional Commits](https://www.conventionalcommits.org/) format:

```
<type>(<scope>): <short description>

[optional body]
```

### Types

| Type | When to Use |
|------|-------------|
| `feat` | New feature or capability |
| `fix` | Bug fix |
| `docs` | Documentation only |
| `style` | Formatting, no code change |
| `refactor` | Code change that neither fixes nor adds |
| `test` | Adding or updating tests |
| `chore` | Build process, tooling, dependencies |
| `perf` | Performance improvement |

### Rules

1.  **Keep subject line under 72 characters**
2.  **Use imperative mood:** "Add user auth" not "Added user auth"
3.  **Scope is optional** but helpful: `feat(auth): add JWT refresh tokens`
4.  **Body explains WHY**, not what (the diff shows what)
5.  **Reference issues** when applicable: `Closes #42`

### Examples

```
feat(auth): add JWT refresh token rotation
fix(dashboard): prevent crash on empty dataset
docs: update API endpoint documentation
refactor(db): extract query builder into separate module
test(auth): add integration tests for login flow
chore: upgrade dependencies to latest versions
```

---

## Branch Naming

```
<type>/<short-kebab-description>
```

| Type | Pattern | Example |
|------|---------|---------|
| Feature | `feature/user-auth` | `feature/jwt-refresh-tokens` |
| Bug fix | `fix/empty-dataset-crash` | `fix/login-redirect-loop` |
| Chore | `chore/upgrade-deps` | `chore/ci-pipeline` |
| Docs | `docs/api-endpoints` | `docs/readme-update` |

### Rules

1.  **Lowercase kebab-case** for branch names
2.  **Keep it short** — 3-5 words max
3.  **Include the scope** when helpful: `feature/auth-jwt-refresh`

---

### Parallel sessions

Never switch the branch of a shared checkout: another session may be working in it, and its next commit lands on your branch. A new branch gets its own worktree (`.agents/skills/git-worktrees/SKILL.md`). The append-only logs (ship-log, inbox, review-log) merge with `merge=union` (set by `carja init` and `upgrade`), so parallel entries do not conflict.

## PR / MR Description Template

When creating a Pull Request (GitHub) or Merge Request (GitLab):

```markdown
## What
[One sentence: what does this change?]

## Why
[One sentence: what problem does it solve?]

## How
[Key technical decisions or approach]

## Testing
- [ ] Unit tests pass
- [ ] Integration tests pass
- [ ] Manual verification: [describe what was checked]

## Related
- Closes #[issue number]
- Implementation: [link to Feature Spec if applicable]
```

---

## When to Commit (During Build Workflow)

1.  **After each verified task** — not at the end of a batch
2.  **Message matches the task** — `feat(auth): create user model` maps to Task 1
3.  **Only commit passing code** — Verification Iron Law applies to git too
4.  **Don't bundle unrelated changes** — one commit per task

### Build Integration

During the Build workflow:
- Phase 1 (Execute Batch): Commit after each task verification passes
- Phase 4 (Ship & Close): Create PR/MR with the description template above
