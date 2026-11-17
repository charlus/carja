// src/loop/deps.js
//
// I4, the dependency gate (owner, 2026-10-23). "How worried should I be of an
// hallucinated package name or a package with vulnerabilities?" and "Not only
// PyPI, any package repo." The agent never reaches a package registry: the
// sandbox does not list one, and loop.allowed_domains refuses them. After a
// beat the DRIVER reads the manifests the beat changed. A dependency the
// approved Technical Vision names is checked against its registry (it exists,
// the version is pinned, older than loop.dependency_min_age_days, not yanked,
// no known vulnerability in OSV) and installed outside the sandbox with
// loop.install. Any other dependency is a one-way door: a question round for
// the owner. A registry or OSV that cannot be reached stops the item (fail
// closed). One table per ecosystem, so another one is a row, not a rewrite.
// Pure except checkPackage, whose `fetch` is injected.

/** Hosts a beat must never reach: the gate installs, not the agent. */
import { answerAt } from "./questions.js";

export const REGISTRY_HOSTS = Object.freeze(
  [
    "pypi.org", "files.pythonhosted.org", "pypi.python.org", "test.pypi.org",
    "registry.npmjs.org", "npmjs.org", "npmjs.com", "registry.yarnpkg.com", "yarnpkg.com", "npm.pkg.github.com",
    "crates.io", "static.crates.io", "index.crates.io",
    "proxy.golang.org", "sum.golang.org",
    "repo1.maven.org", "repo.maven.apache.org", "maven.org", "plugins.gradle.org", "services.gradle.org", "jcenter.bintray.com",
    "rubygems.org", "index.rubygems.org",
    "packagist.org", "repo.packagist.org",
    "nuget.org", "api.nuget.org",
    "pub.dev", "hex.pm", "repo.hex.pm", "cocoapods.org", "cdn.cocoapods.org",
  ].map((h) => new RegExp(`^(\\*\\.)?([a-z0-9-]+\\.)*${h.replace(/\./g, "\\.")}$`, "i"))
);

const npmLike = (text, fields) => {
  const out = new Map();
  let json;
  try {
    json = JSON.parse(text || "{}");
  } catch {
    return out;
  }
  for (const f of fields) for (const [k, v] of Object.entries(json?.[f] ?? {})) out.set(k, String(v));
  return out;
};

const pyName = (n) => n.toLowerCase().replace(/[-_.]+/g, "-");

/** One PEP 508 requirement string → [name, spec] or null (URLs and options are not registry dependencies). */
function pep508(line) {
  const s = line.replace(/\s+#.*$/, "").split(";")[0].trim();
  if (!s || s.startsWith("-") || s.startsWith("#") || /^[a-z+]+:\/\//i.test(s) || s.includes(" @ ")) return null;
  const m = s.match(/^([A-Za-z0-9][A-Za-z0-9._-]*)\s*(?:\[[^\]]*\])?\s*(.*)$/);
  return m ? [pyName(m[1]), m[2].replace(/\s+/g, "")] : null;
}

/** The quoted strings of a TOML array that starts at `lines[i]`, across lines. */
function tomlArray(lines, i) {
  let text = lines[i].slice(lines[i].indexOf("[") + 1);
  let j = i;
  while (!text.includes("]") && j + 1 < lines.length) text += `\n${lines[++j]}`;
  return { items: [...text.split("]")[0].matchAll(/"([^"]*)"|'([^']*)'/g)].map((m) => m[1] ?? m[2]), end: j };
}

function parsePyproject(text) {
  const out = new Map();
  const lines = String(text ?? "").split("\n");
  let section = "";
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    const h = line.match(/^\[([^\]]+)\]$/);
    if (h) {
      section = h[1].trim();
      continue;
    }
    const kv = line.match(/^([A-Za-z0-9_.-]+|"[^"]+")\s*=\s*(.*)$/);
    if (!kv) continue;
    const key = kv[1].replace(/"/g, "");
    const arraySection = (section === "project" && key === "dependencies") || section === "project.optional-dependencies" || section === "dependency-groups";
    if (arraySection && kv[2].startsWith("[")) {
      const { items, end } = tomlArray(lines, i);
      i = end;
      for (const it of items) {
        const p = pep508(it);
        if (p) out.set(p[0], p[1]);
      }
      continue;
    }
    if (/^tool\.poetry(\.group\.[^.]+)?\.(dev-)?dependencies$/.test(section) && key !== "python") {
      const v = kv[2].match(/^"([^"]*)"|^'([^']*)'/);
      const t = kv[2].match(/version\s*=\s*"([^"]*)"/);
      if (v || t) out.set(pyName(key), (v?.[1] ?? v?.[2] ?? t[1]).replace(/\s+/g, ""));
    }
  }
  return out;
}

