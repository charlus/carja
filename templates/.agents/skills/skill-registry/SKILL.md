---
name: skill-registry
description: Manages Carja skills from the remote registry — install, remove, search, and list skills using the carja CLI. Use during Technical Vision workflow or whenever the tech stack changes.
---

# Skill Registry Management

> This skill teaches you how to manage dynamic skills using the `carja` CLI. Use it during **Technical Vision** (to install skills matching the chosen tech stack) or anytime the project's needs change.

## Prerequisites

- `glab` CLI installed and authenticated (`glab auth login --hostname <your-gitlab>`)
- `carja.config.json` in the project root with the registry URL:

```json
{
  "registry": "https://your-gitlab-instance.com/group/skills-registry"
}
```

## When To Use

### During Technical Vision (Primary Flow)

After the tech stack is decided — whether from user input during genesis or from analyzing an existing codebase — search the registry for matching skills and install them:

```bash
# 1. Search for skills matching the chosen technologies
carja search react
carja search python
carja search --tag data-engineering

# 2. Install relevant skills
carja add react-best-practices
carja add django-patterns

# 3. Verify installation
carja list
```

### On Existing Projects

If `carja init` detected a tech stack, it will have printed recommendations. Follow up by installing the suggested skills.

### When Tech Stack Changes

When the project adopts a new technology (e.g., adding Docker, switching to Next.js), search the registry and install relevant skills.

## Commands

### `carja add <skill-name>`

Downloads a skill from the registry into `.agents/skills/`.

```bash
carja add <skill-name>
carja add <skill-name> --registry <url>   # Override registry URL
```

**What it does:**
1. Checks `glab` auth
2. Fetches `registry.json` from the registry
3. Downloads the skill folder via GitLab's archive API
4. Extracts to `.agents/skills/<Skill-Name>/`
5. Validates `skill.json` + `SKILL.md` exist

### `carja remove <skill-name>`

Removes an installed skill.

```bash
carja remove <skill-name>
carja remove <skill-name> --force   # Required for core skills
```

Core skills (bundled with the framework) are protected — they require `--force` and will be restored on `carja upgrade`.

### `carja list`

Lists installed skills or browse the full registry.

```bash
carja list                        # Local skills
carja list --remote               # Registry skills (✓ = installed)
carja list --tier tech-vision     # Filter by tier
carja list --tier domain
```

### `carja search <query>`

Searches the registry by name, description, tags, and tech stack.

```bash
carja search react              # Find React-related skills
carja search --tag debugging    # Filter by tag
carja search --tier domain      # Filter by tier
carja search python django      # Multi-word query
```

## Skill Tiers

| Tier | Where | When |
|------|-------|------|
| **Core** | Bundled in framework | Always available |
| **Tech Vision** | Downloaded from registry | When tech stack is defined |
| **Domain** | Downloaded from registry | For industry verticals (finance, healthcare, etc.) |

## Workflow Integration

After installing skills, they are immediately available in `.agents/skills/` and will be discovered by the AI agent. No restart or reconfiguration needed.

### Recommended flow during Technical Vision:

1. **List what's available**: `carja list --remote`
2. **Search by tech stack**: `carja search <technology>`
3. **Install matches**: `carja add <skill-name>`
4. **Verify**: `carja list` — confirm skills are installed
5. **Continue** with the Technical Vision workflow — new skills are now active
