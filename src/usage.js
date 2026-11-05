// src/usage.js
//
// The one source for how to use the CLI: every command, its flags, the
// carja.config.json keys it reads, and an example. `carja help`,
// `carja <command> --help`, the main help and the reference part of
// docs/Using-Carja.md are all rendered from it. test/usage-reference.test.js
// fails when a command parses a flag, or the config reads a key, that is not
// here, and when the page's reference is not the rendering of this file.

const NPX = "npx -y github:charlus/carja";

/** Groups, in the order a product owner meets them. */
export const GROUPS = Object.freeze([
  ["start", "Start or upgrade a project"],
  ["daily", "Every day"],
  ["loop", "Run work unattended"],
  ["gates", "Gates and evidence"],
  ["skills", "Skills"],
  ["measure", "Measurement and upkeep"],
]);

export const COMMANDS = Object.freeze([
  {
    name: "init", group: "start", summary: "Install Carja in a new project",
    usage: "carja init [dir] [options]",
    flags: [
      ["--all", "Install every bundle without asking"],
      ["-f, --force", "Overwrite an existing .agents/ folder"],
      ["--agent-only", "Install .agents/ only, no carja/ folders"],
      ["--no-detect", "Skip tech stack detection"],
    ],
    examples: [[`${NPX} init`, "install in the current folder"]],
  },
  {
    name: "upgrade", group: "start", summary: "Upgrade a project to the latest framework",
    usage: "carja upgrade [dir] [options]",
    flags: [
      ["--dry-run", "Show what would change, write nothing"],
      ["--force", "Upgrade although the checks advise against it"],
      ["--no-backup", "Do not copy the old files to .carja-backup/"],
      ["--no-commit", "Leave the upgrade uncommitted and print the commit to make"],
    ],
    examples: [[`${NPX} upgrade --dry-run`, "preview the upgrade"]],
  },
  {
    name: "survey", group: "start", summary: "Collect the facts about a codebase you inherited",
    usage: "carja survey [dir] [options]",
    flags: [["--json", "Print JSON"], ["--out <file>", "Write the report to a file"]],
    examples: [["carja survey --out survey.md", "facts for the onboarding interview"]],
  },
  {
    name: "status", group: "daily", summary: "One-screen digest: inbox, backlog, next up, waiting questions",
    usage: "carja status [dir] [options]",
    flags: [
      ["--live", "Also fetch MR and deploy state from the forge"],
      ["--json", "Print the digest as JSON"],
      ["--no-color", "Plain text (also --no-colour; --color or --colour forces colour)"],
      ["--stale-days <n>", "Days after which an item counts as stale (default 30)"],
    ],
    config: ["deployCheck", "repos"],
    examples: [["carja status --live", "what is on our plate, with MR state"]],
  },
  {
    name: "inbox", group: "daily", summary: "Capture a thought, or read the inbox",
    usage: "carja inbox add <text> | carja inbox list",
    flags: [],
    examples: [['carja inbox add "rename the export button"', "capture without opening a file"]],
  },
  {
    name: "view", group: "daily", summary: "Render carja/ as one HTML dashboard",
    usage: "carja view [dir] [options]",
    flags: [["-o, --open", "Open it in the browser"], ["--out <file>", "Write it to this file"], ["--stale-days <n>", "Days after which an item counts as stale"]],
    examples: [["carja view --open", "the full dashboard"]],
  },
  {
    name: "review", group: "daily", summary: "Show a document in the browser and wait for approve or request-changes",
    usage: "carja review <file.md> [options]",
    flags: [["--no-open", "Print the URL, do not open a browser"], ["--timeout <min>", "Stop waiting after this many minutes"], ["--quiet", "No JSON on stdout"]],
    examples: [["carja review carja/2-backlog/project-backlog/x/blueprint/grand-prd.md", "review a PRD"]],
  },
  {
    name: "personas", group: "daily", summary: "Which domain personas (Designer, Security…) a change needs",
    usage: "carja personas [paths…] [options]",
    flags: [["--base <ref>", "Compare with this ref instead of the working tree"], ["--json", "Print JSON"]],
    examples: [["carja personas --base master", "personas for this branch"]],
  },
  {
    name: "work", group: "daily", summary: "The hidden worktree an interactive Spec-It, Build or Ship works in, so your folder stays on its default branch",
    usage: "carja work <item> [dir]\n  carja work clean [dir]",
    flags: [],
    config: ["loop.code_dir", "loop.setup"],
    examples: [
      ["carja work cop-availability/01-cockpit-access", "make or reuse the slice's worktree (and its code worktree), print where it is"],
      ["carja work clean", "remove the worktrees of merged work now (git pull does it too)"],
    ],
  },
  {
    name: "design", group: "daily", summary: "Combine an old carja/4-context/design/ folder into one DESIGN.md",
    usage: "carja design migrate [dir] [options]",
    flags: [["--repo <path>", "The code repository that gets DESIGN.md"], ["--dry-run", "Show the result, write nothing"]],
    examples: [["carja design migrate --dry-run", "preview DESIGN.md"]],
  },
  {
    name: "loop", group: "loop", summary: "Run the autonomous loop: beats, reviews, one MR per item",
    usage: "carja loop <project> [dir] [options]\n  carja loop [dir] [--from-carja | --goal <text> | --event <file.json>] [options]\n  carja loop on|off <project> [dir] [--yes] [--dry-run]\n  carja loop take [\"<item>\"] [dir] [--drop]\n  carja loop profile [quality|balanced] [dir]\n  carja loop doctor [dir] [--beat]",
    flags: [
      ["<project>", "Build this project, after you approve its Technical Vision: the Carve, then every slice, each one on the branch of the one below, with no wait for a merge. A one-way question stops the run. You merge the MRs in order at the end: the list is in carja/1-workbench/loop-report-<project>.md. An MR you close is built again with everything above it. Its state stays in .git; another terminal in the same folder can build another project at the same time. The loop removes its worktrees when it ends or on Ctrl+C"],
      ["--from-carja", "Take the work from carja/: backlog, inbox, slices, Blueprints"],
      ["--dry-run", "Show what the run would pick up and do, write nothing"],
      ["--platform <name>", "Engine: claude | codex | antigravity (default: loop-state, then detected)"],
      ["--goal <text>", "One goal for this run, instead of carja/"],
      ["--event <file.json>", "Start from a trigger payload (cron, CI, bot); untrusted text is clamped to L1"],
      ["--priority <P1[,P2]>", "With --from-carja: only backlog items under these headings"],
      ["--no-inbox", "With --from-carja: skip inbox lines"],
      ["--unsafe-no-sandbox", "Allow sandbox: none (only inside a VM you control)"],
      ["on", "List the projects, their stage, and which ones the loop can take"],
      ["on <project>", "Let the loop work on a project: shows each change in plain words, asks once, writes the settings"],
      ["on --backlog", "Set the loop up for backlog items you give it with take, with no project"],
      ["on --yes", "Apply without asking (after you have seen the list)"],
      ["on --code-dir <dir>", "Name the nested code repository when there are several"],
      ["off <project>", "The loop no longer works on that project"],
      ["take \"<item>\"", "Give the loop one open backlog item (its title or a unique part of it). Kept in .git, so no tracked file changes"],
      ["take", "List the items the loop has been given and not yet shipped"],
      ["take --drop \"<item>\"", "Take an item back"],
      ["profile", "Show the model profile, each role's model and the last run's cost per role"],
      ["profile quality|balanced", "Pick the models by budget: Opus everywhere, or Sonnet for code with Opus for review, specs and designs"],
      ["doctor", "Check the project before an unattended run"],
      ["doctor --beat", "Also run one real beat to prove the engine and sandbox"],
    ],
    config: ["verify", "loop.forge", "loop.setup", "loop.allowed_domains", "loop.require_ready", "loop.priorities", "loop.inbox", "loop.allow_nested_repo", "loop.models", "loop.cost_aware", "loop.slices", "loop.blueprint", "loop.code_dir", "loop.profile", "loop.blank_env", "loop.install", "loop.dependency_min_age_days", "loop.quota_max_wait_min"],
    examples: [
      ["carja loop km-workload-relief", "build this project; a second terminal can run another project"],
      ["carja loop km-workload-relief --dry-run", "what will it build?"],
      ["carja loop on km-workload-relief", "let the loop work on this project"],
      ["carja loop take \"flaky login\"", "give the loop this backlog item"],
      ["carja loop doctor .", "is this project ready?"],
      ["carja loop . --from-carja --dry-run", "what would the next run do?"],
      ["carja loop . --from-carja", "the real run"],
    ],
  },
  {
    name: "watch", group: "loop", summary: "What the loop run is doing: each item's beat in progress, the last news, beats and cost",
    usage: "carja watch [dir] [--once]\n  carja watch --all [--once]",
    flags: [
      ["--all", "The watch tower: every product the loop is on, on one screen (registered by carja loop on or carja loop <project>), one row per running project"],
      ["--once", "Print one screen and exit (it refreshes every few seconds otherwise)"],
      ["--no-color", "Plain text on a terminal (NO_COLOR does the same)"],
    ],
    examples: [["carja watch --all", "every product's run, beat, last news and waiting questions"], ["carja watch", "this product only, every project run going on in it"]],
  },
  {
    name: "verify", group: "gates", summary: "Show or set the command `git push` must pass",
    usage: "carja verify [options]",
    flags: [
      ["--set <cmd>", "Set the push gate (runs it once first)"],
      ["--detect", "Find the command from the project"],
      ["--none", "This repository has no tests (also --off)"],
      ["--no-run", "With --set: do not run it first"],
      ["--repo <dir>", "A nested code repository"],
    ],
    config: ["verify", "repos"],
    examples: [['carja verify --set "npm test"', "set the push gate"]],
  },
  {
    name: "install-hooks", group: "gates", summary: "Turn on the TDD and verification git hooks",
    usage: "carja install-hooks [--uninstall]",
    flags: [["--uninstall", "Turn them off"]],
    examples: [["carja install-hooks", "gates on"]],
  },
  {
    name: "trust-verify", group: "gates", summary: "Record your consent for this repository's verify command",
    usage: "carja trust-verify [--revoke | --list]",
    flags: [["--revoke", "Withdraw consent"], ["--list", "List trusted repositories"]],
    examples: [["carja trust-verify", "trust the current command"]],
  },
  {
    name: "evidence", group: "gates", summary: "Record and check verification evidence against the working tree",
    usage: "carja evidence run --label <name> [--stable-tree] -- <cmd>\n  carja evidence check --label <name> [options]\n  carja evidence list",
    flags: [
      ["--label <name>", "Which evidence (repeatable for check)"],
      ["--stable-tree", "With run: fail when the command changes files"],
      ["--expect-cmd <cmd>", "With check: the evidence must come from this command"],
      ["--max-age <hours>", "With check: the evidence must be this recent"],
      ["--allow-paths <a,b>", "With check: changes to these paths keep the evidence fresh"],
    ],
    examples: [["carja evidence run --label tests -- npm test", "record a test run"]],
  },
  {
    name: "add", group: "skills", summary: "Download a skill from the registry",
    usage: "carja add <skill> [options]",
    flags: [["--registry <url>", "Use this registry"], ["--allow-unsafe", "Install although the scan found a critical issue"]],
    config: ["registry"],
    examples: [[`${NPX} add react-components`, ""]],
  },
  {
    name: "remove", group: "skills", summary: "Remove an installed skill",
    usage: "carja remove <skill> [-f]",
    flags: [["-f, --force", "Remove without asking"]],
    examples: [["carja remove react-components", ""]],
  },
  {
    name: "list", group: "skills", summary: "List installed skills, or the registry's",
    usage: "carja list [options]",
    flags: [["-r, --remote", "List the registry"], ["--tier <tier>", "core | tech-vision | domain"]],
    config: ["registry"],
    examples: [["carja list --remote", ""]],
  },
  {
    name: "search", group: "skills", summary: "Search the registry",
    usage: "carja search <query> [options]",
    flags: [["--tag <tag>", "Only skills with this tag"], ["--tier <tier>", "Only this tier"]],
    config: ["registry"],
    examples: [["carja search react", ""]],
  },
  {
    name: "review-log", group: "measure", summary: "Record review findings, and see which rules reviewers dismiss",
    usage: "carja review-log append '<json>' | carja review-log summary [--since <date>]",
    flags: [["--since <date>", "With summary: only findings after this date"]],
    examples: [["carja review-log summary", ""]],
  },
  {
    name: "context-bill", group: "measure", summary: "What the framework costs an agent per session",
    usage: "carja context-bill [dir] [options]",
    flags: [["--all", "List every file"], ["--json", "Print JSON"], ["--budget <file>", "Check against a budget file"], ["--capture", "Print a budget file for the current state"]],
    examples: [["carja context-bill", ""]],
  },
  {
    name: "agents-md", group: "measure", summary: "The project card in AGENTS.md: print facts, refresh them, check it",
    usage: "carja agents-md <facts|write|check> [dir]",
    flags: [],
    config: ["verify", "eval"],
    examples: [["carja agents-md check", "is the card current?"]],
  },
]);

