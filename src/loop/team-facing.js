// src/loop/team-facing.js
//
// What the team sees of the loop (C3-F21, autopportunity 2026-10-21): an MR in
// their repository is titled like any other, by the work it does, and the
// owner's own checkout is left as it was found (F8).

import { prTitle } from "./merge.js";

/** The code MR's title, and the outer state MR's. */
export function mrTitles(task) {
  const plain = prTitle(task?.title || "") || task?.id || task?.type || "Carja work item";
  return { code: plain, state: `Carja state: ${plain}` };
}

/** A command prefixed so that a run in the owner's checkout leaves no Python bytecode or pytest cache. */
export function readOnlyEnv(cmd) {
  return `export PYTHONDONTWRITEBYTECODE=1 PYTEST_ADDOPTS="\${PYTEST_ADDOPTS:-} -p no:cacheprovider"; ${cmd}`;
}