function parseCargo(text) {
  const out = new Map();
  const lines = String(text ?? "").split("\n");
  let section = "";
  let tableDep = null;
  const isDeps = (s) => /(^|\.)(dev-|build-)?dependencies$/.test(s);
  for (const raw of lines) {
    const line = raw.trim();
    const h = line.match(/^\[([^\]]+)\]$/);
    if (h) {
      section = h[1].trim();
      const t = section.match(/(?:^|\.)(?:dev-|build-)?dependencies\.([A-Za-z0-9_-]+)$/);
      tableDep = t ? t[1] : null;
      if (tableDep) out.set(tableDep, "");
      continue;
    }
    const kv = line.match(/^([A-Za-z0-9_-]+)\s*=\s*(.*)$/);
    if (!kv) continue;
    if (tableDep && kv[1] === "version") {
      out.set(tableDep, kv[2].replace(/^["']|["']$/g, ""));
      continue;
    }
    if (!isDeps(section)) continue;
    const v = kv[2].match(/^"([^"]*)"/);
    const t = kv[2].match(/version\s*=\s*"([^"]*)"/);
    const other = /\b(git|path)\s*=/.test(kv[2]) ? kv[2].match(/\b(git|path)\s*=\s*"([^"]*)"/) : null;
    out.set(kv[1], v?.[1] ?? t?.[1] ?? (other ? `${other[1]}:${other[2]}` : ""));
  }
  return out;
}

function parseGoMod(text) {
  const out = new Map();
  let block = false;
  for (const raw of String(text ?? "").split("\n")) {
    const line = raw.replace(/\/\/.*$/, "").trim();
    if (/^require\s*\($/.test(line)) {
      block = true;
      continue;
    }
    if (block && line === ")") {
      block = false;
      continue;
    }
    const m = block ? line.match(/^(\S+)\s+(v\S+)$/) : line.match(/^require\s+(\S+)\s+(v\S+)$/);
    if (m) out.set(m[1], m[2]);
  }
  return out;
}

function parseJvm(text, path) {
  const out = new Map();
  const s = String(text ?? "");
  if (path.endsWith(".xml")) {
    for (const d of s.matchAll(/<dependency>([\s\S]*?)<\/dependency>/g)) {
      const g = d[1].match(/<groupId>\s*([^<]+?)\s*<\/groupId>/)?.[1];
      const a = d[1].match(/<artifactId>\s*([^<]+?)\s*<\/artifactId>/)?.[1];
      const v = d[1].match(/<version>\s*([^<]+?)\s*<\/version>/)?.[1] ?? "";
      if (g && a) out.set(`${g}:${a}`, v);
    }
    return out;
  }
  const conf = "(?:implementation|api|compileOnly|runtimeOnly|testImplementation|testRuntimeOnly|testCompileOnly|annotationProcessor|kapt|ksp|classpath|compile|testCompile)";
  for (const m of s.matchAll(new RegExp(`\\b${conf}\\s*\\(?\\s*["']([^"':]+):([^"':]+)(?::([^"']+))?["']`, "g"))) out.set(`${m[1]}:${m[2]}`, m[3] ?? "");
  return out;
}

function parseGemfile(text) {
  const out = new Map();
  for (const m of String(text ?? "").matchAll(/^\s*gem\s+["']([^"']+)["']\s*(?:,\s*["']([^"']+)["'])?/gm)) out.set(m[1], m[2] ?? "");
  return out;
}

function parseComposer(text) {
  const out = npmLike(text, ["require", "require-dev"]);
  for (const k of [...out.keys()]) if (k === "php" || k.startsWith("ext-") || k.startsWith("lib-") || !k.includes("/")) out.delete(k);
  return out;
}

function parseNuget(text) {
  const out = new Map();
  for (const m of String(text ?? "").matchAll(/<Package(?:Reference|Version)\s+([^>]*)>/g)) {
    const name = m[1].match(/\bInclude\s*=\s*"([^"]+)"/)?.[1];
    if (name) out.set(name, m[1].match(/\bVersion\s*=\s*"([^"]*)"/)?.[1] ?? "");
  }
  return out;
}

