import { readdir, rename, stat, readFile, writeFile, access } from "node:fs/promises";
import { join, parse } from "node:path";
import { constants as fsConstants } from "node:fs";

const IGNORED_FILES = new Set([
  "AGENTS.md", "SKILL.md", "GEMINI.md", "CLAUDE.md", "CHANGELOG.md", "README.md", "package.json",
  // Files whose casing is canonical and must not be kebab-lowercased.
  "Dockerfile", "Dockerfile.sandbox",
]);

export function toKebabCase(str) {
  return str
    .replace(/([a-z])([A-Z])/g, '$1-$2')
    .replace(/[\s_]+/g, '-')
    .toLowerCase();
}

async function exists(path) {
  try {
    await access(path, fsConstants.F_OK);
    return true;
  } catch {
    return false;
  }
}

export async function renameRecursive(dir, stdout) {
  if (!(await exists(dir))) return;
  
  const entries = await readdir(dir);
  
  for (const entry of entries) {
    if (IGNORED_FILES.has(entry) || entry === ".checksums.json" || entry.startsWith(".")) {
      if (entry !== ".agents" && entry.startsWith(".")) continue;
    }
    
    const fullPath = join(dir, entry);
    const stats = await stat(fullPath);
    
    let newEntry = entry;
    if (!IGNORED_FILES.has(entry) && entry !== ".agents") {
      const parsed = parse(entry);
      newEntry = toKebabCase(parsed.name) + parsed.ext.toLowerCase();
    }

    const newFullPath = join(dir, newEntry);

    let effectivePath = fullPath;
    if (newFullPath !== fullPath) {
      if (!(await exists(newFullPath))) {
        await rename(fullPath, newFullPath);
        effectivePath = newFullPath;
        if (stdout) stdout.write(`  📝 Renamed: ${entry} -> ${newEntry}\n`);
      } else {
        // Collision: the kebab-cased target already exists. Do NOT clobber —
        // leave the original in place (a backup is taken before upgrade anyway).
        if (stdout) stdout.write(`  ⚠️  Skipped rename (target exists): ${entry}\n`);
      }
    }

    if (stats.isDirectory()) {
      await renameRecursive(effectivePath, stdout);
    }
  }
}

// The framework-scaffolded numbered folders, Title-Case → kebab.
const NUMBERED_FOLDER_NAMES = [
  "0-Compass", "1-Workbench", "2-Backlog", "3-Product-Areas",
  "4-Context", "5-Templates", "6-Archive",
];

/**
 * Kebab-rename ONLY the known framework numbered folders at the top of
 * `carja/`. Deliberately does not recurse — user knowledge files inside
 * these folders keep whatever names the user gave them.
 */
export async function renameNumberedFolders(carjaDir, stdout) {
  if (!(await exists(carjaDir))) return;
  for (const name of NUMBERED_FOLDER_NAMES) {
    const kebab = toKebabCase(name);
    if (name === kebab) continue;
    const src = join(carjaDir, name);
    const dst = join(carjaDir, kebab);
    if ((await exists(src)) && !(await exists(dst))) {
      await rename(src, dst);
      if (stdout) stdout.write(`  📝 ${name}/ → ${kebab}/\n`);
    }
  }
}

// Names the workflows write inside a Project folder. They are not in the
// scaffolded carja/ tree, but the workflows read them by exact path.
const WORKFLOW_OUTPUT_NAMES = [
  "genesis", "storyboard", "blueprint", "implementations",
  "problem-solar-system.md", "world-transformation.md", "functional-animator.md",
  "main-character.md", "storyboard.md", "grand-prd.md", "ux-ui-design-brief.md",
  "technical-vision.md", "implementation-overview.md", "feature-spec.md",
  "implementation-plan.md", "task-tracker.md", "project-documentation.md", "trace.md",
];

// Names Carja once scaffolded and no longer ships. An old install still has
// them in Title-Case, and `carja design migrate` reads them by exact path.
const RETIRED_SCAFFOLD_NAMES = ["design", "design-system.md", "ui-components.md", "brand-assets.md"];

