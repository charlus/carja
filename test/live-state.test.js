// test/live-state.test.js
//
// Live state: what the ship-log says against what the forge and the deploy
// check say NOW.
//
// WHY. An agent read "Not deployed yet" from the state it had written the day
// before and reported it as today's fact. The human had merged and deployed in
// between, outside the conversation. A dated record is history; MR and deploy
// status is live and is fetched at the moment of the claim, or the agent says
// it did not check. `carja status --live` is the one command that fetches it.
//
// Fixtures are taken from real ship-logs (eurassistant, evalapp-v2), including
// the "MRs !79 to !83" range and the hand-written correction entry that shows
// the problem existed before this fix. The forge CLI outputs are the real `gh`
// and `glab` JSON shapes, probed 2026-10-20.

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  mrRefsFromShipLog,
  normaliseMrState,
  staleClaim,
  deployChecksFrom,
  collectLive,
} from "../src/live-state.js";
import { renderLive } from "../src/view/status.js";
import { statusCommand } from "../src/commands/status.js";

const SHIP_LOG = `# Ship Log

## Your Ship Log

## 2026-07-29 — Annual review export
- **Platform:** MR !52, open for review.

## 2026-10-13 — Usage backfill
- **Platform:** branch \`feat/usage-backfill\`, MR !41 https://code.euranova.eu/enx-it/eurassistant/-/merge_requests/41

## 2026-10-18 — Batch of fixes
- **Platform:** MRs !79 to !83 and !85.

## 2026-10-19 — Ownership migration
- **Platform:** MR !254. Not merged yet.
- **Risk:** see https://github.com/charlus/carja/pull/78 for the framework side.

- [2026-10-19 10:00] Hook waiver (TDD): generated migration !999
`;

describe("mrRefsFromShipLog — the pure half", () => {
  test("finds bare GitLab refs, ranges, GitLab and GitHub URLs, newest entry first", () => {
    const refs = mrRefsFromShipLog(SHIP_LOG);
    const keys = refs.map((r) => r.key);
    assert.deepEqual(keys.slice(0, 2).sort(), ["github:charlus/carja#78", "gitlab:!254"], "the newest entry's refs come first");
    for (const n of [79, 80, 81, 82, 83, 85]) assert.ok(keys.includes(`gitlab:!${n}`), `!${n} from the range`);
    assert.ok(keys.includes("gitlab:code.euranova.eu/enx-it/eurassistant!41"));
    assert.ok(!keys.includes("gitlab:!41"), "a bare ref next to its own URL is the same MR, not a second one");
    assert.ok(!keys.includes("gitlab:!999"), "waiver lines are not ship entries");
  });

  test("each ref carries its entry's date and its own line, so a stored claim can be compared", () => {
    const ref = mrRefsFromShipLog(SHIP_LOG).find((r) => r.key === "gitlab:!254");
    assert.equal(ref.entryDate, "2026-10-19");
    assert.equal(ref.entryTitle, "Ownership migration");
    assert.equal(ref.line, "- **Platform:** MR !254. Not merged yet.");
  });

  test("only the newest entries are checked, so a long log does not mean a hundred forge calls", () => {
    const refs = mrRefsFromShipLog(SHIP_LOG, { entries: 1 });
    assert.deepEqual(refs.map((r) => r.entryDate), ["2026-10-19", "2026-10-19"]);
  });

  test("a log without MR refs gives an empty list", () => {
    assert.deepEqual(mrRefsFromShipLog("# Ship Log\n\n## 2026-10-01 — Docs\n- **What:** typo.\n"), []);
  });
});

describe("normaliseMrState — one vocabulary for two forges", () => {
  test("gh: MERGED / mergedAt", () => {
    assert.deepEqual(
      normaliseMrState("github", '{"closedAt":"2026-10-19T13:56:43Z","mergedAt":"2026-10-19T13:56:43Z","state":"MERGED"}'),
      { state: "merged", at: "2026-10-19" },
    );
    assert.deepEqual(normaliseMrState("github", '{"closedAt":null,"mergedAt":null,"state":"OPEN"}'), { state: "open", at: null });
  });

  test("glab: merged / merged_at, opened, closed", () => {
    assert.deepEqual(
      normaliseMrState("gitlab", '{"iid":41,"state":"merged","merged_at":"2026-10-13T14:25:35.67+02:00","closed_at":null}'),
      { state: "merged", at: "2026-10-13" },
    );
    assert.deepEqual(normaliseMrState("gitlab", '{"state":"opened","merged_at":null}'), { state: "open", at: null });
    assert.deepEqual(
      normaliseMrState("gitlab", '{"state":"closed","merged_at":null,"closed_at":"2026-10-02T09:00:00Z"}'),
      { state: "closed", at: "2026-10-02" },
    );
  });

  test("unparseable output is unknown, never a guess", () => {
    assert.equal(normaliseMrState("gitlab", "404 Not Found").state, "unknown");
    assert.equal(normaliseMrState("github", '{"state":"WEIRD"}').state, "unknown");
  });
});