function parseRequirements(text) {
  const out = new Map();
  for (const line of String(text ?? "").split("\n")) {
    const p = pep508(line);
    if (p) out.set(p[0], p[1]);
  }
  return out;
}

const NON_REGISTRY = /^(?:git(?:\+\w+)?:|github:|gitlab:|bitbucket:|file:|link:|workspace:|portal:|https?:|git@|path:|npm:)|\.git$|^\.{0,2}\//i;

/**
 * The ecosystems. `version(spec)` is the one version a pinned spec names, or
 * null; `link` is the page the owner opens; `depsdev` and `osv` name the
 * system in those services (null: not covered there).
 */
export const ECOSYSTEMS = Object.freeze([
  {
    key: "npm", osv: "npm", depsdev: "npm",
    manifests: [/(^|\/)package\.json$/],
    parse: (t) => npmLike(t, ["dependencies", "devDependencies", "optionalDependencies", "peerDependencies"]),
    version: (s) => s.match(/^=?v?(\d+\.\d+\.\d+(?:[-+][\w.+-]*)?)$/)?.[1] ?? null,
    link: (n, v) => `https://www.npmjs.com/package/${n}${v ? `/v/${v}` : ""}`,
  },
  {
    key: "pypi", osv: "PyPI", depsdev: "pypi",
    manifests: [/(^|\/)requirements[^/]*\.(txt|in)$/, /(^|\/)pyproject\.toml$/],
    parse: (t, p) => (p.endsWith(".toml") ? parsePyproject(t) : parseRequirements(t)),
    version: (s) => s.match(/^===?([\w.+!-]+)$/)?.[1] ?? s.match(/^(\d[\w.+!-]*)$/)?.[1] ?? null,
    link: (n, v) => `https://pypi.org/project/${n}/${v ? `${v}/` : ""}`,
  },
  {
    key: "go", osv: "Go", depsdev: "go",
    manifests: [/(^|\/)go\.mod$/],
    parse: parseGoMod,
    version: (s) => s.match(/^(v\d[\w.+-]*)$/)?.[1] ?? null,
    link: (n, v) => `https://pkg.go.dev/${n}${v ? `@${v}` : ""}`,
  },
  {
    key: "cargo", osv: "crates.io", depsdev: "cargo",
    manifests: [/(^|\/)Cargo\.toml$/],
    parse: parseCargo,
    // A bare "1.2.3" in Cargo.toml means ^1.2.3: only "=1.2.3" is one version.
    version: (s) => s.match(/^=\s*(\d[\w.+-]*)$/)?.[1] ?? null,
    link: (n, v) => `https://crates.io/crates/${n}${v ? `/${v}` : ""}`,
  },
  {
    key: "maven", osv: "Maven", depsdev: "maven",
    manifests: [/(^|\/)pom\.xml$/, /(^|\/)build\.gradle(\.kts)?$/],
    parse: parseJvm,
    version: (s) => s.match(/^(\d[\w.+-]*)$/)?.[1] ?? null,
    link: (n, v) => `https://central.sonatype.com/artifact/${n.replace(":", "/")}${v ? `/${v}` : ""}`,
  },
  {
    key: "rubygems", osv: "RubyGems", depsdev: "rubygems",
    manifests: [/(^|\/)Gemfile$/],
    parse: parseGemfile,
    version: (s) => s.match(/^=?\s*(\d[\w.]*)$/)?.[1] ?? null,
    link: (n, v) => `https://rubygems.org/gems/${n}${v ? `/versions/${v}` : ""}`,
  },
  {
    key: "composer", osv: "Packagist", depsdev: null,
    manifests: [/(^|\/)composer\.json$/],
    parse: parseComposer,
    version: (s) => s.match(/^v?(\d+\.\d+(?:\.\d+)?(?:[-.][\w.]+)?)$/)?.[1] ?? null,
    link: (n, v) => `https://packagist.org/packages/${n}${v ? `#${v}` : ""}`,
  },
  {
    key: "nuget", osv: "NuGet", depsdev: "nuget",
    manifests: [/\.(cs|fs|vb)proj$/, /(^|\/)Directory\.Packages\.props$/],
    parse: parseNuget,
    version: (s) => s.match(/^\[?(\d[\w.+-]*)\]?$/)?.[1] ?? null,
    link: (n, v) => `https://www.nuget.org/packages/${n}${v ? `/${v}` : ""}`,
  },
]);

