// test/project-card.test.js
//
// The project card (docs/roadmap/Agents-MD-Project-Card.md §5): code writes the
// facts (Stack, Commands, Layout, the area list), an agent writes Purpose,
// Conventions and one line per area, and `check` enforces shape, size and that
// the facts were not edited, then stamps a hash per source so `status` can say
// which source changed. Pure functions here; the IO lives in the command.

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  renderFacts,
  buildCard,
  parseCard,
  checkCard,
  stampCard,
  staleSources,
  CARD_LIMIT_BYTES,
} from "../src/project-card.js";

const FACTS = {
  codeRoots: ["."],
  languages: [{ lang: "py", files: 120 }, { lang: "ts", files: 80 }],
  frameworks: ["fastapi", "react", "vite"],
  manifests: ["requirements.txt", "client/package.json"],
  commands: [
    { what: "verify", cmd: "pytest -q && cd client && npm test" },
    { what: "test", cmd: "cd client && npm run test" },
  ],
  layout: [{ dir: "app", files: 90 }, { dir: "client", files: 85 }, { dir: "tests", files: 40 }],
  areas: ["carja/3-product-areas/billing/", "carja/3-product-areas/auth/"],
};

test("buildCard on a first run: facts filled, agent sections marked TODO, status draft", () => {
  const card = buildCard({ facts: FACTS, previous: null });
  assert.match(card, /status=draft/);
  for (const h of ["### Purpose", "### Stack", "### Commands", "### Layout", "### Conventions", "### Product areas", "### Read more"]) {
    assert.ok(card.includes(h), h);
  }
  assert.ok(card.indexOf("### Purpose") < card.indexOf("### Stack"));
  assert.match(card, /py \(120 files\), ts \(80 files\)/);
  assert.match(buildCard({ facts: { ...FACTS, languages: [{ lang: "ts", files: 1 }] }, previous: null }), /ts \(1 file\)/);
  assert.match(card, /`pytest -q && cd client && npm test`/);
  assert.match(card, /- `carja\/3-product-areas\/billing\/` — TODO/);
  assert.match(card, /### Purpose\n\nTODO/);
});

test("buildCard on a refresh keeps the agent's text and regenerates the facts", () => {
  const first = buildCard({ facts: FACTS, previous: null })
    .replace("### Purpose\n\nTODO: 2–3 sentences: what the product is and for whom.", "### Purpose\n\nInvoicing for small agencies.")
    .replace("### Conventions\n\nTODO: up to 5 bullets that change how code is written.", "### Conventions\n\n- Services never import routers.")
    .replace("`carja/3-product-areas/billing/` — TODO", "`carja/3-product-areas/billing/` — Invoices and payments");
  const facts2 = { ...FACTS, layout: [...FACTS.layout, { dir: "scripts", files: 3 }] };
  const second = buildCard({ facts: facts2, previous: parseCard(first) });
  assert.match(second, /Invoicing for small agencies\./);
  assert.match(second, /Services never import routers\./);
  assert.match(second, /billing\/` — Invoices and payments/);
  assert.match(second, /`scripts\/` — 3 files/);
  assert.match(second, /auth\/` — TODO/);
});

test("checkCard: a draft with TODOs fails and names them", () => {
  const r = checkCard(buildCard({ facts: FACTS, previous: null }), FACTS);
  assert.equal(r.ok, false);
  assert.ok(r.problems.some((p) => /TODO/.test(p)));
});

function filled() {
  return buildCard({ facts: FACTS, previous: null })
    .replace(/### Purpose\n\nTODO[^\n]*/, "### Purpose\n\nInvoicing for small agencies.")
    .replace(/### Conventions\n\nTODO[^\n]*/, "### Conventions\n\n- Services never import routers.")
    .replace(/billing\/` — TODO[^\n]*/, "billing/` — Invoices and payments")
    .replace(/auth\/` — TODO[^\n]*/, "auth/` — Login and roles");
}

test("checkCard: a filled card passes", () => {
  const r = checkCard(filled(), FACTS);
  assert.deepEqual(r.problems, []);
  assert.equal(r.ok, true);
});

test("checkCard: an edited fact, a missing heading, too many conventions, too big — each fails", () => {
  assert.match(checkCard(filled().replace("pytest -q", "pytest -x"), FACTS).problems.join(), /Commands.*generated/);
  assert.match(checkCard(filled().replace("### Layout", "### Folders"), FACTS).problems.join(), /Layout/);
  const six = "### Conventions\n\n" + Array.from({ length: 6 }, (_, i) => `- rule ${i}`).join("\n");
  assert.match(checkCard(filled().replace("### Conventions\n\n- Services never import routers.", six), FACTS).problems.join(), /at most 5/);
  const big = filled().replace("Invoicing for small agencies.", "x".repeat(CARD_LIMIT_BYTES));
  assert.match(checkCard(big, FACTS).problems.join(), /bytes/);
});

test("stampCard sets status ok and records one hash per source; staleSources names what changed", () => {
  const sources = { "carja/0-compass/north-star.md": "A", "requirements.txt": "flask" };
  const stamped = stampCard(filled(), sources);
  assert.match(stamped, /status=ok/);
  assert.deepEqual(staleSources(stamped, sources), []);
  assert.deepEqual(staleSources(stamped, { ...sources, "requirements.txt": "fastapi" }), ["requirements.txt"]);
  assert.deepEqual(staleSources(stamped, { ...sources, "new.md": "x" }), ["new.md"]);
  assert.equal(staleSources(buildCard({ facts: FACTS, previous: null }), sources), null, "a draft has no stamp");
});

test("renderFacts is what the agent reads: the code sections only", () => {
  const md = renderFacts(FACTS);
  assert.match(md, /### Stack/);
  assert.doesNotMatch(md, /### Purpose/);
});
