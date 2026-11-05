# How Carja Works

**System:** Carja Framework V6 — Hybrid Architecture
**Role:** You are the Carja — a Product Engineer that orchestrates the full development lifecycle.

> This is the full reference. The root `AGENTS.md` is what every session loads: the framework block (generated from `.agents/AGENTS.md` and the inline rules) and the project card. Read this file when you need folder purposes, the complete workflow/skill/persona registries, or the reasoning behind a rule.

---

## Folder Structure

```
your-project/
├── .agents/                       # The Engine — capabilities (read-only for project logic)
│   ├── AGENTS.md                  # Source of the framework block in the root AGENTS.md: boundaries + request classifier
│   ├── how-it-works.md            # This file — full system reference
│   ├── registry.json              # Machine-readable index of every skill/rule/workflow
│   ├── rules/                     # Laws; those marked `inline: true` are copied into the root AGENTS.md
│   ├── workflows/                 # Step-by-step guides that PRODUCE artifacts through a defined process
│   ├── skills/                    # Atomic capabilities that EXECUTE discrete actions
│   ├── personas/                  # Judgment partners that embody ways of THINKING
│   ├── references/                # On-demand reference docs (not skills)
│   ├── hooks/                     # Git + Claude Code hooks that enforce the laws (wired by `carja install-hooks`)
│   ├── sandbox/                   # Sandbox profile for `carja loop` (sandbox: cli-native)
│   └── tests/                     # Framework self-test (check-carja.sh)
├── carja/                     # The Dashboard — project state (your collaborative workspace)
│   ├── 0-compass/                 # North Star & Ship Log
│   ├── 1-workbench/               # Active work area
│   ├── 2-backlog/                 # Queue for ready work
│   │   ├── task-backlog.md        # Small stuff — bugs, tweaks, no full plan needed
│   │   ├── project-backlog/       # Projects (Genesis → Storyboard → Grand PRD → multiple Implementations)
│   │   └── implementation-backlog/ # Individual Implementations (Feature Spec + Plan) ready to build
│   ├── 3-product-areas/           # Product Map, organized by domain (e.g. auth/, billing/)
│   ├── 4-context/                 # Tribal knowledge specific to YOUR product
│   │   ├── identity/               # Problem, Vision, Target User, Brand Voice
│   │   ├── design/                 # Design System, UI Components, Brand Assets
│   │   ├── technical/              # Tech Stack, Architecture, Coding Patterns
│   │   ├── product/                 # Growth Strategy, Future Plans
│   │   └── meta/                    # Decision Log, Glossary
│   ├── 5-templates/               # Standard structures for creating artifacts
│   └── 6-archive/                 # Completed work
├── carja.config.json          # Project settings: `verify` and `eval` commands, the `loop` block, skill registry URL
├── AGENTS.md                      # The one instruction file every harness loads: framework block (generated) + project card + your notes
├── .claude/commands/, .claude/skills/  # Generated Claude Code shims for workflows, CLI commands and skills
└── CHANGELOG.md                   # Framework version history for this install
```

---

## What Each Folder Is For

### 0-compass
Your North Star. The "where are we going?" layer.
- **north-star.md** — The one metric that defines success right now
- **ship-log.md** — A chronological victory log of everything you've shipped, plus the loop's run trail and every logged gate waiver
- **architecture-checklist.md** — Enforceable architecture decisions as checkable items (created by `technical-vision` / `carve`, read by the Checker)

### 1-workbench
The daily workspace. Where focus happens.
- **inbox.md** — Dump everything here. Process later. Reachable via chat with `Inbox: X` — see Quick Capture below.
- **scratchpad.md** — Temporary notes. Reachable via chat with `Scratchpad: X`.
- **loop-state.json** — The persistent external state and telemetry ledger for headless execution. Owned by the driver.
- **loop-trigger.md** — The brief a `--goal` / `--event` trigger seeded, with its trust verdict.
- **Active Implementation** — when you start building, its folder moves here from the Backlog.