/** Lockfiles follow their manifest: a change there alone adds no direct dependency. */
const LOCKFILES = [/(^|\/)(package-lock|npm-shrinkwrap)\.json$/, /(^|\/)yarn\.lock$/, /(^|\/)pnpm-lock\.yaml$/, /(^|\/)bun\.lockb?$/, /(^|\/)(poetry|uv|pdm)\.lock$/, /(^|\/)Pipfile\.lock$/, /(^|\/)Cargo\.lock$/, /(^|\/)go\.sum$/, /(^|\/)Gemfile\.lock$/, /(^|\/)composer\.lock$/, /(^|\/)packages\.lock\.json$/, /(^|\/)gradle\.lockfile$/];
/** Manifests the gate cannot read yet: a change there is a question for the owner. */
const UNPARSED = [/(^|\/)Pipfile$/, /(^|\/)setup\.(py|cfg)$/, /(^|\/)environment\.ya?ml$/, /(^|\/)build\.sbt$/, /(^|\/)mix\.exs$/, /(^|\/)pubspec\.yaml$/, /(^|\/)Package\.swift$/, /(^|\/)Podfile$/, /(^|\/)deps\.edn$/, /(^|\/)project\.clj$/, /(^|\/)rebar\.config$/, /\.gemspec$/, /(^|\/)conanfile\.(txt|py)$/, /(^|\/)vcpkg\.json$/, /(^|\/)packages\.config$/, /(^|\/)bower\.json$/, /(^|\/)deno\.jsonc?$/];

/** What a path is to the gate: an ecosystem's manifest, a lockfile, a manifest it cannot read, or nothing. */
export function manifestKind(path) {
  const p = String(path);
  if (LOCKFILES.some((re) => re.test(p))) return { lockfile: true };
  const eco = ECOSYSTEMS.find((e) => e.manifests.some((re) => re.test(p)));
  if (eco) return eco;
  if (UNPARSED.some((re) => re.test(p))) return { unparsed: true };
  return null;
}

/** The dependencies a manifest declares: Map name → spec as written. */
export function parseManifest(path, text) {
  const eco = manifestKind(path);
  return eco?.parse ? eco.parse(text, path) : new Map();
}

/**
 * What the beat added: every dependency new or with a new spec, per manifest.
 * A removed dependency needs no check. `files`: [{path, before, after}].
 * @returns {{deps: {ecosystem, name, spec, file, change}[], unrecognised: string[]}}
 */
export function dependencyChanges(files) {
  const deps = [];
  const unrecognised = [];
  for (const f of files) {
    const kind = manifestKind(f.path);
    if (!kind || kind.lockfile) continue;
    if (kind.unparsed) {
      if ((f.before ?? "") !== (f.after ?? "")) unrecognised.push(f.path);
      continue;
    }
    const before = kind.parse(f.before ?? "", f.path);
    for (const [name, spec] of kind.parse(f.after ?? "", f.path)) {
      if (!before.has(name)) deps.push({ ecosystem: kind.key, name, spec, file: f.path, change: "added" });
      else if (before.get(name) !== spec) deps.push({ ecosystem: kind.key, name, spec, file: f.path, change: "changed" });
    }
  }
  return { deps, unrecognised };
}

