---
name: abs-zalo-bot
description: Use when connecting an AI agent to Zalo — official OA adapter or personal QR bridge, listing groups and users, reading recent messages, or exposing Zalo tools over MCP.
triggers:
  - Zalo
  - Zalo OA
  - Zalo group
  - Zalo MCP
  - zalo_status
---

# Zalo channel adapter

Two adapters kept separate on purpose:

- **Zalo OA** — official API, for customer-facing work.
- **Zalo personal QR** — unofficial, your own account only, internal or demo use.

Read `AGENTS.md` before changing anything.

## Run

```bash
npm ci
npm run doctor
npm start          # daemon on :3871
npm run mcp        # stdio MCP facade
```

## MCP tools

`zalo_status` · `zalo_list_groups` · `zalo_list_users` · `zalo_group_members` ·
`zalo_recent_messages` · `zalo_corpus_summary` · `zalo_backfill` ·
`zalo_ask_destination` · `zalo_refresh_discovery`

All read-oriented. Sending is fail-closed: `draft_first` plus an empty recipient
allowlist, so nothing leaves the machine until a human approves it.

## Limits worth knowing

Personal QR runs on `zca-js`: one listener per account, fragile session, and a real
risk of the account being locked. Treat it as internal tooling, not a product surface.
