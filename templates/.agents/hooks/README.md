# Carja Enforcement Hooks

> **Why this exists:** the field consensus (Anthropic, Böckeler, Huntley, obra) is blunt — *prose rules are advisory; only code enforces.* Carja's two headline laws were prose-only. These hooks make them **deterministic** at the git boundary, so they hold even when an agent ignores the prose. See `docs/adr/0001-enforcement-and-autonomy-rebalance.md` (D1). The prose rules stay as the guidance layer; these are the backstop.

## What's here

| Hook | Law | When it fires | Blocks when… |
|---|---|---|---|
| `pre-commit` | **Test-Driven Law** | `git commit` | implementation code is staged with no test change, or with a test change that adds or changes no assertion (waiver: `CARJA_NO_TEST="reason"`) |
| `pre-commit` | **Eval-Driven Law** | `git commit` | code that calls an LLM provider is staged with no eval alongside (waiver: `CARJA_NO_EVAL="reason"`). See `skills/writing-evals/`. The two gates are independent — waiving one never skips the other. |
| `pre-commit` | **Goodhart boundary** | `git commit` | a test file is deleted, a test is disabled (`.skip`/`.only`/`@pytest.mark.skip`/`#[ignore]`/`t.Skip`/`@Disabled`…), or the staged tests net-lose assertions (waiver: `CARJA_NO_BOUNDARY="reason"`) |
| `pre-commit` | **Default branch** | `git commit` | code is committed on the default branch of a repository that has a remote (`origin`), in the project or a nested code repository. Carja's own files (`carja/`, `.agents/`, `AGENTS.md`, `carja.config.json`, `.gitattributes`) may be. Work in the item's worktree (`carja work <item>`) instead (waiver: `CARJA_ON_DEFAULT="reason"`) |
| `pre-commit` | **Gate integrity** | `git commit` | the change gains a line that switches part of a check off: `@ts-ignore`/`@ts-nocheck`/`@ts-expect-error`, `# type: ignore`, a bare `# noqa`, a file-wide `eslint-disable`, `# pragma: no cover` or `istanbul ignore` in product code; `continue-on-error: true` or `allow_failure: true` in a CI file; `--no-verify` in a script; a `TODO`/`FIXME` with no issue reference (waiver: `CARJA_NO_INTEGRITY="reason"`) |
| `pre-commit` | **Protected paths** | `git commit` | the change edits `.agents/hooks/`, `.agents/rules/`, `.agents/sandbox/` or the reviewer brief (waiver: `CARJA_NO_PROTECTED="reason"`) |
| `pre-push` | **Verification Iron Law** | `git push` | the configured verification command exits non-zero, or exits 0 with output that says no test ran (waiver: `CARJA_NO_TESTS_RAN="reason"`) |
| `pre-push` | **Gate integrity** | `git push` | a pushed commit's message says `[skip ci]`, `[ci skip]`, `[no ci]` or `[skip actions]` (waiver: `CARJA_NO_INTEGRITY="reason"`) |
| `pre-push` | **Review gate** | `git push` | the change has 50 or more changed non-test lines of code, or touches a risk path (auth, sessions, permissions, security, secrets, payments, billing, migrations, CI), and no independent APPROVE is recorded for the pushed commit. `carja review-log verdict APPROVE` records one (Ship Phase 4); the loop records its Checker's. Code added after the approval needs a new one only when it alone reaches the same threshold. `carja/`, `.agents/`, Markdown and test files never count (waiver: `CARJA_NO_REVIEW="reason"`) |
| `post-merge` | cleanup, not a gate | `git pull` (a merge) | never: it removes `carja loop` and `carja work` worktrees and local branches already merged into the default branch, and keeps any worktree with uncommitted changes |
| `verification-stop-hook.sh` | Verification Iron Law (interactive) | Claude Code `Stop` | **opt-in** — code changed since HEAD and verify is red |
| `pretooluse-no-bypass.sh` | every gate above | Claude Code `PreToolUse` | **opt-in** — a Bash call tries to skip the git hooks (`--no-verify`, `-n`, `-c core.hooksPath=`) |
| `pretooluse-fact-gate.sh` | investigate before you write | Claude Code `PreToolUse` | **opt-in** — the first edit/creation of a file, and the first run of each destructive command, until the facts are stated (off: `CARJA_FACT_GATE=off`) |
| `lib.sh` | — | sourced by the others | shared helpers |

