// src/commands/context-bill.js
//
// `carja context-bill [dir]` — show what the framework costs an agent
// before it reads a line of project code (E2).
//
// Read-only, offline, deterministic. Ceilings live in bytes; token figures are
// an ESTIMATE with the divisor printed, never a measurement.

import { join, resolve } from "node:path";
import { buildBill, renderBill, checkBudget, captureBudget } from "../context-bill.js";
import { readFile } from "node:fs/promises";

export async function contextBillCommand(args, { cwd, stdout, stderr }) {
  // Only args[0] may be the directory. Scanning for "the first non-flag" would
  // pick up a flag's VALUE (e.g. the path after --budget).
  const positional = args[0] && !args[0].startsWith("-") ? args[0] : null;
  const agentsDir = positional
    ? join(resolve(cwd, positional), ".agents")
    : join(cwd, ".agents");

  const bill = await buildBill(agentsDir);
  if (bill.totals.alwaysOnBytes === 0 && bill.eager.length === 0) {
    stderr.write(`context-bill: nothing found under ${agentsDir}\n`);
    return 1;
  }

  if (args.includes("--json")) {
    stdout.write(`${JSON.stringify(bill, null, 2)}\n`);
    return 0;
  }
  if (args.includes("--capture")) {
    stdout.write(`${JSON.stringify(captureBudget(bill), null, 2)}\n`);
    return 0;
  }

  stdout.write(`${renderBill(bill, { top: args.includes("--all") ? 999 : 12 })}\n`);

  const budgetPath = args.includes("--budget") ? args[args.indexOf("--budget") + 1] : null;
  if (budgetPath) {
    try {
      const budget = JSON.parse(await readFile(join(cwd, budgetPath), "utf8"));
      const res = checkBudget(bill, budget);
      stdout.write(res.ok ? "\n✅ within budget\n" : `\n🛑 over budget:\n  ${res.failures.join("\n  ")}\n`);
      return res.ok ? 0 : 1;
    } catch (e) {
      stderr.write(`context-bill: could not read budget ${budgetPath} (${e.message})\n`);
      return 1;
    }
  }
  return 0;
}
