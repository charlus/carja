# 🎼 Carja Framework

**Carja** — a framework for **disciplined, verifiable, autonomous AI software engineering**.

Carja is a harness layer: it configures your AI coding assistant (Claude Code, Antigravity, Codex) with a full engineering methodology — Plan → Design → Build → Ship → Learn — and enforces the discipline in **code, not prose**, so AI output becomes something you can actually depend on.

**What makes it different:**

- **Laws enforced by code.** Deterministic git hooks gate every commit and push: no implementation without a test (Test-Driven Law), no LLM feature without an eval (Eval-Driven Law). Prose rules are advisory; a hook can't be reasoned around.
- **Evals for the non-deterministic surface.** Tests verify deterministic code; **evals** verify LLM output. A **ship-contract** (`architecture-checklist`) turns "follow the architecture" into checkable items the Checker verifies before anything merges.
- **An autonomous, multi-engine loop.** `carja loop` drives a Maker/Checker build cycle unattended across Claude Code / `agy` / `codex`, with safety baked in: PR-gated merge (never a direct push), sandbox isolation, and an Evidence Rule — a model can't self-declare victory.
- **One instruction file, every harness.** The root `AGENTS.md` (the AAIF standard) carries the framework's laws and a short **project card** — stack, commands, layout, purpose, conventions — so every session starts knowing the project, without a single tool call.
- **Built for a terminal, not an IDE.** Project state stays plain markdown, so the loop and every git-based gate can read it — but you don't have to read it with `cat`. `carja status` answers "what's on our plate" in one screen; `carja view` renders every document into a single searchable HTML page with backlinks.

**How to use it:** every command and setting, by what you want to do, is in [`docs/Using-Carja.md`](docs/Using-Carja.md). Inside a project, `carja` on its own says where the project stands and the next command, and `carja help <command>` shows every option.

### Why Carja

*Carja* is *jacquard* in verlan. The Jacquard loom was the first machine that ran a program unattended. Carja runs coding agents unattended, inside rules enforced by code.

The project was called Conductor until 6.x. It was renamed in 7.0.0 because Google's Conductor uses the same `conductor/` folder. `carja upgrade` moves a 6.x project in one reviewable branch, and the `conductor` command still works through 7.x.

---

## Quick Install

```bash
npx github:charlus/carja init
```

This scaffolds the full Carja Framework into your project:

```
your-project/
├── .agents/              # AI agent core (rules, workflows, skills, personas, hooks)
│   ├── AGENTS.md        # Source of the framework block in the root AGENTS.md (classifier)
│   ├── how-it-works.md  # Full reference, read on demand
│   ├── rules/           # Laws (Prime Directive, Verification, Test-Driven, Live State; loop guardrails)
│   ├── workflows/       # Genesis → Build → Ship pipeline
│   ├── skills/          # 32 modular skills
│   ├── personas/        # 10 thinking partners
│   ├── hooks/           # Deterministic enforcement (TDD + Eval git hooks)
│   ├── references/      # On-demand reference docs
│   └── tests/           # Framework self-test
├── carja/           # Project state (all managed artifacts)
│   ├── 0-compass/       # North Star & Ship Log
│   ├── 1-workbench/     # Active work (scratchpad, inbox, loop-state.json)
│   ├── 2-backlog/       # Queued work
│   ├── 3-product-areas/ # Feature inventory
│   ├── 4-context/       # Tribal knowledge
│   ├── 5-templates/     # Document templates
│   └── 6-archive/       # Completed work
└── AGENTS.md            # The one instruction file every harness loads (framework block + project card)
```

### Options

```bash
# Install into a specific directory
npx github:charlus/carja init ./my-project

# Only install .agents/ (for existing projects; run upgrade afterwards to refresh AGENTS.md)
npx github:charlus/carja init --agent-only

# Overwrite an existing installation
npx github:charlus/carja init --force
```

### Upgrading

Already have Carja installed? Upgrade to the latest:

```bash
npx github:charlus/carja upgrade
```

