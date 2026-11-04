// src/next-step.js
//
// The CLI guides the user: `status`, `loop`, `loop doctor` and a bare
// `carja` in a project end with one "Next:" line, the exact command to run
// from where the project is. Pure: callers pass what they already read.

const LOOP = "carja loop . --from-carja";

/** After `carja status` (and a bare `carja` in a project). */
export function nextAfterStatus({ waitingRounds = [], answeredRounds = 0, verifyConfigured = true, inboxCount = 0, queueLength = 0, loopItems = [], loopOffProjects = [] } = {}) {
  if (waitingRounds.length) {
    return `Next: answer ${waitingRounds[0]} (an option number after each \`Answer:\`), then run \`${LOOP}\`.`;
  }
  if (answeredRounds) return `Next: \`${LOOP}\` resumes the item${answeredRounds === 1 ? "" : "s"} whose questions you answered.`;
  if (!verifyConfigured) return "Next: `carja verify --detect` sets the command every push must pass.";
  if (loopItems.length) return `Next: \`${LOOP} --dry-run\` shows the loop's next work (${loopItems.slice(0, 2).join(", ")}${loopItems.length > 2 ? ", …" : ""}), then run it without --dry-run.`;
  if (queueLength) return `Next: \`${LOOP} --dry-run\` shows what the loop would take, or open the first item in your agent.`;
  if (inboxCount) return "Next: ask your agent to triage the inbox, or run `carja inbox list` to read it.";
  if (loopOffProjects.length) return `Next: \`carja loop on ${loopOffProjects[0]}\` lets the loop work on it unattended (it shows what changes first).`;
  return 'Next: `carja inbox add "<idea>"` captures the next thing to do.';
}

/** After a `carja loop` run, from its final status. */
export function nextAfterLoop(status, { prUrls = [], cmd = LOOP } = {}) {
  switch (status) {
    case "awaiting_answers":
      return "Next: `carja status` names the question file. Answer each question with an option number, then run the loop again.";
    case "completed":
      return `Next: review and merge the MR${prUrls.length === 1 ? "" : "s"}${prUrls.length ? ` (${prUrls.join(", ")})` : ""}. After the merge, \`${cmd}\` takes the next item.`;
    case "awaiting_review":
      return "Next: read carja/1-workbench/loop-messages.md. It names the branch to review: below L3 the loop opens no MR, and at L3 the inbox says why the MR could not be opened.";
    case "escalated":
      return "Next: read carja/1-workbench/loop-messages.md. The loop needs something only you can give, then run it again.";
    case "budget_exceeded":
    case "max_iterations_exceeded":
      return "Next: raise `budget` in carja/1-workbench/loop-state.json if the work deserves it, then run the loop again. It resumes.";
    case "usage_limit_reached":
      return "Next: wait for the engine's usage limit to reset, then run the loop again. It resumes.";
    case "auth_failed":
      return "Next: log the engine CLI in again (`claude` then `/login`, or `codex login`), then run the loop again. It resumes.";
    case "halted_isolation":
      return `Next: run \`${cmd}\` again. A worktree was removed under the run, nothing was committed, and the item starts over in a new worktree.`;
    case "idle":
    case null:
    case undefined:
      return null;
    default:
      return "Next: read carja/1-workbench/loop-messages.md and the beat logs in .git/carja-loop-logs/, or run `carja loop doctor .`.";
  }
}

/** After `carja loop doctor`. */
export function nextAfterDoctor(ready, dir = ".") {
  return ready
    ? `Next: \`carja loop ${dir} --from-carja --dry-run\` shows what the first run would take.`
    : "Next: fix each ✖ above, then run `carja loop doctor` again.";
}