const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Does the approved Technical Vision name this dependency, as a word? */
export function namedInVision(visionText, { ecosystem, name }) {
  const text = String(visionText ?? "");
  if (!text.trim()) return false;
  const forms = new Set([name]);
  if (ecosystem === "pypi") {
    forms.add(name.replace(/-/g, "_"));
    forms.add(name.replace(/-/g, "."));
  }
  if (ecosystem === "maven" && name.includes(":")) forms.add(name.split(":")[1]);
  if (ecosystem === "go") {
    const parts = name.split("/");
    const last = /^v\d+$/.test(parts.at(-1)) ? parts.at(-2) : parts.at(-1);
    if (last && last.length > 2) forms.add(last);
  }
  return [...forms].some((f) => new RegExp(`(?<![\\w/.@-])${esc(f)}(?![\\w/-])`, "i").test(text));
}

const day = 86400000;

async function getJson(fetch, url, init = {}) {
  const r = await fetch(url, { ...init, signal: AbortSignal.timeout?.(20000) });
  return { status: r.status, ok: r.ok, json: r.ok ? await r.json() : null };
}

/**
 * The registry facts and the verdict for one dependency. Fails closed: when a
 * registry or OSV cannot be reached, `ok` is false and `unreachable` true.
 * @returns {Promise<{ok: boolean, unreachable?: boolean, reasons: string[], facts: object}>}
 */
export async function checkPackage(dep, { fetch = globalThis.fetch, now = Date.now(), minAgeDays = 7 } = {}) {
  const eco = ECOSYSTEMS.find((e) => e.key === dep.ecosystem);
  const spec = String(dep.spec ?? "").trim();
  const facts = { link: eco ? eco.link(dep.name, null) : null };
  if (!eco) return { ok: false, reasons: [`the ${dep.ecosystem} ecosystem is not covered by the gate`], facts };
  if (NON_REGISTRY.test(spec)) return { ok: false, reasons: [`not a registry version (${spec}): it comes from a repository or a path, which the gate cannot check`], facts };
  const version = spec ? eco.version(spec) : null;
  if (!version) return { ok: false, reasons: [`not pinned to one version (${spec || "no version"}): pin the exact version`], facts };
  facts.version = version;
  facts.link = eco.link(dep.name, version);
  const unreachable = (what) => ({ ok: false, unreachable: true, reasons: [`could not reach ${what}, so the dependency could not be checked; the gate does not let an unchecked package through`], facts });
  const reasons = [];
  try {
    let publishedAt = null;
    let deprecated = null;
    if (eco.depsdev) {
      const base = `https://api.deps.dev/v3/systems/${eco.depsdev}/packages/${encodeURIComponent(dep.name)}`;
      const v = await getJson(fetch, `${base}/versions/${encodeURIComponent(version)}`);
      if (v.status === 404) {
        const p = await getJson(fetch, base);
        if (p.status === 404) return { ok: false, reasons: [`${dep.name} does not exist on the registry: the name may be wrong or invented`], facts };
        if (!p.ok) return unreachable("deps.dev");
        return { ok: false, reasons: [`version ${version} of ${dep.name} does not exist on the registry`], facts };
      }
      if (!v.ok) return unreachable("deps.dev");
      publishedAt = v.json.publishedAt ?? null;
      if (v.json.isDeprecated) deprecated = v.json.deprecatedReason || "no reason given";
    } else {
      // Packagist (Composer): deps.dev does not cover it.
      const p = await getJson(fetch, `https://repo.packagist.org/p2/${dep.name}.json`);
      if (p.status === 404) return { ok: false, reasons: [`${dep.name} does not exist on the registry: the name may be wrong or invented`], facts };
      if (!p.ok) return unreachable("Packagist");
      const found = (p.json.packages?.[dep.name] ?? []).find((x) => String(x.version).replace(/^v/, "") === version);
      if (!found) return { ok: false, reasons: [`version ${version} of ${dep.name} does not exist on the registry`], facts };
      publishedAt = found.time ?? null;
    }
    if (publishedAt) {
      facts.publishedAt = publishedAt;
      facts.ageDays = Math.floor((now - Date.parse(publishedAt)) / day);
      if (facts.ageDays < minAgeDays) reasons.push(`version ${version} was published ${facts.ageDays} day${facts.ageDays === 1 ? "" : "s"} ago; the minimum is ${minAgeDays} days (loop.dependency_min_age_days)`);
    } else reasons.push(`the registry gives no publication date for ${version}`);
    if (deprecated) reasons.push(`version ${version} is yanked or deprecated: ${deprecated}`);
    const osv = await getJson(fetch, "https://api.osv.dev/v1/query", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ package: { name: dep.name, ecosystem: eco.osv }, version }),
    });
    if (!osv.ok) return unreachable("OSV");
    facts.vulns = (osv.json.vulns ?? []).map((v) => v.id);
    if (facts.vulns.length) reasons.push(`${facts.vulns.length} known vulnerabilit${facts.vulns.length === 1 ? "y" : "ies"} (${facts.vulns.slice(0, 5).join(", ")}${facts.vulns.length > 5 ? ", …" : ""})`);
  } catch {
    return unreachable("the registry or OSV");
  }
  return { ok: reasons.length === 0, reasons, facts };
}

