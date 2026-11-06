# Reviewer Calibration Set (Rubric v2)

> Few-shot cases that pin the reviewer's judgement to the rubric in `reviewer.md`.
> Load them **with** the brief when a review matters (a shippable diff, a loop beat);
> skip them for a cheap pass. They exist because an LLM judge drifts in **both**
> directions and the two failures look nothing alike:
>
> - **Over-rejection** — every round finds something, the change never ships. Cured by
>   the evidence bar (quote + confidence ≥ 7) and the exclusion list.
> - **Under-rejection** — the reviewer finds a real defect, then talks itself into
>   "not a big deal" and approves. Cured by C1 and C5: a quotable defect in a blocker
>   class is a BLOCKER regardless of how small the fix is.
>
> **Recalibrate when the ledger says to.** `carja/1-workbench/review-log.jsonl`
> records each finding's disposition. A class the author dismisses most of the time is
> a rubric defect, not an author defect — add the case here and bump the rubric
> version. A reviewer that has never rejected anything is a broken gate, not a clean
> codebase.

---

### C1 — BLOCKER: quotable, in a blocker class, trivial to fix

Diff adds to `api/orders.ts`:

```ts
const rows = await db.raw(`SELECT * FROM orders WHERE customer = '${req.query.c}'`);
```

**Verdict:** `[BLOCKER] (confidence 10)`. Quotable, unparameterised interpolation of
request input, class = SQL injection. Sweep the class: the finding must list every
other `db.raw` with interpolation in the diff.

**Why it is a BLOCKER even though the fix is one line:** severity is about the defect,
never about the size of the remedy. "It's a small change, and the endpoint is internal"
is the under-rejection failure — do not take it.

---

### C2 — Not a finding: false positive killed by the quote rule

The reviewer suspects `session.user.email` may be undefined and is about to file
"missing null check before use".

It goes to quote the line where `user` is constructed — and that line sets `email` from
a non-nullable column, three lines up in the same diff.

**Verdict:** no finding. This is the most common false-positive class ("field X does not
exist / may be null"), and the quote requirement kills it: the lookup that produces the
quote is the lookup that shows the finding was wrong.

**If the reviewer could not find that line at all:** IMPORTANT at confidence 5, not a
BLOCKER. Never promote an unverified suspicion to confidence 7 to make it block.

---

### C3 — Not a finding: acceptance criteria met, more could be built

The spec's criteria are: *the export produces a CSV; empty result sets produce a
header-only file; a failure returns 500 with a message*. All three are implemented and
tested.

The reviewer notes the export is not paginated and will be slow past ~100k rows.

**Verdict:** no BLOCKER. Nothing in the definition of done asks for pagination and no
criterion is violated. File it as IMPORTANT with the quote and the reasoning so the
author can record it under Known gaps, and **APPROVE**.

**Why:** withholding APPROVE here is the routing error the rubric names. The change
satisfies what was asked; the next change can be asked for separately.

---

### C4 — BLOCKER: the test does not test what it claims

Diff adds:

```js
it("rejects an expired token", async () => {
  const res = await verify(expiredToken);
  expect(res).toBeDefined();
});
```

**Verdict:** `[BLOCKER] (confidence 9)`. Quotable. The assertion passes for a token that
verifies successfully, so it cannot fail for the reason the name claims — a reward-hacked
test, which is an explicit blocker class. Sweep: check whether other tests added in this
diff assert only `toBeDefined` / `not.toThrow` on a path whose failure mode is a value.

**Contrast with C6:** the defect here is that the test cannot detect its own subject, not
that its assertion could be stronger.

---

### C5 — BLOCKER: an architecture-checklist item is unsatisfied

`carja/0-compass/architecture-checklist.md` carries:

```
- [ ] every write to `payments` runs inside a transaction — check: rg -n "payments\.insert" | rg -v "trx"
```

The reviewer runs the `check:` command; it returns a line added by this diff.

**Verdict:** `[BLOCKER] (confidence 10)`, naming the failing checklist item in the
finding. The checklist is part of the definition of done, so an unsatisfied item is a
criterion not met — not a style preference, and not waivable by the reviewer.

---

### C6 — Not a finding: test-structure opinion

The reviewer wants to file: *"this test exercises three guards at once; split it and
tighten the assertions"*.

**Verdict:** no finding, at any severity. The test detects the defect it is named for.
"Could be tighter" is true of every assertion ever written, which is exactly why it
cannot terminate a review loop. A test that does **not** reduce product risk is closed
by deleting it and saying so, not by strengthening it.

---

### C7 — SCOPE: the definition of done is itself wrong

The criteria describe a soft-delete flag. Reading the diff, the reviewer sees the table
is replicated to a downstream warehouse that reads rows unfiltered, so soft-deleted
records stay visible to users of the report — the criteria as written cannot deliver the
stated intent.

**Verdict:** one finding titled `SCOPE:`, stating what the boundary should be and why,
routed to the human. Not repeated as instances. Not a BLOCKER unless what ships is
unsafe as it stands — here it is degraded, not unsafe, so the reviewer files `SCOPE:`,
approves the rest against the criteria that exist, and lets the human decide.

**Anti-pattern this replaces:** re-expressing "the spec is wrong" as a fresh
implementation finding every round, which makes the change unfailable and hides the one
question a human actually has to answer.

---

### C8 — IMPORTANT, not BLOCKER: real, but normal use does not reach it

Three findings from one review of a production app (the 2026-11-06 audit of 142 logged
blockers found 42 like these):

- Two writers editing the same target at once: the loser gets a 500 instead of a 409.
- A queue section with no empty-state text: an empty list shows a blank panel.
- A spec criterion worded "should" where the plan reads "must", and a builder would read
  both the same way.

**Verdict:** the first is `[IMPORTANT]`: a real defect, but only a race reaches it. The
second is `[NIT]` (ui). The third is not a finding: a competent builder resolves it one
way. None withholds APPROVE.

**Contrast with C1:** a quotable defect that normal use reaches is a BLOCKER however
small the fix. Severity follows who hits it, not how sure you are that it exists.
Naming, wording and documentation are never BLOCKERs: `carja review-log` refuses to
record one.
