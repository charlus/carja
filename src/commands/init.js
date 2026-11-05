import { access, cp, mkdir, rm, stat, readFile, writeFile } from "node:fs/promises";
import { readFileSync } from "node:fs";
import { constants as fsConstants } from "node:fs";
import { fileURLToPath } from "node:url";
import { join, resolve } from "node:path";
import { detectTechStack } from "../detect.js";
import { resolveRegistry, fetchRegistryIndex, readLocalSkills } from "../registry.js";
import { runInteractiveSetup } from "../prompt.js";
import { selectiveCopy, syncSelections, readSelections } from "../selective-copy.js";
import { generateClaudeCommands, generateClaudeSkills } from "../claude-commands.js";
import { installHooksCommand } from "./install-hooks.js";
import { ensureUnionMerge } from "../gitattributes.js";
import { writeVersionStamp, packageVersion } from "../version.js";
import { ensureVerifyCommand } from "../verify-config.js";
import { buildFrameworkBlock, renderRootAgentsMd } from "../agents-md.js";
import { instructionWarningsFor } from "../claude-instructions.js";

function getTemplateDir() {
  return fileURLToPath(new URL("../../templates", import.meta.url));
}

async function exists(path) {
  try {
    await access(path, fsConstants.F_OK);
    return true;
  } catch {
    return false;
  }
}

function parseInitArgs(args) {
  const parsed = {
    target: ".",
    force: false,
    agentOnly: false,
    noDetect: false,
    all: false,
  };
  let targetSet = false;

  for (const arg of args) {
    if (arg === "--force" || arg === "-f") {
      parsed.force = true;
      continue;
    }
    if (arg === "--agent-only") {
      parsed.agentOnly = true;
      continue;
    }
    if (arg === "--no-detect") {
      parsed.noDetect = true;
      continue;
    }
    if (arg === "--all") {
      parsed.all = true;
      continue;
    }
    if (arg.startsWith("-")) {
      throw new Error(`Unknown option: ${arg}`);
    }
    if (targetSet) {
      throw new Error(
        "Too many positional arguments. Only one target directory is supported."
      );
    }
    parsed.target = arg;
    targetSet = true;
  }

  return parsed;
}

async function validateTargetDir(targetDir) {
  let targetStat;
  try {
    targetStat = await stat(targetDir);
  } catch {
    await mkdir(targetDir, { recursive: true });
    return;
  }
  if (!targetStat.isDirectory()) {
    throw new Error(`Target path is not a directory: ${targetDir}`);
  }
}

