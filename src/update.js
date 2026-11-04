import fs from 'fs';
import path from 'path';
import { 
    computeChecksum,
    buildChecksumManifest,
    readChecksumFile,
    writeChecksumFile,
 } from './checksums.js';

/**
 * @typedef {Object} UpdateAction
 * @property {'COPY'|'UPDATE'|'SKIP'|'KEEP'|'AVAILABLE'|'REMOVE'} action
 * @property {string} relativePath
 * @property {string} reason
 */

/**
 * Walk a directory recursively and return all relative file paths.
 * @param {string} dirPath - Absolute path to directory.
 * @param {string} [prefix] - Internal recursion prefix.
 * @returns {string[]} Relative file paths.
 */
function listFiles(dirPath, prefix) {
    prefix = prefix || '';
    const results = [];
    if (!fs.existsSync(dirPath)) return results;

    const entries = fs.readdirSync(dirPath, { withFileTypes: true });
    for (const entry of entries) {
        const rel = prefix ? prefix + '/' + entry.name : entry.name;
        const abs = path.join(dirPath, entry.name);

        if (entry.isDirectory()) {
            results.push(...listFiles(abs, rel));
        } else if (entry.isFile()) {
            if (entry.name === '.checksums.json') continue;
            if (entry.name === '.selections.json') continue;
            if (entry.name === '.conductor-version.json' || entry.name === '.carja-version.json') continue;
            results.push(rel);
        }
    }
    return results;
}

/**
 * Read .selections.json from the target directory, if it exists.
 * @param {string} targetDir - Absolute path to target .agents directory.
 * @returns {{skills: string[], rules: string[], workflows: string[]}|null}
 */
function readSelections(targetDir) {
    const selectionsPath = path.join(targetDir, '.selections.json');
    if (!fs.existsSync(selectionsPath)) {
        return null;
    }
    return JSON.parse(fs.readFileSync(selectionsPath, 'utf8'));
}

/**
 * Check if a relative file path belongs to the user's installed selections.
 *
 * Rules:
 *   - If no .selections.json exists (legacy full install), everything is "selected"
 *   - registry.json is always selected
 *   - rules/<file>      → always selected, regardless of what was recorded at install
 *                          time. Unlike skills/workflows, every rule is `category: core`
 *                          — there is no optional/tech-specific rule tier — so a rule
 *                          added to the framework after a project's original install
 *                          (e.g. test-driven-law) must still land on `upgrade`, not get
 *                          silently stuck as AVAILABLE because it wasn't in the old
 *                          .selections.json (which has no way to distinguish "didn't
 *                          exist yet" from "user deselected it")
 *   - skills/<name>/... → name must be in selections.skills
 *   - workflows/<file>  → matched against selections.workflows
 *
 * @param {string} relativePath
 * @param {{skills: string[], rules: string[], workflows: string[]}|null} selections
 * @returns {boolean}
 */
function isSelected(relativePath, selections, coreSkills) {
    // No selections file → legacy "everything installed" mode
    if (!selections) return true;

    // registry.json is always part of the installation
    if (relativePath === 'registry.json') return true;

    const parts = relativePath.split('/');

    // Rules and workflows are core methodology — always land on upgrade, even if
    // they postdate (or were deselected from) the user's .selections.json. A stale
    // selection must never withhold a new core rule/workflow (same reasoning the
    // interview primitives get below).
    if (parts[0] === 'rules') return true;
    if (parts[0] === 'workflows') return true;

    if (parts[0] === 'skills' && parts.length >= 2) {
        const skillName = parts[1];
        // Core/default skills (e.g. the grilling/collaborative-drafting/handoff
        // primitives) always land; optional tech skills stay gated by selections.
        if (coreSkills && coreSkills.has(skillName)) return true;
        return selections.skills.includes(skillName);
    }

    // Unknown top-level path → treat as selected (don't filter out unexpected files)
    return true;
}

/**
 * Produce a plan of update actions by comparing source, target, and stored checksums.
 *
 * Decision matrix (framework files are framework-OWNED — upgrade replaces them):
 *   Source present,  Target absent,  selected        → COPY   (new upstream file)
 *   Source present,  Target absent,  NOT selected    → AVAILABLE (optional, not installed)
 *   Source present,  Target present                   → UPDATE (framework file — replaced wholesale)
 *   Source absent,   Target present,  in old manifest → REMOVE (framework file dropped upstream — prune it)
 *   Source absent,   Target present,  NOT in manifest → KEEP   (user-authored OR `conductor add`-imported — carried forward)
 *
 * The REMOVE / KEEP split turns on framework OWNERSHIP, read from the stored
 * `.checksums.json`: that manifest records only files init/upgrade itself delivered.
 * `conductor add` never writes to it, so registry-imported skills (terraform, angular,
 * …) and hand-authored files are absent from the manifest and are always KEEP — only a
 * file we ourselves installed AND that upstream has since deleted is pruned. A missing
 * manifest (legacy/V4 install) falls back to `options.retired`: a path Conductor once
 * shipped and no longer ships (src/retired-framework-files.json) is pruned. The
 * caller backs up the old tree first, so a REMOVE is recoverable from the backup.
 *
 * The prior checksum-gated SKIP ("local override kept") is intentionally gone: a
 * methodology upgrade must land new instructions even if the user edited them.
 *
 * @param {string} sourceDir    - Absolute path to the source .agents directory.
 * @param {string} targetDir    - Absolute path to the target .agents directory.
 * @param {string} checksumPath - Absolute path to .agents/.checksums.json.
 * @returns {UpdateAction[]} Ordered list of actions.
 */