Upgrade works from **any prior version** (V4, V5, or a hand-copied install) on a single principle — **your `carja/` project knowledge is preserved; the `.agents/` methodology is replaced.** It will:
- **Back up first** — the existing `.agents/` (and any migrated folders) are copied to a git-ignored `.carja-backup/<timestamp>/` before anything changes; a failure mid-run auto-restores.
- **Replace the instructions** — `.agents/` framework files (workflows, skills, rules, personas) are overwritten with the current version, so a methodology upgrade actually lands. **Custom** skills/workflows you added are carried forward; new core capabilities (e.g. the interview primitives) install even if they postdate your original selection.
- **Refresh `carja/5-templates/`** — the framework document scaffolding — while leaving all your knowledge in `0-compass`, `2-backlog`, `3-product-areas`, `4-context`, `6-archive` untouched.
- **Migrate structure & schema** — legacy `.agent/` / `.conductor/` / root numbered folders → the `carja/` dashboard; `loop-state.json` → the current schema.
- **Write the root `AGENTS.md`** — its framework block is regenerated from `.agents/`; your own text in it is kept. The old `CLAUDE.md` / `GEMINI.md` stubs are removed, and any notes you wrote in them move into `AGENTS.md`. Claude Code reads `AGENTS.md` from v2.1.277, when no `CLAUDE.md` is present; `upgrade` and `status` warn otherwise. Your `CHANGELOG.md` is never touched.
- **Point at DESIGN.md** — if `carja/4-context/design/` still holds your design notes, `upgrade` tells you to run `carja design migrate`. It never moves them itself.
- **Stamp the version** — records the framework version for idempotent future upgrades.
- **Commit itself** — in a git repo, it commits exactly the framework files it wrote, and nothing of yours. Then `git push` as usual. If you had uncommitted edits in those files, or pass `--no-commit`, it prints the one command to run instead.

Preview any upgrade with `upgrade --dry-run` (prints the plan, writes nothing).

After an upgrade that created `AGENTS.md`, ask your agent to run the **agents-md** workflow (`/agents-md` in Claude Code) to write the project card. `carja status` reminds you until it is done.

---

## One Instruction File: `AGENTS.md`

Claude Code (2.1.277+), Codex, Copilot, Cursor and the other tools that follow the standard load the root `AGENTS.md` at the start of each session (Antigravity: assumed, not verified). Carja writes two blocks into it and never touches anything you write below them:

- **Framework block** — the request classifier and the three laws, **generated** from `.agents/` by `init`/`upgrade`. Edit `.agents/`, never the block.
- **Project card** — at most 3 KB. `carja agents-md write` fills Stack, Commands, Layout and the product-area list from the code; the **agents-md** workflow has the agent write Purpose, Conventions and one line per area from `carja/`; `carja agents-md check` exits 0 only for a complete card whose facts still match the code, then stamps it. `carja status` names the files that changed since.

Measured on a real project (5 project questions, 2 runs each, read-only tools): with the card, the agent needed **2.3 turns per question instead of 5.9**, cost **35% less** and took **half the time**. Answers were equally correct on 4 questions; on the fifth ("what must pass before I push?") only the card runs named the lint gate in CI. Small sample, one project — a direction, not a benchmark.

**Where the file lives.** Start your agent in the folder that holds `carja/` and `.agents/`; `AGENTS.md` sits there. On a solo project that is the code repository. On a team project you can keep Carja in a private outer folder with the team's repository nested inside: your `AGENTS.md` never reaches your colleagues, Claude Code still reads the team's own `AGENTS.md` when it works in their code, and the card's facts come from the nested repository. The git hooks guard the nested code repositories too: `carja install-hooks` wires them, and `carja verify --repo <dir> --set "<cmd>"` sets each one's push check. `carja loop` runs in that layout too: `carja loop on <project>` finds the nested code repository, and each item gets a code worktree and two MRs, the code MR to the team's repository first, then the state MR to yours.

Do not keep a `CLAUDE.md` or `CLAUDE.local.md` next to it: Claude Code then reads those instead of `AGENTS.md`. `init`, `upgrade` and `status` warn when they find one.

### Skill Registry (optional)

Beyond the 32 core skills bundled in `templates/`, Carja can download tech-specific or domain skills on demand from a registry you configure:

```bash
npx carja list --remote          # browse the registry
npx carja search react           # search by keyword
npx carja add react-components    # install a skill
npx carja remove react-components # uninstall a skill
```

This requires a `carja.config.json` (scaffolded by `init`) pointing at your own skills registry — there is no public registry yet, so this is aimed at teams running a private one (e.g. on GitLab, via `glab`).

---

## How It Works

Tell your AI assistant what you need. Carja classifies and routes:

| You say... | Carja routes to |
|:---|:---|
| "I have an idea" | **Genesis** workflow → full problem exploration |
| "Build it" | **Build** workflow → verified execution, run to ship-ready without stops |
| "Quick path" | **Quick-Path** → skip discovery, go fast |
| "I inherited this codebase" | **Survey** workflow → facts from the code, the why from you |
| "Loop", "Unattended" | **Unattended-Loop** workflow → headless autonomous run |
| "Update the project card" | **Agents-MD** workflow → the card in `AGENTS.md`, checked by `carja agents-md check` |
| "CTO mode" | **CTO** persona → strategic thinking partner |
| "Security mode" | **Security Auditor** persona → vulnerability analysis |