describe("staleClaim — a stored status that reality contradicts", () => {
  test("an entry that says not merged, for an MR that is merged", () => {
    const claim = staleClaim({ line: "- **Platform:** MR !254. Not merged yet." }, { state: "merged", at: "2026-10-20" });
    assert.match(claim, /not merged/i);
  });

  test("'open for review' on a merged MR is stale too", () => {
    assert.ok(staleClaim({ line: "MR !52, open for review." }, { state: "merged", at: "2026-07-30" }));
  });

  test("no claim when the entry only links the MR, or when the MR is still open", () => {
    assert.equal(staleClaim({ line: "MR !41 https://x/-/merge_requests/41" }, { state: "merged", at: "2026-10-13" }), null);
    assert.equal(staleClaim({ line: "MR !254. Not merged yet." }, { state: "open", at: null }), null);
  });

  test("'unmerged' describing a branch on the MR's line is not a claim about the MR (real eurassistant line)", () => {
    const line = "- **Note on this log:** Rows for !8-!19 sit on the unmerged `docs/state-after-mr18` branch.";
    assert.equal(staleClaim({ line }, { state: "merged", at: "2026-09-08" }), null);
  });
});

describe("deployChecksFrom — the config, or an honest 'ask the human'", () => {
  test("no deployCheck anywhere: empty, so the caller says ask the human", () => {
    assert.deepEqual(deployChecksFrom('{"verify":"npm test"}'), []);
    assert.deepEqual(deployChecksFrom(null), []);
    assert.deepEqual(deployChecksFrom("{not json"), []);
  });

  test("top-level and per nested repository", () => {
    const raw = JSON.stringify({
      deployCheck: "./scripts/deployed.sh",
      repos: { "website-cms": { verify: "npm test", deployCheck: "make deployed" }, other: { verify: "x" } },
    });
    assert.deepEqual(deployChecksFrom(raw), [
      { repo: null, command: "./scripts/deployed.sh" },
      { repo: "website-cms", command: "make deployed" },
    ]);
  });

  test("a blank deployCheck is not a check", () => {
    assert.deepEqual(deployChecksFrom('{"deployCheck":"  "}'), []);
  });
});

