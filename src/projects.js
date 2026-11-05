// src/projects.js
//
// The projects in carja/2-backlog/project-backlog/, each with its stage and
// whether the loop is on for it (owner decisions D1, D2, 2026-10-20). Shown by
// `carja status` and by `carja loop on` without a name. The stage is
// read the way the loop reads it (src/loop/blueprint.js, src/loop/slices.js),
// so what is shown is what the loop would act on.

import { readdir } from "node:fs/promises";
import { join } from "node:path";
import { BLUEPRINT_STAGES, discoveryDone, harvestBlueprints } from "./loop/blueprint.js";
import { PROJECTS_REL } from "./loop/slices.js";

const NAMES = { "grand-prd": "Grand PRD", "ux-ui-brief": "UX/UI Brief", "technical-vision": "Technical Vision", carve: "Carve" };

/**
 * One project's stage, from facts. Pure.
 * @param {{name, docs, templates, carved, openSlices: string[], oldLayout: boolean, loopOn: {blueprint: boolean, slices: boolean}}} p
 * @returns {{name, stage: string, canTurnOn: boolean, loop: string}}
 */
export function describeProject(p) {
  const on = p.loopOn ?? {};
  const loop = on.blueprint || on.slices ? `loop on (${[on.blueprint && "Blueprint", on.slices && "slices"].filter(Boolean).join(", ")})` : "loop off";
  if (p.carved) {
    const stage = p.openSlices.length ? `${p.openSlices.length} slice${p.openSlices.length === 1 ? "" : "s"} open (next: ${p.openSlices[0]})` : "every slice shipped";
    return { name: p.name, stage, canTurnOn: p.openSlices.length > 0, loop };
  }
  if (p.oldLayout) return { name: p.name, stage: "old slice layout (the loop cannot read it)", canTurnOn: false, loop: "" };
  if (!discoveryDone({ docs: p.docs, templates: p.templates })) return { name: p.name, stage: "no Discovery yet (yours: /genesis, /storyboard)", canTurnOn: false, loop: "" };
  const item = harvestBlueprints({ projects: [{ name: p.name, docs: p.docs, carved: false }], optIn: [p.name], templates: p.templates })[0];
  const done = item?.stages_done ?? [];
  const next = BLUEPRINT_STAGES.find((s) => !done.includes(s.key));
  return { name: p.name, stage: `Blueprint ${done.length} of ${BLUEPRINT_STAGES.length} (${NAMES[next.key]} next)`, canTurnOn: true, loop };
}

/** All projects, read from the root checkout. Never throws. */
export async function readProjects(root, { config = {}, readBlueprints, exists }) {
  try {
    const bp = await readBlueprints(root, true);
    const loop = config.loop ?? {};
    const isOn = (key, name) => loop[key] === true || (Array.isArray(loop[key]) && loop[key].includes(name));
    const out = [];
    for (const p of [...bp.projects].sort((a, b) => a.name.localeCompare(b.name))) {
      const dir = join(root, PROJECTS_REL, p.name);
      const impl = join(dir, "implementations");
      const openSlices = [];
      if (await exists(impl)) {
        for (const s of (await readdir(impl)).sort((a, b) => a.localeCompare(b, "en", { numeric: true }))) {
          if (await exists(join(impl, s, "feature-spec.md"))) openSlices.push(s);
        }
      }
      const files = await readdir(dir).catch(() => []);
      const oldLayout = !p.carved && files.some((f) => /^slice-\d+.*\.md$/.test(f));
      out.push(describeProject({ ...p, templates: bp.templates, openSlices, oldLayout, loopOn: { blueprint: isOn("blueprint", p.name), slices: isOn("slices", p.name) } }));
    }
    return out;
  } catch {
    return [];
  }
}

/** The Projects block, aligned. */
export function renderProjects(list) {
  if (!list.length) return "";
  const w = Math.min(36, Math.max(...list.map((p) => p.name.length)));
  const s = Math.max(0, ...list.filter((p) => p.loop).map((p) => p.stage.length));
  const cut = (x, n) => (x.length > n ? `${x.slice(0, n - 1)}…` : x.padEnd(n));
  return ["  Projects", ...list.map((p) => `    ${cut(p.name, w)}  ${p.loop ? `${p.stage.padEnd(s)}  · ${p.loop}` : p.stage}`)].join("\n");
}

