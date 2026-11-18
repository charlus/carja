// src/commands/app.js
//
// `carja app up|check|down [dir]` (F7, docs/roadmap/Risk-Tiered-Merge.md):
// "Running the app end to end matters more than tests" (Claude Code team). An
// agent cannot drive a product it cannot start, and working out how to start it
// in every session is slow and unreliable. The project says it once:
//
//   "app": {
//     "start": "npm run dev",                    // runs in the background
//     "ready": "curl -sf http://localhost:3000",  // polled until it exits 0
//     "url": "http://localhost:3000",            // printed, for the agent's browser or curl
//     "dir": "repo",                             // optional: where start runs (default: loop.code_dir, else the root)
//     "ready_timeout_s": 120                     // optional
//   }
//
// up starts it (its own process group, output to <git dir>/carja-app.log, pid in
// <git dir>/carja-app.pid) and waits for `ready`. An app that is not ready in
// time is stopped and the end of its log is shown. check runs `ready` once.
// down stops the process group. The app runs on the owner's machine with the
// owner's environment, like `verify`.

import { spawn, spawnSync } from "node:child_process";
import { openSync, readFileSync, writeFileSync, rmSync, existsSync } from "node:fs";
import { join, resolve } from "node:path";

const EXAMPLE = '"app": { "start": "npm run dev", "ready": "curl -sf http://localhost:3000", "url": "http://localhost:3000" }';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function readConfig(root) {
  try {
    return JSON.parse(readFileSync(join(root, "carja.config.json"), "utf8"));
  } catch {
    return {};
  }
}

const alive = (pid) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

const ready = (cmd, cwd) => spawnSync(cmd, { cwd, shell: true, stdio: "ignore", timeout: 30000 }).status === 0;

function stopGroup(pid) {
  for (const target of [-pid, pid]) {
    try {
      process.kill(target, "SIGTERM");
    } catch {
      /* already gone */
    }
  }
}

const tail = (path, n = 20) => {
  try {
    return readFileSync(path, "utf8").trimEnd().split("\n").slice(-n).join("\n");
  } catch {
    return "(no log)";
  }
};

export async function appCommand(args, { cwd, stdout, stderr }) {
  const sub = args[0];
  if (!["up", "check", "down"].includes(sub)) {
    stderr.write("Usage: carja app up|check|down [dir]\n");
    return 1;
  }
  const root = resolve(cwd, args.find((a, i) => i > 0 && !a.startsWith("-")) ?? ".");
  const git = spawnSync("git", ["rev-parse", "--path-format=absolute", "--git-common-dir"], { cwd: root, encoding: "utf8" });
  if (git.status !== 0) {
    stderr.write(`${root} is not a git repository.\n`);
    return 1;
  }
  const gitDir = git.stdout.trim();
  const pidPath = join(gitDir, "carja-app.pid");
  const logPath = join(gitDir, "carja-app.log");
  const config = readConfig(root);
  const app = config.app && typeof config.app === "object" ? config.app : null;
  const pid = existsSync(pidPath) ? Number(readFileSync(pidPath, "utf8")) : null;

  if (sub === "down") {
    if (pid && alive(pid)) stopGroup(pid);
    rmSync(pidPath, { force: true });
    stdout.write(pid ? "The app is stopped.\n" : "No app was running.\n");
    return 0;
  }
  if (!app?.start || !app?.ready) {
    stderr.write(`carja.config.json has no app block with start and ready. Add, for example:\n  ${EXAMPLE}\n`);
    return 1;
  }
  const dir = join(root, app.dir ?? config.loop?.code_dir ?? ".");
  const at = app.url ? ` at ${app.url}` : "";

  if (sub === "check") {
    const ok = ready(app.ready, dir);
    (ok ? stdout : stderr).write(ok ? `The app is ready${at}.\n` : `The app is not ready: \`${app.ready}\` failed.\n`);
    return ok ? 0 : 1;
  }

  if (pid && alive(pid) && ready(app.ready, dir)) {
    stdout.write(`The app is already running${at} (pid ${pid}). Stop it with \`carja app down\`.\n`);
    return 0;
  }
  const out = openSync(logPath, "w");
  const child = spawn(app.start, { cwd: dir, shell: true, detached: true, stdio: ["ignore", out, out] });
  child.unref();
  writeFileSync(pidPath, String(child.pid));
  const limit = (Number(app.ready_timeout_s) > 0 ? Number(app.ready_timeout_s) : 120) * 1000;
  const started = Date.now();
  while (Date.now() - started < limit) {
    if (!alive(child.pid)) break;
    if (ready(app.ready, dir)) {
      stdout.write(`The app is ready${at} (pid ${child.pid}, log ${logPath}). Stop it with \`carja app down\`.\n`);
      return 0;
    }
    await sleep(500);
  }
  const exited = !alive(child.pid);
  stopGroup(child.pid);
  rmSync(pidPath, { force: true });
  stderr.write(`The app ${exited ? "exited before it was ready" : `is not ready after ${Math.round(limit / 1000)} s`}: \`${app.ready}\` never passed. The end of its log:\n${tail(logPath)}\n`);
  return 1;
}