describe("collectLive — IO through an injected runner", () => {
  async function project(config, shipLog = SHIP_LOG) {
    const root = await mkdtemp(join(tmpdir(), "live-"));
    await writeFile(join(root, "carja.config.json"), JSON.stringify(config));
    return { root, shipLog };
  }

  function fakeRunner(calls) {
    return async (cmd, args, opts) => {
      calls.push({ cmd, args, cwd: opts.cwd });
      if (cmd === "git" && args.includes("get-url")) return { code: 0, stdout: "git@code.euranova.eu:enx-it/app.git\n" };
      if (cmd === "glab") {
        const n = args[2];
        if (n === "254") return { code: 0, stdout: '{"state":"merged","merged_at":"2026-10-20T08:00:00Z"}' };
        if (n === "41") return { code: 0, stdout: '{"state":"merged","merged_at":"2026-10-13T14:25:35.67+02:00"}' };
        return { code: 1, stdout: "", stderr: "404 Not Found" };
      }
      if (cmd === "gh") return { code: 0, stdout: '{"state":"MERGED","mergedAt":"2026-10-19T13:56:43Z","closedAt":"2026-10-19T13:56:43Z"}' };
      if (cmd === "sh") return { code: 0, stdout: "production: v1.4.2 (!254)\n" };
      return { code: 127, stdout: "", stderr: "not found" };
    };
  }

  test("queries each MR, flags the stale claim, runs the deploy check", async () => {
    const { root, shipLog } = await project({ deployCheck: "./deployed.sh" });
    const calls = [];
    const live = await collectLive(root, { shipLogMd: shipLog, run: fakeRunner(calls), now: Date.UTC(2026, 9, 20, 9) });

    assert.equal(live.checkedAt, "2026-10-20T09:00:00.000Z");
    const mr = live.mrs.find((m) => m.key === "gitlab:!254");
    assert.equal(mr.state, "merged");
    assert.equal(mr.at, "2026-10-20");
    assert.match(mr.stale, /not merged/i);

    const url = live.mrs.find((m) => m.key === "gitlab:code.euranova.eu/enx-it/eurassistant!41");
    const urlCall = calls.find((c) => c.cmd === "glab" && c.args[2] === "41");
    assert.ok(urlCall.args.includes("https://code.euranova.eu/enx-it/eurassistant"), "a URL ref names its project with -R");

    assert.equal(live.mrs.find((m) => m.key === "gitlab:!80").state, "unknown");
    assert.match(live.mrs.find((m) => m.key === "gitlab:!80").reason, /404/);

    assert.deepEqual(live.deploy.checks.map((d) => [d.repo, d.code, d.output]), [[null, 0, "production: v1.4.2 (!254)"]]);
    assert.equal(live.deploy.state, "checked");
  });

  test("no deployCheck configured: the state says ask the human, and no command runs", async () => {
    const { root, shipLog } = await project({ verify: "npm test" });
    const calls = [];
    const live = await collectLive(root, { shipLogMd: shipLog, run: fakeRunner(calls) });
    assert.equal(live.deploy.state, "ask");
    assert.ok(!calls.some((c) => c.cmd === "sh"));
  });

  test("a missing forge CLI makes the MR unknown with the reason, and status still renders", async () => {
    const { root, shipLog } = await project({});
    const live = await collectLive(root, {
      shipLogMd: shipLog,
      run: async (cmd) => (cmd === "git" ? { code: 0, stdout: "git@code.euranova.eu:x/y.git\n" } : { code: 127, stdout: "", stderr: "glab: command not found" }),
    });
    assert.ok(live.mrs.every((m) => m.state === "unknown"));
    assert.ok(live.mrs.every((m) => m.reason));
  });

  test("a bare ref with no matching repository is unknown, not looked up in the wrong project", async () => {
    const { root, shipLog } = await project({});
    const calls = [];
    const live = await collectLive(root, {
      shipLogMd: shipLog,
      run: async (cmd, args, opts) => {
        calls.push({ cmd, args, cwd: opts.cwd });
        if (cmd === "git") return { code: 0, stdout: "git@github.com:someone/else.git\n" };
        return { code: 0, stdout: '{"state":"merged"}' };
      },
    });
    assert.equal(live.mrs.find((m) => m.key === "gitlab:!254").state, "unknown");
    assert.ok(!calls.some((c) => c.cmd === "glab" && c.args[2] === "254"));
  });
});

describe("carja status — --live is opt-in, and its absence is said", () => {
  async function install() {
    const root = await mkdtemp(join(tmpdir(), "live-cli-"));
    await mkdir(join(root, "carja/0-compass"), { recursive: true });
    await mkdir(join(root, "carja/1-workbench"), { recursive: true });
    await writeFile(join(root, "carja/1-workbench/inbox.md"), "# Inbox\n\n- \n");
    await writeFile(join(root, "carja/0-compass/ship-log.md"), "## 2026-10-19 — X\n- **Platform:** MR !254. Not merged yet.\n");
    return root;
  }
  const sink = () => ({ text: "", write(s) { this.text += s; } });

  test("without --live: no forge call, and a line says MR and deploy status were not checked", async () => {
    const root = await install();
    const calls = [];
    const stdout = sink();
    await statusCommand([root, "--no-color"], { cwd: root, stdout, stderr: sink(), run: async (cmd) => (calls.push(cmd), { code: 1, stdout: "" }) });
    assert.deepEqual(calls, []);
    assert.match(stdout.text, /MR and deploy status: not checked\. Run carja status --live/);
  });

  test("--live --json: the digest carries the live block", async () => {
    const root = await install();
    const stdout = sink();
    const run = async (cmd) =>
      cmd === "git" ? { code: 0, stdout: "git@gitlab.example:a/b.git\n" } : { code: 0, stdout: '{"state":"merged","merged_at":"2026-10-20T08:00:00Z"}' };
    await statusCommand([root, "--live", "--json"], { cwd: root, stdout, stderr: sink(), run });
    const digest = JSON.parse(stdout.text);
    assert.equal(digest.live.mrs[0].state, "merged");
    assert.match(digest.live.mrs[0].stale, /not merged/i);
    assert.equal(digest.live.deploy.state, "ask");
  });
});