/** Every carja.config.json key the CLI reads. */
export const CONFIG_KEYS = Object.freeze([
  ["verify", "The command `git push` and the loop must pass (set it with `carja verify --set`)"],
  ["eval", "The agent-layer eval command the push gate also runs"],
  ["deployCheck", "A command that says whether the latest merge is deployed (`status --live`)"],
  ["registry", "The skill registry URL for add, list and search"],
  ["repos", "Per nested code repository: { \"<dir>\": { \"verify\": …, \"deployCheck\": … } }"],
  ["loop.forge", "\"gh\" | \"glab\" (default: from the origin host)"],
  ["loop.setup", "Shell command run once in each new worktree, before the first beat"],
  ["loop.allowed_domains", "Extra hosts the sandbox may reach; never a package registry (refused)"],
  ["loop.require_ready", "true: only backlog items given with carja loop take, or tagged loop-ready"],
  ["loop.priorities", "[\"P1\"]: only backlog items under these headings"],
  ["loop.inbox", "false: never take inbox lines"],
  ["loop.allow_nested_repo", "true: run although a gitignored nested git repository exists"],
  ["loop.profile", "\"quality\" (Opus everywhere) or \"balanced\" (Sonnet for code and ship, Opus for review, specs and designs): set it with carja loop profile"],
  ["loop.models", "{ \"maker\": \"sonnet\", … }: one role's model over the profile (roles: maker, maker_escalation, checker, spec, blueprint, ship; claude engine)"],
  ["loop.cost_aware", "true: budget.max_cost_usd in loop-state.json stops a run"],
  ["loop.slices", "[\"<Project>\"] or true: the project's carved slices are loop work, from spec to MR"],
  ["loop.blueprint", "[\"<Project>\"] or true: after Discovery, the project's Blueprint is loop work, one MR"],
  ["loop.code_dir", "\"repo\": the code is this nested repository (outer layout). Each item gets a code worktree and two MRs, code first; verify is repos.<code_dir>.verify"],
  ["loop.blank_env", "[\"GEMINI_API_KEY\", …]: set empty in every beat, so app code never calls a provider with a placeholder key (default: the common provider keys, never the engine's own; [] turns it off)"],
  ["loop.install", "Shell command the driver runs outside the sandbox after the dependency gate passed a new dependency, e.g. \".venv/bin/pip install -r requirements.txt\" or \"npm ci\""],
  ["loop.dependency_min_age_days", "A new dependency's version must be at least this many days old (default 7)"],
  ["loop.quota_max_wait_min", "A beat that hit the agent CLI's usage limit waits for the announced reset when it is at most this many minutes away, then runs again (default 330; 0 stops at the limit)"],
]);