### The Pipeline

```
Genesis → Storyboard → Grand PRD → UX/UI Design Brief → Technical Vision → Carve → Spec-It → Build → Ship → Retrospective
   ↑                                                                                                  ↑
   └── Discovery Phase ─────────────────────────────────────────────── Execution Phase ──────────────┘
```

Run each planning step in a fresh session. Every step ends with the exact next command and the folder to read, for example `/clear`, then `/carve carja/2-backlog/project-backlog/<Project>`. The next session reads that folder and does not ask. See `.agents/skills/handoff/SKILL.md`, *Between workflows*.

### What's Inside

- **19 Workflows** — From Genesis (ideation) to Build (verified execution) to Ship, **Survey** for a codebase you inherited, **Agents-MD** for the project card, **Merge-Stack** to walk you through a loop run's MRs, plus the headless **Unattended-Loop** orchestrator and its independent **Loop-Checker**
- **32 Skills** — including the `grilling` and `collaborative-drafting` interview/drafting primitives, `writing-evals` + `architecture-checklist` (the ship-contract), `handoff` (context hygiene), Verification Gate, Code Review, Systematic Debugging, and more
- **10 Personas** — Thinking partners plus the **Checker**. `carja personas` loads the Architect, Designer, Security Auditor, Database Architect and Performance Optimizer automatically when a change touches their files

Full reference: [`how-it-works.md`](templates/.agents/how-it-works.md) (installed as `.agents/how-it-works.md`, read on demand).

*Carja uses **Progressive Disclosure**: every session loads only the root `AGENTS.md` (about 6 KB of framework plus the project card) and the skills' one-line descriptions. Workflows, skill bodies, personas and the full reference load when they are used.*

---

## An Engineering Team, With You as Product Owner

The personas are not decoration you have to remember to call. They are loaded from what the work touches:

```bash
carja personas src/auth/LoginForm.tsx db/migrations/004.sql   # → designer, security-auditor, database-architect
carja personas                                                 # the same, for everything this branch changed
```

- **Build** loads each listed persona before writing the first test of a task. The reviewer in Build, Ship and the loop gets each persona's **Review Lens**: 3 to 5 checks, such as "every colour comes from the tokens" or "a failed permission check denies access".
- **Upstream**, Spec-It turns those checks into acceptance criteria, and a **Lens Pass** lets the Architect, Database Architect, Security Auditor and Performance Optimizer challenge the Technical Vision, and the Product Manager challenge Genesis and the Grand PRD. Engineering answers are recorded as decisions, not asked.
- **Conflicts are settled by the team**, in a fixed order: security and data integrity, acceptance criteria, architecture, performance, design. You are asked only when every option changes what the user sees or does. `carja review-log` refuses an override that reverses that order without your decision.

### DESIGN.md keeps the UI coherent

One `DESIGN.md` at the root of each code repository holds the visual identity (an install with two products, such as a public site and a CMS, has one per product): theme, colour roles, typography, layout, component styling, and the file that holds the token values. The UX/UI Design Brief drafts it for your approval. Build extracts it from existing code when it is missing. It is a system, not a philosophy: besides colours and type it fixes the patterns (how a record is edited, how a form opens), the data display (dates, unknown values) and the reference screens a new page should match. The Designer reads it before every UI change, and a new pattern is added to it in the same change, so a screen built months later still belongs.

The UX/UI Brief specifies each screen's experience, not only its function: what the user sees first, every state from read and edit to empty and by status, and how a missing value looks. A visual review of the rendered screens is available when you ask for it. It is off by default, for cost and speed.

Projects that kept their design notes in the old `carja/4-context/design/` folder combine them with `carja design migrate` (`--dry-run` to preview). It never overwrites an existing `DESIGN.md` and leaves a pointer in each old file.

---

## Reading Your Project From a Terminal

Carja keeps project state in plain markdown under `carja/`. That is deliberate: it is what lets the autonomous loop drain a backlog, the evidence ledger fingerprint tracked content, and every quality gate run through a diff and a PR. Move that state into a database and all three break.

But markdown was pleasant to *read* because an IDE rendered it. Drive your agent from a CLI instead and browsing your own project becomes `ls`, `cd`, `vim`, decipher a table by eye, quit, repeat. So the files stay, and gain renderers.

### `carja status` — the daily question

```bash
carja status
```

