// src/review/server.js
//
// The loopback server behind `carja review` (F4, slice 1).
//
// The agent blocks on one call; the human opens a page, reads, and decides;
// the call returns their verdict as JSON. That is the whole contract.
//
// Deliberately NOT a detached daemon. ECC runs a shared background server on a
// fixed port keyed by artifact path, which buys "feedback survives an
// interrupted await" at the cost of a port registry, a queue and a lifecycle
// nobody owns. Slice 1 keeps the server inside the waiting process: one
// artifact, one wait, ephemeral port. The agent runs it as a background Bash
// call and reads the JSON when it exits.
//
// Slice 2 removed the sharp edge that choice had. Every record is appended to
// a per-artifact queue (./store.js) before the response is sent, and a re-run
// replays it — so an interrupted wait costs the human a re-run, not their
// words. The page is still live only while the command runs; what changed is
// that clicking into a dead server is no longer silently lost.

import { createServer } from "node:http";
import { isLoopbackRequest, normalizeFeedback, summariseFeedback, renderReviewPage, contentHash } from "./canvas.js";
import { loadPending, appendPending, clearPending } from "./store.js";

const MAX_BODY_BYTES = 64 * 1024;

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on("data", (c) => {
      size += c.length;
      // A review page has no reason to receive a large body, and an unbounded
      // read is a way to take the process down from a page the human has open.
      if (size > MAX_BODY_BYTES) {
        reject(new Error("body too large"));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

function send(res, status, type, body) {
  res.writeHead(status, {
    "content-type": type,
    // This page can approve work; nothing should frame it or sniff it.
    "x-content-type-options": "nosniff",
    "content-security-policy": "default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; frame-ancestors 'none'",
    "cache-control": "no-store",
  });
  res.end(body);
}

/**
 * Start a review server for one artifact.
 *
 * @returns {Promise<{url:string, port:number, feedback:Array, waitForVerdict:()=>Promise<object>, close:()=>Promise<void>}>}
 */
export async function createReviewServer({
  markdown, title, artifactPath, host = "127.0.0.1", port = 0, home = undefined, replay = true,
}) {
  const page = renderReviewPage({ markdown, title, artifactPath });
  const doc = contentHash(markdown);
  // Anything said while an earlier wait was dying is still the human's input
  // — but a VERDICT only counts for the text it was given on. Comments and
  // annotations from an earlier version are kept (they are still the human's
  // words, and the agent needs them); a verdict for different text is dropped,
  // or an approval of v1 would approve a v2 nobody read.
  const queued = replay ? await loadPending(artifactPath, home) : [];
  const feedback = queued.filter((f) => f?.kind !== "verdict" || f?.doc === doc);
  let resolveVerdict;
  const verdictReached = new Promise((resolve) => {
    resolveVerdict = resolve;
  });

  const server = createServer(async (req, res) => {
    // Every route, including the page: a rebound origin must not even read it.
    if (!isLoopbackRequest(req)) {
      send(res, 403, "text/plain; charset=utf-8", "forbidden");
      return;
    }

    const url = new URL(req.url ?? "/", `http://${req.headers.host}`);

    if (req.method === "GET" && (url.pathname === "/" || url.pathname === "/index.html")) {
      send(res, 200, "text/html; charset=utf-8", page);
      return;
    }

    if (req.method === "GET" && url.pathname === "/api/state") {
      send(res, 200, "application/json", JSON.stringify(summariseFeedback(feedback)));
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/feedback") {
      // Only JSON. A cross-site page can send JSON only after a CORS
      // preflight, which this server never grants — so this closes the
      // no-preflight "simple request" route independently of the Origin check.
      const type = String(req.headers["content-type"] ?? "").split(";")[0].trim().toLowerCase();
      if (type !== "application/json") {
        send(res, 415, "application/json", JSON.stringify({ error: "application/json required" }));
        return;
      }
      let record;
      try {
        record = normalizeFeedback(JSON.parse(await readBody(req)));
      } catch {
        send(res, 400, "application/json", JSON.stringify({ error: "unreadable body" }));
        return;
      }
      if (!record) {
        // An unrecognised verdict is refused rather than coerced — see canvas.js.
        send(res, 400, "application/json", JSON.stringify({ error: "not a feedback record" }));
        return;
      }
      // Stamp the document version, so a replay can tell which text a verdict
      // was given on.
      record.doc = doc;
      feedback.push(record);
      // Durable BEFORE the response: a crash between the two would otherwise
      // lose exactly the record the human just watched succeed.
      await appendPending(artifactPath, record, home);
      const summary = summariseFeedback(feedback);
      send(res, 200, "application/json", JSON.stringify(summary));
      // A comment is not a decision: only a verdict ends the agent's wait.
      if (summary.done) {
        // The verdict is about to reach the agent, so the queue has done its
        // job. Clearing here — not on close — means an abandoned review keeps
        // its queue for the next run.
        await clearPending(artifactPath, home);
        resolveVerdict(summary);
      }
      return;
    }

    send(res, 404, "text/plain; charset=utf-8", "not found");
  });

  // A replayed queue can already contain the verdict: the human decided, and
  // the process died before the agent read it. Honour it rather than asking
  // them to click twice.
  const replayed = summariseFeedback(feedback);
  if (replayed.done) {
    await clearPending(artifactPath, home);
    resolveVerdict(replayed);
  }

  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, host, resolve);
  });

  const actual = server.address();
  return {
    url: `http://${host}:${actual.port}/`,
    port: actual.port,
    feedback,
    waitForVerdict: () => verdictReached,
    close: () =>
      new Promise((resolve) => {
        server.closeAllConnections?.();
        server.close(() => resolve());
      }),
  };
}
