// test/loop-nested-run.test.js
//
// Unattended Lifecycle step 7, end to end through the real CLI: an outer
// Carja repository with the team's code nested at repo/ (`loop.code_dir`),
// a stub engine on PATH (test/fixtures/stub-engine/claude) and a stub `gh`
// that records each MR it is asked to open. One backlog item must give:
//   - a code worktree made from the code repository's main, not from the
//     branch the owner has checked out;
//   - the code commit in the code repository, the Carja state in the outer one;
//   - two MRs, the code MR first, the state MR naming it;
//   - the owner's two checkouts untouched.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync, spawnSync } from "node:child_process";

const REPO = new URL("..", import.meta.url).pathname;
const G = (cwd, ...a) => execFileSync("git", a, { cwd, stdio: "pipe" }).toString().trim();

function outerLayout() {
  const base = mkdtempSync(join(tmpdir(), "nested-run-"));
  const bin = join(base, "bin");
  mkdirSync(bin);
  writeFileSync(join(bin, "claude"), readFileSync(join(REPO, "test/fixtures/stub-engine/claude")), { mode: 0o755 });
  // Each MR request is recorded with the folder it was opened from.
  writeFileSync(
    join(bin, "gh"),
    `#!/bin/sh\n[ "$1" = auth ] && exit 0\n[ "$1" = pr ] && [ "$2" = list ] && exit 0\nn=$(ls "${base}/mrs" 2>/dev/null | wc -l)\nmkdir -p "${base}/mrs"\n{ pwd; printf '%s\\n' "$@"; } > "${base}/mrs/$n.txt"\necho "https://example.invalid/pr/$((n+1))"\n`,
    { mode: 0o755 }
  );
  // The team's code repository, with the owner working on a feature branch.
  G(base, "init", "-q", "--bare", "-b", "main", "code.git");
  const root = join(base, "outer");
  execFileSync("node", [join(REPO, "bin/carja.js"), "init", root, "--all", "--no-detect"], { stdio: "pipe" });
  const code = join(root, "repo");
  execFileSync("git", ["clone", "-q", join(base, "code.git"), code], { stdio: "pipe" });
  for (const d of [code]) {
    G(d, "config", "user.email", "t@t");
    G(d, "config", "user.name", "t");
  }
  writeFileSync(join(code, "app.py"), "x = 1\n");
  G(code, "add", "-A");
  G(code, "commit", "-qm", "main");
  G(code, "push", "-q", "-u", "origin", "main");
  G(code, "remote", "set-head", "origin", "main");
  G(code, "checkout", "-q", "-b", "feat/owner");
  writeFileSync(join(code, "owner.py"), "wip = True\n");
  G(code, "add", "-A");
  G(code, "commit", "-qm", "owner wip");
  // The private outer repository.
  G(root, "init", "-q", "-b", "master");
  G(root, "config", "user.email", "t@t");
  G(root, "config", "user.name", "t");
  writeFileSync(join(root, ".gitignore"), "repo/\n.agents/.worktrees/\n", { flag: "a" });
  writeFileSync(join(root, "carja/2-backlog/task-backlog.md"), "# Task Backlog\n\n- [ ] Add the built flag (loop-ready)\n", { flag: "a" });
  const cfg = JSON.parse(readFileSync(join(root, "carja.config.json"), "utf8"));
  Object.assign(cfg, { verify: "none", repos: { repo: { verify: "test -f app.py" } } });
  // As on autopportunity: setup links an untracked environment from the owner's checkout.
  cfg.loop = { forge: "gh", code_dir: "repo", require_ready: true, inbox: false, setup: 'ln -sfn "$CARJA_CODE_ROOT/app.py" linked-env' };
  writeFileSync(join(root, "carja.config.json"), JSON.stringify(cfg, null, 2));
  const st = JSON.parse(readFileSync(join(root, "carja/1-workbench/loop-state.json"), "utf8"));
  Object.assign(st, { phase: "execution", autonomy_level: "L3", sandbox: "cli-native", platform: "claude", concurrency: 1 });
  st.budget = { max_beats: 10, max_wall_clock_min: 10 };
  st.iterations = { current: 0, max_allowed: 10 };
  writeFileSync(join(root, "carja/1-workbench/loop-state.json"), JSON.stringify(st, null, 2));
  G(root, "add", "-A");
  G(root, "commit", "-qm", "init");
  G(base, "init", "-q", "--bare", "-b", "master", "outer.git");
  G(root, "remote", "add", "origin", join(base, "outer.git"));
  G(root, "push", "-q", "origin", "master");
  G(root, "remote", "set-head", "origin", "master");
  return { base, root, code, bin };
}