```
  acme-app · carja  8 Sep 2026, 09:14

  Inbox      2   Backlog    6   Docs      48
  P1         2   P2         2   P3         2
  Loop     discovery · idle · beat 0/20 · L1

  Next up — the order the loop would drain it
    1  bugfix  Fix login timeout bug on mobile                  P1
    2  task    Update README with new installation steps        P1
    3  triage  rename the export button
```

Under the counts, three lines answer "is anything actually enforced here?": the **Push gate** command, whether the git **Gates** are armed (with the fix when they are not, and which opt-in agent guards are on), and the **Waivers** logged in the last 30 days. A fourth line, **Skipped**, appears when local commits or pushes in the last 14 days did not run the hooks (`--no-verify`, `CARJA_HOOKS=off`, or a git client that ignores hooks), with their hashes. Each hook writes a heartbeat line in the git directory and status compares it with the reflog. Commits from before `carja install-hooks` are not judged.

That queue is the **same** one `carja loop` drains, in the same order, from the same parser — a preview of the fleet's next move, not a second opinion about it. `--json` for scripts, `--no-color` for pipes.

**`--live`** adds what the files cannot know: the state of each MR the newest ship-log entries name, asked of `glab` or `gh` now, and the output of the project's `deployCheck` command. An entry that still says "not merged" for a merged MR is flagged. With no `deployCheck` in `carja.config.json`, status says to ask you, and the agent does (the Live State Law). Plain `status` makes no network call.

```json
{ "deployCheck": "./scripts/what-is-deployed.sh", "repos": { "website-cms": { "deployCheck": "make deployed" } } }
```

Reading state this way costs **no tokens and no context**. Asking your agent to summarise the backlog costs a full turn, every time, for the question you ask most often in a day.

### `carja inbox` — capture that can't be forgotten

```bash
carja inbox add "the export button should say Download"
carja inbox list
```

Appended verbatim to `carja/1-workbench/inbox.md`. No workflow, no clarifying questions, no triage — triage is a later pass, on purpose. `Inbox: X` in chat still works and Claude Code users get an `/inbox` command, but the CLI is the path that can't be reworded or skipped.

### `carja view` — every document, rendered

```bash
carja view --open
```

One self-contained HTML file (`carja/.views/index.html`) holding the whole `carja/` folder: rendered tables, search across every document, per-document outlines, light/dark, and **backlinks** — which specs and PRDs reference the document you're reading. That last one exists only because generation sees every file at once; no folder tree or `grep` can show it.

It's one file rather than a site for two reasons. The page opens over `file://`, where the browser blocks runtime loading, so nav, search index and every rendered document are stamped in at generation time. And one file is one bookmark — there's no "which file do I open next". The read loop becomes `carja view`, then refresh the tab.

The output is **derived**: written to an ignored folder, regenerated whole each run, never committed — and absent from both `status` and a blanket `add -A`, which is how it would otherwise get swept into a commit. To change what the page says, change the markdown it came from.

> On WSL the command prints a `file://wsl.localhost/<distro>/…` URL, because a Windows browser can't resolve `file:///home/...`. Use the URL the command prints — a hand-made one looks correct there and silently does nothing.

### `carja review` — approve a document without pasting it

```bash
carja review carja/3-product-areas/billing/spec.md
```

The agent runs this when a document needs your sign-off. The document opens rendered in your browser. Select text to comment on it, then press **Approve** or **Request changes**. Your verdict and comments return to the agent as JSON, with exit `0` (approved), `2` (changes requested) or `1` (no verdict). Feedback is written to disk before each response, so a crashed agent loses none of it, and an approval is valid only for the exact text you approved.

The page is served on loopback and accepts same-origin JSON only.

### `carja survey` — the facts about a codebase you inherited

```bash
carja survey --out carja/1-workbench/survey.md
```

File and language counts, test coverage by area with the untested areas first, entry points, HTTP routes, configuration keys and dependencies. Facts only: it does not guess what the product is for. The **Survey** workflow ("I inherited this codebase") runs it, interviews you for what the code cannot say, and writes the `carja/` knowledge base, marking every claim it could not establish `TBD`.

Coverage is attributed by what a test imports, then by name, so an area marked untested is a place to check, not a proven gap.

---

## The Verification Iron Law

> **No completion claims without fresh verification evidence.**

Before claiming any work is done, the agent must run a check, read the output, confirm it matches, and only then claim completion. "Should work" is not evidence.

Carja backs its laws with **code, not just prose** — deterministic git hooks (`.agents/hooks/`, wired by `carja install-hooks`), because prose rules are advisory and only code enforces:

- **Test-Driven Law** — a `pre-commit` gate blocks implementation code staged with no test, or with a test change that adds or changes no assertion.
- **Goodhart boundary** — the cheapest way to make tests pass is to remove them. `pre-commit` blocks a commit that deletes a test file, adds a skip marker (`.skip`, `.only`, `@pytest.mark.skip`, `#[ignore]`…) or net-loses assertions.
- **Gate integrity** — the other cheap way to green is to switch a check off. `pre-commit` blocks a new `@ts-ignore`, `# type: ignore`, bare `# noqa`, file-wide `eslint-disable` or coverage ignore in product code, `continue-on-error`/`allow_failure` in CI, `--no-verify` in a script, and a `TODO` with no issue reference. `pre-push` blocks a `[skip ci]` commit, and a verify that exits 0 but says it ran no test. The limits were set on 9,662 real commits so that ordinary work passes (`hooks/README.md`).
- **Review gate** — `pre-push` refuses a change of 50 or more changed non-test lines of code, or one on a risk path (auth, payments, migrations, CI and similar), without an independent APPROVE recorded for it. Ship records it with `carja review-log verdict APPROVE`; the loop records its Checker's. Waiver: `CARJA_NO_REVIEW="why"`.
- **Protected paths** — the change being built does not edit what judges it. Edits to `.agents/hooks/`, `.agents/rules/`, `.agents/sandbox/` and the reviewer brief are blocked, and the hooks judge each change with the library already committed, so deleting or rewriting it switches nothing off. `carja upgrade` commits its own framework changes, so an upgrade needs no extra step. With a remote, it commits on its own `chore/carja-<version>` branch for a merge request, never on the default branch or a feature branch.
- **Eval-Driven Law** — tests verify the deterministic surface; **evals** verify the non-deterministic LLM-output surface of the apps you build. If a feature calls an LLM provider, a `pre-commit` gate requires an evalset alongside it and a `pre-push` gate runs it — see the `writing-evals` skill (three grading modes). The **ship-contract** extends this: `architecture-checklist` turns "follow the architecture" into checkable items the Checker verifies. Every escape hatch is logged, never silent.

The push gate runs one command per repository: `carja verify` shows it, `carja verify --set "npm test"` sets it, and `carja trust-verify` records your consent to that command before the agent's Stop hook may run it: a cloned repository can name any command it likes.

Every escape hatch is an environment variable with a reason (`CARJA_NO_BOUNDARY="why"`), logged to `carja/0-compass/ship-log.md`.

Two **opt-in** Claude Code `PreToolUse` hooks act before the action rather than at the commit (setup in [`hooks/README.md`](templates/.agents/hooks/README.md)):

- **`pretooluse-no-bypass.sh`** denies Bash calls that skip the git hooks (`--no-verify`, `commit -n`, `-c core.hooksPath=`, including through `env`, `sh -c` and shell quoting). It stops the ordinary bypass, not a determined one: the server-side PR gate stays the backstop.
- **`pretooluse-fact-gate.sh`** makes the agent state the facts before its first edit of a file (the failing test), its first new file (what already does this), and each destructive command. It changes what the agent reports: gated runs named the files their change affects 4/4, ungated 0/4 (n=4, see `test/evals/`). It has not been shown to change the result. ECC's pre-registered study of the same mechanism (336 billed trials) found no established benefit on outcomes and 35–45% more turns and spend.

**And the law now has a memory.** "Fresh evidence" used to mean *fresh at the moment of the check* — after that the result was trusted indefinitely, which is why a review round would re-run the whole suite to prove something it had already proven. `carja evidence` binds a verification run to a **content fingerprint of the working tree**:

```bash
carja evidence run --label tests -- npm test     # run it, and record what it ran against
carja evidence check --label tests               # FRESH / STALE / MISSING
```

Commit exactly the code that was tested and the evidence stays **FRESH**. Add an untracked source file and it goes **STALE**. A run that changes tracked or new files while it runs (snapshots, a lint fix, a lockfile) is never FRESH, and `pre-push` runs the command with `--stable-tree`, which fails such a run and names the files: the code that passed is not the code on disk. `pre-push` and the loop driver use this to skip a re-run they do not need — and only ever to *skip* one: no ledger, no CLI, or any doubt at all, and the command runs. The ledger can never satisfy the gate on its own.

---

## 🤖 Autonomous Loop Backend (V6)

Carja drives headless, unattended building through a **deterministic loop backend** — a pure state machine (`src/loop/driver.js`), not a prose-only prompt. Run it with `carja loop`, or trigger the **Unattended-Loop** workflow from a recursive harness.

