# Rename Conductor to Carja

> **Status:** in progress. Plan approved by the owner 2026-10-16 (D2 and D4 answered), resumed 2026-11-04 with the name `carja` confirmed. PR 1 (dual-name readers) in 6.54.0, `src/names.js`, proven by `test/names-dual.test.js`. Next: PR 2. Name chosen by the owner: `carja`, the Jacquard loom in verlan.
> **Release:** 7.0.0, one major. `Compatibility: upgrade plus a step` (the step: update scripts and your own instruction files that call `conductor`).

## Why

- Google's Conductor (Gemini CLI extension) writes its own files into `conductor/` at the project root, the folder we use. A project that uses both gets one folder with two owners.
- conductor.build sells parallel Claude Code agents to the same audience. The npm name `conductor` is taken.
- `carja` is free on npm, on PATH and on GitHub (exact name).

## How we got here

Discussed with the owner on 2026-10-16. Recorded so the choice is not reopened without new facts.

- **Criteria.** Short to type, usable as a folder and config name, free on npm and PATH, no bad meaning in the main EU languages. The owner added: the word can be invented or come from another field, but it must have a hidden link to what the tool does. Because the owner is the only user and installs go through `npx github:`, search results and trademarks weigh little.
- **What the tool is**, the reference for the link: it turns a general coding agent into an engineering team that can work unattended, with the safety rules enforced by code. A method (Plan → Ship → Learn), rules enforced by hooks, a driver that runs several agents unattended, and a shared state folder.
- **stromae** (maestro in verlan, the model for the final choice). Rejected: the stage name of a living Belgian artist, very probably a registered trademark, and every search returns the singer.
- **Invented short names** (sarn, fenn, tamo, vanto). Free, but no link to the tool, so rejected under the owner's criterion.
- **Music** (dirigo, segno, kapell, feuch). `segno` (the repeat sign, the loop) and `feuch` (chef in verlan) were liked. Taken on npm: tutti, tactus, batuta, attacca, segue, coda, fermata, tempi, volta.
- **Other fields** (loom, falconry, horse training, rope team, jig): metier, longe, cordee, gabarit. This led to the Jacquard loom: the first machine that ran a program unattended.
- **jacquard.** Rejected: npm reserves the name, three active GitHub projects use it, Google has Project Jacquard, and 8 letters is long for a command.
- **carja**, *jacquard* in verlan (quardja, spelled carja). Chosen: 5 letters, free everywhere, the same trick as stromae with a link to the loom. Known side effects: a GitHub search returns "carjack" tools, and in Finnish *karja* means a cattle herd (from memory, not verified).

## Scope: every surface that carries the name

Measured on `master` at `2c2a4e4`: 2,904 occurrences in 242 files, 57 paths. On 2026-11-04 at `168c813`: 4,719 in 343 files.

| Surface | Today | After | Compatibility in 7.x |
|---|---|---|---|
| CLI binary | `conductor` | `carja` | `conductor` stays as an alias that prints a one-line deprecation notice. Removed in 8.0 |
| Package / repo | `conductor-framework`, `github:charlus/conductor-framework` | `carja`, `github:charlus/carja` | GitHub redirects the old repo URL (to verify live) |
| State folder | `conductor/` | `carja/` | Readers accept `conductor/` when `carja/` is absent, with a warning to run `carja upgrade` |
| Config | `conductor.config.json` | `carja.config.json` | Same fallback |
| Version stamp | `.agents/.conductor-version.json` | `.agents/.carja-version.json` | `version.js` reads both, so upgrade still detects every old install |
| Backup | `.conductor-backup/` | `.carja-backup/` | Old backups left in place |
| AGENTS.md markers | `<!-- conductor:framework:begin -->`, `conductor:project-card:*`, `conductor:managed:*` | `carja:*` | Parser accepts both prefixes, writer emits `carja:` |
| Claude Code command shims | marker `conductor:generated-command` | `carja:generated-command` | Upgrade removes shims that carry either marker, then regenerates |
| Env vars (25: `CONDUCTOR_HOOKS`, `CONDUCTOR_NO_TEST`, `CONDUCTOR_EVALS`…) | `CONDUCTOR_*` | `CARJA_*` | Hooks and CLI read the new name first, then the old one with a deprecation notice. A waiver set under the old name still works |
| Hook library functions (34) | `conductor_*` in `lib.sh` | `carja_*` | None needed: `.agents/hooks/` is replaced wholesale on upgrade |
| Pinned `pre-commit` fingerprint | `CONDUCTOR_OFFICIAL_PRECOMMIT_SHA256` | recomputed for the renamed file | The hook must accept the 6.x fingerprint during the upgrade commit itself |
| Loop branches | `conductor/loop/<slug>` | `carja/loop/<slug>` | Upgrade refuses to run while a loop worktree exists (see D3) |
| `.gitattributes` union paths | `conductor/0-compass/ship-log.md`… | `carja/…` | Upgrade rewrites the lines it owns |
| Claude Code settings hooks | `conductor trust-verify`… | `carja …` | Upgrade rewrites commands it installed, leaves others |
| Prose, README, templates | "Conductor" | "Carja" | Credit to Test in Prod's Conductor stays in README. README gets a short "Why Carja" section (see Delivery) |

## The upgrade migration

`carja upgrade` on a 6.x install runs these steps before the normal upgrade, on the upgrade branch that `commitUpgrade` already creates, as one separate commit (`chore: rename conductor to carja`):

