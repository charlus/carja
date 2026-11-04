// test/loop-deps.test.js
//
// I4, the dependency gate (owner, 2026-10-23): "Not only PyPI, any package
// repo. Carja works with any language and package manager." The agent never
// reaches a registry. After a beat the driver reads what changed in the
// manifests; a dependency the approved Technical Vision names is checked against
// the registry (exists, old enough, not yanked, pinned, no known vulnerability)
// and installed outside the sandbox; any other is a one-way door for the owner.
// Here: the pure part, with the registry stubbed. Live check at the end, skipped
// unless CARJA_LIVE_REGISTRY=1.

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  manifestKind,
  parseManifest,
  dependencyChanges,
  namedInVision,
  checkPackage,
  dependencyRound,
  approvalsFromRound,
  REGISTRY_HOSTS,
} from "../src/loop/deps.js";

test("each ecosystem's manifest is recognised, lockfiles are not, and an unknown manifest is flagged", () => {
  assert.equal(manifestKind("package.json")?.key, "npm");
  assert.equal(manifestKind("client/package.json")?.key, "npm");
  assert.equal(manifestKind("requirements.txt")?.key, "pypi");
  assert.equal(manifestKind("requirements-dev.txt")?.key, "pypi");
  assert.equal(manifestKind("backend/pyproject.toml")?.key, "pypi");
  assert.equal(manifestKind("go.mod")?.key, "go");
  assert.equal(manifestKind("Cargo.toml")?.key, "cargo");
  assert.equal(manifestKind("pom.xml")?.key, "maven");
  assert.equal(manifestKind("app/build.gradle.kts")?.key, "maven");
  assert.equal(manifestKind("Gemfile")?.key, "rubygems");
  assert.equal(manifestKind("composer.json")?.key, "composer");
  assert.equal(manifestKind("src/App/App.csproj")?.key, "nuget");
  for (const lock of ["package-lock.json", "yarn.lock", "pnpm-lock.yaml", "poetry.lock", "uv.lock", "Cargo.lock", "go.sum", "Gemfile.lock", "composer.lock"]) {
    assert.equal(manifestKind(lock)?.lockfile, true, lock);
  }
  assert.equal(manifestKind("Pipfile")?.unparsed, true);
  assert.equal(manifestKind("pubspec.yaml")?.unparsed, true);
  assert.equal(manifestKind("src/app.py"), null);
});