// `[ProjectName]-documentation/` and `[area]-epics.md` etc.: only the
// framework suffix is lowercased; the user's part keeps its name.
const FRAMEWORK_SUFFIXES = [
  [/-Documentation$/, "-documentation"],
  [/-Epics\.md$/, "-epics.md"],
  [/-Features\.md$/, "-features.md"],
  [/-Technical\.md$/, "-technical.md"],
];

async function segmentsOf(dir, out = new Set()) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    out.add(entry.name);
    if (entry.isDirectory()) await segmentsOf(join(dir, entry.name), out);
  }
  return out;
}

/** A case-only rename in two steps, so it also works on case-insensitive filesystems. */
async function renameCaseSafe(src, dst) {
  if (src.toLowerCase() === dst.toLowerCase()) {
    const tmp = `${src}.carja-rename-${process.pid}`;
    await rename(src, tmp);
    await rename(tmp, dst);
  } else {
    await rename(src, dst);
  }
}

async function entryExactlyExists(dir, name) {
  return (await readdir(dir)).includes(name);
}

/**
 * Kebab-rename the FRAMEWORK names at every level of `carja/` — the ones the
 * workflows and the CLI read by exact path (`2-backlog/project-backlog/`,
 * `1-workbench/inbox.md`, `<project>/blueprint/grand-prd.md`, …). A V4 install
 * has them in Title-Case, and on a case-sensitive filesystem nothing finds them.
 *
 * A name is renamed only when its kebab form is a framework name: a segment of
 * the shipped `templates/carja/` tree, a name a workflow writes, or a
 * framework suffix. Every other name — `Nexus`, `01-Foundation-Auth`,
 * `API-Discovery.md` — is the user's and is left exactly as it is.
 * `5-templates/` is skipped: it is refreshed wholesale elsewhere.
 */
export async function renameFrameworkNames(carjaDir, templateCarjaDir, stdout) {
  if (!(await exists(carjaDir))) return 0;
  const known = await segmentsOf(templateCarjaDir);
  for (const n of WORKFLOW_OUTPUT_NAMES) known.add(n);
  for (const n of RETIRED_SCAFFOLD_NAMES) known.add(n);

  const target = (entry) => {
    const parsed = parse(entry);
    const kebab = toKebabCase(parsed.name) + parsed.ext.toLowerCase();
    if (kebab !== entry && known.has(kebab)) return kebab;
    for (const [re, lower] of FRAMEWORK_SUFFIXES) if (re.test(entry)) return entry.replace(re, lower);
    return entry;
  };

  let renamed = 0;
  async function walk(dir, depth) {
    for (const entry of await readdir(dir)) {
      if (entry.startsWith(".") || (depth === 0 && entry === "5-templates")) continue;
      let path = join(dir, entry);
      const next = target(entry);
      if (next !== entry) {
        if (await entryExactlyExists(dir, next)) {
          if (stdout) stdout.write(`  ⚠️  Skipped rename (target exists): ${join(dir, entry)}\n`);
        } else {
          await renameCaseSafe(path, join(dir, next));
          path = join(dir, next);
          renamed += 1;
          if (stdout) stdout.write(`  📝 Renamed: ${entry} -> ${next}\n`);
        }
      }
      if ((await stat(path)).isDirectory()) await walk(path, depth + 1);
    }
  }
  await walk(carjaDir, 0);
  return renamed;
}

export function kebabCasePath(filePath) {
  return filePath.split('/').map(part => {
    if (IGNORED_FILES.has(part)) return part;
    const parsed = parse(part);
    return toKebabCase(parsed.name) + parsed.ext.toLowerCase();
  }).join('/');
}

export async function updateChecksumsKeys(checksumPath) {
  if (!(await exists(checksumPath))) return;
  
  try {
    const content = await readFile(checksumPath, "utf-8");
    const checksums = JSON.parse(content);
    const newChecksums = {};
    let changed = false;
    
    for (const [key, value] of Object.entries(checksums)) {
      const newKey = kebabCasePath(key);
      newChecksums[newKey] = value;
      if (key !== newKey) changed = true;
    }
    
    if (changed) {
      await writeFile(checksumPath, JSON.stringify(newChecksums, null, 2) + '\n');
    }
  } catch (e) {
    // ignore
  }
}
