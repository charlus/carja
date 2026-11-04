# Ship Log

A chronological record of everything you've shipped. Your victory log.

---

## Why Keep a Ship Log?

- Builds momentum - seeing progress motivates more progress
- Provides context - "when did we add X?" is always answerable
- Celebrates wins - shipping is hard, mark it down

---

## How to Use

The Ship workflow appends one entry per shipment, newest last, **before** it creates the MR. The last three lines are the minimal retrospective: one line each, from what actually happened. `none` is an honest answer. An invented lesson is worse than none.

```markdown
## [Date] — [Implementation Name]
- **What:** [One sentence summary]
- **Quality:** [tests added, independent review verdict]
- **Platform:** [MR/PR link]
- **Surprised:** [What did not match the spec, the docs, or the assumption we built on]
- **Next time:** [What we would do differently, or `none`]
- **Framework lesson:** [What Carja's workflows, skills or hooks should change, or `none`]
```

`grep -h "Framework lesson" carja/0-compass/ship-log.md` lists everything this project has to teach the framework. The full Retrospective workflow is still there for a project-level look back; this entry is the floor, not the ceiling.

---

## Your Ship Log

(Entries are appended below by the Ship workflow.)