test("the parsers read each manifest's dependencies", () => {
  const npm = parseManifest("package.json", JSON.stringify({ dependencies: { left: "1.2.3" }, devDependencies: { right: "^2.0.0" } }));
  assert.deepEqual([...npm], [["left", "1.2.3"], ["right", "^2.0.0"]]);
  const req = parseManifest("requirements.txt", "# comment\nholidays==0.58  # BE and TN\nFlask[async]>=3.0 ; python_version>'3.9'\n-r base.txt\n-e .\nhttps://x/y.whl\n");
  assert.deepEqual([...req], [["holidays", "==0.58"], ["flask", ">=3.0"]]);
  const pyproject = parseManifest(
    "pyproject.toml",
    '[project]\nname = "app"\ndependencies = [\n  "holidays==0.58",\n  "requests>=2",\n]\n\n[project.optional-dependencies]\ndev = ["pytest==8.3.3"]\n\n[tool.poetry.dependencies]\npython = "^3.11"\nrich = "13.9.4"\nhttpx = { version = "0.27.2", extras = ["http2"] }\n'
  );
  assert.deepEqual(Object.fromEntries(pyproject), { holidays: "==0.58", requests: ">=2", pytest: "==8.3.3", rich: "13.9.4", httpx: "0.27.2" });
  const gomod = parseManifest("go.mod", "module x\n\ngo 1.22\n\nrequire github.com/google/uuid v1.6.0\n\nrequire (\n\tgolang.org/x/text v0.14.0 // indirect\n)\n");
  assert.deepEqual(Object.fromEntries(gomod), { "github.com/google/uuid": "v1.6.0", "golang.org/x/text": "v0.14.0" });
  const cargo = parseManifest("Cargo.toml", '[package]\nname="x"\nversion="0.1.0"\n\n[dependencies]\nserde = "=1.0.210"\ntokio = { version = "1.40", features = ["full"] }\n\n[dev-dependencies.proptest]\nversion = "1.5.0"\n');
  assert.deepEqual(Object.fromEntries(cargo), { serde: "=1.0.210", tokio: "1.40", proptest: "1.5.0" });
  const pom = parseManifest("pom.xml", "<project><version>9</version><dependencies><dependency><groupId>com.google.guava</groupId><artifactId>guava</artifactId><version>33.3.1-jre</version></dependency></dependencies></project>");
  assert.deepEqual(Object.fromEntries(pom), { "com.google.guava:guava": "33.3.1-jre" });
  const gradle = parseManifest("build.gradle.kts", 'dependencies {\n  implementation("com.squareup.okhttp3:okhttp:4.12.0")\n  testImplementation \'junit:junit:4.13.2\'\n}\n');
  assert.deepEqual(Object.fromEntries(gradle), { "com.squareup.okhttp3:okhttp": "4.12.0", "junit:junit": "4.13.2" });
  const gem = parseManifest("Gemfile", "source 'https://rubygems.org'\ngem 'rails', '7.2.1'\ngem \"puma\"\n");
  assert.deepEqual(Object.fromEntries(gem), { rails: "7.2.1", puma: "" });
  const composer = parseManifest("composer.json", JSON.stringify({ require: { php: ">=8.2", "ext-json": "*", "monolog/monolog": "3.7.0" } }));
  assert.deepEqual(Object.fromEntries(composer), { "monolog/monolog": "3.7.0" });
  const csproj = parseManifest("App.csproj", '<Project><ItemGroup><PackageReference Include="Newtonsoft.Json" Version="13.0.3" /></ItemGroup></Project>');
  assert.deepEqual(Object.fromEntries(csproj), { "Newtonsoft.Json": "13.0.3" });
});

test("the changes: an added or re-versioned dependency, never a removed one; an unknown manifest is reported", () => {
  const changes = dependencyChanges([
    { path: "requirements.txt", before: "flask==3.0.0\n", after: "flask==3.0.3\nholidays==0.58\n" },
    { path: "package.json", before: JSON.stringify({ dependencies: { a: "1.0.0", gone: "2.0.0" } }), after: JSON.stringify({ dependencies: { a: "1.0.0" } }) },
    { path: "package-lock.json", before: "{}", after: '{"x":1}' },
    { path: "Pipfile", before: "", after: "[packages]\nx = '*'\n" },
  ]);
  assert.deepEqual(
    changes.deps.map((d) => `${d.ecosystem} ${d.name} ${d.spec} ${d.change}`),
    ["pypi flask ==3.0.3 changed", "pypi holidays ==0.58 added"]
  );
  assert.deepEqual(changes.unrecognised, ["Pipfile"]);
});

test("the Technical Vision names a dependency by its name, as a word", () => {
  const tv = "We use `holidays` for BE and TN public holidays. Charts: Recharts. JVM: com.google.guava:guava. Go: github.com/google/uuid.";
  assert.equal(namedInVision(tv, { ecosystem: "pypi", name: "holidays" }), true);
  assert.equal(namedInVision(tv, { ecosystem: "npm", name: "recharts" }), true);
  assert.equal(namedInVision(tv, { ecosystem: "maven", name: "com.google.guava:guava" }), true);
  assert.equal(namedInVision(tv, { ecosystem: "go", name: "github.com/google/uuid" }), true);
  assert.equal(namedInVision(tv, { ecosystem: "pypi", name: "holiday" }), false, "a word, not a part of one");
  assert.equal(namedInVision(tv, { ecosystem: "npm", name: "lodash" }), false);
  assert.equal(namedInVision("", { ecosystem: "npm", name: "lodash" }), false);
});

