---
name: domain-modeling
description: "Use when establishing or refining the shared vocabulary of the product — during Technical Vision, when naming entities or slices in Carve, when writing a spec, or any time a term is ambiguous or two people mean different things by the same word. Turns the static glossary into a living ubiquitous-language discipline."
category: core
---

# Domain Modeling (Ubiquitous Language)

> A model is only useful if everyone — human, agent, spec, UI, and code — uses the **same words for the same things**. This skill makes the domain vocabulary an active, maintained artifact instead of a glossary nobody updates.

Carja already ships a static `carja/4-context/meta/glossary.md`. This skill upgrades it into a *living* domain model and keeps the language consistent everywhere it appears.

## When to reach for this

- **Technical Vision** — before locking the data model, agree on what the entities *are* and what they're *called*.
- **Carve** — slice and folder names must use domain terms, not technical ones (`checkout` not `order-service-phase-2`).
- **Spec-It / Build** — a spec that invents a new word for an existing concept is a bug; catch it here.
- **Any conversation** where you notice a synonym, a homonym, or a term you can't crisply define.

## The Ubiquitous Language rules

1. **One term, one meaning.** If "user", "customer", and "member" are the same thing, pick one and retire the others. If they're genuinely different, define the difference.
2. **Name from the domain, not the implementation.** The word the business uses wins over the word the framework uses. `Subscription`, not `StripeRecord`.
3. **Same word everywhere.** The term in conversation = the term in the spec = the class/table name = the UI label. Divergence is drift; fix it at the source.
4. **Define by behavior and invariant, not just a noun.** "An *Invoice* is issued once, is immutable after issue, and always belongs to exactly one *Account*" beats "Invoice: a bill."
5. **Surface disagreement early.** When two stakeholders use a word differently, that's a modeling discovery, not a nuisance — capture both readings and force a decision.

## Active discipline (grill, don't transcribe)

Do not passively record whatever words appear. **Interrogate the language:**

- For each key noun the human uses: *"What exactly is a `<term>`? What can it do? What must always be true about it? What is it NOT?"*
- Hunt for **synonyms** (two words, one concept → canonicalize) and **homonyms** (one word, two concepts → split and rename).
- Ask *"who owns / creates / destroys this?"* to find relationships and lifecycle.
- Prefer proposing: *"I'll call this a `Booking` and treat `Reservation` as its alias — object if that's wrong."*

## The living artifact

Maintain **`carja/4-context/meta/domain-model.md`** (create it from the shape below on first use; keep `glossary.md` as the quick lookup table and keep the two in sync — a term added here is added there).

```markdown
# Domain Model

## Ubiquitous Language
| Canonical term | Means | Invariants / rules | Aliases retired | NOT |
|---|---|---|---|---|
| Booking | A held slot for one Guest | Exactly one Guest; cancellable until start | Reservation | An Order (payment is separate) |

## Entities & Relationships
- **Booking** —(belongs to)→ **Guest**;  —(has many)→ **Booking Change**
- (a one-line-per-edge list, or a small mermaid diagram if it clarifies)

## Bounded contexts (only if the product is big enough to need them)
- **Scheduling**: Booking, Slot, Calendar
- **Billing**: Invoice, Payment, Account  ← "Account" here ≠ "Account" in Auth

## Open questions / disagreements
- [ ] Is a "cancelled" Booking deleted or retained? (affects Guest history)
```

Keep it **lightweight** — a page, not a treatise. Add a bounded-contexts section only when the same word legitimately means different things in different parts of the product. Prefer prose and a term table over heavy UML.

## How it feeds the pipeline

- **Technical Vision** reads the domain model and makes its data model use these exact names.
- **Carve** names implementations and slices in domain terms; a slice that can't be named in the ubiquitous language is a sign the boundary is wrong.
- **Build** uses the same identifiers in code; a review finding of "this class name isn't in the domain model" is a real finding.
- **Retrospective** can surface new terms learned during the build back into the model.

## Verification

You have modeled the domain well when: every entity in the data model appears in the domain-model table with an invariant; no two rows mean the same thing; and someone new could read `domain-model.md` and use the product's words correctly. If a term in a spec or in code isn't traceable to this file, that's the gap to close.
