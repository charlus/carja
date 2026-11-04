// src/commands/work.js
//
// `carja work <item>`: the hidden worktree an interactive Spec-It, Build or
// Ship works in, so the owner's folder stays on the default branch.
// `carja work clean`: remove the merged ones now (they also go on `git pull`
// and at a loop run). The logic is in src/work.js.

import { spawnSync, spawn } from "node:child_process";
import { relative } from "node:path";
import { ensureWorkWorktree, locate, cleanMerged } from "../work.js";
import { isOldLayout, oldLayoutMessage } from "../names.js";

const git = (cwd) => async (args) => {
  const r = spawnSync("git", args, { cwd, encoding: "utf8", timeout: 60_000 });
  return { ok: r.status === 0, stdout: (r.stdout || "").trim(), stderr: (r.stderr || "").trim() };
};

const sh = (cmd, cwd) =>
  new Promise((res) => {
    const p = spawn("bash", ["-c", cmd], { cwd });
    let output = "";
    p.stdout.on("data", (d) => (output += d));
    p.stderr.on("data", (d) => (output += d));
    p.on("close", (code) => res({ exitCode: code ?? 1, output }));
  });

export async function workCommand(args, context) {
  const { stdout, stderr } = context;
  const positional = args.filter((a) => !a.startsWith("-"));
  const [first, second] = positional;
  if (!first) {
    stderr.write("Name the item: carja work <project>/<slice> or carja work <backlog item>. carja work clean removes the merged ones.\n");
    return 1;
  }
  const where = await locate(second ?? context.cwd, git);
  if (where.inside) {
    stdout.write(`Already in an item's worktree: ${where.inside} (${where.branch}). Work and commit here.\n`);
    return 0;
  }
  if (where.root && isOldLayout(where.root)) {
    stderr.write(oldLayoutMessage(where.root));
    return 1;
  }
  if (!where.root) {
    stderr.write(`Not a git repository: ${second ?? context.cwd}\n`);
    return 1;
  }
  const root = where.root;

  if (first === "clean") {
    const r = await cleanMerged({ root, git });
    for (const w of r.removed) stdout.write(`Removed the merged worktree ${relative(root, w.path) || w.path} (${w.branch}).\n`);
    for (const w of r.kept) stdout.write(`Kept ${relative(root, w.path) || w.path}: ${w.reason}.\n`);
    if (!r.removed.length && !r.kept.length) stdout.write("No merged worktree to remove.\n");
    return 0;
  }

  const r = await ensureWorkWorktree({ root, item: first, git, sh });
  if (!r.ok) {
    stderr.write(`Could not make the worktree for ${first}: ${r.reason}\n`);
    return 1;
  }
  stdout.write(`Worktree: ${r.path}\n`);
  stdout.write(`  branch ${r.branch}, ${r.reused ? "reused" : `new, from ${r.base}`}\n`);
  for (const c of r.code) {
    if (c.ok) stdout.write(`  code: ${c.path} (${c.reused ? "reused" : `new, from ${c.base}`})\n`);
    else stdout.write(`  ⚠️  code ${c.dir}/: ${c.reason}\n`);
  }
  if (r.setup && !r.setup.ok) stdout.write(`  ⚠️  loop.setup failed: ${r.setup.reason}\n`);
  stdout.write("Edit, test and commit in that folder. Your own folder stays on its default branch.\n");
  return r.code.every((c) => c.ok) ? 0 : 1;
}