// A registry stub: deps.dev and OSV answers by URL.
function stubFetch(routes) {
  const calls = [];
  const fetch = async (url, opts = {}) => {
    calls.push({ url, body: opts.body ?? null });
    for (const [match, reply] of routes) {
      if (url.includes(match) && (!reply.body || (opts.body ?? "").includes(reply.body))) {
        if (reply.throw) throw new Error("network down");
        return { ok: reply.status === undefined || reply.status < 400, status: reply.status ?? 200, json: async () => reply.json ?? {} };
      }
    }
    return { ok: false, status: 404, json: async () => ({}) };
  };
  return { fetch, calls };
}
const NOW = Date.parse("2026-10-23T08:00:00Z");

test("a pinned, old, clean, existing version passes", async () => {
  const { fetch, calls } = stubFetch([
    ["api.deps.dev/v3/systems/pypi/packages/holidays/versions/0.58", { json: { publishedAt: "2024-10-07T17:47:46Z", isDeprecated: false } }],
    ["api.osv.dev", { json: {} }],
  ]);
  const r = await checkPackage({ ecosystem: "pypi", name: "holidays", spec: "==0.58" }, { fetch, now: NOW, minAgeDays: 7 });
  assert.equal(r.ok, true, r.reasons.join("; "));
  assert.equal(r.facts.version, "0.58");
  assert.equal(r.facts.ageDays > 700, true);
  assert.match(r.facts.link, /pypi\.org\/project\/holidays\/0\.58/);
  assert.ok(calls.some((c) => c.url.includes("api.osv.dev") && JSON.parse(c.body).package.ecosystem === "PyPI"));
});

test("each check that fails says why in plain words", async () => {
  const cases = [
    [{ ecosystem: "npm", name: "left", spec: "^1.2.3" }, [], /not pinned to one version/],
    [{ ecosystem: "npm", name: "ghost-pkg", spec: "1.0.0" }, [], /does not exist on the registry/],
    [{ ecosystem: "npm", name: "fresh", spec: "1.0.0" }, [["deps.dev/v3/systems/npm/packages/fresh/versions/1.0.0", { json: { publishedAt: "2026-10-21T00:00:00Z" } }], ["api.osv.dev", { json: {} }]], /published 2 days ago/],
    [{ ecosystem: "pypi", name: "requests", spec: "==2.32.0" }, [["deps.dev/v3/systems/pypi/packages/requests/versions/2.32.0", { json: { publishedAt: "2024-05-20T16:08:19Z", isDeprecated: true, deprecatedReason: "Yanked due to conflicts" } }], ["api.osv.dev", { json: {} }]], /yanked or deprecated: Yanked due to conflicts/],
    [{ ecosystem: "npm", name: "lodash", spec: "4.17.20" }, [["deps.dev/v3/systems/npm/packages/lodash/versions/4.17.20", { json: { publishedAt: "2020-08-13T16:53:54Z" } }], ["api.osv.dev", { json: { vulns: [{ id: "GHSA-29mw-wpgm-hmr9" }, { id: "GHSA-35jh-r3h4-6jhm" }] } }]], /2 known vulnerabilities \(GHSA-29mw-wpgm-hmr9, GHSA-35jh-r3h4-6jhm\)/],
    [{ ecosystem: "npm", name: "gitdep", spec: "github:someone/repo" }, [], /not a registry version/],
  ];
  for (const [dep, routes, why] of cases) {
    const { fetch } = stubFetch(routes);
    const r = await checkPackage(dep, { fetch, now: NOW, minAgeDays: 7 });
    assert.equal(r.ok, false, dep.name);
    assert.match(r.reasons.join("; "), why, dep.name);
  }
});

test("the gate fails closed when the registry or OSV cannot be reached", async () => {
  const down = stubFetch([["api.deps.dev", { throw: true }]]);
  const r = await checkPackage({ ecosystem: "npm", name: "left", spec: "1.2.3" }, { fetch: down.fetch, now: NOW, minAgeDays: 7 });
  assert.equal(r.ok, false);
  assert.equal(r.unreachable, true);
  assert.match(r.reasons[0], /could not reach/);
  const osvDown = stubFetch([["deps.dev/v3/systems/npm/packages/left/versions/1.2.3", { json: { publishedAt: "2020-01-01T00:00:00Z" } }], ["api.osv.dev", { status: 503 }]]);
  const r2 = await checkPackage({ ecosystem: "npm", name: "left", spec: "1.2.3" }, { fetch: osvDown.fetch, now: NOW, minAgeDays: 7 });
  assert.equal(r2.ok, false);
  assert.equal(r2.unreachable, true);
});

