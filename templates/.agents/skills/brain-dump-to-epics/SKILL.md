---
name: brain-dump-to-epics
description: Use this skill when the user asks to transform unstructured thoughts and ideas into structured Product Epics.
---

# Brain-Dump-to-Epics

**Goal:** Transform unstructured thoughts and ideas into structured Product Epics.

**Trigger:** "Refine my ideas", "Brain dump", "Turn this into epics"

---

## Input

Unstructured text - raw thoughts, ideas, feature requests, or chaotic notes from the user.

---

## Output

Formatted Epic block(s) ready to paste into `carja/3-product-areas/[area]/[area]-epics.md`:

```markdown
### [area]-E[XX]: [Action-Oriented Title]
- [ ] Completed

**The Problem:**
- **Who:** [The specific persona]
- **The Pain:** [The specific struggle]
- **Why it Matters:** [The impact]

**The Transformation:**
- **How the world changes:** [The desired future state]
```

---

## Protocol

1. **Check for duplicates** - Scan `carja/3-product-areas/` to ensure this epic doesn't already exist.
2. **Filter bugs/tasks** - If it's a bug or small task, tell user to add to `carja/2-backlog/task-backlog.md` instead. Stop.
3. **Ask for clarity** - If the "who" or "why" is missing, ask. Don't guess motivation.
4. **Extract the problem** - Identify the user and their pain.
5. **Define the transformation** - How does their world change after this?
6. **Format and place** - Output the epic block and recommend which Product Area it belongs to.

---

## Constraints

- Does not create PRDs or implementation plans (that's Workflows)
- Does not prioritize or sequence epics (that's Product Manager persona)
- Does not proceed if the "why" is unclear - asks first
- Splits multiple distinct ideas into separate epics
