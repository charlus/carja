---
name: writing-evals
description: "How to write an evalset for the non-deterministic surface of the app you're building — the LLM-calling features whose output a unit test can't pin down. Loaded when a task touches provider-calling code (the Eval-Driven Law's pre-commit gate requires an eval alongside it). Covers the three grading modes (rubric/LM-judge, property, reference) so 'we have no labelled data' is never an excuse."
category: core
---

# Writing Evals

> Tests verify the **deterministic** parts of a system: this input → that output. Evals verify the parts that are **not** deterministic: did the LLM's output meet the quality bar. A feature that calls a model can pass every unit test and still be wrong on the thing that matters — the generation. "It compiles and the tests are green" is exactly the false-confidence case. If the code calls an LLM, it needs an eval, not just a test.

This is the **Eval-Driven Law**, the non-deterministic counterpart to the Test-Driven Law. The `pre-commit` hook enforces it: staging code that calls a provider (`openai`, `anthropic`, `langchain`, …) with no evalset alongside blocks the commit (escape hatch: `CARJA_NO_EVAL="reason"`, logged). This skill is the *how*.

## Scope — which evals these are

These evals cover **the LLM features of the app you are building** (a support bot, a RAG answer, a classifier, a summarizer) — Level B. They are NOT for evaluating your coding agent's own trajectory (out of scope), and NOT the same as Carja's `judge-panel`/`independent-review`, which review Carja's *own* artifacts. If the thing you ship makes a model call whose output a human would judge, it needs an eval here.

## Where evals live

Alongside the code, discoverable by the gate: an `evals/` directory, or a `*.eval.*` / `*.evals.*` file next to the feature (`answer.eval.ts`, `rag.evals.json`, `evals/classify_test.py`). Keep them runnable in CI — an eval that never runs is documentation, not a gate.

## The three grading modes

Pick per case. **You almost never need a labelled golden dataset** — that objection kills more eval coverage than any other, and modes 2 and 3 don't need one.

### 1. Reference-based (needs golden outputs)
Compare the output to known-correct answers. Use when the task has a defensible ground truth: a classifier's label, an extraction's fields, a routing decision.
- Metric: exact match, F1, or a similarity threshold.
- Cost: you must curate and maintain the labelled set. Reserve it for the cases that genuinely have one right answer.

### 2. Rubric + LM-judge (no golden set) — the workhorse
Score the output against **written criteria** using a model as the judge. Use when quality is real but not a single string: an answer's helpfulness, faithfulness to sources, tone, refusal-when-it-should.
- Write the rubric explicitly — *an eval without a clear rubric measures nothing.* Name the dimensions (task success, groundedness, safety, format) and what each score means.
- Guard the judge: pin its model/version, give few-shot anchors, and spot-check the judge against a handful of human labels so the watcher is itself checked.

### 3. Property / assertion-based (no dataset at all)
Assert invariants the output must always satisfy, regardless of content. The cheapest and most underused mode.
- Examples: valid JSON / schema-conformant; cites only real packages (no hallucinated imports); no PII leaked; every claim carries a source; length/latency/cost within budget; refuses a disallowed request.
- These run like unit tests but over generated output, and catch the failure modes that "looks right" hides.

Most features want a **mix**: a few property assertions (mode 3) as a hard floor, plus a rubric-judged set (mode 2) for quality, and reference cases (mode 1) only where a ground truth truly exists.

## How to write one (the loop)

1. **State what "correct" means** for this feature in one sentence — that sentence becomes the rubric's top line.
2. **Collect ~10–30 representative inputs**, including the edge cases a human reviewer worries about (ambiguous, adversarial, empty, out-of-scope). Breadth beats volume early.
3. **Choose the grading mode(s)** per the above. Start with property assertions; add a rubric where quality is subjective; add references only where ground truth exists.
4. **Make it run in CI** and fail loudly below the bar. An eval that only runs locally is not a gate.
5. **Grow it from failures** — when a real bad output ships, add it as a case so it can't regress. The eval set is a living regression suite for the non-deterministic surface.

## Anti-patterns

- **Demo-as-eval.** One happy-path example proves it can succeed once, not reliably. Set the bar at the eval, not the demo.
- **Rubric-less judging.** "Ask GPT if it's good" with no criteria measures nothing and drifts.
- **Golden-set paralysis.** Waiting for a labelled dataset before writing any eval. Ship property assertions today.
- **Eval that never runs.** If it's not wired into CI, it's a doc; the gate wants a runnable set.

## Composition

- Runs **alongside** the Test-Driven Law — the LLM feature needs both a test (the deterministic glue: routing, parsing, error paths) and an eval (the generation). The `pre-commit` gate enforces each independently.
- For non-deterministic output *inside Carja's own workflows*, see `skills/judge-panel/SKILL.md` and `skills/independent-review/SKILL.md` — same spirit (rubrics + LM-judges), different target.