test("outer layout: a code worktree from main, the code in the code repository, two MRs with the code MR first", () => {
  const p = outerLayout();
  try {
    // F14 (autopportunity, 2026-10-20): the owner works on a branch of the outer repository too.
    G(p.root, "checkout", "-q", "-b", "docs/owner-tv");
    writeFileSync(join(p.root, "carja/owner-wip.md"), "# my technical vision, in progress\n");
    G(p.root, "add", "-A");
    G(p.root, "commit", "-qm", "owner wip");
    const r = spawnSync("node", [join(REPO, "bin/carja.js"), "loop", p.root, "--from-carja"], {
      cwd: p.root,
      encoding: "utf8",
      env: { ...process.env, PATH: `${p.bin}:${process.env.PATH}`, STUB_LOG_DIR: join(p.base, "prompts"), STUB_CODE_DIR: "repo", CARJA_HOME: join(p.base, "home"), GEMINI_API_KEY: "placeholder", ANTHROPIC_API_KEY: "engine-key" },
      timeout: 120000,
    });
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.match(r.stdout, /finished: completed/);

    // P1 (autopportunity, 2026-10-22): the Ship beat writes only to the outer
    // repository, so the verify after it finds the code verdict FRESH and reuses it.
    const verifies = readFileSync(join(p.root, ".git/carja-loop-logs/events.ndjson"), "utf8")
      .trim().split("\n").map((l) => JSON.parse(l)).filter((e) => e.type === "verify");
    assert.equal(verifies.length, 2, JSON.stringify(verifies));
    assert.deepEqual(verifies.map((e) => [e.exit, Boolean(e.reused)]), [[0, false], [0, true]]);

    // Two MRs: the code MR from the code worktree, then the state MR naming it.
    const mrs = readdirSync(join(p.base, "mrs")).sort().map((f) => readFileSync(join(p.base, "mrs", f), "utf8"));
    assert.equal(mrs.length, 2, mrs.join("\n---\n"));
    assert.match(mrs[0].split("\n")[0], /\/\.agents\/\.worktrees\/[^/]+\/repo$/, "the code MR is opened from the code worktree");
    assert.doesNotMatch(mrs[1].split("\n")[0], /\/repo$/, "the state MR is opened from the outer worktree");
    assert.match(mrs[1], /Merge the code MR first:\*\* https:\/\/example\.invalid\/pr\/1/);
    assert.match(r.stdout, /pr\/1.*pr\/2|pr\/2.*pr\/1/s, "the Next line names both MRs");

    // The code branch, in the code repository, from main.
    const branch = G(p.code, "ls-remote", "--heads", "origin", "carja/loop/*").split("\t")[1].replace("refs/heads/", "");
    G(p.code, "fetch", "-q", "origin", branch);
    const files = G(p.code, "ls-tree", "-r", "--name-only", "FETCH_HEAD").split("\n");
    assert.ok(files.includes("src/built.js"), "the code is in the code repository");
    assert.ok(!files.includes("owner.py"), "the owner's feature branch is not the base");
    assert.ok(!files.some((f) => f.startsWith("carja/")), "no Carja state in the team's repository");
    assert.ok(!files.includes("linked-env"), "what loop.setup made is never committed");

    // The state branch, in the outer repository, with Ship's bookkeeping and no code.
    G(p.root, "fetch", "-q", "origin", branch);
    const outerFiles = G(p.root, "diff", "--name-only", "origin/master", "FETCH_HEAD").split("\n");
    assert.ok(outerFiles.includes("carja/0-compass/ship-log.md"));
    assert.ok(!outerFiles.some((f) => f.startsWith("repo/") || f === "src/built.js"));
    assert.ok(!G(p.root, "ls-tree", "-r", "--name-only", "FETCH_HEAD").split("\n").includes("carja/owner-wip.md"), "the owner's outer branch is not the base of the state MR");

    // P4: every beat ran with the app's provider key blank and the engine's own key kept.
    const envs = readdirSync(join(p.base, "prompts")).filter((f) => f.endsWith(".env.json")).map((f) => JSON.parse(readFileSync(join(p.base, "prompts", f), "utf8")));
    assert.ok(envs.length >= 3, `beats seen: ${envs.length}`);
    assert.deepEqual([...new Set(envs.map((e) => `${e.GEMINI_API_KEY}|${e.ANTHROPIC_API_KEY}`))], ["|engine-key"]);

    // The Checker was told where the code diff is.
    const prompts = readdirSync(join(p.base, "prompts")).map((f) => readFileSync(join(p.base, "prompts", f), "utf8"));
    assert.ok(prompts.some((x) => /# This layout: the code is a separate repository/.test(x)));

    // The owner's checkouts: the code one on its branch with nothing changed.
    assert.equal(G(p.code, "branch", "--show-current"), "feat/owner");
    assert.equal(G(p.code, "status", "--porcelain"), "");
    assert.equal(existsSync(join(p.code, "src/built.js")), false);

    // F21: the run's audit trail stays in the git dir, never in the owner's tracked ship-log.
    assert.equal(G(p.root, "diff", "--name-only", "--", "carja/0-compass/ship-log.md"), "", "the owner's ship-log is untouched");
    const audit = readFileSync(join(p.root, ".git/carja-loop-logs/audit.md"), "utf8");
    assert.match(audit, /^- \[[0-9T:.\-]+Z\] \[loop\] /m, "the audit trail is in .git/carja-loop-logs/audit.md");
  } finally {
    rmSync(p.base, { recursive: true, force: true });
  }
});

test("outer layout: a single --goal run is refused with the command to use", () => {
  const p = outerLayout();
  try {
    const r = spawnSync("node", [join(REPO, "bin/carja.js"), "loop", p.root, "--goal", "x"], {
      cwd: p.root, encoding: "utf8", env: { ...process.env, PATH: `${p.bin}:${process.env.PATH}` }, timeout: 60000,
    });
    assert.notEqual(r.status, 0);
    assert.match(r.stderr, /--from-carja/);
  } finally {
    rmSync(p.base, { recursive: true, force: true });
  }
});

test("outer layout: loop doctor checks the code repository and runs verify in a code worktree", () => {
  const p = outerLayout();
  try {
    const r = spawnSync("node", [join(REPO, "bin/carja.js"), "loop", "doctor", p.root], {
      cwd: p.root, encoding: "utf8", env: { ...process.env, PATH: `${p.bin}:${process.env.PATH}` }, timeout: 120000,
    });
    assert.match(r.stdout, /code repository repo\/.*origin\/main/, r.stdout);
    assert.match(r.stdout, /verify is green in a fresh worktree.*test -f app\.py/, r.stdout);
    assert.doesNotMatch(r.stdout, /nested repositories: repo/);
    assert.equal(G(p.code, "worktree", "list").split("\n").length, 1, "the probe worktree is removed");
  } finally {
    rmSync(p.base, { recursive: true, force: true });
  }
});
