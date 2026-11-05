// src/loop/blueprint.js
//
// Unattended Lifecycle step 5 (docs/roadmap/Unattended-Lifecycle.md, D4): the
// Blueprint as loop work. A project whose Discovery is written (the owner's
// stage, never the loop's) runs Grand PRD → UX/UI Brief → Technical Vision →
// Carve in one branch, each stage a fresh beat with its own workflow and a fresh
// Checker with its own lens. One MR carries all four: merging it is the owner's
// sign-off, and only then do the carved slices exist for step 3. The stage is
// read from files, never from memory. All functions are pure.

import { isBlankDoc, PROJECTS_REL } from "./slices.js";
import { prBodyReasons } from "./ship.js";
import { stage } from "./stages.js";

export const DISCOVERY = [
  "genesis/problem-solar-system.md",
  "genesis/world-transformation.md",
  "genesis/functional-animator.md",
  "storyboard/main-character.md",
  "storyboard/storyboard.md",
];

/** The stages in order: the workflow the beat runs, the document it writes, the lens it is reviewed with. */
export const BLUEPRINT_STAGES = Object.freeze([
  { key: "grand-prd", workflow: stage("grand-prd").workflows[0], doc: "blueprint/grand-prd.md", lens: "Grand PRD" },
  { key: "ux-ui-brief", workflow: stage("ux-ui-brief").workflows[0], doc: "blueprint/ux-ui-design-brief.md", lens: "UX/design (the reviewer adopts `.agents/skills/ux-reviewer/SKILL.md`)" },
  { key: "technical-vision", workflow: stage("technical-vision").workflows[0], doc: "blueprint/technical-vision.md", lens: "Technical Vision" },
  { key: "carve", workflow: stage("carve").workflows[0], doc: "blueprint/implementation-overview.md", lens: "Carve slicing" },
]);

/** The template each document is compared with, relative to `carja/5-templates/`. */
export const TEMPLATE_FOR = Object.freeze({
  "genesis/problem-solar-system.md": "genesis-workflow/problem-solar-system-template.md",
  "genesis/world-transformation.md": "genesis-workflow/world-transformation-template.md",
  "genesis/functional-animator.md": "genesis-workflow/functional-animator-template.md",
  "storyboard/main-character.md": "storyboard-workflow/main-character-template.md",
  "storyboard/storyboard.md": "storyboard-workflow/storyboard-template.md",
  "blueprint/grand-prd.md": "blueprint-workflows/grand-prd.md",
  "blueprint/ux-ui-design-brief.md": "blueprint-workflows/ux-ui-design-brief.md",
  "blueprint/technical-vision.md": "blueprint-workflows/technical-vision.md",
  "blueprint/implementation-overview.md": "carve-workflow/implementation-overview.md",
});

const written = (docs, templates, rel) => !isBlankDoc(docs?.[rel], templates?.[rel]);

/** Discovery is the owner's: the loop starts a project only once its five documents are written. */
export function discoveryDone({ docs, templates }) {
  return DISCOVERY.every((rel) => written(docs, templates, rel));
}

/** The documents the owner approves before a stacked run starts (owner, 2026-10-22), in order. */
export const OWNER_DOCS = Object.freeze([
  ...DISCOVERY.map((rel) => ({ rel, name: rel.startsWith("genesis/") ? "Genesis" : "Storyboard" })),
  { rel: "blueprint/grand-prd.md", name: "Grand PRD" },
  { rel: "blueprint/ux-ui-design-brief.md", name: "UX/UI Design Brief" },
  { rel: "blueprint/technical-vision.md", name: "Technical Vision" },
]);

/**
 * S8, the starting gate of `carja loop <project>`: the owner's phase ends
 * with the approved Technical Vision. Approved means written on the default
 * branch (merged), the way the Blueprint stages are read. A carved project is
 * past the gate. Returns the documents still missing, in order, by plain name.
 */
export function missingOwnerDocs({ docs, templates, carved = false }) {
  if (carved) return [];
  const missing = OWNER_DOCS.filter((d) => !written(docs, templates, d.rel));
  const names = [];
  for (const d of missing) if (!names.some((n) => n.name === d.name)) names.push({ name: d.name, rel: d.rel });
  return names;
}

/**
 * Did the stage's beat write what the stage is for? Checked in code before the review.
 * @param {string} key a BLUEPRINT_STAGES key
 * @param {{docs: object, templates: object, hasDesignMd?: boolean, sliceCount?: number, prBody?: string}} input
 */
export function blueprintStageEvidence(key, { docs, templates, hasDesignMd = false, sliceCount = 0, prBody = "" }) {
  const stage = BLUEPRINT_STAGES.find((s) => s.key === key);
  if (!stage) return { ok: false, reasons: [`unknown Blueprint stage ${key}`] };
  const reasons = [];
  if (!written(docs, templates, stage.doc)) reasons.push(`${stage.doc} is missing, empty or still the template`);
  if (key === "ux-ui-brief" && !hasDesignMd) reasons.push("DESIGN.md is missing at the code repository root");
  if (key === "carve") {
    if (sliceCount < 1) reasons.push("no slice folder under implementations/ (NN-<slice>/ with feature-spec.md)");
    reasons.push(...prBodyReasons(prBody));
  }
  return { ok: reasons.length === 0, reasons, ...(key === "carve" ? { body: prBody } : {}) };
}

/**
 * The work items: one per opted-in project whose Discovery is done and which is
 * not carved yet. A stage whose document is already on the default branch is
 * the owner's (an interactive session they converged on): it is not redone.
 * @param {{projects: {name: string, docs: object, carved: boolean}[], optIn: string[]|true, templates: object}} input
 */
export function harvestBlueprints({ projects, optIn, templates }) {
  const items = [];
  for (const p of projects ?? []) {
    if (!(optIn === true || (Array.isArray(optIn) && optIn.includes(p.name)))) continue;
    if (p.carved || !discoveryDone({ docs: p.docs, templates })) continue;
    const stagesDone = BLUEPRINT_STAGES.filter((s) => s.key !== "carve" && written(p.docs, templates, s.doc)).map((s) => s.key);
    items.push({
      id: `blueprint:${p.name}`,
      type: "blueprint",
      title: `${p.name} Blueprint`,
      // Only the stages still to run: a dry run never lists a stage it will skip.
      route: BLUEPRINT_STAGES.filter((s) => !stagesDone.includes(s.key)).map((s) => s.workflow).join(" → "),
      priority: null,
      details: "",
      source: { kind: "blueprint", project: p.name, path: `${PROJECTS_REL}/${p.name}` },
      stages_done: stagesDone,
    });
  }
  return items;
}

const CARRIED = ["spec_reviewed", "answered_round", "stages_reviewed", "reviewed_head"];

/**
 * The harvest rebuilds the queue every run (the folder is truth). What a stage
 * earned in the last run for the same item (a passed review, an answered round)
 * is carried over; the files are still checked before it counts.
 */
export function carryOver(previous, harvested) {
  const byId = new Map((previous ?? []).map((t) => [t.id, t]));
  return harvested.map((t) => {
    const prev = byId.get(t.id);
    if (!prev) return t;
    const out = { ...t };
    for (const k of CARRIED) if (prev[k] !== undefined && prev[k] !== null && out[k] === undefined) out[k] = prev[k];
    return out;
  });
}
