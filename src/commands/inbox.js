// src/commands/inbox.js
//
// `carja inbox add "…"` — deterministic quick capture.
//
// WHY A COMMAND AND NOT A RULE. `Inbox: X` already existed as a row in the
// always-on request classifier, and it did not fire reliably. That is the
// expected outcome for a prose instruction competing with everything else in
// context — the framework's own operating rule is to enforce with code wherever
// the rule is mechanical. Appending a line to a file is as mechanical as it
// gets, so it becomes a command that cannot be forgotten, reworded, or triaged.
//
// The prose rule stays as a fallback for platforms without the CLI on PATH.

import { captureInbox, collectState, INBOX_REL } from "../carja-state.js";

const SUBCOMMANDS = new Set(["add", "list", "ls"]);

export async function inboxCommand(args, context) {
  const [first, ...rest] = args;
  // Forgiving on purpose: `carja inbox "a thought"` means add. Capture must
  // never fail on syntax — that would defeat the point of it being fast.
  const sub = SUBCOMMANDS.has(first) ? first : "add";
  const payload = SUBCOMMANDS.has(first) ? rest : args;

  if (sub === "list" || sub === "ls") {
    const { ok, state } = await collectState(context.cwd);
    if (!ok) {
      context.stderr.write(`  No \`carja/\` folder in ${context.cwd}\n`);
      return 1;
    }
    // I6: the loop's messages are not inbox thoughts: they live in their own file, outside git.
    const { readLoopMessages, MESSAGES_REL } = await import("../loop/owner-files.js");
    const messages = await readLoopMessages(state.root ?? context.cwd);
    const loopLines = messages.length
      ? `\n  ${messages.length} loop message${messages.length === 1 ? "" : "s"} — ${MESSAGES_REL}\n\n${messages.slice(-5).map((m) => `   · ${m.title}${m.text ? `: ${m.text.slice(0, 140)}` : ""}`).join("\n")}\n\n`
      : "";
    if (!state.inbox.items.length) {
      context.stdout.write(`  Inbox is empty (${state.inbox.relPath})\n${loopLines}`);
      return 0;
    }
    context.stdout.write(
      `\n  ${state.inbox.items.length} in the inbox — ${state.inbox.relPath}\n\n` +
        state.inbox.items.map((it) => `   · ${it.title}`).join("\n") +
        "\n\n" +
        loopLines
    );
    return 0;
  }

  const text = payload.join(" ").trim();
  if (!text) {
    context.stderr.write(
      '  Nothing to capture.\n  Usage:  carja inbox add "the thought"\n          carja inbox list\n'
    );
    return 1;
  }

  try {
    const { relPath, created } = await captureInbox(context.cwd, text);
    context.stdout.write(
      `  ✅ ${created ? "Created " : ""}${relPath} · ${text.length > 60 ? `${text.slice(0, 59)}…` : text}\n`
    );
    return 0;
  } catch (err) {
    context.stderr.write(`  Could not write the inbox: ${err.message}\n`);
    return 1;
  }
}
