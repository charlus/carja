#!/usr/bin/env bash
# Carja — hook-bypass blocker (F11). A Claude Code `PreToolUse` hook.
#
# WHY THIS EXISTS. Every Carja gate lives in a git hook: the Test-Driven
# Law, the Eval-Driven Law, the Goodhart boundary and protected paths on
# commit; the Verification Iron Law on push. `git commit --no-verify` skips all
# of them, in one flag, silently, with no ship-log line. Until now the only
# thing standing in its way was a sentence in hooks/README.md asking nicely —
# and prose is advisory, which is the whole reason these gates are code.
#
# The rule this enforces is not "never bypass". It is "every bypass is
# logged". Carja already ships a named, ship-logged waiver for each gate;
# this hook refuses the unlogged shortcut and names the logged one instead.
#
# CONTRACT. stdin is Claude Code PreToolUse JSON; exit 2 blocks the tool call
# and shows stderr to the agent, exit 0 allows it. FAIL OPEN on anything
# unexpected — no node, unparseable stdin, an unknown shape: a hook that
# blocks on its own errors would wedge every Bash call in the session.
#
# REACH. PreToolUse is a Claude Code mechanism, so this guards that harness
# only. On Codex and Antigravity the fallback is after the fact, not before:
# `src/loop/autocommit.js` records a bypassed commit and `improver.js` surfaces
# the recurring pattern. Detection, not prevention — state it, don't claim it.
#
# Wire it up (see hooks/README.md) in .claude/settings.json:
#   "PreToolUse": [ { "matcher": "Bash", "hooks": [ { "type": "command",
#     "command": "$CLAUDE_PROJECT_DIR/.agents/hooks/pretooluse-no-bypass.sh" } ] } ]
#
# WHAT IT IS NOT. A guard against the ordinary, lazy bypass — not a sandbox.
# That is a decided standard, not an accident (PR #33 review, decision D2): it
# closes every form found by review, and deliberately does not chase a
# determined attacker, because there is no end state to that chase.
# It parses the command the way the shell would, including grouped short
# flags, quoting, wrapper programs and `sh -c` strings. It cannot see a git
# alias (`git config alias.c "commit -n"` then `git c`), a script file that
# runs git, or a hook path set in git config beforehand. Those are exactly
# what the PR gate and the loop's Checker exist for.
#
# Disable with CARJA_HOOKS=off, like every other Carja hook.
set -uo pipefail

# 6.x names still work through 7.x: each CONDUCTOR_X sets CARJA_X when unset.
for _k in $(compgen -e); do case "$_k" in CONDUCTOR_*) _n="CARJA_${_k#CONDUCTOR_}"; [ -n "${!_n:-}" ] || export "$_n=${!_k}" ;; esac; done
[ "${CARJA_HOOKS:-on}" = "off" ] && exit 0
command -v node >/dev/null 2>&1 || exit 0

