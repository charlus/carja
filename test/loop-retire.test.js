// test/loop-retire.test.js
//
// A loop report and its messages leave the workbench once the project's run is
// done and every MR of its stack is merged (agentic-content-os / KM, 2026-11-23:
// a report of 9 merged MRs and 9 shipped escalations still showed as open work
// weeks later). Moved to carja/6-archive/loop/, never deleted: git does not
// track these files.

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, readdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { messageTag, parseLoopMessages, retireLoopFiles, MESSAGES_REL, ARCHIVE_REL, OWNER_EXCLUDES } from "../src/loop/owner-files.js";
import { REPORT_REL, renderStackReport } from "../src/loop/stack.js";

const msg = (title, tag) => `\n## [loop] ${title}${tag ? ` ${tag}` : ""}\nbody of ${title}\n`;

function folder({ stop = null } = {}) {
  const root = mkdtempSync(join(tmpdir(), "carja-retire-"));
  mkdirSync(join(root, "carja/1-workbench"), { recursive: true });
  const report = renderStackReport({ project: "km", entries: [{ title: "a", merged: true, outer: { url: "u" } }], stop, now: "2026-11-04T10:00:00.000Z" });
  writeFileSync(join(root, REPORT_REL("km")), report);
  writeFileSync(
    join(root, MESSAGES_REL),
    "# Loop messages\n\nheader text\n" +
      msg("legacy escalation") +
      msg("km ruling", messageTag({ project: "km", at: "2026-11-04T09:00:00.000Z" })) +
      msg("other project stop", messageTag({ project: "notes", at: "2026-11-05T09:00:00.000Z" }))
  );
  return root;
}

test("the tag is hidden from the title and read back", () => {
  const [m] = parseLoopMessages(msg("Escalation — failed", messageTag({ project: "km", at: "2026-11-04T09:00:00.000Z" })));
  assert.equal(m.title, "Escalation — failed");
  assert.equal(m.project, "km");
  assert.equal(m.at, "2026-11-04T09:00:00.000Z");
  assert.equal(m.text, "body of Escalation — failed");
});

test("a done run: the report and its project's messages move to the archive; another project's stay", async () => {
  const root = folder();
  try {
    const r = await retireLoopFiles(root, "km", { now: new Date("2026-11-23T08:00:00Z") });
    assert.equal(r.report, `${ARCHIVE_REL}/loop-report-km-2026-11-23.md`);
    assert.equal(r.messages, 2, "the km message and the untagged one from before tags existed");
    assert.equal(existsSync(join(root, REPORT_REL("km"))), false);
    assert.match(readFileSync(join(root, r.report), "utf8"), /# Loop report: km/);
    const left = readFileSync(join(root, MESSAGES_REL), "utf8");
    assert.match(left, /^# Loop messages\n\nheader text\n/);
    assert.deepEqual(parseLoopMessages(left).map((m) => m.title), ["other project stop"]);
    const archived = readFileSync(join(root, r.messagesArchive), "utf8");
    assert.deepEqual(parseLoopMessages(archived).map((m) => m.title), ["legacy escalation", "km ruling"]);
    // A second retirement on the same day never overwrites the first.
    writeFileSync(join(root, REPORT_REL("km")), renderStackReport({ project: "km", entries: [], now: "2026-11-23T09:00:00.000Z" }));
    const again = await retireLoopFiles(root, "km", { now: new Date("2026-11-23T10:00:00Z") });
    assert.equal(again.report, `${ARCHIVE_REL}/loop-report-km-2026-11-23-2.md`);
    assert.equal(readdirSync(join(root, ARCHIVE_REL)).length, 3);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("a run that stopped keeps its report and messages: its escalation is still open", async () => {
  const root = folder({ stop: { status: "failed", item: "b" } });
  try {
    const r = await retireLoopFiles(root, "km", { now: new Date("2026-11-23T08:00:00Z") });
    assert.equal(r.report, null);
    assert.equal(r.messages, 0);
    assert.equal(existsSync(join(root, REPORT_REL("km"))), true);
    assert.equal(parseLoopMessages(readFileSync(join(root, MESSAGES_REL), "utf8")).length, 3);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("while another loop runs, the report moves but the messages file is not rewritten", async () => {
  const root = folder();
  try {
    const r = await retireLoopFiles(root, "km", { now: new Date("2026-11-23T08:00:00Z"), messages: false });
    assert.equal(r.report, `${ARCHIVE_REL}/loop-report-km-2026-11-23.md`);
    assert.equal(r.messages, 0);
    assert.equal(parseLoopMessages(readFileSync(join(root, MESSAGES_REL), "utf8")).length, 3);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("the archive is hidden from git like the files it holds", () => {
  assert.ok(OWNER_EXCLUDES.includes(`${ARCHIVE_REL}/`));
});
