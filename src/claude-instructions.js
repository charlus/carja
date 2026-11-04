// src/claude-instructions.js
//
// D9: Carja's instructions live in the root AGENTS.md. Claude Code reads it
// natively only from v2.1.277, and only when no CLAUDE.md, .claude/CLAUDE.md or
// CLAUDE.local.md sits in the working folder or any folder above it: any of them
// makes Claude read CLAUDE files instead, and the framework is silently skipped.
// ~/.claude/CLAUDE.md does not count. These warnings name the cause and the fix.
// Pure, plus one IO helper for the commands.

import { access } from "node:fs/promises";
import { dirname, join, relative, resolve } from "node:path";
import { homedir } from "node:os";
import { spawnSync } from "node:child_process";

export const MIN_CLAUDE_VERSION = "2.1.277";

/** `2.1.289 (Claude Code)` → [2, 1, 289]; anything else → null. */
export function parseClaudeVersion(text) {
  const m = /(\d+)\.(\d+)\.(\d+)/.exec(String(text ?? ""));
  return m ? m.slice(1, 4).map(Number) : null;
}

function below(v, min) {
  for (let i = 0; i < 3; i++) if (v[i] !== min[i]) return v[i] < min[i];
  return false;
}

/**
 * @param {{claudeVersion: string|null, files: string[]}} input
 *   claudeVersion: raw `claude --version` output, null when claude is not installed
 *   files: the CLAUDE files that hide AGENTS.md, relative to the working folder
 *          (CLAUDE.md, CLAUDE.local.md, .claude/CLAUDE.md, ../CLAUDE.md, …)
 */
export function instructionWarnings({ claudeVersion, files }) {
  const out = [];
  const v = parseClaudeVersion(claudeVersion);
  if (v && below(v, parseClaudeVersion(MIN_CLAUDE_VERSION))) {
    out.push(
      `Claude Code ${v.join(".")} does not read AGENTS.md, so it will not see Carja. Update to ${MIN_CLAUDE_VERSION} or later (claude update).`
    );
  }
  if (files.includes("CLAUDE.md")) {
    out.push("CLAUDE.md is here: Claude Code reads it instead of AGENTS.md. Put the line @AGENTS.md at its top, or move its content into AGENTS.md and delete it.");
  }
  if (files.includes("CLAUDE.local.md")) {
    out.push("CLAUDE.local.md is here: Claude Code then reads CLAUDE files instead of AGENTS.md. Put the line @AGENTS.md at its top.");
  }
  for (const f of files.filter((f) => f !== "CLAUDE.md" && f !== "CLAUDE.local.md")) {
    out.push(`${f} makes Claude Code read CLAUDE files instead of AGENTS.md. Set Project instructions to claude-md-and-agents-md in /config, or import AGENTS.md from that file.`);
  }
  return out;
}

async function present(p) {
  try {
    await access(p);
    return true;
  } catch {
    return false;
  }
}

/**
 * The warnings for the folder `dir`, probing `claude --version` unless given
 * (never throws). Walks `dir` and every folder above it, as Claude Code does.
 */
export async function instructionWarningsFor(dir, { home = homedir(), claudeVersion } = {}) {
  if (claudeVersion === undefined) {
    const probe = spawnSync("claude", ["--version"], { encoding: "utf8", timeout: 10000 });
    claudeVersion = probe.status === 0 ? probe.stdout : null;
  }
  const start = resolve(dir);
  const files = [];
  for (let d = start; ; d = dirname(d)) {
    for (const f of ["CLAUDE.md", "CLAUDE.local.md", join(".claude", "CLAUDE.md")]) {
      // The user's own ~/.claude/CLAUDE.md loads alongside AGENTS.md.
      if (d === resolve(home) && f !== "CLAUDE.md" && f !== "CLAUDE.local.md") continue;
      if (await present(join(d, f))) files.push(relative(start, join(d, f)));
    }
    if (dirname(d) === d) break;
  }
  return instructionWarnings({ claudeVersion, files });
}