export async function initCommand(args, { cwd, stdout, stderr }) {
  let parsed;
  try {
    parsed = parseInitArgs(args);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    stderr.write(`${message}\n`);
    return 1;
  }

  const targetDir = resolve(cwd, parsed.target);
  const agentsDir = join(targetDir, ".agents");
  const templateDir = getTemplateDir();
  const sourceAgentsDir = join(templateDir, ".agents");

  try {
    await validateTargetDir(targetDir);

    const templateExists = await exists(templateDir);
    if (!templateExists) {
      throw new Error("Bundled templates are missing. This package may be corrupted.");
    }

    // Clean legacy agent dir
    const legacyAgentDir = join(targetDir, ".agent");
    if (await exists(legacyAgentDir)) {
      await rm(legacyAgentDir, { recursive: true, force: true });
      stdout.write("🧹 Removed legacy .agent/ (replaced by .agents/)\n");
    }

    // Check if .agents/ exists
    const agentsExists = await exists(agentsDir);
    if (agentsExists && !parsed.force && !parsed.agentOnly) {
      stderr.write(`.agents/ already exists at ${agentsDir}\nRe-run with --force to replace it, or --agent-only to reconfigure it interactively.\n`);
      return 1;
    }

    if (agentsExists && parsed.force && !parsed.agentOnly) {
      await rm(agentsDir, { recursive: true, force: true });
      stdout.write("Removed existing .agents/ directory.\n");
    }

    // CLI Interactive Setup for .agents/
    const registryPath = join(sourceAgentsDir, "registry.json");
    if (!(await exists(registryPath))) {
       throw new Error("registry.json missing. Run build-registry.js first.");
    }
    const registry = JSON.parse(readFileSync(registryPath, "utf8"));
    const existing = await exists(agentsDir) ? readSelections(agentsDir) : null;
    
    if (parsed.all) {
      // Install everything manually (legacy behavior)
      const allSelections = {
         skills: registry.skills.map(s => s.name),
         rules: registry.rules.map(r => r.name),
         workflows: registry.workflows.map(w => w.name),
         bundles: []
      };
      selectiveCopy(sourceAgentsDir, agentsDir, allSelections, registry);
      stdout.write("✅ Installed ALL .agents/ (workflows, skills, personas, rules)\n");
    } else {
      const setupOptions = existing ? { previousSelections: existing } : undefined;
      const selections = await runInteractiveSetup(registry, setupOptions);
      if (!selections) {
         process.exit(0);
      }

      if (existing) {
         const { added, removed } = syncSelections(sourceAgentsDir, agentsDir, selections, existing, registry);
         if (added.length === 0 && removed.length === 0) stdout.write('\n✅ No changes — selections are the same.\n');
         else stdout.write('\n✅ Reconfiguration complete!\n');
      } else {
         selectiveCopy(sourceAgentsDir, agentsDir, selections, registry);
         stdout.write("✅ Installed .agents/ based on selections\n");
      }
    }

    // Stamp the installed framework version (future upgrades read this).
    writeVersionStamp(agentsDir);

    // Claude Code slash-command bridge (ADR-0001 D5): shim per installed workflow.
    await generateClaudeCommands(targetDir, { stdout });
    await generateClaudeSkills(targetDir, { stdout });

    // Copy carja/ (project state folders)
    if (!parsed.agentOnly) {
      const carjaDir = join(targetDir, "carja");
      const carjaExists = await exists(carjaDir);
      if (carjaExists && !parsed.force) {
        stdout.write("⏭️  Skipped carja/ (already exists)\n");
      } else {
        if (carjaExists && parsed.force) {
          await rm(carjaDir, { recursive: true, force: true });
        }
        await cp(join(templateDir, "carja"), carjaDir, { recursive: true });
        stdout.write("✅ Installed carja/ (project state folders)\n");
      }

      // Copy platform stubs and config
      // Root AGENTS.md: the one instruction file every harness loads, generated
      // from the .agents/ just installed. A file the user already has keeps every
      // byte below the inserted blocks.
      const agentsMdPath = join(targetDir, "AGENTS.md");
      const hadAgentsMd = await exists(agentsMdPath);
      await writeFile(
        agentsMdPath,
        renderRootAgentsMd(hadAgentsMd ? await readFile(agentsMdPath, "utf8") : null, await buildFrameworkBlock(agentsDir)),
        "utf8",
      );
      stdout.write(`✅ ${hadAgentsMd ? "Added the Carja framework block to your AGENTS.md" : "Created AGENTS.md"}\n`);
      for (const w of await instructionWarningsFor(targetDir)) stdout.write(`⚠️  ${w}\n`);

      for (const stub of ["CHANGELOG.md", "carja.config.json"]) {
        const stubTarget = join(targetDir, stub);
        if (!(await exists(stubTarget))) {
          await cp(join(templateDir, stub), stubTarget);
          stdout.write(`✅ Created ${stub}\n`);
        }
      }

      // The push gate needs a command to run (Verification Iron Law). Derive it
      // from the project's files, or warn in words that name the fix.
      await ensureVerifyCommand(targetDir, stdout);

      stdout.write(`\n🎼 Carja Framework v${packageVersion()} initialized!\n`);

      // Deterministic enforcement (ADR-0001 D1): wire git hooks when in a repo.
      if (await exists(join(targetDir, ".git"))) {
        stdout.write("\n🔒 Enabling deterministic enforcement hooks...\n");
        await installHooksCommand([targetDir], { cwd, stdout, stderr });
        ensureUnionMerge(targetDir);
      }

      if (!parsed.noDetect) {
        const detected = await detectTechStack(targetDir);
        if (detected.length > 0) {
          stdout.write("\n🔍 Detected tech stack:\n   " + detected.join(", ") + "\n");
          await suggestRegistrySkills(targetDir, detected, stdout);
        }
      }

      stdout.write(
        "\nNext steps:\n" +
          "  1. Set the push gate:  carja verify      (what `git push` must pass here)\n" +
          "  2. Write the project card: ask your agent to run the agents-md workflow (/agents-md)\n" +
          "  3. Run the self-test:  bash .agents/tests/check-carja.sh\n" +
          '  4. Start building:     Tell your AI "Let\'s go"\n' +
          "\nRun the autonomous loop (no git clone needed):\n" +
          "  • Zero-install:  npx github:charlus/carja loop --dry-run\n" +
          "  • Persistent:    npm i -g github:charlus/carja   then:   carja loop --dry-run\n" +
          "  • Fleet:         carja loop --from-carja --dry-run   (drain your ./carja/ backlog)\n" +
          "  Guide: https://github.com/charlus/carja/blob/master/docs/Running-The-Loop.md\n" +
          "\nDocs: AGENTS.md (always loaded), .agents/how-it-works.md (full reference)\n"
      );
    }
    
    return 0;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    stderr.write(`Init failed: ${message}\n`);
    return 1;
  }
}

async function suggestRegistrySkills(projectDir, detectedTech, stdout) {
  try {
    const { hostname, project } = await resolveRegistry(projectDir);
    const registry = await fetchRegistryIndex(hostname, project);
    const localSkills = await readLocalSkills(join(projectDir, ".agents", "skills"));
    const localNames = new Set(localSkills.map((s) => s.name));

    const suggestions = registry.skills.filter((skill) => {
      if (localNames.has(skill.name)) return false;
      if (!skill.techStack || skill.techStack.length === 0) return false;
      return skill.techStack.some((t) => detectedTech.includes(t));
    });

    if (suggestions.length > 0) {
      stdout.write("\n💡 Recommended skills from registry:\n");
      for (const skill of suggestions) {
        const matched = skill.techStack.filter((t) => detectedTech.includes(t));
        stdout.write(`   • ${skill.name} — ${skill.description}\n     matches: ${matched.join(", ")}\n`);
      }
      stdout.write(`\n   Install with: carja add <skill-name>\n`);
    }
  } catch {}
}
