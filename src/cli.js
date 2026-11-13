import { initCommand } from "./commands/init.js";
import { upgradeCommand } from "./commands/upgrade.js";
import { addCommand } from "./commands/add.js";
import { removeCommand } from "./commands/remove.js";
import { listCommand } from "./commands/list.js";
import { searchCommand } from "./commands/search.js";
import { installHooksCommand } from "./commands/install-hooks.js";
import { trustVerifyCommand } from "./commands/trust-verify.js";
import { verifyCommand } from "./commands/verify.js";
import { evidenceCommand } from "./commands/evidence.js";
import { reviewLogCommand } from "./commands/review-log.js";
import { contextBillCommand } from "./commands/context-bill.js";
import { agentsMdCommand } from "./commands/agents-md.js";
import { loopCommand } from "./commands/loop.js";
import { statusCommand } from "./commands/status.js";
import { inboxCommand } from "./commands/inbox.js";
import { viewCommand } from "./commands/view.js";
import { reviewCommand } from "./commands/review.js";
import { surveyCommand } from "./commands/survey.js";
import { personasCommand } from "./commands/personas.js";
import { designCommand } from "./commands/design.js";
import { watchCommand } from "./commands/watch.js";
import { workCommand } from "./commands/work.js";
import { modelsCommand } from "./commands/models.js";
import { mainHelp, commandHelp } from "./usage.js";
import { nextAfterStatus } from "./next-step.js";

function helpText() {
  return mainHelp();
}

/** A bare `carja` inside a project: where it stands and the next command, not the whole list. */
async function projectGuide(cwd) {
  const { collectState } = await import("./carja-state.js");
  const { readRounds, loopItems, loopOffProjects } = await import("./commands/status.js");
  const { ok, state } = await collectState(cwd, {});
  if (!ok) return null;
  const rounds = await readRounds(cwd);
  const d = state.digest ?? {};
  return [
    "",
    `  Carja project: ${cwd}`,
    `  Inbox ${d.inboxCount ?? 0} · backlog open ${d.backlogOpen ?? 0} · question rounds waiting ${rounds.waiting.length}`,
    "",
    `  ${nextAfterStatus({ waitingRounds: rounds.waiting, answeredRounds: rounds.answered.length, verifyConfigured: d.verify?.state !== "unset", inboxCount: d.inboxCount ?? 0, queueLength: d.queueLength ?? 0, loopItems: await loopItems(cwd), loopOffProjects: await loopOffProjects(cwd) })}`,
    "",
    "  Often used:  carja status · carja inbox add \"<idea>\" · carja loop . --from-carja --dry-run",
    "  All commands: carja help   ·   Full guide: docs/Using-Carja.md",
    "",
  ].join("\n");
}

export async function runCli(rawArgs, io = process) {
  // The 6.x spelling of the flag, kept through 7.x.
  const args = rawArgs.map((a) => (a === "--from-conductor" ? "--from-carja" : a));
  const [command, ...rest] = args;

  if (!command) {
    const guide = await projectGuide(io.cwd?.() ?? process.cwd()).catch(() => null);
    io.stdout.write(`${guide ?? helpText()}\n`);
    return 0;
  }
  if (command === "-h" || command === "--help" || command === "help") {
    const topic = command === "help" ? rest[0] : null;
    const text = topic ? commandHelp(topic) : helpText();
    if (!text) {
      io.stderr.write(`Unknown command: ${topic}\n${helpText()}\n`);
      return 1;
    }
    io.stdout.write(`${text}\n`);
    return 0;
  }
  // `carja <command> --help`: the flags before a `--` are the CLI's; after it, the wrapped command's.
  const own = rest.includes("--") ? rest.slice(0, rest.indexOf("--")) : rest;
  if ((own.includes("--help") || own.includes("-h")) && commandHelp(command)) {
    io.stdout.write(`${commandHelp(command)}\n`);
    return 0;
  }

  const context = {
    cwd: io.cwd?.() ?? process.cwd(),
    stdout: io.stdout,
    stderr: io.stderr,
  };

  switch (command) {
    case "status":
      return statusCommand(rest, context);
    case "inbox":
      return inboxCommand(rest, context);
    case "view":
      return viewCommand(rest, context);
    case "review":
      return reviewCommand(rest, context);
    case "survey":
      return surveyCommand(rest, context);
    case "personas":
      return personasCommand(rest, context);
    case "design":
      return designCommand(rest, context);
    case "init":
      return initCommand(rest, context);
    case "upgrade":
      return upgradeCommand(rest, context);
    case "add":
      return addCommand(rest, context);
    case "remove":
      return removeCommand(rest, context);
    case "list":
      return listCommand(rest, context);
    case "search":
      return searchCommand(rest, context);
    case "install-hooks":
      return installHooksCommand(rest, context);
    case "verify":
      return verifyCommand(rest, context);
    case "trust-verify":
      return trustVerifyCommand(rest, context);
    case "evidence":
      return evidenceCommand(rest, context);
    case "review-log":
      return reviewLogCommand(rest, context);
    case "context-bill":
      return contextBillCommand(rest, context);
    case "agents-md":
      return agentsMdCommand(rest, context);
    case "loop":
      return loopCommand(rest, context);
    case "watch":
      return watchCommand(rest, context);
    case "work":
      return workCommand(rest, context);
    case "models":
      return modelsCommand(rest, context);
    default:
      io.stderr.write(`Unknown command: ${command}\n${helpText()}\n`);
      return 1;
  }
}
