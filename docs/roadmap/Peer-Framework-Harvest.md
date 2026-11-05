# Peer-Framework Harvest (ECC) — F1–F15

> **Status:** merged, PR #33 (`a6bdea1`, 2026-09-24); CHANGELOG, README and
> `how-it-works.md` updated in the follow-up. Shipped: F9/F11/F12, F7, F3, F1
> (measured), F4 (both slices), F15. F8 and F10 deliberately unbuilt; F6 dropped;
> F2, F5, F13, F14 parked. Three independent review rounds found 18 blockers, all
> fixed. Two commits are author-verified only: `cbbd024` (decision D3) and `d224e38`
> (the self-committing upgrade, requested after review closed).
>
> **Source:** a source audit of **ECC** (`github.com/affaan-m/ecc`, `ecc-universal`
> 2.2.1, read at `bf70150`, 2026-09-22) — 68 agents, 292 skills, 94 command shims,
> ~53 hook scripts, adapters for 7+ harnesses, 320 test files, an 80% coverage gate.
>
> **The finding that mattered** was not a feature to copy. It was that ECC's
> `loop-design-check` names five ways an agent loop misfires, and Conductor was
> open to three of them. Our own envelope had holes we had not looked for because
> we were looking at theirs. Everything shipped here closes one of ours.
>
> **Not verified:** nothing in ECC was executed. Every claim about it is from
> reading source. Our own three gates are proven by behaviour tests that install
> the real hooks into a temp repo and run real `git`. Both PreToolUse hooks
> were run in a live Claude Code session on 2026-09-24 (§6). Still unverified:
> the `perl` timeout fallback on macOS, the modern `merge-tree` path, and
> conflict prediction in a real swarm run.

---

## 1. What ECC actually is, and what it is not

A **toolbox and distribution play**, not a methodology. The pitch —
`plan → test → implement → review → verify → remember → improve` — sits over a
pile of skills rather than a lifecycle. Its canonical loop skill
(`continuous-agent-loop`) is 46 lines of ASCII diagram and bullet lists. There
is no PR-gated merge, no evidence rule and no sandbox gate in code.

Two corrections to a first, shallower read of the repo, both worth recording
because they cut in opposite directions:

- **The hook layer is the best-engineered part**, not an advisory afterthought.
  GateGuard denies through Claude Code's JSON `permissionDecision` protocol
  (which an exit-code grep misses), keeps per-session state with atomic writes
  and a 30-minute reset, classifies destructive commands quote-aware, and is
  covered by a 3,120-line behaviour test.
- **The sophisticated libraries have no consumers.** `eval-harness/` — a
  hash-linked capsule journal, effect classes SE0–SE4, offline receipts, replay
  fixtures — is referenced only by its own skill. `agent-proximity/` is computed
  and served to a read-only view; the TCAS hook that would act on it is a design
  doc that opens "nothing in this document is implemented". Read the repo as:
  hooks and installer are the product, `lib/` is one person's R&D.

Also true: 292 skills validated for YAML frontmatter only; roughly a third are
one person's client work published as skills (energy procurement, customs
compliance, visa translation, a "taste" skill for hyperpop music videos).
GateGuard's headline "+2.25 points vs ungated" is two tasks scored out of ten.

**Where Conductor is ahead**, verified by reading both: our evidence ledger is a
*gate* (the child's exit code is always the wrapper's, `cmd_sha256` + `wtree`
binding, machine-local, per-branch) where their capsule is a *journal*. Our
driver already has stall detection, a wall-clock budget, refund-on-no-work and a
propose-only improver — what their GAN harness and `loop-design-check` prescribe.
Rubric v2 and their reviewer's Pre-Report Gate converged on the same rules
independently. Always-on context: our 16.4 KB ceiling against their ~31 KB before
language rules. Their prompt-injection defence is a paragraph pasted into 67 of
68 agent files; ours is `src/loop/untrusted.js`.

---

## 2. The holes in our own envelope

Found by running ECC's loop-failure taxonomy against `src/loop/` and
`templates/.agents/hooks/`. All three are now closed.

### G1 — no Goodhart boundary (→ F9, shipped)

