import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { planUpdate, executeUpdate } from "../src/update.js";
import { writeChecksumFile, readChecksumFile } from "../src/checksums.js";

// Build a source (upstream templates) + target (installed) pair where:
//  - skills/keeper       is a framework skill still shipped upstream        → UPDATE
//  - skills/dropped      is a framework skill upstream deleted (in manifest) → REMOVE
//  - skills/Terraform    was `carja add`-imported (NOT in manifest)      → KEEP
//  - my-notes.md         is a hand-authored custom file (NOT in manifest)    → KEEP
function makePair({ withManifest }) {
  const root = mkdtempSync(join(tmpdir(), "cond-prune-"));
  const source = join(root, "source");
  const target = join(root, "target");
  mkdirSync(join(source, "skills", "keeper"), { recursive: true });
  mkdirSync(join(target, "skills", "keeper"), { recursive: true });
  mkdirSync(join(target, "skills", "dropped"), { recursive: true });
  mkdirSync(join(target, "skills", "Terraform"), { recursive: true });

  writeFileSync(join(source, "skills", "keeper", "SKILL.md"), "upstream keeper v2\n");
  writeFileSync(join(target, "skills", "keeper", "SKILL.md"), "old keeper v1\n");
  writeFileSync(join(target, "skills", "dropped", "SKILL.md"), "framework skill removed upstream\n");
  writeFileSync(join(target, "skills", "Terraform", "SKILL.md"), "imported terraform skill\n");
  writeFileSync(join(target, "skills", "Terraform", "skill.json"), "{}\n");
  writeFileSync(join(target, "my-notes.md"), "my custom notes\n");

  const checksumPath = join(target, ".checksums.json");
  if (withManifest) {
    // Manifest records ONLY framework-delivered files — never the imported/custom ones.
    writeChecksumFile(checksumPath, {
      "skills/keeper/SKILL.md": "x",
      "skills/dropped/SKILL.md": "x",
    });
  }
  return { source, target, checksumPath };
}

test("prune removes a dropped framework skill but keeps imported + custom files", () => {
  const { source, target, checksumPath } = makePair({ withManifest: true });

  const plan = planUpdate(source, target, checksumPath);
  const byPath = Object.fromEntries(plan.map((p) => [p.relativePath, p.action]));

  assert.equal(byPath["skills/keeper/SKILL.md"], "UPDATE", "shipped framework file → UPDATE");
  assert.equal(byPath["skills/dropped/SKILL.md"], "REMOVE", "dropped framework file → REMOVE");
  assert.equal(byPath["skills/Terraform/SKILL.md"], "KEEP", "imported skill → KEEP");
  assert.equal(byPath["skills/Terraform/skill.json"], "KEEP", "imported skill manifest → KEEP");
  assert.equal(byPath["my-notes.md"], "KEEP", "hand-authored custom file → KEEP");

  executeUpdate(plan, source, target, checksumPath);

  // Dropped framework skill deleted, and its now-empty dir cleaned up.
  assert.ok(!existsSync(join(target, "skills", "dropped", "SKILL.md")), "dropped file deleted");
  assert.ok(!existsSync(join(target, "skills", "dropped")), "emptied skill dir removed");

  // Imported + custom survive untouched.
  assert.ok(existsSync(join(target, "skills", "Terraform", "SKILL.md")), "terraform kept");
  assert.ok(existsSync(join(target, "skills", "Terraform", "skill.json")), "terraform manifest kept");
  assert.equal(readFileSync(join(target, "my-notes.md"), "utf8"), "my custom notes\n");

  // Framework file replaced wholesale.
  assert.equal(readFileSync(join(target, "skills", "keeper", "SKILL.md"), "utf8"), "upstream keeper v2\n");

  // New manifest tracks the kept framework file, not the pruned or imported ones.
  const m = readChecksumFile(checksumPath);
  assert.ok("skills/keeper/SKILL.md" in m, "keeper tracked");
  assert.ok(!("skills/dropped/SKILL.md" in m), "dropped no longer tracked");
  assert.ok(!("skills/Terraform/SKILL.md" in m), "imported never framework-tracked");
});

test("no manifest (legacy install) prunes nothing — no proof of ownership", () => {
  const { source, target, checksumPath } = makePair({ withManifest: false });

  const plan = planUpdate(source, target, checksumPath);
  const byPath = Object.fromEntries(plan.map((p) => [p.relativePath, p.action]));

  // Without a manifest, even a framework-shaped orphan is KEPT, never removed.
  assert.equal(byPath["skills/dropped/SKILL.md"], "KEEP", "no manifest → dropped file KEPT");
  assert.ok(!plan.some((p) => p.action === "REMOVE"), "no REMOVE actions without a manifest");

  executeUpdate(plan, source, target, checksumPath);
  assert.ok(existsSync(join(target, "skills", "dropped", "SKILL.md")), "dropped file survives");
});