describe("renderLive — the screen", () => {
  const c = (t) => String(t);

  test("shows each MR's live state, the stale claim, and the check time", () => {
    const out = renderLive(
      {
        checkedAt: "2026-10-20T09:00:00.000Z",
        mrs: [{ key: "gitlab:!254", label: "!254", state: "merged", at: "2026-10-20", entryDate: "2026-10-19", entryTitle: "Ownership migration", stale: "entry says not merged" }],
        deploy: { state: "checked", checks: [{ repo: null, command: "./deployed.sh", code: 0, output: "production: v1.4.2" }] },
      },
      c,
    );
    assert.match(out, /checked 2026-10-20/);
    assert.match(out, /!254\s+merged 2026-10-20/);
    assert.match(out, /entry says not merged/);
    assert.match(out, /production: v1\.4\.2/);
  });

  test("older merged MRs collapse to one line; open, unknown and stale ones always show", () => {
    const mr = (n, date, state, extra = {}) => ({ key: `gitlab:!${n}`, label: `!${n}`, state, at: null, entryDate: date, entryTitle: `T${n}`, stale: null, ...extra });
    const out = renderLive(
      {
        checkedAt: "2026-10-20T09:00:00.000Z",
        mrs: [
          mr(9, "2026-10-19", "merged"),
          mr(8, "2026-10-18", "merged"),
          mr(7, "2026-10-17", "merged"),
          mr(6, "2026-10-16", "open"),
          mr(5, "2026-10-15", "unknown", { reason: "glab: 401" }),
          mr(4, "2026-10-14", "merged", { stale: 'entry says "not merged"' }),
          mr(3, "2026-10-13", "merged"),
        ],
        deploy: { state: "ask", checks: [] },
      },
      c,
    );
    for (const n of [9, 8, 6, 5, 4]) assert.match(out, new RegExp(`!${n}\\s`), `!${n} shown`);
    assert.doesNotMatch(out, /!7\s|!3\s/);
    assert.match(out, /2 older MRs merged/);
  });

  test("no deploy check: says so and tells the agent to ask", () => {
    const out = renderLive({ checkedAt: "2026-10-20T09:00:00.000Z", mrs: [], deploy: { state: "ask", checks: [] } }, c);
    assert.match(out, /no deployCheck/);
    assert.match(out, /ask the human/i);
  });
});

// F22: the merged MR's head for a loop branch, from either forge.
test("forgeMergedHead reads the merged MR head from GitLab and GitHub, null otherwise", async () => {
  const { forgeMergedHead } = await import("../src/live-state.js");
  const sha = "a".repeat(40);
  const runFor = (url, answers) => async (cmd, args) => {
    if (cmd === "git") return { code: 0, stdout: `${url}\n`, stderr: "" };
    return answers[cmd]?.(args) ?? { code: 1, stdout: "", stderr: "no" };
  };
  const gitlab = runFor("git@code.example.eu:team/app.git", {
    glab: (a) => (/source_branch=carja%2Floop%2Fx&state=merged/.test(a[1]) ? { code: 0, stdout: `[{"sha":"${sha}"}]` } : { code: 0, stdout: "[]" }),
  });
  assert.equal(await forgeMergedHead("/r", "carja/loop/x", gitlab), sha);
  assert.equal(await forgeMergedHead("/r", "carja/loop/y", gitlab), null);
  const github = runFor("https://github.com/o/r.git", {
    gh: (a) => (a.includes("carja/loop/x") ? { code: 0, stdout: `[{"headRefOid":"${sha}"}]` } : { code: 0, stdout: "[]" }),
  });
  assert.equal(await forgeMergedHead("/r", "carja/loop/x", github), sha);
  assert.equal(await forgeMergedHead("/r", "carja/loop/y", github), null);
  const broken = runFor("git@code.example.eu:team/app.git", { glab: () => ({ code: 0, stdout: "not json" }) });
  assert.equal(await forgeMergedHead("/r", "carja/loop/x", broken), null);
});