function planUpdate(sourceDir, targetDir, checksumPath, options = {}) {
    const sourceFiles = new Set(listFiles(sourceDir));
    const targetFiles = new Set(listFiles(targetDir));
    const selections = readSelections(targetDir);
    const coreSkills = options.coreSkills;
    // Ownership record: paths this install's init/upgrade actually delivered.
    // `conductor add` does NOT write here, so imported/custom files are absent.
    const oldManifest = readChecksumFile(checksumPath);
    // With a manifest, it alone decides ownership: a registry skill that reuses a
    // retired name is never pruned. `retired` applies only when there is none.
    const noManifest = Object.keys(oldManifest).length === 0;
    const retired = options.retired || new Set();

    /** @type {UpdateAction[]} */
    const plan = [];

    // 1. Process every file in source
    for (const rel of [...sourceFiles].sort()) {
        const targetPath = path.join(targetDir, rel);

        if (!targetFiles.has(rel)) {
            // Target absent — check if user selected this item
            if (isSelected(rel, selections, coreSkills)) {
                plan.push({ action: 'COPY', relativePath: rel, reason: 'new upstream file' });
            } else {
                plan.push({ action: 'AVAILABLE', relativePath: rel, reason: 'not installed — run init to add' });
            }
        } else {
            // Target exists — framework owns this file; replace it wholesale.
            plan.push({ action: 'UPDATE', relativePath: rel, reason: 'framework file — replaced' });
        }
    }

    // 2. Process files only in target (not shipped by the current source)
    for (const rel of [...targetFiles].sort()) {
        if (!sourceFiles.has(rel)) {
            if (Object.prototype.hasOwnProperty.call(oldManifest, rel)) {
                // We delivered this file before; upstream has dropped it → prune it.
                plan.push({ action: 'REMOVE', relativePath: rel, reason: 'framework file removed upstream' });
            } else if (noManifest && retired.has(rel)) {
                // No manifest (V4): the proof of ownership is that Conductor once
                // shipped this exact path (src/retired-framework-files.json).
                plan.push({ action: 'REMOVE', relativePath: rel, reason: 'retired framework file' });
            } else {
                // Never framework-tracked → user-authored or `conductor add`-imported → keep.
                plan.push({ action: 'KEEP', relativePath: rel, reason: 'custom or imported file' });
            }
        }
    }

    return plan;
}

/**
 * Execute an update plan: copy files, and write the updated checksum manifest.
 *
 * @param {UpdateAction[]} plan       - The plan from planUpdate().
 * @param {string}         sourceDir  - Absolute path to source .agents directory.
 * @param {string}         targetDir  - Absolute path to target .agents directory.
 * @param {string}         checksumPath - Absolute path to .checksums.json.
 */
function executeUpdate(plan, sourceDir, targetDir, checksumPath, options = {}) {
    for (const item of plan) {
        const src = path.join(sourceDir, item.relativePath);
        const dst = path.join(targetDir, item.relativePath);

        if (item.action === 'COPY' || item.action === 'UPDATE') {
            // Ensure parent directory exists
            fs.mkdirSync(path.dirname(dst), { recursive: true });
            fs.copyFileSync(src, dst);
        } else if (item.action === 'REMOVE') {
            // Framework file dropped upstream. Delete it, then clean up any now-empty
            // ancestor directories (e.g. an emptied skills/<name>/) up to targetDir.
            if (fs.existsSync(dst)) fs.rmSync(dst);
            let dir = path.dirname(dst);
            const stop = path.resolve(targetDir);
            while (path.resolve(dir) !== stop && path.resolve(dir).startsWith(stop + path.sep)) {
                try {
                    if (fs.readdirSync(dir).length === 0) {
                        fs.rmdirSync(dir);
                        dir = path.dirname(dir);
                    } else break;
                } catch { break; }
            }
        }
        // KEEP and AVAILABLE → no file operations (custom files carried forward as-is)
    }

    if (options.writeChecksums === false) return;

    // Rebuild the checksum manifest from what we delivered (COPY/UPDATE).
    const newSourceManifest = buildChecksumManifest(sourceDir);
    const finalManifest = {};
    for (const item of plan) {
        if (item.action === 'COPY' || item.action === 'UPDATE') {
            finalManifest[item.relativePath] = newSourceManifest[item.relativePath];
        }
        // KEEP and AVAILABLE files are not framework-tracked.
    }
    writeChecksumFile(checksumPath, finalManifest);
}

export { 
    planUpdate,
    executeUpdate,
    listFiles,
    isSelected,
 };
