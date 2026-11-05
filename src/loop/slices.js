// src/loop/slices.js
//
// Unattended Lifecycle step 3 (docs/roadmap/Unattended-Lifecycle.md): carved
// slices as loop work. A slice folder is `project-backlog/<Project>/
// implementations/NN-<slice>/`. Carve leaves its `feature-spec.md` and
// `implementation-plan.md` blank (the templates); Spec-It fills them; Ship
// archives the folder. So the stage is read from files, never from memory.
// All functions are pure: the command layer reads the folders.

import { workflowForType } from "./harvester.js";

export const PROJECTS_REL = "carja/2-backlog/project-backlog";

const PLACEHOLDER = /\[[^\]\n]{3,}\]/;

/** Untouched since Carve: missing, empty, or still holding the template's placeholder lines. */
export function isBlankDoc(text, template) {
  const body = String(text ?? "");
  if (!body.trim()) return true;
  const placeholders = String(template ?? "")
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => PLACEHOLDER.test(l));
  if (!placeholders.length) return /\[Implementation Name\]/.test(body);
  const lines = new Set(body.split("\n").map((l) => l.trim()));
  const left = placeholders.filter((l) => lines.has(l)).length;
  return left >= Math.min(3, placeholders.length);
}

/**
 * The work items for opted-in projects: one per project, its lowest open slice
 * (slices of a project depend on each other, R4). An archived slice is no longer
 * in `implementations/`, so it is not open.
 * @param {{projects: {name: string, slices: {name: string, spec?: string, plan?: string}[]}[],
 *          optIn: string[]|true, specTemplate?: string, planTemplate?: string}} input
 */
export function harvestSlices({ projects, optIn, specTemplate = "", planTemplate = "" }) {
  const items = [];
  for (const p of projects ?? []) {
    if (!(optIn === true || (Array.isArray(optIn) && optIn.includes(p.name)))) continue;
    const open = [...(p.slices ?? [])].sort((a, b) => a.name.localeCompare(b.name, "en", { numeric: true }));
    const s = open[0];
    if (!s) continue;
    items.push({
      id: `slice:${p.name}/${s.name}`,
      type: "slice",
      route: workflowForType("slice"),
      title: `${p.name} ${s.name}`,
      priority: null,
      details: "",
      source: { kind: "slice", project: p.name, slice: s.name, path: `${PROJECTS_REL}/${p.name}/implementations/${s.name}` },
      // A spec already on the default branch is the owner's (an interactive
      // Spec-It they converged on): no spec stage, no spec review.
      spec_ready: !isBlankDoc(s.spec, specTemplate) && !isBlankDoc(s.plan, planTemplate),
    });
  }
  return items;
}

/** Did the Spec beat write the spec and the plan? Checked in code before the review. */
export function specEvidence({ spec, plan, specTemplate = "", planTemplate = "" }) {
  const reasons = [];
  if (isBlankDoc(spec, specTemplate)) reasons.push("feature-spec.md is still the carved template or empty");
  else if (!/^## Brief check\b/m.test(String(spec))) reasons.push("feature-spec.md has no Brief check section");
  if (isBlankDoc(plan, planTemplate)) reasons.push("implementation-plan.md is still the carved template or empty");
  return { ok: reasons.length === 0, reasons };
}
