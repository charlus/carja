// src/loop/enable.js
//
// `carja loop on <project>` / `off <project>` (owner decision 2026-10-20:
// nobody should have to write the loop's JSON). The command reads the facts,
// this module turns them into a plan: each change in plain words, and the
// config and loop-state they produce. Pure; the command shows the plan, asks
// once, then writes.

const ENV_DIRS = [".venv", "venv", "node_modules"];

/**
 * @param {object} f facts:
 *   project, projects (names in project-backlog), discoveryDone, carved,
 *   config (raw carja.config.json), state (loop-state.json),
 *   nestedRepos (["repo/", "video/"]), envDirs (untracked env dirs in the code checkout),
 *   codeDirFlag (from --code-dir), claudeOnPath, stagesDone (Blueprint stage names already written)
 * @returns {{ok: boolean, error?: string, changes: string[], notes: string[], config: object, state: object}}
 */
export function planLoopOn(f) {
  const changes = [];
  const notes = [];
  const config = structuredClone(f.config ?? {});
  const state = structuredClone(f.state ?? {});
  const loop = (config.loop = { ...(config.loop ?? {}) });

  const backlogOnly = Boolean(f.backlog && !f.project);
  if (!backlogOnly && !f.projects.includes(f.project)) {
    return { ok: false, error: `no project "${f.project}" in carja/2-backlog/project-backlog/. Projects: ${f.projects.join(", ") || "none"}.`, changes, notes, config, state };
  }
  if (!backlogOnly && !f.carved && !f.discoveryDone) {
    return {
      ok: false,
      error: `${f.project} has no Discovery yet, and Discovery is yours: run /genesis then /storyboard on it in your agent, then this command again.`,
      changes, notes, config, state,
    };
  }

  const add = (key, what) => {
    const list = loop[key] === true ? true : Array.isArray(loop[key]) ? loop[key] : [];
    if (list === true || list.includes(f.project)) return;
    loop[key] = [...list, f.project];
    changes.push(what);
  };
  if (!backlogOnly && !f.carved) {
    const all = ["Grand PRD", "UX/UI Brief", "Technical Vision", "Carve"];
    const done = f.stagesDone ?? [];
    const left = all.filter((s) => !done.includes(s));
    const say = (xs) => (xs.length > 1 ? `${xs.slice(0, -1).join(", ")} and ${xs.at(-1)}` : xs[0]);
    add("blueprint", `The loop may write the ${say(left)} for ${f.project}${done.length ? ` (you wrote the ${say(done)})` : ""}, and send ${left.length > 1 ? "them" : "it"} as one MR. Merging it is your sign-off.`);
  }
  if (!backlogOnly) add("slices", `The loop may build the slices of ${f.project}, one at a time, from spec to MR${f.carved ? "" : ", once you have merged the Blueprint MR"}.`);

  // F11: never the whole backlog and inbox at once. An explicit choice is kept.
  if (loop.require_ready === undefined) {
    loop.require_ready = true;
    changes.push("From the backlog, the loop takes only the items you give it with `carja loop take \"<item>\"` (or tag (loop-ready) at the end of their line).");
  }
  if (loop.inbox === undefined) {
    loop.inbox = false;
    changes.push("Inbox thoughts are not loop work: triage them first.");
  }

  // The outer layout: the code is a nested repository.
  const nested = (f.nestedRepos ?? []).map((d) => d.replace(/\/+$/, ""));
  if (!loop.code_dir && nested.length) {
    const known = Object.keys(config.repos ?? {});
    const pick = f.codeDirFlag ?? (nested.length === 1 ? nested[0] : nested.find((d) => known.includes(d)));
    if (!pick) {
      return {
        ok: false,
        error: `several nested repositories (${nested.join(", ")}): say which one holds the code, for example: carja loop on ${f.project ?? "--backlog"} --code-dir ${nested[0]}`,
        changes, notes, config, state,
      };
    }
    loop.code_dir = pick;
    changes.push(`The code is the nested repository ${pick}/: each item gets a code worktree from its default branch, and two MRs, the code MR to its repository first, then the state MR to this one.`);
    const others = nested.filter((d) => d !== pick);
    if (others.length && loop.allow_nested_repo !== true) {
      loop.allow_nested_repo = true;
      changes.push(`The loop ignores the other nested ${others.length === 1 ? "repository" : "repositories"}: ${others.map((d) => `${d}/`).join(", ")}.`);
    }
  }
  const codeDir = loop.code_dir ?? null;

  // An untracked environment in the checkout: each worktree links it.
  if (!loop.setup) {
    const envs = ENV_DIRS.filter((d) => (f.envDirs ?? []).includes(d));
    if (envs.length) {
      const from = codeDir ? "$CARJA_CODE_ROOT" : "$CARJA_ROOT";
      loop.setup = envs.map((d) => `ln -sfn "${from}/${d}" ${d}`).join(" && ");
      changes.push(`Each worktree links your ${envs.join(" and ")} instead of installing ${envs.length === 1 ? "it" : "them"} again.`);
    }
  }

  // The run itself: unattended, sandboxed, allowed to open MRs.
  if (state.phase !== "execution") {
    changes.push(`Loop phase: execution (was ${state.phase ?? "unset"}).`);
    state.phase = "execution";
  }
  if (state.autonomy_level !== "L3") {
    changes.push(`Autonomy L3: the loop opens MRs; you merge them (was ${state.autonomy_level ?? "unset"}).`);
    state.autonomy_level = "L3";
  }
  if (state.sandbox !== "cli-native" && state.sandbox !== "container") {
    changes.push(`Sandbox: the engine's own (bubblewrap), so a beat cannot reach your credentials or push (was ${state.sandbox ?? "unset"}).`);
    state.sandbox = "cli-native";
  }
  if (!state.platform && f.claudeOnPath) {
    changes.push("Engine: claude.");
    state.platform = "claude";
  }

  const verify = codeDir ? config.repos?.[codeDir]?.verify : config.verify;
  if (!verify || verify === "none") {
    notes.push(`No test command for ${codeDir ? `${codeDir}/` : "this repository"} yet, and the loop needs one: carja verify ${codeDir ? `--repo ${codeDir} ` : ""}--detect`);
  }
  if (!changes.length) notes.push(backlogOnly ? "The loop is already set up for tagged backlog items." : `${f.project} is already on.`);
  return { ok: true, changes, notes, config, state };
}

/** `carja loop off <project>`: the project is no longer loop work. Nothing else changes. */
export function planLoopOff({ project, config }) {
  const out = structuredClone(config ?? {});
  const loop = (out.loop = { ...(out.loop ?? {}) });
  const changes = [];
  for (const key of ["blueprint", "slices"]) {
    if (loop[key] === true) {
      changes.push(`loop.${key} is true (every project): leave it on, or list the projects you want instead.`);
      continue;
    }
    if (Array.isArray(loop[key]) && loop[key].includes(project)) {
      loop[key] = loop[key].filter((p) => p !== project);
      changes.push(key === "blueprint" ? `The loop no longer writes the Blueprint for ${project}.` : `The loop no longer builds the slices of ${project}.`);
    }
  }
  if (!changes.length) changes.push(`${project} was not on.`);
  return { changes, config: out };
}
