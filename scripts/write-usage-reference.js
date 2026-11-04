#!/usr/bin/env node
// Regenerate the reference part of docs/Using-Carja.md from src/usage.js.
// test/usage-reference.test.js fails when the page and the source differ.
import { readFileSync, writeFileSync } from "node:fs";
import { renderReference, REFERENCE_START, REFERENCE_END } from "../src/usage.js";

const path = new URL("../docs/Using-Carja.md", import.meta.url);
const page = readFileSync(path, "utf8");
const start = page.indexOf(REFERENCE_START);
const end = page.indexOf(REFERENCE_END);
if (start < 0 || end < start) throw new Error("docs/Using-Carja.md has no usage-reference markers");
writeFileSync(path, `${page.slice(0, start + REFERENCE_START.length)}\n\n${renderReference()}\n${page.slice(end)}`);
console.log("docs/Using-Carja.md: reference regenerated");
