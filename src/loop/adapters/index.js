// src/loop/adapters/index.js
//
// The platform-adapter registry + resolver (ADR-0001 D7, Phase 2). Adapters are
// deliberately minimal, BYO-CLI wrappers — the value is the driver's guarantees,
// not the wrapper. The driver knows nothing about any specific platform; it just
// calls `adapter.runBeat`. This module maps a platform preference (from
// `loop-state.json.platform` or a `--platform` flag) onto a concrete adapter,
// falling back to auto-detect by CLI availability.
//
// Adapter contract — every module in ADAPTERS exports:
//   name: string
//   isAvailable(): Promise<boolean>                       // is the CLI on PATH?
//   runBeat({ promptPath, cwd, permissionMode }): Promise<{ exitCode, stdout, stderr?, tokens? }>
//   runChecker(opts): Promise<...>                        // separate process (Phase 3)
//   takesModel: boolean                                   // D5: runBeat honours { model, effort }

import * as claude from "./claude.js";
import * as antigravity from "./antigravity.js";
import * as codex from "./codex.js";

export const ADAPTERS = Object.freeze({ claude, antigravity, codex });

/** Auto-detect priority order (Claude Code first — the primary target). */
export const PRIORITY = Object.freeze(["claude", "antigravity", "codex"]);

/**
 * Pure adapter selection — no IO, unit-testable.
 * @param {string|null} preference   explicit platform name, or null for auto-detect
 * @param {Record<string,boolean>} availability  name → isAvailable result
 * @param {string[]} [priority]
 * @returns {string|null} chosen adapter name, or null if none available (auto only)
 * @throws if an explicit preference is unknown or its CLI is unavailable
 */
export function pickAdapterName(preference, availability, priority = PRIORITY) {
  if (preference) {
    if (!(preference in availability)) {
      throw new Error(
        `Unknown platform '${preference}'. Known adapters: ${Object.keys(availability).join(", ")}.`
      );
    }
    if (!availability[preference]) {
      throw new Error(
        `Platform '${preference}' was selected, but its CLI is not on PATH.`
      );
    }
    return preference;
  }
  for (const n of priority) {
    if (availability[n]) return n;
  }
  return null;
}

/**
 * Resolve a concrete adapter, probing each CLI for availability (IO).
 * @param {{ platform?: string|null }} opts
 * @returns {Promise<{ name: string|null, adapter: object|null, availability: Record<string,boolean> }>}
 */
export async function resolveAdapter({ platform = null } = {}) {
  const availability = {};
  for (const [n, mod] of Object.entries(ADAPTERS)) {
    availability[n] = await mod.isAvailable();
  }
  const chosen = pickAdapterName(platform || null, availability);
  return {
    name: chosen,
    adapter: chosen ? ADAPTERS[chosen] : null,
    availability,
  };
}