The driver reads and writes **The Spine** (a durable JSON ledger, `carja/1-workbench/loop-state.json` — v2 schema) and enforces the guardrails in code, not just advice:
* **Iteration Ceiling & wall-clock budget** — bound token spend on headless runs.
* **Driver-observable stall detection** — halts when progress stops instead of looping forever.
* **The Evidence Rule** — task completion resolves from the verify command's exit code, fail-safe; a model can't self-declare victory.
* **The Scoping Barrier** — headless runs are refused during `discovery` (that phase needs a human).

Around the driver:
* **Platform adapters** (`src/loop/adapters/`) — Claude Code (primary), Antigravity (`agy`), and Codex (`codex`), each verified against the installed CLI; selected via `--platform` → `loop-state.json` → auto-detect.
* **Maker/Checker split** — the Maker builds in an isolated git worktree; an **independent Checker** process verifies via a multi-vote verdict (`checker-verdict.json`, fail-safe reject). A rejected beat passes the verify output and the Checker's reasons to the next one, a Maker that is blocked escalates to your inbox instead of burning beats, a decision that cannot be undone cheaply comes to you as one numbered round of questions while other work goes on, a project's Blueprint (after your Discovery) arrives as one MR whose merge is your sign-off, each carved slice then runs from spec to its own MR, and every decision it makes alone is logged, listed in the PR and, when risky, sent to your inbox.
* **Sandbox gate** — real headless runs are gated behind a sandbox (`--unsafe-no-sandbox` to override); L3 requires `cli-native` (the CLI vendor's own sandbox — Anthropic bubblewrap for `claude`, no Docker image needed) or a container.
* **Swarm scaling & autonomy slider (L0–L3)** — parallelize independent work with a PR-gated merge queue. Before a merge, `git merge-tree` predicts conflicts: clean branches land first and a colliding branch is escalated by name instead of opening a PR that cannot merge.

**Ignition contract** — the driver is a *goal* loop with no scheduler of its own (by design). Seed it from an external trigger and it composes into the **time-based** and **proactive** loops of Anthropic's Loop-Engineering taxonomy:

```bash
# recurring (drive from Claude Code /schedule or host cron)
carja loop --goal "check for new TODO comments and address them"
# event-driven (a webhook/CI shim writes the payload, then fires the loop)
carja loop --event ./event.json
```

A trigger can seed the goal but is **clamped to the operator's autonomy ceiling** — a payload (which may come from an untrusted source) can de-escalate but never escalate. Every driver guardrail still binds.

### Triggers from outside are treated as untrusted

`--event` lets an issue body, a PR comment or a chat message seed a run — which means anyone who can file an issue can put text in front of an unattended agent holding your credentials. That is a live attack class, not a hypothetical: in 2026 a single malicious issue *title* was turned into an npm supply-chain compromise, and the same shape was disclosed in three major coding agents.

So privilege comes from **you**, never from the event:

- **Trust follows authorship, not transport.** A third-party source without operator-level access is untrusted. A `cron` or CI trigger carrying text *you* wrote keeps full trust. A shim forwarding third-party text marks it with `author_association` or `"untrusted": true`.
- An untrusted run is clamped to the **no-merge floor**, so the worst case is a branch you review.
- Its goal and context are **enveloped and labelled as data, never instructions**, with injection attempts flagged inline and fullwidth/zero-width evasion folded for matching.
- It gets an explicit **tool allowlist** — read and edit, no shell, no network. An allowlist, because every published bypass of this agent class defeated a blocklist.

Per-project settings live in the `loop` block of `carja.config.json`: a `setup` command per worktree, extra sandbox domains, the forge (`gh`/`glab`, otherwise read from the origin host), which backlog items the fleet may take (`require_ready`, `priorities`), and whether cost may stop a run (`cost_aware`, off by default). Every run reports what it cost, by role. The sandbox profile withholds your forge logins from every beat, so only the driver can push or open a PR. Each beat's full agent output is kept in `.git/carja-loop-logs/`.

**▶ Build one project:** from the project folder, `carja loop <project>` builds that project only, after you approve its Technical Vision: the Carve, then every slice, each one on the branch of the one below it, with no wait for a merge. A one-way question stops the run; you answer and run it again. At the end you merge the MRs in order, from the list in `carja/1-workbench/loop-report-<project>.md`; an MR you close is built again with everything above it. Its first lines say what it will build. Another terminal in the same folder can run `carja loop <other-project>` at the same time: each run has its own state and lock in `.git`, works in its own worktrees, and removes them when it ends or on Ctrl+C. One loop never removes another loop's live worktree, and the driver never commits outside the worktree it expects (it stops with `halted_isolation` instead).

**▶ A model per role:** the `models` block of `carja.config.json` names the model, and optionally the effort, of each role: `plan` (Spec-It, Technical Vision, Carve), `build`, `review`, `bookkeeping` and `escalate`. The interactive workflows and the loop read the same block, on Claude Code, `codex` and `agy`. Carja ships no model names, strengths or prices: a role left unset runs on the engine's default, and `models.rank` (your models, strongest first) lets the loop doctor check that the reviewer is not weaker than the builder. `carja models` shows each role and the `/model` command for an interactive step; `carja models use <preset>` switches between `quality`, `balanced` and your own `models.presets`, for example one that plans and reviews on Fable and builds on Opus.

**▶ Your folder stays on its default branch:** interactive Spec-It, Build and Ship work in the item's own hidden worktree, made by `carja work <item>` (also a worktree of each code repository inside it, on the same branch). `pre-commit` refuses code committed on the default branch, `carja status` warns when your folder or a code repository is off it, and a merged item's worktree goes on your next `git pull` (or `carja work clean`).

**▶ Follow a run:** `carja watch --all` shows every product the loop works on, on one screen, one row per running project; `carja watch` in a second terminal shows every run going on in that folder, with each item's beat in progress (stage, model, minutes so far, the agent's last step), the last recorded fact, and the run's beats and cost, from the event log every run writes in `.git/carja-loop-logs/events.ndjson`.