1. **Detect.** An old install has `.agents/.conductor-version.json` or a `conductor/` folder with at least one of the numbered folders `0-compass` … `6-archive`.
2. **Refuse if unsafe.** Stop with a clear message when the working tree is dirty or a `conductor/loop/*` worktree exists.
3. **Move the state folder.** `git mv` only our numbered folders into `carja/`. Any other entry in `conductor/` (Google's `product.md`, `tech-stack.md`, `tracks/` and similar, names not verified) stays where it is, and the report lists it. If nothing else is left, remove the empty `conductor/`.
4. **Move the config and the stamp.** `git mv conductor.config.json carja.config.json`. Rename the stamp.
5. **Rewrite what the framework owns.** AGENTS.md markers, `.gitattributes` lines, `.gitignore` lines, Claude Code command shims, settings hooks.
6. **Path references in user knowledge** (see D2).
7. **Nested code repositories.** Their `core.hooksPath` points at `.agents/hooks`, which does not move. Push checks move with the config, under `repos`. Nothing to rewrite, test it anyway.
8. **Report.** List every move, every rewrite, every entry left in `conductor/`, and every old env var still set in the shell.

The step is idempotent: run twice, the second run does nothing.

## Decisions

- **D1 (decided): one major of aliases.** The old binary, env vars, folder and config fallback live through 7.x and are removed in 8.0. The owner is the only user, so a longer window buys nothing.
- **D2 (owner, yes, 2026-10-16): rewrite `conductor/` path references inside the moved folder.** Backlog items, specs and the ship log contain literal paths such as `conductor/2-backlog/x.md`. Left alone, agents follow dead paths. This is a deliberate exception to the 6.0.0 rule "upgrade never touches `conductor/` knowledge": rewrite only the exact pattern `conductor/<n>-<folder>/`, in its own commit so the diff is reviewable, and say so in the report. Record the exception in `CLAUDE.md`'s design decisions.
- **D3 (decided): no migration of in-flight loop work.** Upgrade refuses while a loop worktree exists. Finishing or abandoning a loop run is cheaper than migrating its branch.
- **D4 (owner, yes, 2026-10-16): rename the GitHub repo** to `charlus/carja`, in the same release, after the code is merged.

## Delivery

1. **PR 1: dual-name readers (6.54.0).** No visible change. `src/names.js` holds both names, the new one first, and `CURRENT` (still `conductor`) for writers. Built:
   - The config file, the version stamp and every marker (framework block, project card, managed block, Claude Code shims) are read under both names, everywhere.
   - `CARJA_*` variables are copied to their `CONDUCTOR_*` name at CLI start (`mirrorEnv`), so every reader and child process sees them. An explicit `CONDUCTOR_*` value wins.
   - The state folder falls back only in the commands an agent or the owner runs on an install not yet upgraded: `status` (with `--live`), `inbox`, `view`, `review-log`, `agents-md`.
   - Not dual, by decision (2026-11-04). The loop, `loop doctor` and the hooks: they are replaced together with the folder by `upgrade`, so they never meet the other name. Measured on `master` at `168c813`: 133 literal `conductor/` paths in `src/`, most in the loop. In PR 2 the loop refuses a 6.x layout with "run `carja upgrade` first". `design migrate` is a pre-6.8 migration and stays as it is.
   - Found for PR 2. The pre-commit hook loads the COMMITTED `lib.sh`, so the upgrade commit itself runs under the 6.x hooks: every waiver the CLI sets for that commit must be set under both names. `pre-commit` and `pre-push` read `CONDUCTOR_HOOKS` before they load `lib.sh`, so the hook rename edits the pinned `pre-commit` and its fingerprint.
2. **PR 2: the rename and the migration.** Binary, package, templates, prose, writers, the upgrade step, `CHANGELOG.md` 7.0.0, README, `CLAUDE.md`, `how-it-works.md`, roadmap status blocks. `check-conductor.sh` becomes `check-carja.sh`. The README title changes to Carja and gets a short "Why Carja" section of three or four lines: *carja* is *jacquard* in verlan; the Jacquard loom was the first machine that ran a program unattended, as Carja runs coding agents unattended inside rules enforced by code; the project was called Conductor until 6.x and was renamed because of Google's Conductor, which uses the same `conductor/` folder. The credit to Test in Prod's Conductor stays.
3. **Owner: rename the repo** (D4), then verify `npx -y github:charlus/conductor-framework status` still resolves through the redirect.
4. **Local installs**, one MR each, as for 6.12.0: eurassistant, evalapp-v2, website. autopportunity only when asked. euranova-os untouched.
5. **Owner's own files.** `~/.claude/CLAUDE.md` section 11 names the `conductor` CLI and the repo URL. The Claude Code memory folder for this repo is keyed by its local path: if `~/Workspace/conductor-framework` is renamed, move the memory folder with it.

## Tests

- Upgrade fixtures: a plain 6.13 install, a 6.13 install with Google's files inside `conductor/`, an outer layout with a nested code repository, a dirty tree, a live loop worktree, a second run (idempotence).
- Alias tests: `conductor <cmd>` and every `CONDUCTOR_*` waiver still work in 7.x.
- The usual suites plus `test/docs-drift.test.js`, then the full install flow `init` + `check-carja.sh`.
- One live `carja loop` run on a scratch project (Operating Truth 1): branch names, worktrees, merge gate.
- `grep -ri conductor` after PR 2: only the aliases, the migration code, the credits and the CHANGELOG history may match.
