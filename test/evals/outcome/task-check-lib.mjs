// Shared by task-check.mjs and trial.mjs: run pytest in a tree, return the
// result per test id from a junit report. The tree's .venv is the interpreter.
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";

export function pytest(dir, targets = []) {
  const xml = join(dir, ".q3-junit.xml");
  rmSync(xml, { force: true });
  spawnSync(join(dir, ".venv/bin/python"), ["-m", "pytest", "-q", "-p", "no:cacheprovider", "-o", "addopts=", `--junitxml=${xml}`, ...targets],
    { cwd: dir, encoding: "utf8", maxBuffer: 256 << 20, env: { ...process.env, PYTHONPATH: dir }, timeout: 900_000 });
  const res = {};
  if (!existsSync(xml)) return res;
  for (const m of readFileSync(xml, "utf8").matchAll(/<testcase classname="([^"]*)" name="([^"]*)"[^>]*?(\/>|>([\s\S]*?)<\/testcase>)/g)) {
    const body = m[4] || "";
    res[`${m[1]}::${m[2]}`] = /<(failure|error)\b/.test(body) ? "fail" : /<skipped\b/.test(body) ? "skip" : "pass";
  }
  return res;
}
