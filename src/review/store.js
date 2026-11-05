// src/review/store.js
//
// Feedback that survives an interrupted wait (F4, slice 2).
//
// Slice 1's stated cost was that the server lived inside the waiting process:
// if that process died, the human's click died with it — and from their side
// of the glass, clicking simply appeared to do nothing. That is the worst
// failure this tool can have, because it is silent and it looks like the tool
// working.
//
// So every record is appended to a per-artifact queue before the response is
// sent, and a re-run picks the queue up. NDJSON, because an append is one
// write and a half-written tail costs one record rather than the file.
//
// SAFETY NET, NOT MECHANISM. Every function here swallows its errors: losing
// the queue costs the queue, but throwing would cost the review. The store
// lives under CARJA_HOME, never in the repo — a queued comment is a
// machine-local intermediate, not a document.

import { readFile, appendFile, mkdir, rm } from "node:fs/promises";
import { createHash } from "node:crypto";
import { join, dirname } from "node:path";
import { machineHome } from "../names.js";

function storeRoot(home) {
  return join(home || machineHome(process.env), "review");
}

/** One queue file per artifact, keyed by its absolute path. */
export function pendingPathFor(artifactPath, home) {
  const key = createHash("sha256").update(String(artifactPath)).digest("hex").slice(0, 16);
  return join(storeRoot(home), `${key}.ndjson`);
}

/** Records queued for this artifact. Unreadable or corrupt → empty. */
export async function loadPending(artifactPath, home) {
  try {
    const text = await readFile(pendingPathFor(artifactPath, home), "utf8");
    const out = [];
    for (const line of text.split("\n")) {
      if (!line.trim()) continue;
      try {
        const rec = JSON.parse(line);
        if (rec && typeof rec === "object") out.push(rec);
      } catch {
        // A torn line costs that record, not the queue. Keep reading.
      }
    }
    return out;
  } catch {
    return [];
  }
}

/** Append one record. Never throws — see the header. */
export async function appendPending(artifactPath, record, home) {
  try {
    const path = pendingPathFor(artifactPath, home);
    await mkdir(dirname(path), { recursive: true });
    await appendFile(path, `${JSON.stringify(record)}\n`, "utf8");
    return true;
  } catch {
    return false;
  }
}

/** Drop the queue once a verdict has actually reached the agent. */
export async function clearPending(artifactPath, home) {
  try {
    await rm(pendingPathFor(artifactPath, home), { force: true });
    return true;
  } catch {
    return false;
  }
}