const depKey = (d) => `${d.ecosystem} ${d.name}`;

/** The round of questions for dependencies the Technical Vision does not name (questions.js format). */
export function dependencyRound(taskId, items) {
  const out = [`# Questions: ${taskId} (dependencies)`, ""];
  items.forEach(({ dep, check }, i) => {
    const f = check?.facts ?? {};
    const facts = [
      f.link ? `Registry: ${f.link}` : null,
      f.version ? `version ${f.version}${f.ageDays != null ? `, published ${f.ageDays} days ago` : ""}` : null,
      f.vulns ? `known vulnerabilities: ${f.vulns.length ? f.vulns.join(", ") : "none"}` : null,
    ].filter(Boolean);
    out.push(
      `## Q${i + 1}. New dependency: ${depKey(dep)}`,
      `The slice added \`${dep.name}\` ${dep.spec ? `(${dep.spec}) ` : ""}to \`${dep.file}\`. The Technical Vision does not name it, so the loop does not add it alone: a package runs its code on every machine that installs it, and a wrong or invented name can be a malicious package.`,
      facts.length ? `${facts.join(" · ")}.` : "",
      check?.ok ? "The gate's checks passed: it exists, it is pinned, it is old enough, it is not yanked, and OSV knows no vulnerability." : `The gate's checks failed: ${(check?.reasons ?? ["not checked"]).join("; ")}.`,
      "",
      `1. Allow it — the loop installs ${dep.name}${f.version ? ` ${f.version}` : ""} and continues the slice.`,
      `2. Refuse it — the loop builds the slice without ${dep.name}.`,
      "",
      check?.ok ? "**Recommendation:** 1, because it passed every check of the gate; refuse it if you do not want this vendor in the product." : "**Recommendation:** 2, because it failed the gate's checks above.",
      "**If wrong:** an allowed package stays in the product until someone removes it; a refused one costs one rebuild of the slice without it.",
      "",
      "Answer:",
      ""
    );
  });
  return `${out.join("\n")}\n`;
}

/** Which dependencies an answered round allowed or refused, as "<ecosystem> <name>". */
export function approvalsFromRound(text) {
  const approved = [];
  const refused = [];
  const lines = String(text ?? "").split("\n");
  let current = null;
  let recommendation = null;
  for (const [i, line] of lines.entries()) {
    const q = line.match(/^## Q\d+\.\s*New dependency:\s*(\S+)\s+(.+?)\s*$/);
    if (q) {
      current = `${q[1]} ${q[2]}`;
      recommendation = null;
      continue;
    }
    if (!current) continue;
    const r = line.match(/^\*\*Recommendation:\*\*\s*(\d+)/);
    if (r) recommendation = r[1];
    if (/^Answer:/.test(line)) {
      const ans = answerAt(lines, i) ?? "";
      const n = /^your pick$/i.test(ans) ? recommendation : ans.match(/^(\d+)/)?.[1];
      if (n === "1") approved.push(current);
      else if (n === "2") refused.push(current);
      current = null;
    }
  }
  return { approved, refused };
}

export { depKey };