**▶ How to run it on your repo:** see the step-by-step guide [`docs/Running-The-Loop.md`](docs/Running-The-Loop.md) — configure The Spine (`loop-state.json`, with `sandbox: "cli-native"`), `--dry-run` to preview, `carja loop doctor <dir>` to check the setup and verify command in a real worktree, then `carja loop <dir> --platform claude`.

See also [`docs/roadmap/Autonomous-Loop-Backend.md`](docs/roadmap/Autonomous-Loop-Backend.md), [`docs/roadmap/Loop-Engineering-Alignment.md`](docs/roadmap/Loop-Engineering-Alignment.md), [`docs/roadmap/Loop-Robustness-Plan.md`](docs/roadmap/Loop-Robustness-Plan.md), and [`docs/adr/0001-enforcement-and-autonomy-rebalance.md`](docs/adr/0001-enforcement-and-autonomy-rebalance.md).

---

## Review That Finishes

An independent fresh-context reviewer checks every consequential artifact before it ships — a PRD, an architecture, a spec, a diff. The hard part is making that gate **terminate**: a reviewer told to "find the reason this is not ready" will always find something, so review-until-clean never converges and the cost lands on you as a fourth round and a request for help.

Carja's answer (**Rubric v2**) is one short, self-contained reviewer brief with a bar on the *rejection*, not on the approval:

- A **BLOCKER** needs the **quoted line that proves it** and confidence **≥ 7**. Cannot quote it? It is reported as IMPORTANT — never promoted to clear the bar.
- **`APPROVE` means zero blockers, not zero findings.** IMPORTANT and NIT are reported and the change still ships.
- The reviewer judges the **acceptance criteria as a checklist**, so "is this finished?" is a bounded question with a reachable answer.
- It reports the **whole class**, not one instance — otherwise every instance costs a round.
- An explicit **"Not a finding"** list: already fixed in this diff, anything the linter enforces, process artefacts, test-structure opinions, consistency-only churn.
- **One** delta round, then a single batched question to you. No follow-up backlog — a proven defect is fixed now or written into the PR body under *Known gaps*.

The bar is enforced in code (`src/loop/checker.js`), not just prose, and it can only ever make the gate stricter: a malformed blocker is still a rejection, and a verdict that approves while listing a blocker fails safe.

### It measures itself

A rubric is config: change it and every verdict changes. So the gate keeps a ledger and tells you when **it** is the problem:

```bash
carja review-log summary
```

```
Review findings: 4 (1 blockers)
Dismissal rate:  75%

By class:
     3    0 blk  100% dismissed  test-structure
     1    1 blk    0% dismissed  sql

Rubric suspects (dismissed >50% of the time, n>=3):
  test-structure — add a worked case to skills/independent-review/calibration.md
```

A class you keep dismissing is a **rubric** defect, not a discipline problem. Fix the rubric.

---

## Progressive Disclosure, With a Number

A methodology that loads everything up front is just a big prompt. Carja loads the framework block of `AGENTS.md` (classifier + three laws) plus the skills' descriptions; skills and workflows are pulled in on demand. That is only true if something enforces it:

```bash
carja context-bill
```

```
ALWAYS-ON (every session pays this): 14.4 KB ≈ 3975 tokens
     6.2 KB  framework          AGENTS.md (framework block)
     0.5 KB  skill-frontmatter  skills/architecture-checklist
     ...
EAGER (paid only when invoked): 32 skills, 19 workflows
```

