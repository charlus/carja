# Carja Framework — Development Context

> You are working on **the Carja Framework itself** — the npm package that scaffolds an AI Software Engineering methodology into other projects. This is NOT a project using Carja. This IS Carja. It is a **harness-configuration + orchestration layer**: the methodology in `templates/` configures a real coding-agent harness (Claude Code / agy / codex), and `carja loop` (`src/loop/`) is an outer orchestrator that drives those harnesses unattended — it is not itself a harness.

## How I Must Operate Here (read this first)

Almost everything in this repo is **instructions for other agents' harnesses** (`templates/`) or **control code for an unattended orchestrator** (`src/loop/`) — not ordinary app code. A wrong line propagates to every install, or fires on every autonomous beat with no human watching. Four operating truths, each learned the hard way:

1. **The tests lie by omission.** A green `test:unit` / self-test / `test:smoke` ≠ working for anything **agent-, loop-, or adapter-shaped** — that whole layer is *stubbed*. Real behavior is proven only by a **live run** (`carja loop … --platform <p>` in a background shell with a `timeout` backstop) or by the agent-layer evals in `test/evals/` (`CARJA_EVALS=1`). Never claim a behavior you have not executed. Every real adapter bug this class ever had passed all green suites and died only on a live run. **Run live tests outside Claude Code's temporary folder `/tmp/claude-<uid>`** (for example under `~/.cache/`): the sandbox lets a beat write there, so a scratch layout in it hides every sandbox write limit (2026-10-20: step 7 passed there, then failed on the first real project).
2. **The interactive path is sacred.** Loop/backend work lives in `src/loop/*` + `src/commands/loop.js` and keeps `templates/.agents/workflows/` **byte-identical** except `unattended-loop.md`. Verify: `git diff --name-only master..HEAD -- templates/.agents/workflows/ | grep -v unattended-loop` → empty. One source of truth (`carja/`), two clients (interactive Claude Code + the autonomous fleet).
3. **Enforce with code, not prose.** A non-negotiable gets a deterministic **hook + a *behavior* test** (red→green) wherever the rule is grep-able; the Checker handles the semantic rest. Prose rules are advisory. (A *behavior* test — not a structural existence check — is what caught the eval gate's false-positive.)
4. **Never weaken the orchestrator's safety envelope.** `carja loop` runs unattended, so these invariants must survive every edit: **PR-gated merge (never a direct push), the L3 sandbox gate, the Evidence Rule (verify exit code, not self-report), worktree isolation, the autonomy clamp, and fail-safe-on-missing-verdict.** If a change touches one, that is the thing to get right.

Also: this harness (Claude Code) hard-blocks merges and dangerous flags — those are the human's, not obstacles to route around. Durable state between sessions lives in the `memory/` dir + the roadmap docs' **status blocks** — read them first, keep them current.

## What This Repo Is

An npm package (`carja`) that scaffolds an AI agent methodology into any project via:

```bash
npx github:charlus/carja init      # New projects
npx github:charlus/carja upgrade    # Existing projects
```

The installable framework lives in `templates/`. The CLI lives in `bin/` + `src/`.

## Architecture

```
carja/          ← You are here (package source)
├── bin/carja.js               # CLI entry point (bin/conductor.js: the 6.x name, an alias with a notice, removed in 8.0)
├── src/
│   ├── cli.js                 # Argument parser and command dispatch (one `case` per command)
│   ├── detect.js               # Tech stack detection (used by init for skill recommendations)
│   ├── registry.js             # Remote skill registry client (fetch index, download, glab/gh auth)
│   ├── names.js                # The two names after the rename to Carja: writers use CURRENT, readers also accept the 6.x name through 7.x
│   ├── rename-migration.js     # `carja upgrade` on a 6.x install: conductor/ → carja/ in two commits (rename, then knowledge paths)
│   ├── selective-copy.js       # Interactive/selective template copy for init
│   ├── kebab.js                 # kebab-case rename + checksum-key migration (used by upgrade)
│   ├── update.js                # Diffs installed vs. latest templates for upgrade
│   ├── bundles.js / checksums.js / prompt.js
│   ├── usage.js / next-step.js  # every command, option and config key (help + docs/Using-Carja.md); the `Next:` hints
│   └── commands/
│       ├── init.js            # carja init: scaffolds .agents/ + carja/ into target
│       ├── upgrade.js         # carja upgrade: replaces .agents/, kebab-case migration, carja/ migration
│       ├── add.js / remove.js / list.js / search.js   # carja add|remove|list|search: the remote skill registry
│       ├── status.js / inbox.js / view.js / review.js # carja status|inbox|view|review: human surfaces
│       ├── survey.js          # carja survey: facts about an inherited codebase
│       ├── personas.js        # carja personas: which domain personas a change needs
│       ├── design.js          # carja design migrate: old design folder → DESIGN.md
│       ├── verify.js / trust-verify.js / evidence.js / install-hooks.js   # carja verify|trust-verify|evidence|install-hooks: the gates
│       ├── review-log.js / context-bill.js   # carja review-log|context-bill: measurement
│       ├── agents-md.js       # carja agents-md: the project card
│       ├── loop.js            # carja loop: the autonomous driver
│       ├── loop-doctor.js     # carja loop doctor: checks a project before an unattended run
│       ├── watch.js           # carja watch: what a loop run is doing, from its event log (src/loop/events.js)
│       └── work.js            # carja work <item>: the hidden worktree an interactive item works in (src/work.js)
├── templates/                 # THESE files get installed into user projects
│   ├── .agents/                # Agent core (AGENTS.md, how-it-works.md, registry.json, rules, workflows, skills, personas)
│   ├── carja/              # Project state (numbered folders 0-compass..6-archive)
│   ├── carja.config.json   # Project settings: verify/eval commands, loop block, registry URL
│   └── CHANGELOG.md            # (the root AGENTS.md is GENERATED at install from .agents/, not a template file)
├── package.json               # manifest + npm test scripts (test:unit/smoke/hooks)
├── README.md                  # Public-facing with credits
├── CHANGELOG.md               # Package changelog
├── docs/roadmap/               # Design docs for in-progress/parked features
└── this file (CLAUDE.md)      # Development context for AI
```

### Key Distinction

- **`templates/`** = what users get. Edit these when changing the framework.
- **`src/`** = the installer. Edit these when changing the CLI.
- **Root files** = package metadata. This repo does NOT use the Carja framework itself.

## Design Decisions Made

| Decision | Rationale |
|----------|-----------|
| Root `AGENTS.md` (always loaded) vs. `.agents/how-it-works.md` (on-demand) | Every session loads only the root `AGENTS.md`: a framework block GENERATED from `.agents/AGENTS.md` + the rules marked `inline: true` (`src/agents-md.js`), then the project card. `how-it-works.md` carries the full routing table, folder purposes and registries and is read on demand. Inline, because Claude Code reads nothing under `.agents/` and Codex has no import syntax |
| `carja/` wrapper (visible, not dotted) | Keep project root clean but let the human browse/edit their dashboard directly — this is their collaborative workspace, not hidden state |
| One root `AGENTS.md`, no `CLAUDE.md` / `GEMINI.md` (6.7.0) | The AAIF standard every harness reads. Claude Code (≥ 2.1.277) reads it only when no `CLAUDE.md`, `.claude/CLAUDE.md` or `CLAUDE.local.md` sits in the working folder or any folder above it (6.14.0 warns about each), and such a file also hides a team repo's own `AGENTS.md`. The old stubs only asked the agent, in prose, to read `.agents/AGENTS.md`. Written next to `carja/`, never inside a nested repo, so the outer (team) layout never leaks it. Design: `docs/roadmap/Agents-MD-Project-Card.md` |
| kebab-case naming (all of `.agents/` + `carja/`) | Standardized off legacy Title-Case during the V5 migration; `upgrade` auto-renames existing installs |
| CLI auth detection (not URL regex) | `gh auth status` / `glab auth status` works for self-hosted GitLab |
| No NotebookLM skill in templates | Requires MCP server, too environment-specific for a general framework |
| Remote skill registry (`add`/`remove`/`list`/`search`) | "npm for AI skills" — core skills ship in `templates/`, tech-specific/domain skills download on demand from a `carja.config.json`-configured registry |
| Test-Driven Law as an always-on `rules/` file, not a skill | TDD needs to be structural, not something an agent has to remember to reach for — same reasoning as the Verification Iron Law. Build's per-task loop now hard-codes RED→GREEN→REFACTOR as Step 2, not a generic "implement" step |
| `Inbox: X` / `Add to inbox: X` / `Scratchpad: X` quick-capture, in the always-on classifier | Some platforms (Claude Code, Antigravity 2.0) expose no file browser — chat is the human's only path into `carja/1-workbench/`. The rule is deliberately zero-judgment (append verbatim, no workflow, no triage) so it stays as fast as opening a file would have been |
| `Grilling` + `Collaborative-Drafting` interview/drafting primitives as skills, loaded by discovery/PRD/spec/design workflows | The interview technique (Interviewer persona, one-at-a-time questioning, advancement gates; since 6.14.0 the questions come in short numbered rounds, as Pocock now does) and the "propose-first → discuss → coverage-check → confirm" drafting quartet were duplicated inline across Genesis, Storyboard, Grand-PRD, Spec-It, Technical Vision, Carve, and the Design Brief. Extracted to `skills/grilling/SKILL.md` (extract decisions) and `skills/collaborative-drafting/SKILL.md` (produce documents) as single sources of truth (following Matt Pocock's `grilling` primitive), adding recommend-per-question, look-up-facts-don't-ask, and one convergence gate per document. Genesis, Storyboard, Grand-PRD, and the UX/UI Brief now supply the *agenda* and load the primitives for the *how* — the UX/UI Brief dropped from 448 lines / 7 per-phase gates to one gate at save. Quick-Path, Retrospective, Technical Vision, and Carve reference the primitives too, and Spec-It was reworked to *synthesize-not-re-interview* (Pocock's `to-spec`). Companion sharpening from Pocock's repo, keeping our stronger stances where they diverge: `tdd-cycle` (agree seams first + anti-pattern tells, but kept our in-loop REFACTOR), `code-review` (Fowler smell baseline, but kept our sequential spec→quality gate), `systematic-debugging` (red-command-first), `technical-vision` (deep-module deletion test + ADR 3-test gate), `ship` (merge-conflict discipline), plus a net-new `handoff` skill (context hygiene for the loop). See `docs/roadmap/Pocock-Alignment-Backlog.md` for the full Epic A–E status |
| Personas load from the paths a change touches (`carja personas`), never from memory (6.8.0) | No workflow loaded them, so UI and auth code were written without the Designer or the Security Auditor. The author reads the full persona, the reviewer only its Review Lens, so `reviewer.md` stays one file. Conflicts are settled in a fixed order (security and data integrity, acceptance criteria, architecture, performance, design), and the product owner is asked only when every option is user-visible. Maker and Tech Lead removed as redundant. Design: `docs/roadmap/Persona-Team.md` |
| One `DESIGN.md` at the code repository root, a system and not a philosophy (6.8.0) | A real project built twelve slices from a brief that described function only, then needed five rework slices. DESIGN.md travels with the code (outer layout included), one per code repository and fixes patterns, data display and reference screens. The per-slice visual review is off by default by owner decision (cost and speed) |
| Build runs to ship-ready, with no confirmation stops (6.9.0) | Real usage (2026-10) showed the product owner answering "ready for next batch?" dozens of times and storing "build without checkpoints" in per-project memories. A batch is the unit of independent review, not a pause. Build asks only for product decisions and blockers it cannot remove; the task tracker, not a human "continue", carries state across a context reset |
| The git hooks guard nested code repositories (6.10.0) | In the outer layout no gate ever ran on a code commit, and status said "Gates on". The nested repository's `core.hooksPath` points at the outer `.agents/hooks` by absolute path (local config, nothing committed to the team repo). The hooks derive the project root from their own location and load the library from the outer repository's committed copy, which the code commit cannot change. Push checks live per repository under `repos` in `carja.config.json` |
| Review-log categories are a closed set; append-only logs merge with `merge=union` (6.12.0) | Free-text categories split one idea over many names, so the per-class dismissal alarm could never fire; persona was null in 99% of rows. The reviewer's `class` and `lens` map to `category` and `persona`. Parallel sessions conflicted on every ship-log entry; union merge is right for logs that are only appended to, and wrong for the task backlog, whose lines are edited |
| Live state is fetched, never stored as current: the Live State Law + `carja status --live` (6.25.0) | An agent reported "not deployed" from its own state of the day before; the human had merged and deployed in between. `carja/` is history. MR and deploy status come from the forge and the project's `deployCheck` at the moment of the claim, or the agent says "not checked" and asks. Ship writes dated events, never statuses. The stale-claim check is line-scoped and ignores "unmerged", which in real logs qualifies a branch |
| Renamed Conductor to Carja (7.0.0) | Google's Conductor writes into the same `conductor/` folder, and the npm name `conductor` is taken. *Carja* is *jacquard* in verlan. `carja upgrade` moves a 6.x install first, in its own commits, and is the one exception to "upgrade never touches knowledge": it rewrites the exact pattern `conductor/<n>-<folder>/` inside `carja/` (D2). It refuses a dirty tree or a live loop worktree (D3). Readers accept the old folder, config, stamp, markers, `CONDUCTOR_*` variables, `--from-conductor` and the `conductor` command through 7.x; the loop, `loop doctor` and `work` refuse a 6.x layout. Machine folders keep `~/.conductor` when only that exists. Design: `docs/roadmap/Rename-To-Carja.md` |
| Upgrade **replaces** `.agents/` instructions, **preserves** `carja/` knowledge (ownership rule: framework-owned = ships in `templates/**`) | A methodology upgrade must land new instructions — the old checksum-gated behavior *kept* user-edited instruction files and silently no-op'd checksum-less V4 installs, stranding them on stale methodology. Now framework files are replaced wholesale (custom additions carried forward, everything backed up first to `.carja-backup/`), while the user's app knowledge in `carja/` is never touched. The `carja/5-templates/` scaffolding is framework-owned and refreshed too. Confirmed with the maintainer for the 6.0.0 upgrade path |

## Current State — read the source, not this file

This used to be a version-stamped prose snapshot; it drifts (it predated the V6 loop backend, multi-engine parity, and the Eval-Driven Law). **Truth lives in the source, not here:**

- **What shipped & why** → `docs/roadmap/*.md` (each carries a live status block) + `CHANGELOG.md`.
- **Cross-session / in-flight findings** → the `memory/` dir (start at `MEMORY.md`).
- **The methodology surface** → `templates/.agents/how-it-works.md` (routing table, skill/rule registries, the ship-contract).

Stable pointers to where the big subsystems live:
- **Autonomous loop** → `src/loop/` (driver, adapters, worktree, checker, merge, swarm, trigger, usage, doctor) + `src/commands/loop.js` and `src/commands/loop-doctor.js` (`carja loop doctor`); the only interactive template it touches is `.agents/workflows/unattended-loop.md`. `carja loop <project>` (one project per run, state and lock per project in `.git/carja-loop-logs/runs/`, cleanup at exit) is `src/loop/scope.js`, proven by `test/loop-project-scope.test.js`; since 6.51.0 it is a stacked run (the Carve and every slice, each on the branch below, the owner merges in order at the end, a closed MR rebuilt with everything above it) driven by `stackedProjectRun` in `src/commands/loop.js` with the pure parts in `src/loop/stack.js`, proven by `test/loop-stacked-run.test.js` (outer layout, stub engine, stub forge `test/fixtures/stub-forge/gh`); the cleanup rules that keep one loop from removing another's live worktree are in `src/loop/reconcile.js` and the `post-merge` hook, the commit guard in `src/loop/autocommit.js`. Since 6.52.0 (the owner's lessons of 2026-10-23): the dependency gate `src/loop/deps.js` (no registry for any beat; `loop.allowed_domains` refuses them), the wait for the usage limit `src/loop/quota.js`, document-only conflicts merged with both sides kept (`src/loop/conflict.js`), leftover folders moved aside (`src/loop/worktree.js`), the owner's files hidden from git (`src/loop/owner-files.js`), owner-action hints (`src/loop/owner-hints.js`) and `workflows/merge-stack.md`, all through the real CLI in `test/loop-run-lessons.test.js`. The outer layout (`loop.code_dir`: code worktree, two MRs, claims and cleanup across both repositories) is `src/loop/nested.js`, proven by `test/loop-nested-run.test.js` through the real CLI. The stage map (stage → workflow → gate) is `src/loop/stages.js`; `test/loop-stage-conformance.test.js` runs the real CLI through every stage with the stub engine `test/fixtures/stub-engine/claude` (no model, about 10 s): it proves routing and gates in the command layer, not agent behaviour. Design: `docs/roadmap/Autonomous-Loop-Backend.md`, `docs/roadmap/Loop-Robustness-Plan.md`.
- **Deterministic enforcement** → `templates/.agents/hooks/` (`lib.sh` + `pre-commit` for the TDD + Eval *presence* gates, the Goodhart boundary and protected paths; `pre-push` for Verify + Eval *run* gates and the pinned official `pre-commit` fingerprint), wired by `carja install-hooks`. The hooks load the *committed* `lib.sh` and fail closed without it. Opt-in Claude Code `PreToolUse` hooks: `pretooluse-no-bypass.sh` and `pretooluse-fact-gate.sh` (measured by `test/evals/fact-gate-eval.mjs`). `test/hooks-registry-drift.test.js` keeps hooks, README and `install-hooks` in step. `carja upgrade` commits its own protected-path writes (`src/commands/upgrade.js`, `commitUpgrade`), on its own branch when the repo has a remote (`upgradeTarget`). Files under `carja/` are not code to the hooks, and a waiver line rides the commit that passes. Design + review record: `docs/roadmap/Peer-Framework-Harvest.md`. The ship-contract (Eval-Driven Law + `architecture-checklist`, judge-rubric calibration): `docs/roadmap/Eval-Driven-Law.md`.
- **CLI** → `src/` (`cli.js` parser; `init`/`upgrade` in `src/commands/`; `update.js`/`backup.js`/`version.js` for the robust cross-version upgrade — `docs/roadmap/Robust-Upgrade-Migration.md`).
- **Evidence freshness** → `src/evidence/` (`wtree.js` working-tree content fingerprint + `ledger.js`), surfaced as `carja evidence run|check|list` and consumed by `hooks/pre-push` (with `--stable-tree`: a run that changes files while it runs fails) and by the loop driver's verify (`src/loop/verify-evidence.js`, which also binds the root `.env` files). Design and the remaining steps: `docs/roadmap/Verification-Cost.md`. Committing exactly the code that was tested keeps its evidence FRESH; an untracked new source file invalidates it.
- **Swarm conflict prediction** → `src/loop/conflict.js` (`git merge-tree`, fail-open), consumed by `src/loop/swarm.js`'s merge queue. Only the legacy (git < 2.38) form is proven by `test/conflict-predict-real.sh`. F8 admission control is deliberately unbuilt: `docs/roadmap/Swarm-Collision-Admission.md`.
- **Review canvas** → `src/review/` (`canvas.js` page, `server.js` loopback same-origin server, `store.js` NDJSON feedback queue) + `src/commands/review.js`, surfaced as `carja review <file.md>` (exit 0/2/1, JSON on stdout).
- **Root AGENTS.md + project card** → `src/agents-md.js` (framework block generation, rendering, stub migration; used by `init`/`upgrade`), `src/project-card.js` (card build/check/stamp, pure) + `src/commands/agents-md.js` (`carja agents-md facts|write|check`, facts from the code repo, nested in the outer layout via `src/nested-repos.js`), `src/claude-instructions.js` (D9 warnings), `templates/.agents/workflows/agents-md.md`. Design + decisions D5–D13: `docs/roadmap/Agents-MD-Project-Card.md`.
- **Interactive work off the owner's branch** → `src/work.js` + `src/commands/work.js` (`carja work <item>`: one hidden worktree per item on `carja/work/<slug>`, a code worktree inside it in the outer layout; `carja work clean`), the `pre-commit` default-branch rule (`CARJA_ON_DEFAULT` waiver), the `post-merge` cleanup and `carja status`'s warning. Interactive Spec-It, Build, Ship and Quick-Path start with it; `skills/git-worktrees/SKILL.md` is the rule. Proven by `test/work-worktree.test.js` and `test/hooks-default-branch.test.js` (real git).
- **Brownfield onboarding** → `src/survey.js` + `src/commands/survey.js` (`carja survey`, facts only) and `templates/.agents/workflows/survey.md` (the interview).
- **Human surfaces** → `src/carja-state.js` (ONE read of `carja/`, shared by every renderer; calls `loop/harvester.js` rather than re-parsing) + `src/commands/status.js|inbox.js|view.js` + `src/heartbeat.js` (hook heartbeats against the reflog: commits and pushes that skipped the hooks) + `src/view/` (`markdown.js` renderer, `render.js` page assembler, `styles.css`, `app.client.js`). Surfaced as `carja status|inbox|view`. `src/live-state.js` is the only part that leaves the machine: `carja status --live` (forge MR state via `glab`/`gh`, stale ship-log claims, `deployCheck`). Design: `docs/roadmap/Terminal-First-Human-Surfaces.md`.
- **Personas as an engineering team** → `src/personas.js` (path → persona map, `PRECEDENCE` for conflicting findings) + `src/commands/personas.js` (`carja personas`), each persona's `## Review Lens`, Grilling's Lens Pass. **DESIGN.md** at the code repository root: `templates/.agents/skills/design-system/`, `src/design-md.js` + `src/commands/design.js` (`carja design migrate`). Design + decisions: `docs/roadmap/Persona-Team.md`. Measured by `test/evals/persona-eval.mjs`.
- **Measurement** → `src/context-bill.js` + `test/fixtures/context-budget.json` (the always-on/eager ratchet, ceilings in bytes) and `src/commands/review-log.js` (review findings + dispositions, 13 `CATEGORIES` with aliases; a class dismissed >50% of the time is a *rubric* defect, not an author defect). `src/gitattributes.js` sets `merge=union` for the append-only logs.
- **The review gate** → `templates/.agents/skills/independent-review/` — `SKILL.md` is the caller's half, **`reviewer.md` is the reviewer's entire brief** (self-contained, ≤130 lines by test), `calibration.md` pins both drift directions. Rubric v2 is enforced in code by `src/loop/checker.js`.
- **Untrusted input** → `src/loop/untrusted.js` (trust from authorship not transport; always-on envelope; tool allowlist, never a blocklist) + `carja trust-verify` for the Stop hook's trust store.
- **Agent-layer evals** → `test/evals/` (`CARJA_EVALS=1`). The only tests here that can fail because of *agent behaviour*; everything in `test/*.test.js` stubs that layer. Read `test/evals/README.md` before trusting a green eval — the sensitivity check exists because a green eval proves nothing on its own.
- **This work's design + evidence** → `docs/roadmap/Review-Convergence-And-Harness-Alignment.md` (E1–E5, the peer-harness audit, what was descoped and why, and the measurement that is still outstanding).

> **Version note:** `package.json` may lag what's on `master` — several PRs can land before a bump. Don't trust a version number as a statement of what's shipped; trust the roadmap status blocks + `git log`.

## How to Work on This Repo

1. **Edit `templates/`** for framework content, **`src/`** for CLI behavior.
2. **TDD the framework itself** — a failing test first. For a non-negotiable, that means a **hook + a behavior test** (Operating Truth 3), not a prose rule.
3. **Prove agent/loop/adapter behavior with a live run** (Operating Truth 1) — never from the stubbed suites.
4. **After any change**, run the full local suite and — for loop work — confirm the interactive path is untouched:
   ```bash
   npm run test:unit && npm test && npm run test:smoke && npm run test:hooks && npm run test:trust
   git diff --name-only master..HEAD -- templates/.agents/workflows/ | grep -v unattended-loop   # empty for loop work
   ```
   Full install flow: `node bin/carja.js init /tmp/test --all && bash /tmp/test/.agents/tests/check-carja.sh`.
5. **A new command, option or `carja.config.json` key goes into `src/usage.js` in the same change**, then `node scripts/write-usage-reference.js` regenerates `docs/Using-Carja.md`. `--help`, `carja help` and the page come from that file; `test/usage-reference.test.js` fails when they drift. A command that ends in a state the owner must act on prints a `Next:` line (`src/next-step.js`).
6. **Documentation moves with the code, in the same PR, written as done.** Never a follow-up PR for docs. Add the change to `CHANGELOG.md` in the section of the version it ships in, with a `Compatibility:` line under the heading (`upgrade only`, `upgrade plus a step`, `breaking for scripts`, checked by `test/changelog-compatibility.test.js`), and bump `package.json` in the same PR (with an upgrade note when users must act), and update `README.md`, this file, `templates/.agents/how-it-works.md` and the roadmap status block it affects. What is removed from the code is removed from the docs. `test/docs-drift.test.js` checks the countable part (counts, commands, registries); the meaning is yours.
7. **Commit** with Conventional Commits (`feat:`/`fix:`/`docs:`/`refactor:`); don't squash commits a roadmap doc cites by hash; keep the relevant roadmap status block + `memory/` current.
8. **Hand off** merges and classifier-blocked / dangerous-flag actions to the human.

## Credits

Built on: [Test in Prod's Conductor](https://www.testinprod.co/), [Antigravity Kit](https://github.com/vudovn/antigravity-kit), [Antigravity Superpowers](https://github.com/skainguyen1412/antigravity-superpowers), [Superpowers](https://github.com/obra/superpowers), [agentctl](https://code.euranova.eu/innovation/agentctl.git) (Euranova internal). The full list, with what each one gave: `README.md`, Credits & Acknowledgments.
