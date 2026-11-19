// src/commands/checklist.js
//
// `carja checklist [dir] [--base <ref>] [--files <a,b>]` (F24): the items of
// carja/0-compass/architecture-checklist.md that apply to the current diff,
// for the reviewer to walk. The checklist is read from the base, never from the
// change: a change cannot edit the rules that judge it. The diff is the
// branch against the base, the uncommitted changes and new files, in this
// repository and in the nested code repository (loop.code_dir).

import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join, resolve, dirname } from "node:path";

import { runCli } from "./loop.js";
import { defaultBranchRef } from "../loop/reconcile.js";
import { CHECKLIST_REL, parseChecklist, applicableItems, renderApplicable } from "../checklist.js";

function projectRoot(start) {
  let d = resolve(start);
  for (;;) {
    if (existsSync(join(d, "carja"))) return d;
    const up = dirname(d);
    if (up === d) return resolve(start);
    d = up;
  }
}

async function changedFiles(dir, base, prefix = "") {
  const git = (argv) => runCli("git", argv, dir);
  const ref = base ?? (await defaultBranchRef(git));
  const out = new Set();
  for (const argv of [...(ref ? [["diff", "--name-only", `${ref}...HEAD`]] : []), ["diff", "--name-only", "HEAD"], ["ls-files", "--others", "--exclude-standard"]]) {
    const r = await git(argv);
    if (r.ok) for (const f of r.stdout.split("\n").map((x) => x.trim()).filter(Boolean)) out.add(`${prefix}${f}`);
  }
  return { files: [...out], ref };
}

export async function checklistCommand(args, { cwd, stdout, stderr }) {
  const flag = (name) => {
    const i = args.indexOf(name);
    return i >= 0 ? args[i + 1] : null;
  };
  const dirArg = args.find((a, i) => !a.startsWith("-") && !["--base", "--files"].includes(args[i - 1]));
  const root = projectRoot(resolve(cwd, dirArg ?? "."));
  const base = flag("--base");
  let files;
  let ref = base;
  if (flag("--files") != null) files = flag("--files").split(",").map((f) => f.trim()).filter(Boolean);
  else {
    const outer = await changedFiles(root, base);
    ref = outer.ref;
    files = outer.files;
    let codeDir = null;
    try {
      codeDir = JSON.parse(await readFile(join(root, "carja.config.json"), "utf8")).loop?.code_dir ?? null;
    } catch {
      codeDir = null;
    }
    if (codeDir && existsSync(join(root, codeDir, ".git"))) files.push(...(await changedFiles(join(root, codeDir), null, `${codeDir.replace(/\/+$/, "")}/`)).files);
  }
  const atBase = ref ? await runCli("git", ["show", `${ref}:${CHECKLIST_REL}`], root) : { ok: false };
  const text = atBase.ok ? atBase.stdout : await readFile(join(root, CHECKLIST_REL), "utf8").catch(() => null);
  if (text == null) {
    stdout.write(`No architecture checklist (${CHECKLIST_REL}).\n`);
    return 0;
  }
  const items = parseChecklist(text);
  if (!items.length) {
    stdout.write("The architecture checklist has no items.\n");
    return 0;
  }
  if (!files.length) stderr.write("No changed file found: every item without a trigger applies.\n");
  stdout.write(renderApplicable(applicableItems(items, files)));
  return 0;
}
