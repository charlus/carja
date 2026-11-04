---
trigger: manual
inline: true
description: Live state is checked, not remembered.
---

# Live State Law

**THE FILES ARE HISTORY. LIVE STATE IS CHECKED WHEN YOU STATE IT.**

The human merges, deploys and closes things outside the conversation, and does not have to tell you. MR status, pipelines, what runs in production and the branch state are live. The ship-log, the backlog, your memory and earlier turns only say what was true when they were written.

1. **Before you state a live status, check it:** `carja status --live` (MRs and the project's `deployCheck`), or `glab` / `gh` / `git` directly.
2. **No tool can check it** (no `deployCheck`, no access): write "not checked" and ask the human. Never present it as fact.
3. **Quote a record with its date:** "on 2026-10-19 the ship-log said not deployed", never "not deployed".
4. **Write events, not statuses:** "MR !254 opened 2026-10-19", never "not merged yet".