### Why the boundary gate exists

The Test-Driven Law proves a test *changed*. It cannot tell a new test from a
deleted one — `--diff-filter=ACM` never sees a deletion, and staging `.skip(`
*is* a change. So the two cheapest ways to reach "all tests pass" — delete the
failing test, skip the failing test — both satisfied it, and gutting the
assertions satisfied it too. A done-criterion needs a boundary beside it: what
the change must **not** do. That is this gate, and it is why the gate is
independent of `CARJA_NO_TEST` (that waiver says "this change has no test
surface", which is not a licence to remove proof that already exists).

It is deliberately syntactic. A hook cannot judge whether removing a test was
*right* — only that it happened. When it was right, say so in the waiver and
the reason lands in the ship-log.

### Why some paths are frozen

"Build may not edit the acceptance conditions" is the rule every plan/build/judge
loop rests on. The hooks, the always-on rules, the sandbox profile and the
reviewer brief *are* the acceptance conditions, so whatever is being built does
not get to edit what decides whether it passes. Workflows, skills and your
project knowledge stay freely editable — freezing those would make the gate a
tax rather than a boundary.

A `carja upgrade` legitimately rewrites these paths, and handles that
itself: it commits exactly the framework files it wrote, with
`CARJA_NO_PROTECTED` set so the waiver is still logged, and never sweeps in
your own work. Then push as usual — `pre-push` carries the fingerprint of the
official `pre-commit` and lets that exact file through. If you had uncommitted
edits in those files, a merge was in progress, or you passed `--no-commit`, it
prints the one command to run instead.

**The gates judge a change with the copy already committed.** Both hooks load
`lib.sh` from the last commit (at push, from what the remote already has), on
top of the working-tree copy. So deleting, moving or rewriting `lib.sh` cannot
switch the gates off for the commit that does it. And if the committed library
cannot be loaded at all, the hook fails **closed** — it used to fail open,
which let one deleted file disable every gate at once.

**Disabling `pre-commit` is caught at the push.** git runs `pre-commit` from
the working tree, so a commit that deletes, renames, un-chmods or *edits* it is
judged by the altered copy — which may judge nothing. `pre-push` refuses a range
that does any of those unless the push carries `CARJA_NO_PROTECTED="why"`.
The reverse holds too: an edit to `pre-push` is a protected-path change that
`pre-commit`, still running the committed library, blocks at commit.

**What no local hook can stop.** git executes `pre-commit` and `pre-push`
themselves from the working tree, so a change that rewrites *both entry
scripts* runs the rewritten versions. That is a property of client-side hooks,
not a gap in these ones. The backstop is server-side — the PR gate and branch
protection — and, for `carja loop`, the independent Checker, which reviews
the diff that reached the branch rather than trusting the hooks that ran on it.

## Enabling the git hooks

Automatic during `carja init` / `carja upgrade` when the target is a git repo (they point `core.hooksPath` at this directory). To (re)install or repair manually:

```bash
carja install-hooks           # sets core.hooksPath → .agents/hooks
carja install-hooks --uninstall
```

If you already use a custom `core.hooksPath`, install-hooks won't override it — wire these in yourself.

Each hook appends a heartbeat line (`<time> pre-commit` or `<time> pre-push`) to `.git/carja-heartbeat`, and install-hooks appends `<time> installed`. A clone that got the rename to Carja by a pull still has `.git/conductor-heartbeat`; the first hook or `carja` command renames it. `carja status` compares these with the reflog and names the local commits and pushes that skipped the hooks. Nothing is committed.

**Outer layout** (Carja in an outer folder, the team's code in a gitignored nested repository): install-hooks also sets each nested repository's `core.hooksPath` to this folder by absolute path, in local git config only. The gates then judge the code commits. The library, the config and the ship-log come from the outer repository, and the library from its *committed* copy, which no commit in the code repository can change. Each code repository has its own push check, in `carja.config.json`:

```json
{ "verify": "none", "repos": { "website-cms": { "verify": "npm test", "eval": "npm run eval" } } }
```

Set it with `carja verify --repo website-cms --set "npm test"`. A nested repository that already has a `core.hooksPath` or live files in `.git/hooks` is left alone and reported, and `carja status` says which code is not gated. The path is absolute: run `carja install-hooks` again after moving the folder.

## Configuring verification

`pre-push` (and the optional Stop hook) run your **verification command**. One command reads and sets it:

```bash
carja verify                          # what does `git push` run here, and how do I change it?
carja verify --set "npm test"         # runs it once; only writes it if it passes
carja verify --detect                 # derive it from the files that are here
carja verify --none                   # this repo has nothing to verify (docs, state, wrapper)
```

It is resolved in this order:

1. `"verify"` in `carja.config.json` — e.g. `"verify": "npm test && npm run lint"`
2. `npm test`, if `package.json` defines a `test` script
3. nothing → the push hook prints a notice and allows the push

`--set` runs the command before writing it because a gate that cannot pass is worse than no gate: it
blocks every push and teaches you to reach for `CARJA_SKIP_VERIFY`. Use `--no-run` to write one
that cannot pass here (CI-only, for instance).

**A repo with nothing to verify** — a state repo, a docs repo, a wrapper whose code lives elsewhere —
should say so with `carja verify --none`, which records `"verify": "none"`. The hook then stays
silent instead of warning at every push. An unconfigured gate and a declared-off gate look the same to
`git`, but only one of them is a decision, and a warning that can never be cleared is how a safety
message gets ignored.

## Configuring evals (Eval-Driven Law run-gate)

If the repo has evalsets (an `evals/` file or `*.eval.*`), `pre-push` also runs your **eval command** — presence is gated at commit, *passing* is gated here. Resolved in this order:

1. `"eval"` in `carja.config.json` — e.g. `"eval": "npm run eval"`
2. `npm run eval`, if `package.json` defines an `eval` script
3. nothing → the push hook notes that evalsets exist but no command is set, and allows the push (a gap to close, not a hard block)

```json
{ "verify": "npm test", "eval": "npm run eval" }
```

Non-LLM projects (no eval files) never see this gate.

### Why the integrity gates exist (7.1.0)

The boundary gate protects the tests. The same cheap move is open on every
other check: silence the type checker, hide a branch from coverage, let a CI
job fail green, script `--no-verify`, or touch a test file without asserting
anything so the Test-Driven Law counts it. A verify command can also exit 0
having run nothing: a renamed test folder, a filter that matches no file,
`--passWithNoTests`.

The limits were set on the real history of four projects (9,662 commits) so
that ordinary work passes:

- **Assertions.** A changed assertion counts, so a fix that moves an expected
  value is not blocked. Blocked: a test change beside code that touches no
  assertion line (81 of 1,353 past commits that changed code and tests together).
- **Integrity.** Line-level lint suppressions with a rule code (`# noqa: E402`,
  `eslint-disable-next-line <rule>`, `svelte-ignore`) stay allowed: they were
  most of the 363 past commits with a pragma. Lines are counted per file as net
  new, so editing a line that already had a pragma is not new. Test files,
  `carja/` and `.agents/` are not scanned for pragmas or TODOs. Blocked: 24 of
  9,662 past commits. `--no-verify` in a script and `[skip ci]` never appeared.
- **Zero tests.** The verify output is read for the runner's summary (pytest,
  jest, vitest, `node --test`, mocha, bun, `go test`, unittest, cargo, rspec).
  Any positive count passes, also when another suite in the same command ran
  none. An output with no summary the hook knows passes, as before. The five
  real verify suites of those projects all read as "tests ran".

## Escape hatches (never silent)

Determinism can over-block legitimate config/doc work, so every gate has a logged bypass:

```bash
CARJA_NO_TEST="config-only change"  git commit …     # TDD gate (pre-commit)
CARJA_NO_EVAL="stub, no eval surface" git commit …   # Eval presence gate (pre-commit)
CARJA_NO_BRIEF="pre-A5 spec" git commit …            # brief check (pre-commit)
CARJA_NO_REPORT="editing an old entry" git commit …  # report shape (pre-commit)
CARJA_NO_BOUNDARY="feature removed" git commit …     # Goodhart boundary (pre-commit)
CARJA_NO_PROTECTED="carja upgrade" git commit …  # protected paths (pre-commit)
CARJA_NO_INTEGRITY="generated code" git commit …     # gate integrity (pre-commit and pre-push)
CARJA_ON_DEFAULT="hotfix agreed" git commit …        # code on the default branch (pre-commit)
CARJA_SKIP_VERIFY="hotfix, tests offline" git push … # verify gate (pre-push)
CARJA_SKIP_EVAL="eval infra down" git push …         # Eval run-gate (pre-push)
CARJA_NO_TESTS_RAN="tests run in CI only" git push … # verify ran no test (pre-push)
CARJA_NO_REVIEW="known gaps in the MR" git push …    # review gate (pre-push)
CARJA_HOOKS=off git commit …                         # disable all Carja hooks
```

Every named reason is appended to `carja/0-compass/ship-log.md`, so a bypass stays auditable. The rule is not *never bypass* — it is *every bypass is logged*. A commit carries its own waiver line, and any line a push waiver left behind, so a waiver needs no extra commit. The hook stages the ship-log only when waiver lines are its sole change, and never in a partial commit (`git commit -- <paths>`).

**What is not code.** Files under `carja/` are project state: the TDD and eval presence gates ignore them, and a push that changes only `carja/` runs neither the verify command nor the evals. Prefer these over `git commit --no-verify`, which silently skips **every** hook and leaves no trail.

## Optional: the fact gate (Claude Code)

Every other gate here fires **after** the work: the Test-Driven Law and the
Goodhart boundary at commit, the Verification Iron Law at push, the Checker
after the beat. All of them catch a bad change once it exists. None of them
stop a model writing one from a guess.

Self-evaluation does not close that gap — ask a model "are you sure?" and the
answer is always yes. Asking *"which files import this one"* does, because it
cannot be answered without running a search, and running the search puts the
answer in the context. The investigation is the point; the question only
forces it.

```json
{
  "hooks": {
    "PreToolUse": [
      { "matcher": "Edit|Write|Bash", "hooks": [ { "type": "command", "command": "$CLAUDE_PROJECT_DIR/.agents/hooks/pretooluse-fact-gate.sh" } ] }
    ]
  }
}
```

It denies the **first** edit or creation of each file, and the **first run of
each** destructive command, naming the facts to state; the identical retry is
then allowed. A *different* destructive command is gated on its own — each one
destroys something different. Three questions per gate:

| Gate | Asks for |
|---|---|
| Edit | every file that imports this one (searched, not recalled); the failing test this makes pass; the instruction verbatim |
| Write | what will call the new file; what you searched to confirm nothing already does this; the instruction verbatim |
| Destructive Bash | exactly what it destroys; a one-line rollback; the instruction verbatim |

**What was measured, and what was not.** Our eval
(`test/evals/fact-gate-eval.mjs`) measured a process: gated runs named the
files their change affects 4/4, ungated 0/4 (n=4). It did not measure whether
the work came out better, or what the gate costs. ECC measured both for the
same mechanism (GateGuard), in a pre-registered study of 336 billed trials:
the benefit on task outcomes was not established (the confirmatory run, 25/48
against 18/48, p = 0.21), and the cost was a consistent 35–45% more turns and
spend. It stays opt-in for that reason.

**What it does not do:** verify any of it. A `PreToolUse` hook sees the tool
call, not the reasoning. It buys a pause and a prompt at the moment of action —
do not read it as proof. `Read`, `Grep` and `Glob` are never gated; they are the
investigation being demanded. Routine `Bash` is not gated either — ECC's
GateGuard denies it once per session, but our loop runs many commands a beat and
there is no investigation to buy there, only a wasted turn.

After three denials in a session the message condenses to a single line carrying
its ordinal. Identical repeated denials are what push a model into a repetition
loop, so the gate keeps denying but stops repeating itself.

Turn it off with `CARJA_FACT_GATE=off`, or everything with
`CARJA_HOOKS=off`. Both `PreToolUse` hooks bound themselves with `timeout`
(`CARJA_HOOK_TIMEOUT`, default 5s) and fail **open** on expiry: a hook in
front of every tool call must never be able to wedge the session.

## Optional: blocking the unlogged bypass (Claude Code)

`--no-verify` defeats all of the above in one flag, and a sentence in a README is advisory — which is the whole reason these gates are code. Make it a block:

```json
{
  "hooks": {
    "PreToolUse": [
      { "matcher": "Bash", "hooks": [ { "type": "command", "command": "$CLAUDE_PROJECT_DIR/.agents/hooks/pretooluse-no-bypass.sh" } ] }
    ]
  }
}
```

It denies `git commit --no-verify`, the `-n` shorthand, `git push --no-verify`, `-c core.hooksPath=` overrides and an inline `CARJA_HOOKS=off`, and the denial names the logged waiver to use instead. It fails **open** on anything unexpected — no node, unparseable input, an unknown shape — because a hook that blocks on its own errors would wedge every Bash call in the session. A quoted mention (`git commit -m "document --no-verify"`) is not a use, and is allowed.

**Reach.** `PreToolUse` is a Claude Code mechanism, so this guards that harness only. On Codex and Antigravity the protection is after the fact, not before: `carja loop` records a hook-bypassed commit and the improver surfaces the pattern across runs. Detection, not prevention — worth knowing which one you have.

## Optional: interactive Verification hook (Claude Code)

Off by default. To make Claude Code refuse to end a session "done" while your code is red, add to `.claude/settings.json`:

```json
{
  "hooks": {
    "Stop": [
      { "hooks": [ { "type": "command", "command": "$CLAUDE_PROJECT_DIR/.agents/hooks/verification-stop-hook.sh" } ] }
    ]
  }
}
```

It only engages when tracked implementation files differ from HEAD, so it won't nag on doc-only or exploratory sessions. Disable anytime with `CARJA_HOOKS=off` or by removing the entry.

### The stop hook needs your consent once

Hooks **bypass the permission system** — nothing prompts before this one runs your verification command. That command is read from a file *inside the repo* (`carja.config.json` → `verify`, else the `test` npm script), so a cloned, forked, or contributed repo could name anything. The gate therefore stays inactive until you have read the command and recorded it:

```bash
carja trust-verify            # shows the command, then records consent
carja trust-verify --list     # what is trusted, on this machine
carja trust-verify --revoke   # withdraw it for this repo
```

Trust is keyed on `realpath(repo root)` + `sha256(command)`, stored `0600` at `$CARJA_HOME/verify-trust` (default `~/.carja`, or `~/.conductor` on a machine set up under 6.x), and every grant is appended to `verify-trust-grants.log`. **Edit the command and it must be trusted again.** Until then the stop hook allows the session to end with a one-line note, and never executes the command.

`pre-commit` and `pre-push` are deliberately *not* gated this way: there you typed `git commit` / `git push`, so a human action is already in the chain.

**Bounded re-entry.** Claude Code re-runs `Stop` hooks after a block. A re-entry is not a free pass — the check re-runs, so a red suite cannot be cleared by stopping again — but it is bounded at 3 blocks per episode, after which the hook allows the session to end with a loud `UNVERIFIED` warning rather than trapping it on a permanently broken check. A green run resets the counter.
