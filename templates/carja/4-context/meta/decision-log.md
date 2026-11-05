# Decision Log

Important decisions and why you made them. When future-you (or your AI partners) wonder "why did we do it this way?" - this is where to look.

---

## How to Use This

When you make a significant decision, add an entry:

```
## [Date] - [Short Title]

**Context:** What situation led to this decision?
**Decision:** What did you decide?
**Reasoning:** Why this choice over alternatives?
**Consequences:** What does this mean going forward?
```

---

## Decisions

(Add entries below as you make important choices)

### [Date] - [Example: Chose Supabase over Firebase]

**Context:** Needed a backend database with auth.

**Decision:** Going with Supabase.

**Reasoning:** Postgres gives us more flexibility than Firestore. Row-level security is cleaner than Firebase rules. Better for analytics queries later.

**Consequences:** Locked into Postgres patterns. Need to learn Supabase-specific APIs.

---
