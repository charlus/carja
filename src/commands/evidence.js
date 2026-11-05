// src/commands/evidence.js
//
// `carja evidence` — the CLI over the evidence ledger (E2).
//
//   carja evidence run --label tests [--stable-tree] -- npm test
//   carja evidence check --label tests [--expect-cmd "npm test"] [--max-age 24]
//   carja evidence list [--label tests]
//
// `run` is a TRANSPARENT wrapper: output streams through, and the child's exit
// code is this command's exit code. With `--stable-tree`, a green run that
// changed tracked or new files fails: the code that passed is not on disk. `check` exits 0 only when every named label
// is FRESH, so it is usable as a gate — but it never throws, and "I could not
// tell" grades STALE, never FRESH.

import { recordRun, checkFreshness, resolveLedgerPath } from "../evidence/ledger.js";
import { readFile } from "node:fs/promises";

function flagValue(args, flag) {
  const eq = args.find((a) => a.startsWith(`${flag}=`));
  if (eq) return eq.slice(flag.length + 1);
  const i = args.indexOf(flag);
  return i !== -1 ? args[i + 1] ?? null : null;
}

/** Collect every `--label X` (repeatable), each optionally followed by --expect-cmd. */
function collectLabels(args) {
  const out = [];
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--label" || args[i]?.startsWith("--label=")) {
      const label = args[i].startsWith("--label=") ? args[i].slice(8) : args[++i];
      if (!label) continue;
      let expectCmd;
      // An --expect-cmd immediately after this --label binds to it.
      const next = args[i + 1];
      if (next === "--expect-cmd" || next?.startsWith("--expect-cmd=")) {
        expectCmd = next.startsWith("--expect-cmd=") ? next.slice(14) : args[i + 2];
        i += next.startsWith("--expect-cmd=") ? 1 : 2;
      }
      out.push(expectCmd ? { label, expectCmd } : { label });
    }
  }
  return out;
}

const STATE_ICON = { FRESH: "✅", STALE: "⚠️ ", MISSING: "❌" };

export async function evidenceCommand(args, { cwd, stdout, stderr }) {
  const sub = args.find((a) => !a.startsWith("-")) ?? "";

  if (sub === "run") {
    const label = flagValue(args, "--label");
    const sep = args.indexOf("--");
    const command = sep !== -1 ? args.slice(sep + 1).join(" ") : null;
    if (!label || !command) {
      stderr.write(
        "usage: carja evidence run --label <name> [--stable-tree] -- <command...>\n" +
          '  e.g. carja evidence run --label tests -- npm test\n',
      );
      return 1;
    }
    const stable = args.slice(0, sep).includes("--stable-tree");
    const { exitCode, treeChanged } = await recordRun({ label, command, cwd, io: { stdout, stderr } });
    if (stable && exitCode === 0 && treeChanged) {
      stderr.write(
        `\nThe command changed files while it ran: ${treeChanged.join(", ")}\n` +
          "The code that passed is not the code on disk. Commit those changes, or make the\n" +
          "command stop writing them (for example `jest --ci`, a lint check without --fix).\n",
      );
      return 1;
    }
    // Transparency: otherwise the child's code is ours.
    return exitCode;
  }

  if (sub === "check") {
    const labels = collectLabels(args);
    if (labels.length === 0) {
      stderr.write(
        "usage: carja evidence check --label <name> [--expect-cmd <cmd>] [--max-age <hours>] [--allow-paths a,b]\n" +
          "  Name every lane you expect: the ledger cannot prove that a lane which never ran was supposed to.\n",
      );
      return 1;
    }
    const maxAge = flagValue(args, "--max-age");
    const allow = flagValue(args, "--allow-paths");
    const res = await checkFreshness({
      labels,
      cwd,
      maxAgeHours: maxAge ? Number(maxAge) : null,
      allowPaths: allow ? allow.split(",").map((s) => s.trim()).filter(Boolean) : [],
    });
    for (const { label } of labels) {
      const r = res.byLabel[label];
      stdout.write(`${STATE_ICON[r.state] ?? "?"} ${label}: ${r.state} — ${r.reason}\n`);
      if (r.state === "FRESH") {
        stdout.write(`     ran ${r.ts} · exit ${r.exit} · ${r.command}\n`);
      }
    }
    if (!res.ok) {
      stdout.write(
        "\nNot every lane is FRESH. Re-run it wrapped so the result is recorded:\n" +
          `  carja evidence run --label <name> -- <command>\n`,
      );
    }
    return res.ok ? 0 : 1;
  }

  if (sub === "list") {
    const only = flagValue(args, "--label");
    const path = await resolveLedgerPath({ cwd });
    let text = "";
    try {
      text = await readFile(path, "utf8");
    } catch {
      stdout.write(`No evidence recorded yet for this branch.\n  (${path})\n`);
      return 0;
    }
    stdout.write(`${path}\n`);
    for (const line of text.split("\n")) {
      if (!line.trim()) continue;
      let r;
      try {
        r = JSON.parse(line);
      } catch {
        continue;
      }
      if (only && r.label !== only) continue;
      stdout.write(
        `  ${r.ts}  ${String(r.label).padEnd(10)} exit ${String(r.exit).padEnd(3)} ` +
          `tree ${(r.wtree ?? "-").slice(0, 10)}  ${r.command}\n`,
      );
    }
    return 0;
  }

  stderr.write(
    "usage: carja evidence <run|check|list>\n\n" +
      "  run    --label <name> [--stable-tree] -- <command...>   run it and record the result\n" +
      "         (--stable-tree: fail a green run that changed files while it ran)\n" +
      "  check  --label <name> [--expect-cmd <cmd>] [--max-age <hours>] [--allow-paths a,b/]\n" +
      "  list   [--label <name>]\n\n" +
      "Freshness is bound to the working-tree CONTENT, so committing exactly the\n" +
      "code that was tested keeps its evidence FRESH, while an untracked new\n" +
      "source file invalidates it.\n",
  );
  return sub ? 1 : 0;
}
