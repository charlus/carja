// test/helpers/stacked-layout.js
//
// The outer layout for the stacked-run CLI tests: an outer Carja repository
// with its code nested at repo/, both with a bare origin, the stub engine and a
// stub `gh` on PATH (test/fixtures/stub-engine/claude, test/fixtures/stub-forge/gh).
// No model and no forge is called.

import { readFileSync, mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync, spawnSync } from "node:child_process";

export const REPO = new URL("../..", import.meta.url).pathname;
export const G = (cwd, ...a) => execFileSync("git", a, { cwd, stdio: "pipe" }).toString().trim();
export const OWNER_DOCS = [
  "genesis/problem-solar-system.md",
  "genesis/world-transformation.md",
  "genesis/functional-animator.md",
  "storyboard/main-character.md",
  "storyboard/storyboard.md",
  "blueprint/grand-prd.md",
  "blueprint/ux-ui-design-brief.md",
  "blueprint/technical-vision.md",
];

export function layout({ docs = OWNER_DOCS, carved = 0, prefix = "stacked-run-" } = {}) {
  const base = mkdtempSync(join(tmpdir(), prefix));
  const bin = join(base, "bin");
  mkdirSync(bin);
  writeFileSync(join(bin, "claude"), readFileSync(join(REPO, "test/fixtures/stub-engine/claude")), { mode: 0o755 });
  writeFileSync(join(bin, "gh"), readFileSync(join(REPO, "test/fixtures/stub-forge/gh")), { mode: 0o755 });
  G(base, "init", "-q", "--bare", "-b", "main", "code.git");
  const root = join(base, "outer");
  execFileSync("node", [join(REPO, "bin/carja.js"), "init", root, "--all", "--no-detect"], { stdio: "pipe" });
  const code = join(root, "repo");
  execFileSync("git", ["clone", "-q", join(base, "code.git"), code], { stdio: "pipe" });
  G(code, "config", "user.email", "t@t");
  G(code, "config", "user.name", "t");
  writeFileSync(join(code, "app.py"), "x = 1\n");
  G(code, "add", "-A");
  G(code, "commit", "-qm", "main");
  G(code, "push", "-q", "-u", "origin", "main");
  G(code, "remote", "set-head", "origin", "main");
  G(root, "init", "-q", "-b", "master");
  G(root, "config", "user.email", "t@t");
  G(root, "config", "user.name", "t");
  writeFileSync(join(root, ".gitignore"), "repo/\n.agents/.worktrees/\n", { flag: "a" });
  const p = join(root, "carja/2-backlog/project-backlog/notes");
  for (const rel of docs) {
    mkdirSync(join(p, rel, ".."), { recursive: true });
    writeFileSync(join(p, rel), `# ${rel}\n\nnotes: writers keep notes.\n`);
  }
  // `carved`: the project is already carved into this many slices, on master.
  if (carved) {
    const tpl = (n) => readFileSync(join(root, "carja/5-templates/carve-workflow", n), "utf8");
    for (let i = 1; i <= carved; i++) {
      const d = join(p, `implementations/0${i}-slice-${i}`);
      mkdirSync(d, { recursive: true });
      writeFileSync(join(d, "feature-spec.md"), tpl("feature-spec.md"));
      writeFileSync(join(d, "implementation-plan.md"), tpl("implementation-plan.md"));
    }
    writeFileSync(join(p, "blueprint/implementation-overview.md"), "# Implementation overview\n\nCarved.\n");
  }
  const cfg = JSON.parse(readFileSync(join(root, "carja.config.json"), "utf8"));
  Object.assign(cfg, { verify: "none", repos: { repo: { verify: "test -f app.py" } } });
  cfg.loop = { forge: "gh", code_dir: "repo" };
  writeFileSync(join(root, "carja.config.json"), JSON.stringify(cfg, null, 2));
  const st = JSON.parse(readFileSync(join(root, "carja/1-workbench/loop-state.json"), "utf8"));
  Object.assign(st, { phase: "execution", autonomy_level: "L3", sandbox: "cli-native", platform: "claude", concurrency: 1 });
  st.budget = { max_beats: 20, max_wall_clock_min: 10 };
  st.iterations = { current: 0, max_allowed: 20 };
  writeFileSync(join(root, "carja/1-workbench/loop-state.json"), JSON.stringify(st, null, 2));
  G(root, "add", "-A");
  G(root, "commit", "-qm", "init");
  G(base, "init", "-q", "--bare", "-b", "master", "outer.git");
  G(root, "remote", "add", "origin", join(base, "outer.git"));
  G(root, "push", "-q", "origin", "master");
  G(root, "remote", "set-head", "origin", "master");
  return { base, root, code, bin, db: join(base, "forge.json") };
}

export function loop(l, args, log = "prompts", env = {}) {
  return spawnSync("node", [join(REPO, "bin/carja.js"), "loop", ...args], {
    cwd: l.root,
    encoding: "utf8",
    env: { ...process.env, PATH: `${l.bin}:${process.env.PATH}`, STUB_LOG_DIR: join(l.base, log), STUB_CODE_DIR: "repo", STUB_SLICES: "3", STUB_FORGE_DB: l.db, CARJA_HOME: join(l.base, "home"), ...env },
    timeout: 300000,
  });
}