CI fails on growth past a committed ceiling **and** on a new skill or workflow with no budget entry at all — so adding context is a visible decision, never a default. Ceilings are in bytes: exact, and they do not drift when a tokenizer changes.

---

## Self-Test

Validate your installation:

```bash
bash .agents/tests/check-carja.sh
```

---

## Credits & Acknowledgments

Carja was built by standing on the shoulders of giants. Each entry names what we took, so the credit is checkable. Re-audited 2026-09-15.

**Frameworks whose mechanisms Carja inherited or adapted**

- **[Conductor Framework V2](https://www.testinprod.co/)** by Test in Prod (Eric Before) — The folder-based product-planning system whose workflow names (Genesis, Storyboard, Grand PRD, Technical Vision, Carve, Spec-It, Agentic-Flow), personas, and numbered-folder layout Carja inherited. Distributed as an email-gated zip; no public repository.

- **[Superpowers](https://github.com/obra/superpowers)** by Jesse Vincent, now maintained under Prime Radiant (MIT) — Systematic debugging and its sub-docs (root-cause tracing, defence in depth, condition-based waiting, `find-polluter`), test-driven development, verification before completion, subagent-driven development, git worktrees, and the brainstorm → plan → execute shape. Its eval suite is the one upstream that measures its own effect.

- **[AG Kit](https://github.com/vudovn/antigravity-kit)** (formerly Antigravity Kit) by vudovn (MIT) — Engineering skills, design patterns, and the multi-file skill architecture. Now 47 skills, 20 agents, 13 workflows.

- **[Antigravity Superpowers](https://github.com/skainguyen1412/antigravity-superpowers)** by skainguyen1412 — The self-test infrastructure (`check-carja.sh` is adapted from `check-antigravity-profile.sh`) and the `npx` install pattern.

- **[Skills for Real Engineers](https://github.com/mattpocock/skills)** by Matt Pocock (MIT) — The `grilling` interview primitive, synthesise-then-fill-gaps spec drafting (`to-spec`), TDD seams and anti-pattern tells, the Fowler smell baseline in code review, red-command-first debugging, the deep-module deletion test and ADR gate, merge-conflict discipline, and the `handoff` skill. What we took and where we deliberately differ: [`docs/roadmap/Pocock-Alignment-Backlog.md`](docs/roadmap/Pocock-Alignment-Backlog.md).

- **[gstack](https://github.com/garrytan/gstack)** by Garry Tan (MIT) — The descriptions-suite routing eval with the routing table removed from the fixture, the working-tree content fingerprint and evidence ledger technique (`src/evidence/wtree.js` reimplements `gstack-wtree` in JavaScript), the context-bill ratchet, the review log, and confidence-gated review findings. We diverged on byte ceilings, a drift gate instead of a generator, and host neutrality: [`docs/roadmap/Review-Convergence-And-Harness-Alignment.md`](docs/roadmap/Review-Convergence-And-Harness-Alignment.md).

- **[AI-DLC](https://github.com/awslabs/aidlc-workflows)** by AWS Labs (MIT-0) — Failing a verification run that changes files while it runs, the hook heartbeat that shows when the hooks stopped firing, and the `Compatibility:` line on each release entry. What we took, what we left and why: [`docs/roadmap/AIDLC-Harvest.md`](docs/roadmap/AIDLC-Harvest.md).

- **[agentctl](https://code.euranova.eu/innovation/agentctl.git)** (Euranova internal repository, reachable only from the Euranova network) — The diagnosis that review loops fail to converge when the reviewer's question is unbounded, the finding that round count tracks the size of the instruction corpus, and the architecture-checklist idea. We diverged on self-improvement: Carja proposes rules, it never auto-appends them.

- **The Ralph loop** by Geoff Huntley — `while :; do cat PROMPT.md | agent; done`, the pattern `carja loop` hardens with a Maker/Checker split, worktree isolation, a PR-gated merge, and fail-safe verdicts.

**Reading that shaped the design**

- Isuru Wijesiri, [Harness Engineering 101](https://github.com/IsuruMaduranga/harness-engineering-101) (prose CC BY-NC-ND, code MIT; ideas only, no text copied) — Watching the prompt-cache share as a cost signal, a model verdict that must cite something real, and the rule that a role whose report is trusted without a check must not run on a weaker model. What we took: [`docs/roadmap/Harness-Engineering-101-Harvest.md`](docs/roadmap/Harness-Engineering-101-Harvest.md).
- Martin Fowler, [Harness engineering](https://martinfowler.com/articles/harness-engineering.html), and the code-smell catalogue from *Refactoring*.

We believe in building on each other's work. If you find value in Carja, consider contributing back.

---

## License

MIT