`pre-commit` proved a test *change* existed via `--diff-filter=ACM`. Deletions
are invisible to that filter, and adding `.skip(` **is** a change. `checker.js`
had no test-deletion or weakening check. So the two cheapest routes to "all
tests pass" were open, and so was a third: keep the test, remove what it proves.

This is `loop-design-check`'s failure mode 3 — *only gates on "all tests pass",
so the agent deletes the tests* — and it was live in our unattended loop.

### G2 — hook bypass was prose-only (→ F11, shipped)

`git commit --no-verify` skips every gate we install. Our defence was one
sentence in `hooks/README.md`. Our own `autocommit.js` uses the flag as a
reported backstop, which normalises it.

### G3 — no protected paths (→ F12, shipped)

Nothing stopped a maker beat editing `.agents/hooks/`, `.agents/rules/`,
`.agents/sandbox/` or `reviewer.md`. That is *Build may not edit the acceptance
conditions*, plus the self-modification red line, enforced nowhere.

---

## 3. What shipped (2026-09-22, `943fee5`)

| ID | Gate | Where | Test |
|---|---|---|---|
| F9 | Goodhart boundary | `hooks/lib.sh`, `hooks/pre-commit` | `test/hooks-boundary-gate.sh` G1–G9 |
| F12 | Protected paths | `hooks/lib.sh`, `hooks/pre-commit` | `test/hooks-boundary-gate.sh` P1–P7 |
| F11 | Hook-bypass blocker | `hooks/pretooluse-no-bypass.sh` | `test/hooks-no-bypass.sh` N1–N7, A1–A7, E1–E5 |
| F7 | Merge-conflict prediction | `src/loop/conflict.js`, `swarm.js`, `loop.js` | `test/loop-conflict.test.js` (16), `test/conflict-predict-real.sh` (8, real git), `loop-swarm.test.js` F7 (6) |
| F3 | Hook-registry drift | `test/hooks-registry-drift.test.js` | 7 checks across files, README and install-hooks |
| F1 | Fact gate (pre-action) | `hooks/pretooluse-fact-gate.sh` | `test/hooks-fact-gate.sh` (18) **+ a measured eval**, `test/evals/fact-gate-eval.mjs` |
| F4 | Review canvas, slice 1 | `src/review/`, `src/commands/review.js` | `test/review-canvas.test.js` (17) + an end-to-end run |
| F15 | Survey an inherited codebase | `src/survey.js`, `src/commands/survey.js`, `workflows/survey.md` | `test/survey.test.js` (26) + runs against two real repos |
| F4b | Anchored annotations + durable feedback | `src/review/store.js`, `canvas.js`, `server.js` | `test/review-canvas.test.js` (29) + a SIGKILL-and-replay run |

Three design decisions worth keeping:

1. **The boundary is independent of `CONDUCTOR_NO_TEST`.** That waiver means
   "this change has no test surface", which is not a licence to remove proof
   that already exists. Pinned by G9.
2. **Protected paths arm only once the enforcement surface is committed.** A
   fresh `conductor init` stages `.agents/` wholesale; blocking that would mean
   a new project can never make its first commit. You cannot weaken a gate that
   does not exist yet. Pinned by P4c — and this was found by a *regression in an
   existing suite*, not by the new tests.
3. **The bypass blocker fails open.** No node, unparseable stdin, unknown shape
   → exit 0. A hook that blocks on its own errors wedges every Bash call in the
   session. Pinned by E2/E3.

**Reach limit, stated not implied:** `PreToolUse` is a Claude Code mechanism, so
F11 guards one harness. On Codex and Antigravity the protection stays after the
fact — `autocommit.js` records a bypassed commit, `improver.js` surfaces the
recurring pattern. Detection, not prevention.

---

## 4. The rest of the backlog

### F1, and the only measured claim in this document

The fact gate shipped with an eval rather than an assertion, because ECC's
evidence for its GateGuard is two tasks scored out of ten by a judge. Measured
against `claude` 2.1.278, n=4 per arm, on a fixture whose target file is
imported by three files that each transform its value:

| Arm | Named the files its change affects |
|---|---|
| gated | 4/4 (100%) |
| control (`CONDUCTOR_FACT_GATE=off`) | 0/4 (0%) |
| sensitivity: two identical ungated arms | +25pp — the noise floor |

