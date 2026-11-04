// src/loop/doctor.js
//
// `carja loop doctor` (F1 + F6 of the first unattended crossing,
// docs/roadmap/Unattended-Crossing.md). Preparing a project for the loop took
// six project facts that nothing checked, and the prep notes were proven wrong
// only by a live run. The doctor checks those facts before any beat.
//
// `diagnose` is pure over facts the command layer gathers
// (src/commands/loop-doctor.js), so every rule is unit-testable. A check is
// "pass", "warn" (the run can start but something will likely hurt) or "fail"
// (the run would halt, stall or be unsafe). Each non-pass check names its fix.

const ICON = { pass: "✔", warn: "⚠", fail: "✖" };

/** Claude model families ranked by strength; null for a default or a family not ranked here. */
const TIERS = [["haiku", 1], ["sonnet", 2], ["opus", 3]];
export function modelTier(model) {
  const m = String(model ?? "").toLowerCase();
  return TIERS.find(([family]) => m.includes(family))?.[1] ?? null;
}

function check(id, level, title, detail = "", fix = "") {
  return { id, level, title, detail, fix };
}

/** @param {object} f facts gathered by the command layer */
export function diagnose(f) {
  const out = [];
  const s = f.state ?? {};
  // F12: one cause, one line. Every other check would only restate it.
  if (f.notSetUp) {
    return [
      check(
        "setup",
        "fail",
        "the loop is not set up for this project yet",
        `loop-state.json says ${s.phase ?? "no phase"}, sandbox ${s.sandbox ?? "unset"}, and no work is turned on.`,
        "`carja loop on` lists your projects; `carja loop on <project>` sets the loop up for one, after showing each change; `carja loop on --backlog` for backlog items you give it with `carja loop take`."
      ),
    ];
  }

  if (f.configErrors?.length) {
    out.push(check("config", "fail", "carja.config.json loop block", f.configErrors.join("; "), "Fix the listed values; the run refuses an invalid loop block."));
  }

  if (f.preflightHalt) {
    out.push(check("preflight", "fail", `pre-flight would halt: ${f.preflightHalt}`, f.preflightReason ?? "", "Change loop-state.json as the reason says, then run the doctor again."));
  } else {
    out.push(check("preflight", "pass", `pre-flight passes (${s.phase}, ${s.autonomy_level}, sandbox ${s.sandbox})`));
  }

  if (f.projectVersion && f.cliVersion && f.projectVersion !== f.cliVersion) {
    out.push(check("version", "warn", `project framework ${f.projectVersion}, CLI ${f.cliVersion}`, "The loop runs the CLI's code against the project's templates.", "Run `carja upgrade` in the project."));
  }

  if (s.sandbox === "cli-native") {
    const p = f.profile ?? {};
    if (!p.credentials || !p.strict) {
      const missing = [!p.credentials && "forge credentials are not withheld", !p.strict && "headless beats can stall on commands that need approval"].filter(Boolean);
      out.push(check("sandbox-profile", "fail", "sandbox profile is out of date", missing.join("; "), "Run `carja upgrade` (6.17.0 or later)."));
    } else {
      out.push(check("sandbox-profile", "pass", "sandbox profile withholds credentials and runs headless"));
    }
    if (s.platform === "claude" || !s.platform) {
      const t = f.hostTools ?? {};
      const missing = [!t.bwrap && "bubblewrap", !t.socat && "socat"].filter(Boolean);
      out.push(
        missing.length
          ? check("host-tools", "fail", `missing for the sandbox: ${missing.join(", ")}`, "", "Install bubblewrap and socat (`sudo apt install bubblewrap socat`); see .agents/sandbox/README.md.")
          : check("host-tools", "pass", "bubblewrap and socat are installed")
      );
    }
  } else if (s.sandbox === "none") {
    out.push(check("sandbox", "warn", "sandbox is none", "Every run needs --unsafe-no-sandbox, and L3 is refused.", 'Set "sandbox": "cli-native" in loop-state.json.'));
  }

  const c = f.claude ?? {};
  if (c.available === false && (s.platform === "claude" || !s.platform)) {
    out.push(check("claude", "fail", "claude is not on PATH", "", "Install Claude Code, or set platform in loop-state.json."));
  } else if (c.available) {
    for (const w of c.warnings ?? []) out.push(check("instructions", "warn", "Claude Code may not see the framework", w, "See the warning; `carja status` shows the same."));
    if (!(c.warnings ?? []).length) out.push(check("instructions", "pass", "Claude Code reads AGENTS.md here"));
  }

  const fg = f.forge ?? {};
  if (fg.needed) {
    if (!fg.forge) out.push(check("forge", "fail", "cannot tell which forge opens the PR", fg.error ?? "", 'Set loop.forge to "gh" or "glab" in carja.config.json.'));
    else if (!fg.authOk) out.push(check("forge", "fail", `${fg.forge} is not logged in${fg.host ? ` to ${fg.host}` : ""}`, "", `Run \`${fg.forge} auth login${fg.host ? ` --hostname ${fg.host}` : ""}\`.`));
    else out.push(check("forge", "pass", `${fg.forge} is logged in${fg.host ? ` to ${fg.host}` : ""}`));
  }

  if (f.nestedRepos?.length) {
    out.push(check("nested", "fail", `nested repositories: ${f.nestedRepos.join(", ")}`, "Loop worktrees would not contain that code.", "`carja loop on <project>` sets it up (the code repository, and the others ignored). Or by hand: loop.code_dir for the code, loop.allow_nested_repo: true if unrelated."));
  }
  const cd = f.code;
  if (cd) {
    if (!cd.isRepo) out.push(check("code", "fail", `loop.code_dir ${cd.dir}/ is not a git repository`, "", "Clone the code repository there, or fix loop.code_dir."));
    else if (!cd.base) out.push(check("code", "fail", `code repository ${cd.dir}/ has no default branch to start from`, "", `Run \`git -C ${cd.dir} remote set-head origin --auto\`.`));
    else {
      out.push(check("code", "pass", `code repository ${cd.dir}/: each item gets a code worktree from ${cd.base}, and two MRs, code first`));
      if (!cd.forge) out.push(check("code-forge", "fail", `cannot tell which forge opens the code MR`, "", 'Set loop.forge to "gh" or "glab".'));
      else if (!cd.authOk) out.push(check("code-forge", "fail", `${cd.forge} is not logged in${cd.host ? ` to ${cd.host}` : ""} (code MR)`, "", `Run \`${cd.forge} auth login${cd.host ? ` --hostname ${cd.host}` : ""}\`.`));
      else out.push(check("code-forge", "pass", `${cd.forge} is logged in${cd.host ? ` to ${cd.host}` : ""} (code MR)`));
    }
  }

  const q = f.queue;
  if (q) {
    if (q.count === 0) {
      out.push(check("queue", "warn", "--from-carja would find no work", "", `Turn it on for a project: \`carja loop on <project>\`. Or ${q.requireReady ? "give it a backlog item: `carja loop take \"<item>\"`" : "add a backlog item"}.`));
    } else {
      out.push(check("queue", "pass", `--from-carja would take ${q.count} item${q.count === 1 ? "" : "s"}`));
    }
  }

  // F4 (Harness Engineering 101 harvest): the loop acts on the Checker's approval
  // without a second look, so the Checker must not be weaker than the Maker.
  const makerTier = modelTier(f.models?.maker);
  const checkerTier = modelTier(f.models?.checker);
  if (makerTier !== null && checkerTier !== null && checkerTier < makerTier) {
    out.push(check("models", "warn", `the Checker runs on ${f.models.checker}, a weaker model than the Maker's ${f.models.maker}`, "The loop opens an MR on the Checker's approval alone. A weaker reviewer passes mistakes the Maker made.", "Use a profile: `carja loop profile quality` or `balanced` both review on Opus. Or give `loop.models.checker` the Maker's model or a stronger one."));
  }

  if (f.dotenv?.present && !f.dotenv.copiedBySetup) {
    out.push(check("dotenv", "warn", ".env is not in the worktree", "It is gitignored, so tests or evals that read it will skip or fail in a loop worktree, the push gate included.", f.dotenv.example
          ? "Copy the example in loop.setup, as CI usually does: `cp .env.example .env`. Never put the real .env in a worktree: it holds secrets, and the beat can read every file there."
          : "Copy it in loop.setup, for example `[ -f ../../../.env ] && cp ../../../.env .env`, only if it holds no secret the beat must not read."));
  }

  const pr = f.probe;
  if (pr?.ran) {
    if (pr.setup?.configured) {
      out.push(
        pr.setup.ok
          ? check("setup", "pass", `loop.setup ran in a fresh worktree (${pr.setup.secs ?? "?"}s)`)
          : check("setup", "fail", "loop.setup failed in a fresh worktree", pr.setup.reason ?? "", "Run the setup command by hand in a new worktree of this repo and fix it.")
      );
    }
    if (pr.verify) {
      const v = pr.verify;
      if (v.exitCode === 0) {
        out.push(check("verify", "pass", `verify is green in a fresh worktree (${v.secs ?? "?"}s): ${v.command}`));
      } else {
        let fix = pr.setup?.configured
          ? "The base must be green: fix the failure, or the setup that should prepare it."
          : "A fresh worktree has no installed dependencies or ignored files. Set loop.setup to prepare it.";
        // The project's own test recipe usually lives in its CI file.
        if (f.ciFile) fix += ` ${f.ciFile} shows how CI prepares its test job: mirror those steps in loop.setup.`;
        out.push(check("verify", "fail", `verify is red in a fresh worktree (exit ${v.exitCode}): ${v.command}`, v.tail ?? "", fix));
      }
    }
  }

  // The main checkout: green in a fresh worktree but red here means the local
  // environment is older than the code (eurassistant, 2026-10-19: the .venv
  // still held the old SDK after the loop's MR changed the lock file). Loop runs
  // push from their own worktree, so it is a warning; the owner's next push fails.
  const rv = f.rootVerify;
  if (rv && pr?.verify?.exitCode === 0) {
    out.push(
      rv.exitCode === 0
        ? check("local-env", "pass", "verify is green in your main checkout too")
        : check(
            "local-env",
            "warn",
            `verify is red in your main checkout (exit ${rv.exitCode}) but green in a fresh worktree`,
            rv.tail ?? "",
            "Your local environment is older than the code, for example dependencies installed from an older lock file, or uncommitted changes. Reinstall the dependencies as loop.setup does, or commit or discard the changes. Your next push fails until then."
          )
    );
  }

  const b = f.beat;
  if (b?.ran) {
    if (b.blocked) out.push(check("beat", "fail", "a sandboxed beat could not run the verify command", b.blocked, "Run `carja upgrade`; if it persists, the command needs a host or path the sandbox blocks: add it to loop.allowed_domains or loop.setup."));
    else if (b.exitCode !== 0) out.push(check("beat", "fail", `in a sandboxed beat the verify command exits ${b.exitCode}`, b.tail ?? "", "It passes outside the sandbox, so the sandbox blocks something it needs: read the tail and add the host to loop.allowed_domains."));
    else out.push(check("beat", "pass", "a sandboxed beat ran the verify command green"));
  }

  return out;
}

/** The report, one line per check, a fix under each non-pass, and a verdict. */
export function renderDoctor(checks) {
  const lines = ["carja loop doctor", ""];
  for (const c of checks) {
    lines.push(`  ${ICON[c.level]} ${c.title}`);
    if (c.level !== "pass" && c.detail) lines.push(`      ${c.detail}`);
    if (c.level !== "pass" && c.fix) lines.push(`      fix: ${c.fix}`);
  }
  const fails = checks.filter((c) => c.level === "fail").length;
  const warns = checks.filter((c) => c.level === "warn").length;
  lines.push("");
  if (fails) lines.push(`  ${fails} to fix${warns ? `, ${warns} to check` : ""} before an unattended run.`);
  else if (warns) lines.push(`  Ready for an unattended run, with ${warns} warning${warns === 1 ? "" : "s"} to check.`);
  else lines.push("  Ready for an unattended run.");
  return `${lines.join("\n")}\n`;
}

/** Exit code: 1 when any check fails. */
export function doctorExitCode(checks) {
  return checks.some((c) => c.level === "fail") ? 1 : 0;
}