# A PreToolUse hook sits in front of every tool call, so it must be bounded.
# Anything slow here is a bug whatever the cause — and at least one real one
# is not ours: on some kernels `mkdirSync(..., {recursive:true})` against a
# pathological path (a CARJA_HOME under /proc, say) never returns. The
# harness has its own timeout, but relying on it means the failure mode is
# "the session stalls" rather than "the gate stepped aside". Bound it here and
# fail OPEN on expiry.
run_bounded() {
  local rc t="${CARJA_HOOK_TIMEOUT:-5}" pt
  # A value that is not a positive number means "no bound" to both tools —
  # coreutils treats 0 as disabled, perl's `alarm 0` cancels the alarm — so
  # anything else falls back to 5. perl takes whole seconds: round UP, never 0.
  # Pure bash on purpose: this runs in front of every tool call, and an
  # earlier version that shelled out to awk returned nothing where awk was
  # absent — giving perl `alarm ""`, which is no alarm at all.
  case "$t" in ''|.|*[!0-9.]*|*.*.*) t=5 ;; esac
  local int="${t%%.*}" frac=""
  case "$t" in *.*) frac="${t#*.}" ;; esac
  pt=$((10#${int:-0}))
  [ -n "${frac//0/}" ] && pt=$((pt + 1))
  if [ "$pt" -lt 1 ]; then t=5; pt=5; fi
  # coreutils `timeout`, Homebrew's `gtimeout`, then perl's alarm — which ships
  # with stock macOS, where the first two usually do not. The first version
  # fell back to an UNBOUNDED node when `timeout` was missing (review finding),
  # which on a Mac meant no bound at all.
  if command -v timeout >/dev/null 2>&1; then
    timeout "$t" node -e "$1"
  elif command -v gtimeout >/dev/null 2>&1; then
    gtimeout "$t" node -e "$1"
  elif command -v perl >/dev/null 2>&1; then
    perl -e 'alarm shift; exec @ARGV' "$pt" node -e "$1"
  else
    node -e "$1"   # nothing to bound it with; the harness timeout is all that is left
    exit $?
  fi
  rc=$?
  # 124 = `timeout` expired; 142 = killed by SIGALRM (128+14) from perl.
  # Either way: allow, never wedge the session.
  { [ "$rc" = "124" ] || [ "$rc" = "142" ]; } && exit 0
  exit "$rc"
}

read -r -d '' CARJA_BYPASS_GUARD_JS <<'NODE'
const read = () => { try { return require("fs").readFileSync(0, "utf8"); } catch { return ""; } };

// Git commands whose hooks a flag can skip, and what each gate's logged
// alternative is. A denial that does not name the alternative just teaches
// the reader to find a different way around.
const GATED = {
  commit: 'CARJA_NO_TEST / CARJA_NO_EVAL / CARJA_NO_BOUNDARY / CARJA_NO_INTEGRITY / CARJA_NO_PROTECTED="reason" git commit …',
  push: 'CARJA_SKIP_VERIFY / CARJA_SKIP_EVAL / CARJA_NO_TESTS_RAN / CARJA_NO_INTEGRITY="reason" git push …',
  merge: 'CARJA_HOOKS=off (whole-repo, and deliberate) — prefer the per-gate waivers',
  am: 'CARJA_HOOKS=off (whole-repo, and deliberate) — prefer the per-gate waivers',
};

// git accepts any unambiguous prefix. `--no-v` already resolves to
// --no-verify on these subcommands, so anything shorter is not a bypass.
const isNoVerify = (t) => t.length >= "--no-v".length && "--no-verify".startsWith(t);

// Options that swallow the next token. Needed so the subcommand scan does not
// mistake an option's VALUE for the subcommand.
const TAKES_VALUE = new Set(["-c", "-C", "--git-dir", "--work-tree", "--namespace", "--exec-path", "--config-env"]);

// Split a command line into segments of argv, the way the shell does:
// single quotes are literal, double quotes and bare words honour backslash
// escapes, and ; && || | & ( ) ` and newlines separate commands.
//
// The first version split on whitespace and BLANKED quoted spans instead. The
// independent review (blocker B2) showed that is not how git receives its
// arguments: `-nm` reached git as one token carrying -n, `'it'\''s'` confused
// the blanking so a later --no-verify vanished, and a quoted "--no-verify" is
// still a flag once the shell strips the quotes. Tokenising like the shell
// fixes all three and makes a genuine mention (an -m message) safe by
// understanding it, not by hiding it.
function tokenize(cmd) {
  const segs = [];
  let cur = [];
  let tok = null;
  const pushTok = () => { if (tok !== null) { cur.push(tok); tok = null; } };
  const pushSeg = () => { pushTok(); if (cur.length) segs.push(cur); cur = []; };
  for (let i = 0; i < cmd.length; ) {
    const c = cmd[i];
    if (c === "'") {
      tok = tok ?? "";
      i++;
      while (i < cmd.length && cmd[i] !== "'") tok += cmd[i++];
      i++;
      continue;
    }
    if (c === '"') {
      tok = tok ?? "";
      i++;
      while (i < cmd.length && cmd[i] !== '"') {
        if (cmd[i] === "\\" && i + 1 < cmd.length && '"\\$`\n'.includes(cmd[i + 1])) {
          tok += cmd[i + 1];
          i += 2;
        } else tok += cmd[i++];
      }
      i++;
      continue;
    }
    if (c === "\\") {
      if (i + 1 < cmd.length) tok = (tok ?? "") + cmd[i + 1];
      i += 2;
      continue;
    }
    if (c === " " || c === "\t") { pushTok(); i++; continue; }
    if (c === "&" && cmd[i + 1] === "&") { pushSeg(); i += 2; continue; }
    if (c === "|" && cmd[i + 1] === "|") { pushSeg(); i += 2; continue; }
    if ("\n;|&()`".includes(c)) { pushSeg(); i++; continue; }
    // `$(` opens a command substitution: what follows is its own command.
    // $'…' is ANSI-C quoting: the shell decodes the escapes and passes the
    // result as one word, so `$'--no-verify'` reaches git as --no-verify.
    if (c === "$" && cmd[i + 1] === "'") {
      tok = tok ?? "";
      i += 2;
      const ESC = { n: "\n", t: "\t", r: "\r", e: "\x1b", a: "\x07", b: "\b", f: "\f", v: "\v", "\\": "\\", "'": "'", '"': '"' };
      while (i < cmd.length && cmd[i] !== "'") {
        if (cmd[i] === "\\" && i + 1 < cmd.length) {
          const n = cmd[i + 1];
          if (n === "x") {
            const hex = cmd.slice(i + 2).match(/^[0-9a-fA-F]{1,2}/);
            if (hex) { tok += String.fromCharCode(parseInt(hex[0], 16)); i += 2 + hex[0].length; continue; }
          }
          if (/[0-7]/.test(n)) {
            const oct = cmd.slice(i + 1).match(/^[0-7]{1,3}/)[0];
            tok += String.fromCharCode(parseInt(oct, 8));
            i += 1 + oct.length;
            continue;
          }
          tok += ESC[n] ?? n;
          i += 2;
          continue;
        }
        tok += cmd[i++];
      }
      i++;
      continue;
    }
    if (c === "$" && cmd[i + 1] === "(") { pushSeg(); i += 2; continue; }
    tok = (tok ?? "") + c;
    i++;
  }
  pushSeg();
  return segs;
}

// Programs that run their argument list as another command.
const WRAPPERS = new Set([
  "env", "command", "sudo", "doas", "exec", "nohup", "nice", "time", "builtin",
  // Added after the delta review — each runs its argument list as a command.
  "timeout", "gtimeout", "xargs", "stdbuf", "ionice", "flock", "setsid", "chrt", "taskset", "unbuffer",
]);
// …and the wrapper options that consume a value, so it is not read as the program.
const WRAPPER_VALUE_OPT = {
  sudo: /^-[ugCDhprtTU]$/, doas: /^-[uC]$/, env: /^-[uC]$/, nice: /^-n$/,
  timeout: /^-[sk]$/, gtimeout: /^-[sk]$/, xargs: /^-[IiLlnPsdEa]$/, stdbuf: /^-[ioe]$/,
  ionice: /^-[cnp]$/, flock: /^-[wE]$/, taskset: /^-[c]$/,
};
// …and the ones that take a POSITIONAL argument before the program:
// `timeout 60 git …`, `flock /tmp/lock git …`, `chrt 10 git …`, `taskset 0x1 git …`.
const WRAPPER_POSITIONAL = new Set(["timeout", "gtimeout", "flock", "chrt", "taskset"]);

const SHELLS = /^(sh|bash|zsh|dash|ksh|ash)$/;
// Shell keywords that come BEFORE a command in the same segment: in
// `if ! git diff --quiet; then git commit -n …; fi` the segment starts with
// `then`, so the first word was never git (final review, NB2).
const RESERVED = new Set(["if", "then", "else", "elif", "fi", "do", "done", "while", "until", "{", "}", "!"]);

// commit options that take a value, so the NEXT token is data, not a flag.
// `git commit -m -n` commits with the message "-n"; reading that -n as
// --no-verify was a false positive.
const COMMIT_VALUE_SHORT = new Set(["m", "F", "C", "c", "t"]);
const COMMIT_VALUE_LONG = /^--(message|file|reuse-message|reedit-message|fixup|squash|template|author|date|cleanup|trailer|pathspec-from-file)$/;

function checkSegment(argv, depth) {
  let i = 0;
  let hooksOff = false;
  // git also reads config from the environment: GIT_CONFIG_KEY_<n> with a
  // matching VALUE, or GIT_CONFIG_PARAMETERS. Either can point core.hooksPath
  // at an empty directory, which disables every hook as surely as -c does.
  let hooksPathEnv = false;
  const takeAssignments = () => {
    while (i < argv.length && /^[A-Za-z_][A-Za-z0-9_]*=/.test(argv[i])) {
      const [name, ...rest] = argv[i].split("=");
      const value = rest.join("=");
      if (/^(CARJA|CONDUCTOR)_HOOKS$/.test(name) && /^(off|0|false)$/i.test(value)) hooksOff = true; // the 6.x name still works in 7.x
      if (/^GIT_CONFIG_KEY_\d+$/.test(name) && /^core\.hookspath$/i.test(value)) hooksPathEnv = true;
      if (name === "GIT_CONFIG_PARAMETERS" && /core\.hookspath/i.test(value)) hooksPathEnv = true;
      i++;
    }
  };

  for (let guard = 0; i < argv.length && guard < 8; guard++) {
    while (i < argv.length && RESERVED.has(argv[i])) i++;
    takeAssignments();
    if (i >= argv.length) break;
    const w = argv[i].split("/").pop();
    if (!WRAPPERS.has(w)) break;
    i++;
    while (i < argv.length && argv[i].startsWith("-")) {
      const opt = argv[i++];
      // `env -S "…"` splits its argument into a command line: judge it as one.
      if (w === "env" && (opt === "-S" || opt === "--split-string") && i < argv.length) {
        return depth < 4 ? verdict([argv[i], ...argv.slice(i + 1)].join(" "), depth + 1) : null;
      }
      if (w === "env" && /^-S./.test(opt)) {
        return depth < 4 ? verdict([opt.slice(2), ...argv.slice(i)].join(" "), depth + 1) : null;
      }
      if (WRAPPER_VALUE_OPT[w] && WRAPPER_VALUE_OPT[w].test(opt)) i++;
    }
    if (WRAPPER_POSITIONAL.has(w) && i < argv.length) i++;
    takeAssignments(); // env VAR=value …
  }
  if (i >= argv.length) return null;

  const prog = argv[i].split("/").pop();

  // A shell running a string is a command inside a command: judge the string.
  if (SHELLS.test(prog)) {
    for (let j = i + 1; j < argv.length; j++) {
      if (/^-[A-Za-z]*c[A-Za-z]*$/.test(argv[j]) && j + 1 < argv.length) {
        return depth < 4 ? verdict(argv[j + 1], depth + 1) : null;
      }
    }
    return null;
  }
  if (prog === "eval") return depth < 4 ? verdict(argv.slice(i + 1).join(" "), depth + 1) : null;
  if (prog !== "git") return null;
  i++;

  // Pre-subcommand options, where -c core.hooksPath=… hides.
  let hooksPath = false;
  let sub = null;
  while (i < argv.length) {
    const t = argv[i];
    if (t === "-c" && i + 1 < argv.length) {
      if (/^core\.hookspath=/i.test(argv[i + 1])) hooksPath = true;
      i += 2;
      continue;
    }
    if (/^-ccore\.hookspath=/i.test(t) || /^--config-env=core\.hookspath=/i.test(t)) {
      hooksPath = true;
      i++;
      continue;
    }
    if (TAKES_VALUE.has(t)) { i += 2; continue; }
    if (t.startsWith("-")) { i++; continue; }
    sub = t;
    i++;
    break;
  }
  if (hooksPath) return { sub: sub || "commit", how: "-c core.hooksPath= overrides where git looks for hooks" };
  if (hooksPathEnv && (!sub || sub in GATED)) {
    return { sub: sub || "commit", how: "GIT_CONFIG_* in the environment points core.hooksPath elsewhere" };
  }
  if (!sub || !(sub in GATED)) return null;

  for (let j = i; j < argv.length; j++) {
    const t = argv[j];
    if (t === "--") break;
    if (isNoVerify(t)) return { sub, how: `${t} skips the ${sub} hooks` };
    if (sub !== "commit") continue;
    if (COMMIT_VALUE_LONG.test(t)) { j++; continue; }
    if (/^-[A-Za-z]/.test(t)) {
      // A short-option cluster: -anm is -a -n -m. Walk it the way git does.
      for (let k = 1; k < t.length; k++) {
        const ch = t[k];
        if (ch === "n") return { sub, how: `${t} contains -n, the shorthand for --no-verify on commit` };
        if (COMMIT_VALUE_SHORT.has(ch)) {
          if (k === t.length - 1) j++; // the value is the next token
          break;                        // …or the rest of this one
        }
        if (ch === "u" || ch === "S") break; // optional attached value
      }
    }
  }
  if (hooksOff) return { sub, how: "CARJA_HOOKS=off disables every gate and writes no ship-log line" };
  return null;
}

function verdict(command, depth = 0) {
  for (const argv of tokenize(String(command))) {
    const hit = checkSegment(argv, depth);
    if (hit) return hit;
  }
  return null;
}

let data;
try { data = JSON.parse(read()); } catch { process.exit(0); }
if (!data || typeof data !== "object") process.exit(0);
if (data.tool_name !== "Bash") process.exit(0);
const command = data.tool_input && data.tool_input.command;
if (typeof command !== "string" || !command) process.exit(0);

const hit = verdict(command);
if (!hit) process.exit(0);

process.stderr.write(
  `\n🛑 Carja: hook bypass blocked.\n\n` +
  `  ${hit.how}.\n\n` +
  `  Those hooks are the Test-Driven Law, the Eval-Driven Law, the Goodhart\n` +
  `  boundary, protected paths and the Verification Iron Law. Skipping them\n` +
  `  here leaves no trace that they were skipped, which is the actual problem —\n` +
  `  not the bypass itself.\n\n` +
  `  Every gate has a waiver that COMMITS and gets written to the ship-log:\n` +
  `    ${GATED[hit.sub] || GATED.commit}\n\n` +
  `  Use the one that matches why you are bypassing. If none of them does, the\n` +
  `  gate is probably telling you something true.\n\n`
);
process.exit(2);
NODE

run_bounded "$CARJA_BYPASS_GUARD_JS"