### 2-backlog
The "To Do" queue, three tiers by weight:
- **task-backlog.md** — small stuff (bugs, tweaks) that doesn't need a full plan
- **implementation-backlog/** — individual Implementations (Feature Spec + Implementation Plan) ready to build
- **project-backlog/** — Projects containing Genesis, Storyboard, Grand PRD, and multiple Implementations

### 3-product-areas
The Product Map, organized by domain. Each area has three standard files, kept alive by the `context-updater` skill after every Build:
1. **`[area]-features.md`** — what users can do
2. **`[area]-technical.md`** — how it works
3. **`[area]-epics.md`** — future ideas and open problems

### 4-context
Tribal knowledge specific to your product — not the framework's, yours.
- **identity/** — Problem, Vision, Target User, Brand Voice
- **technical/** — Tech Stack, Architecture, Coding Patterns
- **product/** — Growth Strategy, Future Plans
- **meta/** — Decision Log, Glossary

### 5-templates
Standard structures for creating artifacts: PRD, Persona, Skill, Agentic-Flow at the top level, plus per-workflow subfolders (`genesis-workflow/`, `storyboard-workflow/`, `blueprint-workflows/`, `carve-workflow/`) and a `new-product-area/` starter kit (features/technical/epics stubs) for standing up a new `3-product-areas/` entry.

### 6-archive
Where completed work goes — `completed-implementations/` and `completed-projects/`.

---

## Core Principles

### Folder = State
We don't update status fields. We move folders. `2-backlog/` = queued, `1-workbench/` = active, `6-archive/` = done.

### Context First. Plan Second. Build Third.
Never rush to a solution. Read `carja/4-context/` and `carja/3-product-areas/` before acting. See `.agents/rules/prime-directive.md`.

### Verification Iron Law
No completion claims without fresh verification evidence. Applies to every workflow and skill, globally. See `.agents/rules/verification-iron-law.md`.

### Live State Law
`carja/` is history. MR, pipeline, deploy and branch status are live: the human changes them outside the conversation. Check them when you state them (`carja status --live`, which runs the project's `deployCheck`), or say "not checked" and ask. See `.agents/rules/live-state-law.md`.

### Test-Driven by Default
Tests aren't a Build task like the others — they're how every other Build task gets written. There are three layers, and they don't overlap:

| Layer | When | Question it answers |
|---|---|---|
| **Analyze-Tests** skill | Before Build starts | What's the test strategy for this whole implementation? |
| **Test-Driven Law** | During Build, per task | Does this specific increment have a failing test before it has an implementation? |
| **Ship's Regression Fortification** | After Build | What cross-feature/E2E gaps would per-task unit tests miss? |

The middle layer is a `rules/` file, not a skill you have to remember to reach for — see `.agents/rules/test-driven-law.md`. It's as non-negotiable as the Verification Iron Law, by design.

### Eval-Driven Law (for the apps you build)
Tests verify the **deterministic** parts; **evals** verify the **non-deterministic** LLM-output surface of the app you're building. If a feature calls an LLM provider, a passing unit test is not enough — it needs an evalset. Enforced in two stages, mirroring TDD + Verification: `pre-commit` gates **presence** (provider-calling code staged without an eval — an `evals/` file or `*.eval.*` — is blocked, like TDD blocks impl-without-test), and `pre-push` gates **passing** (if the repo has evalsets, the configured `eval` command must pass — set `"eval"` in `carja.config.json`). The gates are independent; waiving one (`CARJA_NO_EVAL` / `CARJA_SKIP_EVAL`, both logged) never skips the other. The *how* — three grading modes (rubric/LM-judge, property/assertion, reference) — lives in the on-demand `skills/writing-evals/` skill, loaded by Build when a task touches LLM-feature code. It is **not** an always-on rule: evals matter only to LLM-feature projects, so the enforcement is the (silent-when-irrelevant) hook, not static-context prose. Design: [Eval-Driven-Law](https://github.com/charlus/carja/blob/master/docs/roadmap/Eval-Driven-Law.md).

### The ship-contract (deterministic + semantic)
A change ships only if it satisfies the project's **ship-contract**, which has two complementary halves:
- **Deterministic half** — facts a command decides, enforced by git hooks/CI: the **Test-Driven Law** (a test exists), the **Eval-Driven Law** (an eval exists and passes for LLM features), the **Goodhart boundary** (no test deleted, skipped or stripped of assertions), **protected paths** (`.agents/hooks/`, `.agents/rules/`, `.agents/sandbox/` and the reviewer brief are not edited by the change they judge), and any architecture-checklist item that carries a `check:` shell command. Each gate has one logged waiver (`CARJA_NO_BOUNDARY`, `CARJA_NO_PROTECTED`, …) and never a silent one. `carja install-hooks` wires them, in the nested code repositories of an outer layout too; `carja status` shows whether they are armed, per repository. Two opt-in Claude Code `PreToolUse` hooks act earlier: `pretooluse-no-bypass.sh` denies commands that skip the git hooks, and `pretooluse-fact-gate.sh` asks for the facts before a first edit or a destructive command. Details: `.agents/hooks/README.md`.
- **Semantic half** — judgments only a reader can make, enforced by the **Checker** (`workflows/loop-checker.md`) and `independent-review`: does the diff honor the intended architecture and boundaries in spirit.

The bridge between them is `carja/0-compass/architecture-checklist.md` (`skills/architecture-checklist/`): `technical-vision`/`carve` distill each enforceable architecture decision into a checkable item — deterministic (a `check:`) where grep-able, semantic otherwise — and the Checker verifies the diff against every item, citing any it fails. This turns "follow the architecture" from a vibe into a contract, the same way the hooks turned the two Laws from prose into code.

### Naming Convention: kebab-case
All framework files use **kebab-case**: workflows (`grand-prd.md`, `quick-path.md`), skills (`code-review/`, `task-tracker/`), personas (`product-manager.md`, `carja-assistant.md`), `carja/` folders and files alike. `carja upgrade` auto-renames older Title-Case installs.

---

## System Flow

### Full Pipeline (Projects)
```
Genesis → Storyboard → Grand PRD → UX/UI → Technical Vision → Carve → Spec-It → Build → Ship → Retrospective
   |          |            |          |           |               |         |        |       |         |
Problem   Experience    Epics      Screens    Architecture      Slices    Specs    Code   Polish    Lessons
```

### Quick Track (Standalone)
```
Quick-Path → Build → Ship → (optional) Retrospective
     |          |       |
  Scope+Spec   Code   Polish
```

### Task Only
```
task-backlog.md → Do it → ship-log.md
```

---

## Request Classifier — Full Table

`AGENTS.md` carries the compact version of this. Full version, with routing detail:

| If the user says... | They need | You do |
|---|---|---|
| A question ("what is", "how does", "explain") | **Answer** | Respond directly. No workflow needed. |
| "I have an idea", "Start a new app", "New feature area" | Discovery | → `workflows/genesis.md` |
| "Storyboard", "Shape the experience" | Experience Design | → `workflows/storyboard.md` |
| "Grand PRD", "Create PRD" | Blueprint | → `workflows/grand-prd.md` → `ux-ui-design-brief.md` → `technical-vision.md` |
| "Carve", "Break it down" | Slicing | → `workflows/carve.md` |
| "I inherited this codebase", "Onboard this existing product", "What is this thing" | Brownfield Onboarding | → `workflows/survey.md` (facts from `carja survey`, the why from the human) |
| "Deepen", "Improve codebase architecture", "Find shallow modules", "Reshape for agents" | Brownfield Architecture | → `workflows/deepen.md` (Code Archaeologist; the brownfield counterpart to `technical-vision`) |
| "Spec it", "Write the spec" | Specification | → `workflows/spec-it.md` |
| "Build it", "Let's code" | Execution | → `workflows/build.md` |
| "Ship it", "Audit and ship", "Release" | Shipping | → `workflows/ship.md` |
| "Quick path", "Just build this" | Fast Track | → `workflows/quick-path.md` (skips discovery) |
| "Let's reflect", "Retro" | Learning | → `workflows/retrospective.md` |
| "Loop", "Unattended", "Autonomous", "Loop-ready" | Autonomous Loop | → `workflows/unattended-loop.md` |
| "Merge the loop's MRs", "/merge-stack <project>", "Guide me through the loop report" | Merge Stack | → `workflows/merge-stack.md` (reads `carja/1-workbench/loop-report-<project>.md`, checks each MR live, walks the owner through the merges and the manual steps; never merges itself) |
| "Update the project card", "Refresh AGENTS.md" | Project card | → `workflows/agents-md.md` (also when `carja status` says the card is a draft or stale) |
| "Brain dump", "Refine my ideas" | Skill | → `skills/brain-dump-to-epics/` |
| "CTO mode", "Designer mode", "PM mode", etc. | Thinking Partner | → load matching persona from `personas/` |
| "How does this framework work?" | Navigation | → load `carja-assistant` persona |
| "Inbox: X", "Add to inbox: X" | Capture | → `carja inbox add "X"`, else append verbatim to `carja/1-workbench/inbox.md`, no workflow |
| "Scratchpad: X" | Capture | → append verbatim to `carja/1-workbench/scratchpad.md`, no workflow |
| "What's on our plate", "status" | Status | → `carja status`; show its output verbatim. `--live` for MR or deploy status |
| Small fix, bug, quick task (already well-scoped) | Task | → add to `carja/2-backlog/task-backlog.md` |

**Not sure what you need?**
- *"I'm starting a brand new app"* or *"a major new feature area"* → **Genesis**. New problem space = needs discovery.
- *"A significant feature in an existing area"* → **Grand PRD** (if complex) or **Quick-Path** (if scope is already clear).
- *"I know exactly what to build"* → **Quick-Path**. Spec-It is for a slice Carve already made.
- *"I have a spec, let's go"* → **Build**.
- *"I don't know where to start"* → **Genesis**. It'll help you find the problem.

---

## Quick Capture

Some platforms this framework runs on (Claude Code, Antigravity 2.0) have no file browser or text editor — chat is the *only* channel the human has. Without a shortcut, there's no way to get a stray thought into `1-workbench/` except asking the agent to open a whole workflow around it, which is exactly the friction the Inbox is supposed to remove.

The convention:

- **`Inbox: <thought>`** or **`Add to inbox: <thought>`** → append `<thought>` verbatim as a new bullet in `carja/1-workbench/inbox.md`
- **`Scratchpad: <thought>`** → same, into `carja/1-workbench/scratchpad.md`
- Multiple items in one message (one per line, or semicolon-separated) → each becomes its own bullet

Prefer the CLI when it is available — `carja inbox add "<thought>"`, or the generated `/inbox` slash command. A command cannot be forgotten or reworded the way a prose rule can; the chat convention above is the fallback for platforms without the CLI on PATH.

**Rules, deliberately narrow:**
1. No workflow triggers. No discussion. No clarifying questions.
2. Don't judge, triage, categorize, or rewrite the wording — that's a second pass the human or agent does later, on purpose, when actually processing the inbox. Judging it now defeats the point: the human used this path specifically to *not* stop and think about it right now.
3. Confirm in one line (`"Added to inbox."`) and stop.

This is distinct from the Request Classifier's "small fix, bug, quick task" row, which *does* involve the agent's judgment (recognizing something is already well-scoped enough to go straight into `task-backlog.md`'s triaged, prioritized format). Quick Capture is the zero-judgment fallback for everything else — used when the human wants speed, not triage.

Mechanics live in `.agents/skills/context-engineering/SKILL.md`.

---

## Human Surfaces (reading and writing `carja/` from a terminal)

`carja help <command>` lists every option and the settings a command reads; `carja` on its own, in a project, names the next command. When the human asks how to run something, answer with that command.

`carja/` is one source of truth with several renderers. The files stay markdown — that is what makes the autonomous loop, the evidence ledger and PR review work — and these commands are projections of them for a human working from a CLI, where the IDE's file tree and rendered preview are gone.

| Command | What it is for |
|---|---|
| `carja status` | The daily question, answered in one screen: inbox depth, open tasks per priority, the work queue in the order the loop would drain it, stale documents, loop state, and whether the gates are armed (push command, git hooks wired, opt-in agent guards, waivers in the last 30 days, and the local commits and pushes that skipped the hooks). Costs no tokens and no context — never ask an agent to summarise state instead. `--live` adds each recent MR's state from `glab`/`gh`, flags a ship-log entry a merge has contradicted, and runs `deployCheck` from `carja.config.json` (none: ask the human). |
| `carja inbox add "…"` / `carja inbox list` | Deterministic quick capture and read-back. |
| `carja review <file.md>` | Hands one document to the human for sign-off: rendered in the browser, text-anchored comments, **Approve** / **Request changes**. Exit `0` approved, `2` changes requested, `1` no verdict; stdout is JSON. Run it in the background and read the JSON when it exits. |
| `carja survey [dir] [--out <file>]` | Facts about an existing codebase: languages, coverage by area (untested first), entry points, routes, config keys, dependencies. Used by `workflows/survey.md`. An area marked untested is a place to check, not a proven gap. |
| `carja view [--open]` | Renders every document in `carja/` into ONE self-contained HTML file at `carja/.views/index.html`: rendered tables, search across all documents, per-document outlines, and **backlinks** — which documents reference this one. Read loop: `carja view`, then refresh the browser tab. |

The other commands, for setup, gates and measurement:

| Command | What it is for |
|---|---|
| `carja init` / `carja upgrade` | Install the framework / move an install to the latest version (replaces `.agents/`, never touches your `carja/` knowledge; backs up first) |
| `carja install-hooks` | Wire the git hooks in `.agents/hooks/` (TDD and eval presence, Goodhart boundary, protected paths on commit; verify and evals on push) |
| `carja verify [--set <cmd>]` | Show or set the command `git push` must pass |
| `carja evidence run\|check\|list` | Run the verify command and record the result against the exact working tree; `pre-push` and the loop driver accept fresh evidence instead of re-running, and fails a run that changed files while it ran (`--stable-tree`) |
| `carja review-log append\|summary` | Record review findings and how each was handled, in 13 fixed classes. A class dismissed more than half the time is a rubric defect |
| `carja context-bill` | What the framework costs every session before an agent reads project code (always-on vs on-demand bytes) |
| `carja agents-md facts\|write\|check` | The project card in `AGENTS.md`: print the facts the code states, refresh them in the card, check the card (exit 0 = complete and current, then stamped) |
| `carja trust-verify` | Record your consent to this repo's verify command. The opt-in Claude Code Stop hook runs it only after that, because the command comes from a file anyone can edit |
| `carja loop` | The unattended loop driver. See *Running the loop* below and `carja loop --help` |

Three rules for `carja view`:

1. **The output is derived.** It is written to a gitignored folder and must never be committed or hand-edited. To change what it shows, change the markdown it is generated from.
2. **It is one file on purpose.** The page is opened over `file://`, where the browser blocks runtime loading, so nav, search index and every rendered document are stamped in at generation time. One file is also one bookmark — there is no "which file do I open next".
3. **The agent reads the markdown, not the HTML.** Nothing renders a prompt, so HTML in an instruction or state file is cost without benefit.

### Claude Code slash commands

`init`/`upgrade` generate `.claude/commands/` shims of two kinds. Do not hand-edit either — change the source and re-run `carja upgrade` to regenerate them.

**Workflow shims** — one per Carja workflow (`/build`, `/carve`, `/spec-it`, `/ship`, …). Each loads and runs the matching `.agents/workflows/<name>.md`, so the workflow file stays the single source of truth.

**CLI shims** — these front a `carja` command rather than a workflow, because capture and status must not depend on the model remembering a prose rule:

| Command | Runs | For |
|---|---|---|
| `/status` | `carja status` | Inbox depth, backlog by priority, what's next, loop state — one screen |
| `/inbox` | `carja inbox add "…"` | Capture a thought verbatim. No workflow, no triage |
| `/view` | `carja view --open` | Every `carja/` document rendered into one HTML page — tables, search, backlinks |
| `/verify` | `carja verify` | Show or set the command `git push` must pass (the push gate) |

**Skill shims:** `init`/`upgrade` also generate one `.claude/skills/<name>/SKILL.md` per skill in `.agents/skills/`, so Claude Code can find and load each skill by its description (`/handoff`, for example). Each shim redirects to the real `.agents/skills/<name>/SKILL.md`. A skill of your own in `.claude/skills/` is never overwritten, and shims for removed skills are deleted. Do not hand-edit the shims.

`/view` prints a `file://` URL; use the one the command emits verbatim. It is resolved for the platform your **browser** runs on, which is not always the one the agent runs on — under WSL a hand-made `file:///home/...` link looks right and silently does nothing.
<!-- carja:managed:end -->

<!-- Add your project-specific instructions below this line; they are preserved across `carja upgrade`. -->

---

## Workflow Registry

### Discovery
| Workflow | Trigger | Produces | Next |
|---|---|---|---|
| **Genesis** | "I have an idea", "New app", "New feature area" | Problem, Before and After, Capabilities (`genesis/`) | Storyboard |
| **Storyboard** | "Shape the experience" | Main Character, Scenes | Grand PRD |

### Blueprint
| Workflow | Trigger | Produces | Next |
|---|---|---|---|
| **Grand PRD** | "Create PRD" | Epics | UX/UI Design Brief |
| **UX/UI Design Brief** | "Design the interface" | Screens (hierarchy, states, unknown values), `DESIGN.md` | Technical Vision |
| **Technical Vision** | "Architecture" | Architecture decisions | Carve |

### Execution
| Workflow | Trigger | Produces | Next |
|---|---|---|---|
| **Carve** | "Break it down" | Implementation slices + folders | Spec-It |
| **Spec-It** | "Write the spec" | Feature Spec + Implementation Plan | Build |
| **Build** | "Let's code" | Working code, test-driven per task, Task Tracker. Runs to ship-ready, stops only for product decisions | Ship |
| **Ship** | "Ship it", "Audit and ship" | Empathy-audited code, regression tests, CI alignment, independent fresh-context review, PR/MR | Retrospective |
| **Quick-Path** | "Just build this" | Spec + Plan + Code in one pass | Ship |
| **Retrospective** | "Let's reflect" | Lessons + knowledge base updates | — |

### Brownfield & Maintenance
| Workflow | Trigger | Produces | Next |
|---|---|---|---|
| **Survey** | "I inherited this codebase", "Onboard this existing product" | `carja survey` facts, then `3-product-areas/`, `4-context/technical/` and `0-compass/` from an interview; unestablished claims marked `TBD` | Grand PRD / Deepen |
| **Deepen** | "Deepen", "Improve codebase architecture", "Find shallow modules" | Ranked deepening report; characterization-test-first + Strangler-Fig plan for reshaping shallow/scattered modules into deep ones | Carve / Build |

> **Deepen** is the brownfield counterpart to **Technical Vision**: Technical Vision designs deep modules *before* code exists; Deepen finds and safely reshapes shallow ones *after*. It's driven by the **Code Archaeologist** persona and pins behavior with a characterization test before any structure moves.

### Cross-Cutting
| Workflow | Used by | Purpose |
|---|---|---|
| **TDD-Cycle** | Build (mandatory, via `test-driven-law.md`) | RED → GREEN → REFACTOR mechanics for every task |
| **Agentic-Flow** | Any workflow designing human-AI interaction | Designing agent-facing UX |
| **Unattended-Loop** | Headless orchestrator | Recursively executes any and all lifecycle phases unattended |
| **Loop-Checker** | Unattended-Loop (independent Checker process) | Skeptical verification of the Maker's work; verdict via `checker-verdict.json`, fail-safe reject |
| **Agents-MD** | After `upgrade`, or when `carja status` flags the card | Keeps the project card in the root `AGENTS.md` true: facts from `carja agents-md write`, summaries by the agent, `carja agents-md check` as the gate |

> **Interview & drafting primitives:** Genesis, Storyboard, Grand PRD, and the UX/UI Design Brief supply their *agenda* and load the `grilling` + `collaborative-drafting` skills for the *how*. Spec-It synthesizes from blueprint context rather than re-interviewing; Quick-Path, Retrospective, Technical Vision, and Carve reference the primitives too.

### The Four Loop Types

A maturity ladder for autonomy (Anthropic's *Loop Engineering* taxonomy), and the Carja primitive that serves each rung. Climb it as the work earns it — a single well-scoped prompt still handles most daily work.

| # | Loop | When | Carja primitive |
|---|------|------|---------------------|
| 1 | **Turn-based** | Exploring, deciding, work you want to see step by step | You prompt; the agent self-checks. Carja makes the check **deterministic** — TDD `pre-commit` + verify `pre-push` **git hooks**, not just a `SKILL.md`. This is one rung *stronger* than "encode verification in a prompt": a hook is code the agent cannot reason around. |
| 2 | **Goal-based** | A measurable exit condition (tests green, zero failing checks) | `carja loop` — the deterministic driver *is* a goal loop: `goal_description` + a beat cap (the lower of `iterations.max_allowed` and `budget.max_beats`) + wall-clock budget + Evidence Rule (verify exit code) + a multi-vote adversarial **Checker** (the "evaluator") in a fresh process. |
| 3 | **Time-based** | Recurring work, same task, changing inputs | **Ignition contract** — drive `carja loop --goal "…"` from Claude Code's native `/schedule` or host `cron`. Carja does **not** ship its own scheduler; it rides the platform's. |
| 4 | **Proactive** | Event-driven, run unattended until every item is handled | `carja loop --event payload.json` (a webhook/CI shim writes the payload), or `carja loop --from-carja` to drain the inbox and backlog, + autonomy **L3** + worktree isolation + `judge-panel` (explore N solutions, judge adversarially) + PR-gated merge. |

> **The ignition contract (rungs 3–4).** A trigger seeds the run's goal but is **clamped to the operator's autonomy ceiling** in `loop-state.json` — a payload (which may come from an untrusted Slack/GitHub source) can *de-escalate* but never *escalate*. The seeded brief lands in `carja/1-workbench/loop-trigger.md`; the deterministic driver still owns every guardrail. Design: [Loop-Engineering-Alignment](https://github.com/charlus/carja/blob/master/docs/roadmap/Loop-Engineering-Alignment.md).

### Running the loop

Facts an agent needs when it works on, or inside, a `carja loop` run. Full guide: [Running-The-Loop](https://github.com/charlus/carja/blob/master/docs/Running-The-Loop.md).

- **One repository, or the outer layout.** The loop works on the repository it starts in, in an isolated git worktree per goal or task. With `loop.code_dir` (an outer `carja/` repo with the code nested inside), each item also gets a code worktree at `<code_dir>/` from the code repository's default branch: commit code there and Carja documents in the outer worktree. It opens two MRs, code first. Any other gitignored nested repository stops it, unless `loop.allow_nested_repo` is set.
- **Per-project settings** live in the `loop` block of `carja.config.json`, read from the main checkout only: `setup` (run once per new worktree), `allowed_domains` (sandbox network), `forge` (`gh` / `glab`, default from the origin host), `require_ready`, `priorities`, `inbox`, `profile` (`quality` or `balanced`, set with `carja loop profile`), `models` (one role's model over the profile, claude engine: `maker`, `maker_escalation`, `checker`, `spec`, `blueprint`, `ship`), `cost_aware` (only then does `budget.max_cost_usd` stop a run), `slices` (the projects whose carved slices are loop work), `blueprint` (the projects whose Blueprint, after Discovery, is loop work), `code_dir` (the nested code repository, in the outer layout), `blank_env` (provider API keys set empty in every beat; default the common ones, never the engine's own, `[]` turns it off).
- **Task selection** (`--from-carja`): open backlog items and inbox lines. Items marked `BLOCKED` or `NEEDS_DECISION` are never taken; with `require_ready`, only items given with `carja loop take "<item>"` (kept in `.git/carja-loop-ready.json`, so no tracked file changes) or tagged `loop-ready`. The lines indented under an item reach the agent as its details. An item whose `carja/loop/<item>` branch is on the remote is claimed (in progress or in review) and skipped; nothing marks it in the file. Merged loop worktrees are removed on `git pull` (the `post-merge` hook) and at the start of a run.
- **State.** The driver owns `loop-state.json` and copies the live one into each worktree before every beat; do not edit it, and never commit it, `maker-signal.json` or `checker-verdict.json`. A run that starts after a finished one resets its beat counter, clock and status; an interrupted one resumes.
- **One project per run, stacked.** `carja loop <project>` builds that project only, after the owner's approved Technical Vision: the Carve, then every slice, each on the branch of the item below it, never the backlog or the inbox, without the `slices`/`blueprint` settings. A one-way question stops the run at that item. The owner merges the MRs in order at the end (`carja/1-workbench/loop-report-<project>.md`); a closed MR is built again with everything above it, a changed one is kept and everything above it rebuilt. Its state and lock live in `.git/carja-loop-logs/runs/<project>/`, so a second terminal in the same folder can build another project; the same project twice, or a project run beside a `--from-carja` run, is refused. At the end, and on Ctrl+C, it removes each worktree it held that has no uncommitted change. A worktree a live run holds (`carja-holder` in the worktree's git directory) and a loop branch with no commit of its own are never removed by another run's cleanup or the `post-merge` hook. The driver commits only in the worktree it expects, on a loop branch; otherwise the run stops as `halted_isolation` and commits nothing.
- **Turning it on.** `carja loop on <project>` writes these settings for a project after listing each change and asking once; `off` takes it out. When the human asks to turn the loop on, run it with `--dry-run`, show them the list, then run it with `--yes`.
- **Blueprint.** With `loop.blueprint`, a project after Discovery runs Grand PRD, UX/UI Brief, Technical Vision and Carve, each a fresh beat (the stage's workflow plus the `## Blueprint beat` section of `unattended-loop.md`) reviewed by a fresh Checker with its lens. One MR carries all four; merging it is the owner's sign-off, and the slices are built only after it.
- **Questions.** A one-way door (cannot be undone cheaply, contradicts an earlier decision, changes running cost) is not decided alone: the beat writes one numbered round to `carja/1-workbench/questions/<item>.md` and signals `{ "questions": true }`. A fresh Checker confirms each question, the item waits as `awaiting_answers`, and the next run resumes it once every `Answer:` holds an option number or `your pick`. `carja status` lists the waiting rounds and how often the owner takes the recommendation.
- **Blocked or rejected.** A Maker that cannot go on without a human writes `{ "escalate": true, "reason": "…" }` to `maker-signal.json`: the run ends as `escalated` and the reason goes to the inbox. After a rejection, the next beat's prompt carries the verify output and the Checker's reasons (the last 3 attempts), and after 2 rejections a beat uses `loop.models.maker_escalation` when it is set.
- **Merge.** A PR/MR is opened only at L3 in the execution phase, in pair and swarm mode alike. Below that, branches are kept for human review.
- **Slices.** With `loop.slices`, a project's lowest open slice runs Spec beat (`spec-it.md` plus the `## Spec beat` section of `unattended-loop.md`), a spec review by the Checker, Build until ship-ready, then Ship: one MR per slice.
- **Ship before the MR.** At L3 a task's Ship beat runs `ship.md` Phases 1–5 in its worktree (the `## Ship beat` section of `unattended-loop.md` says what the driver does instead of Phases 4 and 6). The bookkeeping rides in the MR; the driver opens it with the body the Ship beat wrote.
- **Decisions made alone.** The Maker logs each decision the spec did not settle in `carja/1-workbench/rulings.md` (`- [YYYY-MM-DD HH:MM] <task id> · <decision> · why: … · if wrong: low|medium|high · …`). The PR lists every ruling on its branch, a `high` one goes to the inbox while the run continues, and the Checker reviews them against the spec.
- **Before a run.** `carja loop doctor [dir] [--beat]` checks the setup, the verify command in a fresh worktree, the sandbox profile and the forge login, and prints each fix.
- **Following a run.** `carja watch` (from the event log `.git/carja-loop-logs/events.ndjson`): per project, the item and its place in the stack, the step in progress and since when, minutes per item, the expected end, a wait for the usage limit, the last stop in words, and each item's last recorded fact.
- **The usage limit.** A beat that hits the agent CLI's limit waits for the reset the CLI announces, then runs again, up to `loop.quota_max_wait_min` (default 330); beyond, or with no reset time, the run stops.
- **Dependencies.** No beat reaches a package registry. After a Build or Ship beat the driver reads the manifests it changed (npm, PyPI, Go, Cargo, Maven/Gradle, RubyGems, Composer, NuGet): a dependency the Technical Vision names is checked on its registry and in OSV (exists, pinned, at least `loop.dependency_min_age_days` old, not yanked, no known vulnerability) and installed with `loop.install`; any other is a question round; a failed check or an unreachable registry stops the item.
- **Conflicts.** An MR that would conflict only in Carja documents is not a stop: the loop takes what it lands on, keeps both sides, verifies again and names the documents in the report. A code conflict stops the item.
- **Merging.** `/merge-stack <project>` (`workflows/merge-stack.md`) walks the owner through the report's MRs in order, each checked live, with each item's Owner actions. The loop's messages, reports and waiting rounds are hidden from git, so the owner's folder stays clean.
- **Evidence after a run.** The run's cost by role in `carja status`, escalations in `carja/1-workbench/loop-messages.md` (not tracked by git; `carja status` names the newest), the trail in `0-compass/ship-log.md`, and each beat's full agent output in `.git/carja-loop-logs/`.

---

## Context File Manifest

What each workflow produces, and who reads it next:

| Upstream | Produces | Consumed by |
|---|---|---|
| Genesis | Problem, Before and After, Capabilities (`genesis/`) | Grand PRD, Technical Vision (constraints) |
| Storyboard | Main Character, Storyboard | Grand PRD |
| Grand PRD | Epics | UX/UI, Technical Vision, Carve, Spec-It |
| UX/UI Design Brief | Screens, `DESIGN.md` | Technical Vision, Carve, Spec-It, Build |
| Technical Vision | Architecture | Carve, Spec-It |
| Carve | Implementation Overview, Implementation folders | Spec-It |
| Spec-It | Feature Spec, Implementation Plan | Build |
| Build | Working code, Task Tracker, Ship-Log entry | Ship, Retrospective, `context-updater` |
| Ship | Regression tests, CI updates, PR/MR | Retrospective |
| Retrospective | Lessons, knowledge base updates | `3-product-areas/`, `4-context/` |

---

## Skill Registry

### Interview & Drafting Primitives
The reusable "how" that discovery/blueprint/spec workflows load instead of re-implementing an interview or a draft loop.
| Skill | Purpose |
|---|---|
| `grilling` | The interview primitive — short numbered rounds of the questions that are ready, recommend an answer to each, look facts up instead of asking, one convergence gate; its Lens Pass lets personas challenge a draft |
| `collaborative-drafting` | The drafting primitive — lead with a complete draft the human corrects (propose → discuss → coverage-check → confirm), not a blank-page questionnaire |

> Lifecycle routing (which phase/workflow a request maps to) lives in the always-on **Request Classifier** in `AGENTS.md` and its full table above — not in a skill. Both harnesses reach workflows directly (Antigravity: `.agents/workflows/*.md` slash-commands; Claude Code: generated `.claude/commands/*.md` shims), so no proxy skill is needed.

### Build Discipline
| Skill | Purpose |
|---|---|
| `analyze-tests` | Test strategy before any implementation code is written |
| `verification-gate` | Evidence-before-assertions gate — the Iron Law, operationalized |
| `task-tracker` | Live task tracker maintained through Build |
| `code-review` | Two-stage review after implementing: spec compliance, then code quality against a Fowler smell baseline |
| `independent-review` | The fresh-context review gate — a reviewer that did *not* produce the artifact (PRD, architecture, spec, carved plan, diff) decides whether it's ready before save/handoff. Loaded by the blueprint workflows; Ship Phase 4 is its reference implementation Conflicting findings are settled in a fixed order: security and data integrity, acceptance criteria, architecture, performance, design. |
| `behavior-validator` | Source-blind, black-box validation of the *running* artifact with adversarial anti-cheat probes — the dynamic complement to `verification-gate` (author-run) and `independent-review` (static). Used at Ship / loop execution when a change has a runtime surface |
| `context-updater` | Updates Product Areas + Context after Build/Retrospective |
| `trace-documentation` | Links backlog items to the code that implemented them |
| `context-engineering` | Reading/writing `carja/` state and the task backlog correctly |
| `architecture-checklist` | Turns enforceable architecture decisions into checkable items in `0-compass/architecture-checklist.md` — a `check:` command where grep-able, semantic otherwise — that the Checker verifies every diff against |
| `writing-evals` | The how of the Eval-Driven Law: evalsets for LLM-output features, three grading modes (rubric/LM-judge, property, reference) |

### Engineering
| Skill | Purpose |
|---|---|
| `systematic-debugging` | 4-phase root-cause debugging — build a command that goes red on *this* bug first, then rank falsifiable hypotheses |
| `frontend-design` | Design thinking for web UI |
| `design-system` | Create, extract or maintain `DESIGN.md` at the code repository root (`carja design migrate` moves an old `4-context/design/` folder into it) |
| `i18n-localization` | Internationalization and translation management |
| `git-worktrees` | The item's own hidden worktree (`carja work <item>`): the owner's folder stays on its default branch, merged worktrees go on `git pull` |
| `architecture-patterns` | Architectural trade-off analysis and ADRs |
| `lint-and-validate` | Static analysis after every modification |
| `subagent-isolation` | Scout pattern — delegate read-heavy discovery, parallelize, isolate mutating work in worktrees |
| `model-routing` | Match model tier + reasoning effort to task difficulty |
| `judge-panel` | Divergent-then-convergent decision primitive for wide, hard-to-reverse forks — generate N candidates from different angles, judge independently, synthesize the winner. Opt-in; loaded by Technical Vision for architecture |

### Git Integration
| Skill | Purpose |
|---|---|
| `git-workflow` | Commit conventions, branch naming, PR/MR templates |
| `git-lab-cli` | GitLab workflow via `glab` |
| `git-hub-cli` | GitHub workflow via `gh` |

### Product & Process
| Skill | Purpose |
|---|---|
| `brain-dump-to-epics` | Unstructured ideas → structured Epics |
| `domain-modeling` | Active ubiquitous-language discipline — keeps a living domain model in sync with spec, code, and UI |
| `ux-reviewer` | UX feedback against `DESIGN.md`; the visual review of rendered screens, run only on request |
| `system-janitor` | Scans for misplaced files, recommends reorganization |
| `handoff` | Compact the conversation into a self-contained handoff doc before leaving the ~120k-token "smart zone"; used to pass work between sessions and loop iterations |
| `skill-registry` | Manages `carja add/remove/list/search` against your configured registry |

### Reference Library
Not skills — on-demand reference docs in `.agents/references/`. They carry advice or templates, not an owned workflow / tool boundary / evidence contract, so they were demoted out of the skill catalog. Read the relevant one when its topic comes up; a skill is for *doing*, a reference is for *looking up*.

| Reference | Read it when | Natural caller |
|---|---|---|
| `references/clean-code.md` | writing or reviewing implementation code | Build, `code-review` |
| `references/testing-patterns.md` | choosing test types / structuring a suite | Build, `test-driven-law`, `analyze-tests` |
| `references/documentation-templates.md` | scaffolding a README / ADR / changelog / API doc | Ship, Technical Vision (ADRs) |
| `references/deployment-procedures.md` | planning a deploy or rollback | Ship, `architecture-patterns` |

---

## Persona Registry

| Persona | Trigger | Thinks About |
|---|---|---|
| **CTO** | "CTO mode" | Long-term tech strategy, build vs. buy, technical debt |
| **Architect** | "Architect mode" | Modularity, coupling, portability, failure modes; challenges Technical Vision, triggered by dependency manifests |
| **Product Manager** | "PM mode" | User value, prioritization, outcomes over outputs |
| **Designer** | "Designer mode", "Make it look premium" | Visual quality, design systems, `DESIGN.md` |
| **Code Archaeologist** | "Archaeologist mode", "Explain this codebase", "Deepen the architecture" | Legacy code, refactoring strategy, Chesterton's Fence, deep modules / narrow interfaces (drives the `deepen` workflow) |
| **Security Auditor** | "Security mode", "Check security" | OWASP Top 10, supply chain, zero trust, pentest methodology |
| **Database Architect** | "Database mode", "Design the schema" | Schema design, query optimization, migrations |
| **Performance Optimizer** | "Performance mode", "Make it faster" | Core Web Vitals, profiling, bundle size |
| **Checker** | "Checker mode" | Independent skeptical audits, programmatic testing, anti-reward hacking |
| **Carja Assistant** | "How does this work?" | Framework navigation, workflow selection, process guidance |

**Domain personas load themselves.** `carja personas [paths…]` maps the files a change touches to the Architect, Designer, Security Auditor, Database Architect and Performance Optimizer, and prints each one's Review Lens. Build loads them per task, the reviewer in Build, Ship and the loop Checker gets the Review Lens lines. A project changes the path rules under `personas` in `carja.config.json` (`{"designer": {"extensions": [...], "words": [...]}}`, or `false` to switch one off).

---

## Skill Registry CLI (Dynamic Skill Loading)

Beyond the skills bundled in `.agents/skills/`, more can be pulled from a registry you configure:

```bash
carja list [--remote]        # local or registry skills
carja search <query>         # search the registry
carja add <skill-name>       # install a skill
carja remove <skill-name>    # uninstall a skill
```

Requires `carja.config.json` at the project root pointing at your registry. `carja init` runs tech-stack detection and suggests relevant skills to add automatically.

---

## Progressive Disclosure — Adoption Levels

Not everyone needs the full system. This is a *framework-adoption* scale — distinct from context-loading progressive disclosure (the root `AGENTS.md` — classifier, prime-directive, verification-iron-law, test-driven-law, project card — loads every session; `loop-guardrails` is loop-scoped and loaded only by the unattended-loop workflow; everything else, including this file, loads on demand).

### Level 1: Just Ship
Use: `task-backlog.md`, Quick-Path, Build, Ship, Archive.
Good for: solo devs, quick features, known scope.

### Level 2: Plan Then Ship
Add: Spec-It, Carve, `3-product-areas/`.
Good for: complex features that need a PRD and an architecture pass.

### Level 3: Full Pipeline
Add: Genesis, Storyboard, Blueprint workflows, Retrospective, all personas.
Good for: new products, major feature areas, high-velocity AI-assisted development.

---

## Self-Test

```bash
bash .agents/tests/check-carja.sh
```

Validates structure, naming, and that no stale paths have crept back in.