const pad = (s, n) => (s.length >= n ? `${s}  ` : s.padEnd(n));

/** `carja <name> --help`. */
export function commandHelp(name) {
  const c = COMMANDS.find((x) => x.name === name);
  if (!c) return null;
  const lines = ["", `  ${c.summary}`, "", "  Usage:", `    ${c.usage.replace(/\n {2}/g, "\n    ")}`];
  if (c.flags.length) {
    lines.push("", "  Options:");
    for (const [f, d] of c.flags) lines.push(`    ${pad(f, 24)}${d}`);
  }
  if (c.config?.length) {
    lines.push("", "  Reads from carja.config.json:");
    for (const k of c.config) lines.push(`    ${pad(k, 24)}${CONFIG_KEYS.find(([x]) => x === k)?.[1] ?? ""}`);
  }
  lines.push("", "  Examples:");
  for (const [e, why] of c.examples) lines.push(`    ${e}${why ? `    # ${why}` : ""}`);
  lines.push("", "  Full guide: docs/Using-Carja.md", "");
  return lines.join("\n");
}

/** `carja help`: the commands by what you want to do. */
export function mainHelp() {
  const lines = ["", "  Carja: the AI software engineering framework.", "", "  Run it with:  carja <command>   or   " + NPX + " <command>", ""];
  for (const [g, title] of GROUPS) {
    lines.push(`  ${title}:`);
    for (const c of COMMANDS.filter((x) => x.group === g)) lines.push(`    ${pad(c.name, 16)}${c.summary}`);
    lines.push("");
  }
  lines.push("  Details:     carja help <command>   or   carja <command> --help", "  Full guide:  docs/Using-Carja.md", "");
  return lines.join("\n");
}

/** The generated reference part of docs/Using-Carja.md. */
export function renderReference() {
  const out = ["## Command reference", "", "Generated from `src/usage.js`. `carja <command> --help` prints the same.", ""];
  for (const [g, title] of GROUPS) {
    out.push(`### ${title}`, "");
    for (const c of COMMANDS.filter((x) => x.group === g)) {
      out.push(`#### \`carja ${c.name}\``, "", `${c.summary}.`, "", "```", c.usage.replace(/\n {2}/g, "\n"), "```", "");
      if (c.flags.length) {
        out.push("| Option | What it does |", "|---|---|");
        for (const [f, d] of c.flags) out.push(`| \`${f}\` | ${d.replace(/\|/g, "\\|")} |`);
        out.push("");
      }
      if (c.config?.length) out.push(`Reads: ${c.config.map((k) => `\`${k}\``).join(", ")}.`, "");
      out.push(...c.examples.map(([e, why]) => `- \`${e}\`${why ? `: ${why}` : ""}`), "");
    }
  }
  out.push("## Settings in `carja.config.json`", "", "| Key | What it does |", "|---|---|");
  for (const [k, d] of CONFIG_KEYS) out.push(`| \`${k}\` | ${d.replace(/\|/g, "\\|")} |`);
  out.push("");
  return out.join("\n");
}

export const REFERENCE_START = "<!-- usage-reference:start (generated by scripts/write-usage-reference.js) -->";
export const REFERENCE_END = "<!-- usage-reference:end -->";