The effect is four times the noise. **n=4 is small**: the direction is
established, the magnitude is approximate. Re-run before quoting a number.

**Correction (7.1.0, harvest A9).** This measures a process, not an outcome.
ECC later measured the outcome of the same mechanism in a pre-registered study
of 336 billed trials: the benefit was not established (confirmatory run 25/48
against 18/48, p = 0.21) and the cost was 35–45% more turns and spend
(`docs/research/2026-10-16/ecc-aidlc-agentsmd-stitch.md`, I1). The gate stays
opt-in.

Three adaptations away from GateGuard, each deliberate: the edit gate asks for
the **failing test**, which puts red-before-green at the moment of action
instead of only at commit; the write gate asks **what already does this**,
turning F13's reuse-before-build from prose into code; and **routine Bash is
not gated**, because our loop runs many commands a beat and there is no
investigation to buy there. Denial dampening is imported as-is — identical
repeated denials push a model into a repetition loop.

**The eval's first version was worthless twice over,** and both traps are
cheap to repeat. It scored the gate against its own denied edit, so a gated run
always looked like it had edited before searching — the gate appeared to make
things 33pp *worse*. And the metric sat at the ceiling, with the control
already at 3/3, so no effect could show in either direction. Neither was
visible until a real run produced a result that made no sense. Full write-up in
`test/evals/README.md`.

**A hang found on the way.** The test that was only meant to check an
unwritable state dir found that `mkdirSync(recursive)` never returns for a path
under `/proc` on this kernel — so a hook sitting in front of every tool call
could wedge the session. Both PreToolUse hooks now bound themselves with
`timeout` and fail open on expiry. Relying on the harness's own timeout would
have made the failure mode "the session stalls" rather than "the gate stepped
aside".

### F15, and the four bugs only a real repo found

`conductor survey` collects the facts; `workflows/survey.md` interviews the
human for the why. Every defect in it was found by running it against a real
codebase, never by a test:

1. ECC keeps 320 tests in a central `tests/` tree, so grouping by path prefix
   called every source area untested.
2. Our own `test/loop-driver.test.js` → `src/loop/driver.js` naming defeated
   exact stem matching, so `src/loop` looked untested.
3. A stale worktree under `.claude/worktrees/` doubled every count and let the
   copy shadow the original.
4. The directory-name fallback was passed an iterator, so it worked for the
   first test file and nothing after it. The unit test had one file.

The fix that matters: coverage is attributed by what a test **imports**,
falling back to naming only when imports resolve nothing. This repo has both
`src/commands/evidence.js` and `src/evidence/`, which no name-based rule can
separate. That is the third time today a tidy fixture hid a real bug —
see [[tidy-fixtures-hide-bugs]].

### What F7 and F3 turned out to be

F7 shipped narrower than the roadmap entry and deliberately so. The worktree
*classifier* and *cleanup plan* were dropped: nothing in the loop would have
called them, and shipping a library with no consumer is the exact ECC failure
this document criticises. What shipped is the part with a caller — prediction
wired into the swarm's merge queue, so clean branches land while the colliding
one is escalated by name. The classifier can follow when something needs it.

F3 shipped as an *agreement* test rather than ECC's fingerprinted sidecar. We
have no `hooks.json` to mirror, and a content checksum that fails on every
legitimate edit gets regenerated without being read. It found real drift on its
first run: `CONDUCTOR_NO_BRIEF` and `CONDUCTOR_NO_REPORT` had been implemented
and undocumented since they shipped.

### F8 is blocked, and that is the finding

ECC computes proximity for agents that are **already running**, so their
working sets are observable. Our swarm chooses concurrency **before** anything
is edited, and a task carries no file scope — `normalizeTask` has none and
neither `carve` nor the harvester produces one. The metric has no input, and
building it anyway would produce exactly what this document criticises ECC for:
a well-engineered library with no consumer.

F7 already took the detectable half at merge time. Full reasoning, and the two
ways to unblock it (declare the scope — wrong, it trusts a self-report; or
observe the first beat — right, and not small), in
`docs/roadmap/Swarm-Collision-Admission.md`.

**Still open.**

