# Implementation Plan: [Implementation Name]

**Implementation:** [NN-Name]
**Status:** Not Started | Specced | In Progress | Complete
**Feature Spec:** [Link to Feature-Spec.md]

---

## Technical Approach

[High-level strategy — how are we going to build this? What patterns are we using? Why this approach?]

---

## Technical Considerations

*Before implementing, confirm:*

- [ ] Reviewed existing codebase for similar patterns
- [ ] Reusing existing utilities/components where possible
- [ ] Approach aligns with current architecture
- [ ] Identified potential impacts to other features
- [ ] Not introducing unnecessary technical debt
- [ ] If debt is unavoidable, it's documented in Trade-offs section

---

## Files & Components Affected

*What parts of the codebase will this touch?*

### New Files
- `path/to/new/file.ts` — [Purpose]
- `path/to/new/component.tsx` — [Purpose]

### Modified Files
- `path/to/existing/file.ts` — [What changes]
- `path/to/existing/component.tsx` — [What changes]

### Components
- `ComponentName` — [New | Modified] — [Purpose/Changes]

---

## Data Model Changes

*Schema changes, new entities, modified fields.*

### New Entities
```
EntityName {
  id: string
  field1: type
  field2: type
  createdAt: DateTime
  updatedAt: DateTime
}
```

### Modified Entities
- `ExistingEntity` — Add `newField: type` — [Reason]

### Migrations Required
- [ ] [Migration description]

---

## API Changes

*New endpoints, modified endpoints, removed endpoints.*

### New Endpoints
| Method | Path | Purpose |
|--------|------|---------|
| POST | `/api/resource` | [What it does] |
| GET | `/api/resource/:id` | [What it does] |

### Modified Endpoints
- `GET /api/existing` — [What changes]

---

## Technical Risks

**Current:**
- [Risk for this implementation and how we're mitigating it]

**Future:**
- [Risk to be aware of down the road / scaling concerns]

---

## Trade-offs

- **[Chosen Approach]** over **[Alternative]** because **[Reasoning]**
- **[Chosen Approach]** over **[Alternative]** because **[Reasoning]**

---

## Execution Phases

### - [ ] Phase 1: [Phase Name]
- [ ] Step 1: [Atomic, testable action]
- [ ] Step 2: [Atomic, testable action]
- [ ] Step 3: [Atomic, testable action]

**Verification:**
- [ ] **Functional:** [How the user can test this in the UI/App]
- [ ] **Technical:** [How to verify in DB, Logs, or via automated tests]

---

### - [ ] Phase 2: [Phase Name]
- [ ] Step 1: [Atomic, testable action]
- [ ] Step 2: [Atomic, testable action]

**Verification:**
- [ ] **Functional:** [How the user can test this in the UI/App]
- [ ] **Technical:** [How to verify in DB, Logs, or via automated tests]

---

### - [ ] Phase 3: [Phase Name]
- [ ] Step 1: [Atomic, testable action]
- [ ] Step 2: [Atomic, testable action]

**Verification:**
- [ ] **Functional:** [How the user can test this in the UI/App]
- [ ] **Technical:** [How to verify in DB, Logs, or via automated tests]