test("Composer packages are checked on Packagist, since deps.dev does not cover them", async () => {
  const { fetch } = stubFetch([
    ["repo.packagist.org/p2/monolog/monolog.json", { json: { packages: { "monolog/monolog": [{ version: "3.7.0", time: "2024-06-28T09:40:51+00:00" }] } } }],
    ["api.osv.dev", { json: {} }],
  ]);
  const r = await checkPackage({ ecosystem: "composer", name: "monolog/monolog", spec: "3.7.0" }, { fetch, now: NOW, minAgeDays: 7 });
  assert.equal(r.ok, true, r.reasons.join("; "));
});

test("an unnamed dependency becomes a question round the round checker accepts, and the answer is read back", async () => {
  const { parseRound, checkRound } = await import("../src/loop/questions.js");
  const text = dependencyRound("slice:cop/03-count", [
    { dep: { ecosystem: "pypi", name: "holidays", spec: "==0.58", file: "requirements.txt" }, check: { ok: true, reasons: [], facts: { version: "0.58", ageDays: 745, link: "https://pypi.org/project/holidays/0.58/", vulns: [] } } },
    { dep: { ecosystem: "npm", name: "left", spec: "^1.0.0", file: "client/package.json" }, check: { ok: false, reasons: ["not pinned to one version (^1.0.0)"], facts: { link: "https://www.npmjs.com/package/left" } } },
  ]);
  const round = parseRound(text);
  assert.equal(checkRound(round).ok, true, checkRound(round).reasons.join("; "));
  assert.equal(round.questions.length, 2);
  assert.match(text, /## Q1\. New dependency: pypi holidays/);
  assert.match(text, /pypi\.org\/project\/holidays\/0\.58/);
  assert.match(text, /\*\*Recommendation:\*\* 1/);
  assert.match(text, /## Q2\. New dependency: npm left[\s\S]*\*\*Recommendation:\*\* 2/);
  const answered = text.replace(/Answer:\n/, "Answer: 1\n").replace(/Answer:\n/, "Answer: your pick\n");
  assert.deepEqual(approvalsFromRound(answered), { approved: ["pypi holidays"], refused: ["npm left"] });
});

test("registry hosts are known, so the loop config can refuse to open them to the agent", () => {
  for (const h of ["pypi.org", "files.pythonhosted.org", "registry.npmjs.org", "*.npmjs.org", "crates.io", "proxy.golang.org", "repo1.maven.org", "rubygems.org", "repo.packagist.org", "api.nuget.org", "registry.yarnpkg.com"]) {
    assert.ok(REGISTRY_HOSTS.some((re) => re.test(h)), h);
  }
  assert.equal(REGISTRY_HOSTS.some((re) => re.test("code.euranova.eu")), false);
});

test("live: the real deps.dev and OSV answer for a known package and a known-vulnerable version", { skip: process.env.CARJA_LIVE_REGISTRY !== "1" }, async () => {
  const ok = await checkPackage({ ecosystem: "pypi", name: "holidays", spec: "==0.58" }, { now: Date.now(), minAgeDays: 7 });
  assert.equal(ok.ok, true, ok.reasons.join("; "));
  const bad = await checkPackage({ ecosystem: "npm", name: "lodash", spec: "4.17.20" }, { now: Date.now(), minAgeDays: 7 });
  assert.equal(bad.ok, false);
  assert.match(bad.reasons.join("; "), /known vulnerabilit/);
  const ghost = await checkPackage({ ecosystem: "pypi", name: "surely-not-a-real-pkg-zz9", spec: "==1.0.0" }, { now: Date.now(), minAgeDays: 7 });
  assert.match(ghost.reasons.join("; "), /does not exist/);
});
