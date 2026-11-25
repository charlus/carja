# Robust Autonomy Backend (Ralph-hardened Loop Engine)

> **Status:** Shipped — Phases 1–4 feature-complete (2026-07-14). Only a published/maintained turnkey sandbox container image and a real-LLM CI run remain outside the code. (Spec-hardened 2026-07-14.) Since 7.11.9 (2026-11-25) `loop-state.json` holds the owner's settings only; the run's state lives in `.git/carja-loop-logs/loop-state.json` (`src/loop/run-state.js`).
> **Priority:** High — flagship of the V6 "Enforcement & Autonomy Rebalance"
> **Decision:** `docs/adr/0001-enforcement-and-autonomy-rebalance.md`
> **Builds on:** V5 Autonomous Loop Engine (`b953efc..bbe8f55`)
> **Extended 2026-09-03 (E1–E5):** the judge/Checker rubric is now **v2** — a BLOCKER requires a quoted line and confidence ≥ 7, and the bar is enforced in `src/loop/checker.js`, not just in prose. See `docs/roadmap/Review-Convergence-And-Harness-Alignment.md`.

> **Corrections applied (2026-07-14 spec-hardening pass).** A pressure-test against the V5 stub, both schema versions, the ADR, and the live `unattended-loop.md`/`loop-guardrails.md` surfaced contradictions and gaps that would have misled a Phase-1 implementer. Fixes folded in below: (1) the driver is the `conductor loop` subcommand everywhere — the old `scripts/run-conductor-loop.js` name is gone from the diagram, keep-table, and acceptance criteria; (2) the status-vocabulary unification now includes `maker_active` from the workflow; (3) the v2 schema is documented as a **migration**, not "additive"; (4–5) the **Checker is necessary-but-not-sufficient** — the red-exit floor is deterministic, judgment above it is the Checker's — and Phase 1 vs Phase 3 Checker responsibilities are split explicitly; (6) the stall signal drops the un-observable `last tool+args` component; (7) Phase 1 now includes **reconciling the soft layer** (`unattended-loop.md` must stop doing driver-owned bookkeeping); (8) the verify fallback **fails safe** instead of guessing `npm test`; (9) crash/resume atomicity is specified; (10) the Phase-1 safety boundary (stub-only until Phase 3's sandbox) is stated; (11) Phase 4 swarm is gated on **evidence**, not just phase order; (12) the autonomy slider's driver-visible collapse to two decisions is noted.

## Progress so far (already shipped — do NOT re-implement)

The **non-loop track** of ADR-0001 is done and in the tree (uncommitted as of 2026-07-14). A fresh agent should treat these as complete and build Phase 1 on top:

- ✅ **D5 slash-command bridge** (was Phase 2's first item) — `src/claude-commands.js`, wired into `init`/`upgrade`.
- ✅ **D2 loop-guardrails demotion** (was Phase 5) — `rules/loop-guardrails.md` is now `trigger: manual`, loaded by `workflows/unattended-loop.md` Step 0; `registry.json` + `check-conductor.sh` updated.
- ✅ **D1 interactive enforcement hooks** (was Deferred) — `templates/.agents/hooks/{pre-commit,pre-push,verification-stop-hook.sh,lib.sh}` + `conductor install-hooks`. **Reuse these:** the pre-push hook already resolves a verification command from `conductor.config.json`'s `verify` field via `conductor_verify_cmd()`. The driver's "Evidence Rule in code" (Phase 1) should read the **same** `verify` field so interactive and headless enforcement agree.
- ✅ **Registry supply-chain scanning** (was Deferred) — `src/skill-scan.js`, wired into `conductor add`.

**Remaining = the loop backend itself: Phases 1, 3, 4** (Phase 2's adapter interface minus the shipped bridge; Phase 5 minus the shipped demotion). That is what this document must be sufficient to build — see **Implementation handoff** below.

**Update (2026-07-14): the loop backend is feature-complete — Phases 1–4 all shipped, including the swarm, Codex adapter, and multi-vote Checker.** Q1/Q2/Q3 resolved. **The only excluded item is the turnkey published/maintained sandbox image** (Q2 chose document-only). The swarm is built but stays behind its evidence gate for real-world *use*. See **Remaining work** at the end of this document.

> **✅ Phase 1 shipped (2026-07-14).** The deterministic driver is live as the `conductor loop` subcommand over the pure `src/loop/driver.js`, with a thin Claude Code adapter (`src/loop/adapters/claude.js`). It owns the iteration ceiling, wall-clock budget, driver-observable stall detection, the Evidence Rule (verify exit code), the Scoping Barrier, and fail-safe verify resolution (mirrors `conductor_verify_cmd`). `loop-state.json` is v2 (auto-migrates v1 on load). The soft layer is reconciled (`unattended-loop.md` + `loop-guardrails.md` no longer do driver-owned bookkeeping). The V5 stub is deleted. Guarantees are proven by `test/loop-driver.test.js` (`npm run test:unit`, 11 cases incl. the lying-stub-agent tests) and `check-conductor.sh` §12 (96 checks). **Not yet done in Phase 1:** real headless runs are gated behind Phase 3's sandbox — `conductor loop` refuses to run against a live repo without `--unsafe-no-sandbox`. Phase 2's adapter *interface* is only partially realized (the Claude adapter exists; a formal multi-platform interface + auto-detect + Codex/Antigravity adapters remain).

## Vision

Turn the V5 Loop Engine from a **prose-driven** headless workflow into a **deterministically-driven** autonomy backend, modelled on Geoff Huntley's Ralph loop (`while :; do cat PROMPT.md | agent; done`) but hardened with Conductor's Maker/Checker split, Scoping Barrier, and a real host-side control loop.

**One engine, pair → swarm.** The same backend runs a simple Maker/Checker pair (default) *and* a swarm of specialized agents (opt-in, L3) — the difference is configuration, not code (see "Role model" below).

**Claude Code first.** The framework was originally built for Antigravity (`run-conductor-loop.js` hardcodes `antigravity run`); Claude Code is now the primary target. The driver is refactored behind a platform-adapter interface with the Claude Code adapter (headless `claude -p` + native `/loop`) shipped first.

The governing rule (from ADR-0001): **the host runner is the authority; the agent is a fallible worker.** Anything that must always happen — iteration limits, stall detection, "success = green tests" — lives in code the agent cannot reason around, per Anthropic's *"hooks are deterministic, instructions are advisory."*

## What V5 already ships (keep)

| Asset | Role | Verdict |
|---|---|---|
| `personas/maker.md` + `personas/checker.md` | Generator / independent verifier split | **Keep** — matches Ralph + obra + "verification is load-bearing" |
| `workflows/unattended-loop.md` | Agent-facing state machine + Scoping Barrier | **Keep**, tighten (below) |
| `rules/loop-guardrails.md` | Iteration ceiling, anti-stall, Evidence Rule (prose) | **Keep as guidance**; ✅ already demoted `always_on` → loop-scoped |
| `conductor/1-workbench/loop-state.json` | "The Spine" — durable external state | **Keep**, extend schema |
| `scripts/run-conductor-loop.js` | Host runner (V5 stub) | **Port intent, then delete** — replaced by the `conductor loop` subcommand (`src/loop/driver.js`); it's the fatal gap |
| `CLAUDE.md` native `/loop` block | Claude Code entry point | **Keep** as the L1/L2 interactive path |

## The gap V5 leaves (fix)

The V5 runner is a stub. It runs **one** beat, hardcodes `antigravity run …`, and enforces **nothing** — the iteration ceiling, anti-stall, and Evidence Rule are prose the agent is trusted to obey. Ralph's whole point is that the *loop and its limits live in the driver*, not in the model. Additional gaps:

1. No actual loop (no `while` / re-invocation).
2. No deterministic verification — nobody runs the test command and checks the exit code.
3. No deterministic stall detection (git SHA / test-output deltas between beats).
4. Platform lock-in (`antigravity` hardcoded) + typo `CONDUCUTOR`.
5. No sandbox; unattended shell access with no isolation (survey §5 mandates it).
6. Checker "independence" is prose, not a separate fresh-context process.
7. Auto-merge to a branch with no PR/clean-state gate.
8. State-schema drift across **four** surfaces: `loop-guardrails.md` writes `status: max_iterations_exceeded`; `unattended-loop.md` writes `status: maker_active`; the runner only checks `completed`/`stalled`; defaults use `idle`/`stalled`/`completed`. Unify all four onto the single vocabulary in the state-machine table below.
9. `telemetry.tokens_spent` is never populated; no time/token budget cap.

## Architecture

```
conductor loop  →  src/loop/driver.js  (the deterministic DRIVER = scheduler + authority)
        │  reads/writes  ┌───────────────────────────────────────────┐
        ├───────────────▶│ conductor/1-workbench/loop-state.json      │
        │                │   THE SPINE = task-graph blackboard        │
        │                │   tasks[]: {id,type,status,deps,role,       │
        │                │             worktree,evidence}             │
        │                └───────────────────────────────────────────┘
        │  enforces: frontier scheduling · concurrency cap · per-task ceiling/stall
        │            · global token+wall-clock budget · Scoping Barrier · clean-git · merge queue
        │
        ├─▶ dispatch frontier task → specialized MAKER   ── isolated worktree + SANDBOX, headless
        │      (archetype=maker + persona + type filter)
        │
        ├─▶ verify(task.verification_cmd) → exit code     ── THE Evidence Rule, in code (not prose)
        │
        ├─▶ specialized CHECKER (SEPARATE fresh process)  ── true independence, not an in-context sub-agent
        │
        └─▶ PlatformAdapter  claude(first) | codex | antigravity   ── swappable; owns the CLI invocation only
```

The agent still reads `unattended-loop.md` + Maker/Checker personas each beat (soft layer). The driver is the hard layer: even if the agent ignores every rule, the driver stops at the ceiling, halts on a stall, refuses to advance state on a non-zero verification exit, and never merges outside the queue.

## Role model: pair → swarm (ADR-0001 D4)

Three primitives make the same engine span N=2 to N-large:

1. **Two archetypes only** — *Maker* (produces) and *Checker* (verifies). No third archetype; the generator–verifier duality is the guarantee.
2. **Specialization = archetype + persona + task-type filter.** The existing 10 personas become the **specialization roster**. Examples: `db-maker` (Maker + Database Architect, claims `schema|migration`), `security-checker` (Checker + Security Auditor, audits `auth|middleware` diffs), `ui-maker` (Maker + Designer, claims `component|style`).
3. **Task-graph blackboard + deterministic scheduler.** Carve already emits dependency-noted vertical slices → that is the task graph. The driver computes the **frontier** (unblocked + unclaimed), dispatches to matching Makers up to a concurrency cap, routes results to matching Checkers, and serializes merges through a PR-gated queue. Coordination is stigmergic (read/write the blackboard); agents never talk to each other.

Scaling is configuration:

```jsonc
// pair (default, L1)                     // swarm (opt-in, L3)
"roles": ["maker","checker"],             "roles": ["db-maker","logic-maker","ui-maker",
"concurrency": 1                                    "security-checker","quality-checker"],
                                          "concurrency": 4
```

**Risk:** swarms amplify bad task decomposition — parallel garbage compounds. Mitigation is upstream: Carve/blueprint quality + the single design-time sign-off (D2) is where the human validates the slicing *before* the swarm runs; the Checker layer + PR gate catch bad output after.

## Phased plan

### Phase 1 — Deterministic driver (the core; no new platforms yet)
Build the `conductor loop` subcommand over `src/loop/driver.js` (see *Where the driver lives*) as a real control loop that owns the guarantees. Port the intent of `scripts/run-conductor-loop.js`, then delete it.
- **Loop:** `while state.status not terminal AND state.iterations.current < max_allowed`. Increment the counter **in the driver**, not the agent.
- **Evidence Rule in code (the floor):** after a `maker`/`checker` beat, the driver resolves the verify command (see fallback below), runs it itself, and captures exit code + output. Non-zero ⇒ **force** `rejected_by_checker` — this is a hard, non-negotiable floor the agent cannot argue past. Exit `0` is **necessary but not sufficient**: it only makes the task *eligible* for `passed_by_checker`; the Checker's judgment (Phase 3) still runs above the floor and may reject green-but-wrong work. In Phase 1, with no LLM Checker yet, the driver's own green exit *is* the pass (deterministic-only; see the state machine and *the beat contract* for the Phase 1 vs Phase 3 split). The agent's self-assessment is advisory only.
- **Verify command resolution (fail-safe, mirrors the pre-push hook exactly):** `state.verification.command` → else `conductor.config.json` `verify` → else `npm test` **only if `package.json` declares a `test` script** → else **halt with `halted_no_verification`** (terminal). This is byte-for-byte the resolution order in the shipped `conductor_verify_cmd()` (`hooks/lib.sh`), so interactive (pre-push) and headless (driver) enforcement agree. The key doctrine: never *blindly* guess `npm test` in a project that doesn't declare it (Conductor installs into any language) — but do honor a declared test script, and otherwise refuse to claim success without a real signal.
- **Stall detection in code (driver-observable only):** hash `(git rev-parse HEAD, verification output)` at beat end; if unchanged vs the previous beat, increment `stall.consecutive`; at 3 → `stalled`, write `inbox.md`, exit. The V5 `last_tool+args` component is **dropped** — it lives inside the `claude -p` process and is not observable to the driver without agent self-report, which is exactly what Phase 1 removes. (If tool-level granularity is ever wanted, parse `--output-format stream-json` — deferred, not needed for a correct stall signal.)
- **Scoping Barrier in code:** refuse to start if `phase == "discovery"`; print the human-requirements request and exit with `halted_scoping`.
- **Clean-git precondition:** abort a beat if the worktree is dirty in an unexpected way; never merge with conflicts.
- **Unify state schema + fix typo:** single status vocabulary from the state-machine table below (terminal: `completed` | `awaiting_review` | `stalled` | `max_iterations_exceeded` | `budget_exceeded` | `halted_scoping` | `halted_no_verification` | `halted_sandbox_required` | `halted_autonomy`); reconcile **all four** surfaces — `loop-guardrails.md`, `unattended-loop.md` (drop `maker_active`), `loop-state.json`, and the driver. Fix `CONDUCUTOR`→`CONDUCTOR`.
- **Reconcile the soft layer (not just add the hard one):** `unattended-loop.md` Step 1 currently instructs the agent to *increment `iterations.current`* and *check `consecutive_stalls`* — both now owned by the driver. Edit the workflow so the agent stops performing driver-owned bookkeeping (otherwise: double-increment / contradictory ownership). The workflow keeps the *judgment* steps (which persona, what to build); the driver keeps the *counters and gates*.

**Template files that change in Phase 1 (not just new `src/` code):**
| File | Change |
|---|---|
| `templates/.agents/workflows/unattended-loop.md` | Remove agent-side counter increment + stall check from Step 1 (driver owns them); drop `maker_active` writes in Step 2 (use `current_worker`); keep persona-selection + build judgment. |
| `templates/.agents/rules/loop-guardrails.md` | Reframe iteration-ceiling / anti-stall / Evidence Rule from "agent MUST set `status`…" to "the driver enforces this; if running interactively without the driver, honor it as guidance." Statuses cited must match the unified vocabulary. |
| `templates/conductor/1-workbench/loop-state.json` | Replace v1 with the v2 schema (below); this is the shipped default new installs get. |
| `templates/.agents/tests/check-conductor.sh` | Add a section asserting the driver module + v2 schema fields exist (see test harness). |
| `scripts/run-conductor-loop.js` | Delete after porting intent. |
| `src/loop/driver.js`, `src/commands/loop.js`, `src/cli.js` | New driver module + subcommand, routed like `install-hooks`. |
- **Budget:** add `budget: { max_beats, max_wall_clock_min, tokens_spent, started_at }`; driver enforces wall-clock + beat caps even if the agent misreports tokens.
- **Crash/resume:** the driver resumes from `loop-state.json` on restart (it is the durable Spine). State writes are **atomic** (write temp + `rename`) so a kill mid-beat never leaves half-written state; a beat interrupted before its state write is simply retried on resume.
- **Safety boundary (important):** Phase 1 ships with **no sandbox** (that is Phase 3). A driver that loops `claude -p` unattended *is* unattended shell access — the very thing the survey (§5) and gap #5 prohibit. Therefore Phase 1 is exercised **only via the stub adapter in `node:test`**; real headless runs against a working repo are gated on Phase 3's sandbox. Ship Phase 1 with a loud runtime warning if invoked against a live repo without a sandbox.
- Tests: unit-test the driver's state machine and guardrail math with fixture `loop-state.json` files (Node's built-in `node:test`).

### Phase 2 — Platform adapter interface (Claude Code first)

> **✅ Phase 2 shipped (2026-07-14).** The adapter interface is formalized and the driver is fully platform-agnostic — the hardcoded `antigravity run` is gone. Registry + resolver in `src/loop/adapters/index.js` (contract: `name`, `isAvailable()`, `runBeat({promptPath,cwd,permissionMode})`, `runChecker()`); adapters for **Claude Code** (`claude.js`, primary) and **Antigravity** (`antigravity.js`, demoted to a peer). Selection order: `--platform <name>` flag → `loop-state.json.platform` → auto-detect by CLI availability (Claude first). Explicit-but-unknown / explicit-but-unavailable platforms error loudly (no silent fallback). Pure selection logic covered by `test/loop-adapters.test.js` (7 cases). The slash-command bridge (below) was already shipped. **Still open:** Codex adapter (deferred until the interface proves out) and a headless permission-mode audit per platform (currently `acceptEdits`).
- **Slash-command bridge (shipped first, ADR-0001 D5):** `init`/`upgrade` generate a thin `.claude/commands/<name>.md` shim per `.agents/workflows/*.md` so Conductor's workflows are invocable as native Claude Code slash commands (`/build`, `/carve`, …). Shims are derived from the workflow set (no drift) and only redirect to the real workflow file — the workflow stays the single source of truth shared with Antigravity. `/loop` is already native and needs no shim.
- Define the adapter interface: `runBeat(promptPath, {sandbox, permissionMode}) → {stdout, exitCode, tokens?}` and `runChecker(...)`.
- **Ship the Claude Code adapter first** (it is the primary target): headless `claude -p` with a scoped permission mode; wire to the existing `.claude/loop.md` / native `/loop` path. Phase 1's driver is built directly against this adapter.
- Reduce Antigravity to just another adapter (`scripts/adapters/antigravity.js`); add Codex later. Remove the hardcoded `antigravity run` from the driver.
- Select adapter via `loop-state.json.platform` or a CLI flag; default auto-detect.
- The adapter is deliberately minimal and BYO-CLI — directly answering Steinberger's "thin wrapper, no moat" critique (D7): the value is the driver's guarantees, not the wrapper or a GUI.

### Phase 3 — Sandbox & isolation (hard dependency for L3)

> **✅ Phase 3 shipped (2026-07-14).** Three pieces: **(1) Worktree isolation** — the Maker runs in a dedicated git worktree (`src/loop/worktree.js`, deterministic create/reuse/teardown; teardown keeps a worktree with unmerged commits for the human / Phase 4 merge queue and only removes clean ones). **(2) Sandbox gate (document-only, Q2)** — `sandbox: "none" | "container"` in state; the driver refuses L3 unless `sandbox == "container"` (terminal `halted_sandbox_required`, checked *before* the verify-config gate — safety first); a documented container profile ships in `templates/.agents/sandbox/` (README + `Dockerfile.sandbox`). Conductor never spawns containers itself. **(3) Independent Checker** — a separate fresh process (`.agents/workflows/loop-checker.md` + `src/loop/checker.js`) that audits a green diff and writes `checker-verdict.json`; the driver reads it as the verdict *above* the deterministic green floor (necessary-but-not-sufficient), failing safe to reject on a missing/malformed verdict. Covered by `test/loop-phase3.test.js` (12 cases). **Still open:** the container profile is a starting point, not a hardened image; multi-vote/adversarial Checker is still deferred.
- **Maker** runs in an isolated **git worktree** (V5 already calls `using-git-worktrees`; make the driver create/tear it down deterministically).
- **Process/network sandbox** for unattended runs: default-deny network, workspace-only filesystem, per-beat CPU/time limits (survey §5.1). Start with a documented container profile; expose `sandbox: none|container` with `none` disallowed at L3.
- **Checker as a separate process** with a fresh context (structural independence), not an in-context sub-agent.

### Phase 4 — Autonomy slider + swarm scaling + merge gating

> **✅ Phase 4 shipped (2026-07-14) — autonomy slider (L0–L3), PR-gated merge, multi-vote adversarial Checker, and the opt-in swarm (`src/loop/swarm.js`) are all live. `concurrency=1` reproduces the pair exactly.**
>
> **Shipped (buildable now, pair mode):**
> - **Autonomy slider L0–L3** enforced in the driver (`autonomyPreflight` + `describeHalt`): **L0** interactive-only (loop refuses to run headless); **L1** single beat then `awaiting_review`, never merges; **L2** multi-beat *blueprint only* (execution refused → `halted_autonomy`), no code merge; **L3** multi-beat execution in a sandbox with a PR-gated merge. `concurrency>1` is refused everywhere (`halted_autonomy`) because the swarm scheduler isn't built.
> - **PR-gated merge** (`src/loop/merge.js`): on L3 execution completion the driver pushes the worktree branch and opens a PR/MR via `gh`/`glab` (auto-detected) — **never a direct push to a protected branch**; a failed merge escalates to `awaiting_review` + inbox. Covered by `test/loop-phase4.test.js` (18 cases).
> - **Auditable action trail** (`deps.audit`): every run start, beat, verify/checker verdict, merge, and terminal status is appended to `conductor/0-compass/ship-log.md` (Karpathy's "auditable actions").
> - New terminal statuses: `awaiting_review` (clean human handoff) and `halted_autonomy` (policy refusal).
>
> **Swarm now also shipped (2026-07-14):** `src/loop/swarm.js` — task-graph blackboard, frontier scheduler, `roles[]` specialized resolution, `concurrency>1` parallel dispatch, per-task ceiling/anti-stall with a shared global budget, and the multi-worktree serialized PR-gated merge queue. Opt-in at L3 + `sandbox:container` + `concurrency>1` + a task graph; `concurrency=1` reproduces the pair (regression-tested). Also shipped: Codex adapter and the multi-vote adversarial Checker. See **Remaining work**.

> **Evidence gate — still binding for *running* it, not for building it.** The swarm is built, but it amplifies bad task decomposition (parallel garbage compounds — Karpathy's "overshooting the tooling w.r.t. present capability"). Do **not** rely on it for real tickets until pair mode (Phases 1–3) has driven several to green *unattended*. Building it ahead of that evidence was an explicit, requested decision; using it in anger remains gated by judgment. Prove the pair, then parallelize.

- Implement L0–L3 (ADR-0001 D3) as `loop-state.json.autonomy_level`; driver refuses actions above the set level. **Default L0/L1**; swarm/concurrency only unlocks at L3.
  - **Note the driver-visible collapse:** the four levels are a UX/comms taxonomy, but the *driver* makes only two decisions — "headless allowed at all?" (`phase != discovery`) and "may merge to a protected branch / run concurrently?" (`>= L3`). L1 (single-beat) vs L2 (blueprint-headless) are the same driver path with a different stop point. Implement two decisions, not four code paths.
- **Swarm scheduling (D4):** promote the Spine to the task-graph blackboard; implement frontier computation, `roles[]` + `concurrency` config, and specialized role resolution (archetype + persona + type filter) from the persona roster. Concurrency=1 reproduces the pair exactly (regression guard).
- **Merge queue:** parallel Makers each in their own worktree; the driver serializes merges, each gated by its specialized Checker (green) + a PR/MR (reuse `git-hub-cli`/`git-lab-cli`). Never a silent push to a protected branch; conflicts pause and escalate.
- Per-task ceiling/anti-stall; single global token + wall-clock budget pool across all concurrent roles.
- Log every autonomous action to `0-compass/ship-log.md` (human-auditable trail = Karpathy's "auditable actions").

### Phase 5 — Rebalance cleanup (from ADR-0001 D2)
- Demote `loop-guardrails.md` from `always_on` to loop-scoped (loaded by `unattended-loop.md`); update `registry.json` + `check-conductor.sh`.
- Sweep for per-step approval ceremony collapsible into a single design-time gate.

### Deferred (parallel track, lower priority)
- ✅ ~~Interactive-session hooks (Verification stop-hook + TDD pre-commit)~~ — **shipped** (see Progress so far).
- ✅ ~~Registry supply-chain scanning for downloaded `SKILL.md`~~ — **shipped** (`src/skill-scan.js`).
- Multi-vote / adversarial Checker for high-stakes tickets (survey's "verify with N skeptics") — still open.
- Codex adapter (after the Claude Code adapter proves the interface) — still open.

## Implementation handoff (read this to start Phase 1)

Everything a fresh agent needs to begin without re-deriving decisions. Where this section and the prose above differ, this section wins.

### Where the driver lives (resolves Open Q1)

**Decision: ship the driver as a `conductor loop` CLI subcommand** (`src/commands/loop.js`, routed in `src/cli.js` exactly like `install-hooks`), operating on the current project's `conductor/1-workbench/loop-state.json`. Rationale: the loop runs in the *user's* project, and Conductor is already an npm CLI — a subcommand means no per-project script copy and one code path to maintain (consistent with D7 "thin BYO-CLI driver"). The V5 `scripts/run-conductor-loop.js` is a throwaway prototype: port its intent, then **delete it** (and its `antigravity`/`CONDUCUTOR` typo). Keep the driver's pure logic (state machine, guardrail math) in a testable module (`src/loop/driver.js`) that the command thins over, so `node:test` can exercise it without spawning an agent.

### Target `loop-state.json` schema (v2)

The current file (`templates/conductor/1-workbench/loop-state.json`) is the v1 minimum. v2 is a **migration, not a purely additive extension** — it adds fields *and* removes/restructures some, so the driver must map v1→v2 on load (bumping `schema_version` to 2). The mapping:

| v1 | v2 | note |
|---|---|---|
| `telemetry.tokens_spent` | `budget.tokens_spent` | moved |
| `telemetry.consecutive_stalls` | `stall.consecutive` | moved |
| `telemetry.last_tool_invoked` / `last_tool_arguments` | `stall.last_beat_hash` | folded into the driver-computed hash; the raw tool fields are dropped |
| `current_task` | `tasks[]` (Phase 4) / `goal_description` | dropped in pair mode; goal is carried by `goal_description` |
| `maker_branch` | `tasks[].worktree` (Phase 4) | dropped in pair mode; the driver derives the worktree |

New fields default when absent so a v1 file still loads:

```jsonc
{
  "schema_version": 2,
  "goal_description": "",
  "phase": "discovery",              // discovery | blueprint | execution | shipping
  "autonomy_level": "L1",            // L0 | L1 | L2 | L3  (Phase 4; driver refuses actions above it)
  "status": "idle",                  // see state machine below
  "current_worker": null,
  "iterations": { "current": 0, "max_allowed": 20 },
  "budget": {                         // NEW — driver-enforced, not agent-reported
    "max_beats": 20,
    "max_wall_clock_min": 120,
    "tokens_spent": 0,
    "started_at": null                // ISO string; driver stamps on first beat
  },
  "verification": {                   // NEW — source of truth for the Evidence Rule
    "command": "",                    // if empty: conductor.config.json "verify" → `npm test` iff package.json declares it → else HALTS (halted_no_verification). Mirrors conductor_verify_cmd()
    "last_exit_code": null,
    "last_output_hash": null
  },
  "stall": {                          // promoted out of telemetry for clarity
    "consecutive": 0,
    "last_beat_hash": null            // hash(git HEAD + verify output + last tool+args)
  },
  "tasks": [],                        // Phase 4 task-graph blackboard; [] = simple pair mode
  "roles": ["maker", "checker"],      // Phase 4; default pair
  "concurrency": 1,                   // Phase 4; >1 only at L3
  "history": []                       // append-only beat log: {beat, status, evidence, ts}
}
```

Fix the v1 typo path where present and unify terminal-status vocabulary (below). `telemetry.last_tool_invoked/arguments` from v1 fold into `stall.last_beat_hash`.

### State machine (explicit — the driver owns transitions)

| status | who acts this beat | on success → | on failure → | terminal? |
|---|---|---|---|---|
| `idle` | Maker | `ready_for_check` | `stalled` | no |
| `rejected_by_checker` | Maker (retry) | `ready_for_check` | — | no |
| `ready_for_check` | driver runs `verification.command`; then (Phase 3+) Checker | `passed_by_checker` (exit 0 **and** Checker approves) | `rejected_by_checker` (exit ≠ 0, **or** Checker rejects) | no |
| `passed_by_checker` | driver merges/advances | `idle` (next task) or `completed` | — | no |
| `passed_by_checker` (L1) | driver | `awaiting_review` (single-beat handoff) | — | → terminal |
| `completed` | — (L3 execution: PR opened, awaiting human merge) | — | — | **yes** |
| `awaiting_review` | — (L1 single beat / L2 blueprint done / L3 merge deferred to human) | — | — | **yes** |
| `stalled` | — (3 consecutive no-progress beats; write inbox.md) | — | — | **yes** |
| `max_iterations_exceeded` | — (`iterations.current ≥ max_allowed`) | — | — | **yes** |
| `budget_exceeded` | — (wall-clock ≥ `budget.max_wall_clock_min`) | — | — | **yes** |
| `halted_scoping` | — (`phase == discovery`; Scoping Barrier) | — | — | **yes** |
| `halted_no_verification` | — (no verify command resolves; fail-safe) | — | — | **yes** |
| `halted_sandbox_required` | — (L3 without `sandbox:container`) | — | — | **yes** |
| `halted_autonomy` | — (L0, or concurrency>1, or L2 in execution) | — | — | **yes** |

**The Evidence Rule is a driver step, not an agent claim — but it is a floor, not the whole verdict.** On `ready_for_check` the driver runs `verification.command` itself and records `last_exit_code`:
- **Red exit (≠ 0) forces `rejected_by_checker`, always.** This is the non-negotiable floor; the agent's self-report cannot override it. A deliberately-lying stub agent must still be routed to `rejected_by_checker` on a red exit — **that is the key Phase 1 test.**
- **Green exit (0) is necessary but not sufficient.** It makes the task *eligible* to pass; it does not by itself prove the work is correct (tests can be green and wrong, or incomplete). Above the floor sits the **Checker's judgment**, which is the reason two archetypes exist at all:
  - **Phase 1 (no LLM Checker yet):** green exit ⇒ `passed_by_checker` directly. The driver's deterministic verification *is* the checker for now.
  - **Phase 3+ (Checker as a separate fresh process):** after a green exit the driver spawns the independent Checker; `passed_by_checker` requires green exit **and** Checker approval. A green-but-wrong diff can still be sent back to `rejected_by_checker`. This preserves the generator–verifier guarantee instead of collapsing it into a test exit code.

This also resolves where the LLM Checker lives: it is a **separate process (Phase 3)**, never the in-context "Spawn Checker sub-agent" the current `unattended-loop.md` describes — that prose must be updated when Phase 3 lands.

**On `maker_active`:** the current workflow writes a transient `status: maker_active` while a Maker works. Under the driver this is redundant — the driver stamps `current_worker` for the active role and the *status* stays `idle`/`rejected_by_checker` (Maker's turn) until the beat produces `ready_for_check`. Drop `maker_active` from the vocabulary; use `current_worker` for "who is acting."

### The beat contract & Claude Code adapter (Phase 2)

One **beat** = one agent invocation that reads state, does the phase-appropriate work for the current `status`, writes files, and updates `loop-state.json`. The driver wraps each beat with the deterministic guards.

Adapter interface (Phase 1 builds directly against the Claude Code impl):
```js
// src/loop/adapters/claude.js
async function runBeat({ promptPath, cwd, permissionMode }) → { exitCode, stdout, tokens? }
async function runChecker({ ... })  // separate fresh process for structural independence (Phase 3)
```
Claude Code invocation (headless): `claude -p "$(cat <promptPath>)" --permission-mode <mode>` run in `cwd`, capturing exit code + stdout. `promptPath` is `.agents/workflows/unattended-loop.md` (the agent re-reads it each beat — the soft layer). Adapter selection via `loop-state.json` (add a `platform` field) or a `--platform` flag; default auto-detect (Claude Code if `claude` is on PATH). Keep the adapter to *only* the CLI invocation — all guarantees live in the driver.

Between beats the driver — not the agent — increments `iterations.current`, recomputes the stall hash, checks the budget wall-clock, and enforces the Scoping Barrier before dispatching.

### Test harness (Phase 1 acceptance)

Inject the adapter (`{ runBeat }`) into `driver.js` so tests pass a **stub adapter** that returns canned `{exitCode, stdout}` and mutates a fixture `loop-state.json` — no `claude` process. Cover with `node:test`: (a) ceiling stop, (b) stall stop after 3 no-progress beats (hash of git HEAD + verify output only — no tool component), (c) red verification forces `rejected_by_checker` even when the stub "claims" success, (d) `phase:discovery` → `halted_scoping` before any beat, (e) budget wall-clock stop, (f) no resolvable verify command → `halted_no_verification` before any beat, (g) green verification → `passed_by_checker` (the Phase-1 deterministic-checker path). Add a `check-conductor.sh` section asserting the driver module + v2 schema fields exist.

## Acceptance criteria

- `conductor loop` (over `src/loop/driver.js`) drives a real multi-beat loop to a terminal status with **no** reliance on the agent honoring the guardrails (provable by a test where a deliberately-misbehaving stub agent still gets stopped at the ceiling / on a stall / on a red verification).
- A discovery-phase state halts (`halted_scoping`) before any beat runs; a state with no resolvable verify command halts (`halted_no_verification`) before any beat runs.
- L3 never merges on a non-zero verification exit; merges go through a PR.
- `bash templates/.agents/tests/check-conductor.sh` stays green; new checks cover the driver + schema.
- Works on ≥2 platforms via adapters (Claude Code + one other).

## Open questions

1. ✅ **Resolved:** ship the driver as a `conductor loop` CLI subcommand (see Implementation handoff → *Where the driver lives*), not a per-project script.
2. ✅ **Resolved (2026-07-14): document-only for v1.** Ship a documented container profile (`templates/.agents/sandbox/`) the user runs `conductor loop` inside; expose `sandbox: "none" | "container"` in `loop-state.json`; the driver refuses to run at **L3** unless `sandbox == "container"` (terminal `halted_sandbox_required`). Conductor does not spawn or manage containers itself — consistent with the thin BYO-CLI principle (D7). Revisit a turnkey bundled sandbox only if L3 adoption demands it.
3. ✅ **Resolved: both, split by autonomy level.** Native Claude Code `/loop` (via `.claude/loop.md`) is the interactive **L1/L2** path — no custom driver, human sits on the loop. The `conductor loop` driver is the unattended **L3** path where deterministic guarantees are load-bearing. They share `unattended-loop.md` + `loop-state.json`, so state is portable between them.

> **All open questions are now resolved.** Q1 (driver location), Q2 (sandbox baseline: document-only), and Q3 (interactive vs. driver split) are decided. Phases 1–3 and Phase 4's pair-mode parts are built; only the swarm remains.

## Remaining work

The loop backend is **feature-complete**. The only outstanding item is the one that requires publishing and maintaining a container image in a registry — deliberately excluded.

### ✅ Shipped (2026-07-14)

1. ✅ **Task-graph blackboard** — `src/loop/swarm.js` `normalizeTask`; `state.tasks[]` schema `{id, type, status, deps, role, worktree, iterations, stall, evidence, merge}`.
2. ✅ **Frontier scheduler** — `computeFrontier` (pending + all deps merged) + wave dispatch; stigmergic, no agent-to-agent chat.
3. ✅ **Specialized role resolution** — `resolveRoleForTask` (archetype + persona + task-type `claims`); `concurrency=1` reproduces per-task pair behavior (regression-tested).
4. ✅ **`concurrency>1` parallel dispatch** — `Promise.all` over the frontier wave; gated at L3 + task graph in `autonomyPreflight`.
5. ✅ **Per-task ceiling / anti-stall + shared global budget** — per-task `iterations`/`stall`; one shared beat + wall-clock pool across the wave.
6. ✅ **Multi-worktree merge queue** — serialized PR-gated merge across concurrent branches (per-task worktrees), each gated by its Checker, pausing → `awaiting_review` on failure/conflict.
7. ✅ **Codex adapter** — `src/loop/adapters/codex.js`, registered in the resolver.
8. ✅ **Multi-vote / adversarial Checker** — `tallyVerdicts` (N skeptics, strict majority, fail-safe); `checker_votes` in state, wired in the command.
10. ✅ **End-to-end pipeline run** — `test/smoke-loop.sh` (`npm run test:smoke`) drives the *real* worktree → maker-commit → verify → Checker-verdict → signal → handoff pipeline with a fake agent (no LLM). *Caveat:* a real `claude -p` multi-beat run inside the container profile still needs one-time manual validation (needs the agent CLI + a sandbox host — not automatable in CI here).
11. ✅ **CHANGELOG back-fill** — loop-backend Phases 1–4 documented under `[Unreleased]`.

### ⛔ Excluded by request (requires a published/maintained registry image)

9. **Turnkey hardened sandbox image** — build the `templates/.agents/sandbox/Dockerfile.sandbox` recipe into a hardened image, publish it to a container registry (GHCR/Docker Hub), and maintain it (base-image CVEs, update cadence) so L3 users `docker pull` instead of building. Q2 chose document-only precisely to avoid this maintenance/runtime ownership (D7). The Dockerfile + profile docs we ship remain the supported path.

### Note on the evidence gate

The swarm is built but **unproven on real work**. It stays opt-in (L3 + `sandbox:container` + `concurrency>1` + a task graph) and the evidence-gate guidance stands: don't rely on it for real tickets until pair mode has driven several to green unattended. Building it early was an explicit decision; running it in anger is still gated by judgment.