| ID | What | Why it waits |
|---|---|---|
| F4 slice 2 | Element-anchored annotations, and feedback that survives an interrupted wait | Slice 1 ships the verdict loop; pointing at a paragraph is the next increment |
| F10 | PreCompact handoff snapshot into `1-workbench/` | Today `handoff` relies on the agent remembering to run it. Interactive-path change — needs care. |


**Parked or dropped.**

| ID | What | Call |
|---|---|---|
| F2 | Instincts: atomic YAML units, 0.3–0.9 confidence, scoped by hash of the git remote, promoted to global after 2+ projects | **Hold** until the review-convergence measurement closes. Adding a second unmeasured learning surface buys two unmeasured things. |
| F5 | `rules-distill`: find principles recurring across skills, distil into a rule file | Opportunistic — fold into whatever touches skills next. |
| F13 | Research-and-reuse step before net-new code | Prose only. Zero hits for "existing library" / "gh search" in our templates today. |
| F14 | Delete-zone for intentional removals | Prose only. Prevents re-creating something deliberately removed. |
| F6 | Rationalisation-tell regex in the Stop hook | **Dropped.** Four patterns, warn-only, trivially evaded. Not worth the surface. |

**Not importing:** the 292-skill catalogue, the seven-harness adapter layer, the
commercial direction (hosted scanning, org policy, SOC2 evidence packs). Breadth
is their product and would be our liability.

**One operational note if ECC is ever installed for real:** its `hooks.json`
embeds a minified plugin-root resolver that then executes node scripts from a
path discovered at runtime. Executable config with a hairy resolution path.

---

## 5. What independent review found (PR #33)

Three rounds, rubric v2, Opus reviewers. 6 blockers, then 7, then 3; every one
reproduced before it was fixed, and fixed by class with the reviewer's own
counterexample as the failing test.

The findings clustered in one place: the **client-side enforcement hooks**. Each
round found a new edge of the same question — can a git hook be bypassed? — and
that question has no terminating answer, because git runs the hooks from files
the agent can edit. It is the same unbounded-question failure recorded for the
review gate itself. The maintainer decided the standard twice rather than let it
run on: **D2**, the bypass blocker stops the ordinary bypass and states its limit;
**D3**, the round-3 blockers are fixed author-verified and merged without a
fourth round. The real backstop for a determined bypass is server-side — the PR
gate and the loop's Checker.

What the rounds caught that the author's own suites did not, in order of cost:
- a single `exit 0` in `lib.sh` switched every gate off, and the first fix for
  that still ran the working-tree copy first;
- any page on another localhost port could approve a review;
- the conflict predictor reported a false collision for any file containing
  marker text — breaking the one promise the module makes;
- four tests passed with the thing they were named for deleted.

And two regressions introduced by fixes, both caught: an anchored `rm` pattern
that stopped gating `sh -c "rm -rf …"`, and a timeout rounding that shelled out
to `awk` and gave perl `alarm ""` where awk was absent.

---

## 6. Live-session test of the PreToolUse hooks (2026-09-24)

`claude` 2.1.281, headless `claude -p` with `--allowedTools
"Bash,Edit,Write,Read,Grep,Glob"`, run against a fresh `conductor init --all`
project with both hooks in the project's `.claude/settings.json`, as the hooks
README documents. One session per scenario, so the fact gate's per-session
state starts empty each time.

| Scenario | Result |
|---|---|
| `git commit --allow-empty --no-verify` | Denied by `pretooluse-no-bypass.sh`. No commit made. |
| `git -c core.hooksPath=/dev/null commit` | Denied by `pretooluse-no-bypass.sh`. No commit made. |
| First Edit of `src/price.js` | Denied by the fact gate. The model searched the callers, wrote a failing test, confirmed it failed on the assertion, and the identical retry was allowed. |
| First Write of a new file | Denied, then the identical retry was allowed. |
| `rm -rf build` | Denied, then the identical retry was allowed. A changed command (`… && ls build`) was denied again, as designed. |
| `ls src && git status --short` | Not gated. |

The denial reaches the model as `PreToolUse:<Tool> hook error: …` followed by
the hook's full message, and the model acted on it in every case.

**Fixture trap.** The first run placed the test projects under `~/.claude/`.
Claude Code refuses every edit there as a "sensitive file", after the hook has
already allowed it, so the edit scenarios looked broken when the hook was not.
Live fixtures go under `/tmp`.
