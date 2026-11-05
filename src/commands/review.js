// src/commands/review.js
//
// `carja review <artifact>` — hand a document to the human and block on
// their verdict (F4, slice 1).
//
// THE PROBLEM IT SOLVES. Carja's human is a product owner, and on Claude
// Code there is no file browser: chat is the only way in and out. So a plan
// gets reviewed by pasting it into the terminal, and "change the second phase"
// has to be typed rather than pointed at. `carja view` fixed the reading
// half. This is the return path — the human reads the real rendered document
// and presses Approve or Request changes, and that decision lands back in the
// agent's hands as JSON.
//
// EXIT CODES, because a verdict is a gate and gates here carry exit codes:
//   0  approved
//   2  changes requested
//   1  no verdict (timed out, unreadable artifact, interrupted)
//
// Feedback is queued to disk before each response, so an interrupted wait
// costs a re-run rather than the human's words — including a verdict they
// gave to a process that had already died.
//
// The agent should run this as a BACKGROUND call and read the JSON when it
// exits. A foreground call works too, until the harness time-limits it.

import { readFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import { basename, resolve } from "node:path";
import { createReviewServer } from "../review/server.js";
import { openerFor } from "../carja-state.js";
import { documentTitle } from "../view/markdown.js";

const DEFAULT_TIMEOUT_MIN = 60;

function parseArgs(args) {
  const opts = { path: null, open: true, timeoutMin: DEFAULT_TIMEOUT_MIN, json: true };
  for (let i = 0; i < args.length; i += 1) {
    const a = args[i];
    if (a === "--no-open") opts.open = false;
    else if (a === "--timeout") opts.timeoutMin = Number(args[++i]) || DEFAULT_TIMEOUT_MIN;
    else if (a === "--quiet") opts.json = false;
    else if (!a.startsWith("-") && !opts.path) opts.path = a;
  }
  return opts;
}

function openBrowser(url) {
  const opener = openerFor();
  if (!opener) return;
  try {
    const child = spawn(opener, [url], { stdio: "ignore", detached: true });
    child.on("error", () => {});
    child.unref();
  } catch {
    /* the URL is printed regardless — opening is a convenience, not the path */
  }
}

export async function reviewCommand(args, { cwd, stdout, stderr }) {
  const opts = parseArgs(args);
  if (!opts.path) {
    stderr.write(
      "Usage: carja review <file.md> [--no-open] [--timeout <minutes>]\n\n" +
        "  Renders the document in your browser and waits for Approve / Request changes.\n" +
        "  Exit: 0 approved, 2 changes requested, 1 no verdict.\n",
    );
    return 1;
  }

  const abs = resolve(cwd, opts.path);
  let markdown;
  try {
    markdown = await readFile(abs, "utf8");
  } catch {
    stderr.write(`Cannot read ${abs}\n`);
    return 1;
  }

  const title = documentTitle(markdown, basename(abs));
  const server = await createReviewServer({ markdown, title, artifactPath: abs });

  // Everything a human reads goes to stderr; stdout carries ONLY the JSON
  // record. The primary consumer here is an agent parsing stdout, and mixing
  // prose into it would make the result unparseable exactly when it matters.
  stderr.write(`\n  Review: ${title}\n  ${server.url}\n\n`);
  if (server.feedback.length) {
    // Silently replaying would look like the page remembering something the
    // human does not remember saying.
    stderr.write(`  Picked up ${server.feedback.length} note(s) from an earlier, interrupted review.\n`);
  }
  stderr.write("  Waiting for your verdict — Approve or Request changes.\n");
  stderr.write(`  The page is live only while this command runs (timeout ${opts.timeoutMin}m).\n\n`);
  if (opts.open) openBrowser(server.url);

  let timer;
  const timedOut = new Promise((r) => {
    timer = setTimeout(() => r(null), opts.timeoutMin * 60_000);
    timer.unref?.();
  });

  const result = await Promise.race([server.waitForVerdict(), timedOut]);
  clearTimeout(timer);
  await server.close();

  if (!result) {
    // Fail LOUD, not silently approved. An unattended loop that read a
    // timeout as consent would merge work nobody looked at.
    if (opts.json) stdout.write(`${JSON.stringify({ status: "timeout", done: false, feedback: server.feedback })}\n`);
    stderr.write(`\n  No verdict within ${opts.timeoutMin} minutes — treating as NOT approved.\n`);
    return 1;
  }

  if (opts.json) stdout.write(`${JSON.stringify(result)}\n`);
  stderr.write(`\n  ${result.status === "approved" ? "Approved." : "Changes requested."}\n`);
  return result.status === "approved" ? 0 : 2;
}
