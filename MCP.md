# ABS Zalo MCP Architecture & Battle Notes

## Architecture Overview

```
   ┌────────────────────────────────────────────────────────┐
   │         Hermes Agent / Claude Code / Codex CLI         │
   └───────────────────────────┬────────────────────────────┘
                               │ (MCP Protocol via stdio)
   ┌───────────────────────────▼────────────────────────────┐
   │                  mcp/server.js                         │
   │           (ABS Zalo MCP Facade - 15+ Tools)            │
   └───────────────────────────┬────────────────────────────┘
                               │ (HTTP localhost:3871)
   ┌───────────────────────────▼────────────────────────────┐
   │                  ABS Zalo Daemon Server                │
   │    ┌─────────────────┬─────────────────┬───────────┐   │
   │    │  Policy Guard   │  Corpus SQLite  │  REST API │   │
   │    │  (RBAC/Safety)  │  (Multi-Tenant) │  (Express)│   │
   │    └─────────────────┴─────────────────┴───────────┘   │
   └───────────────────────────┬────────────────────────────┘
                               │
                ┌──────────────┴──────────────┐
                ▼                             ▼
       Zalo Personal Engine              Zalo OA Adapter
       (zca-js Core Daemon)             (Official Webhook)
```

## Available MCP Tools

All tools are prefixed with `abs_zalo_*` (with backward-compatible aliases for legacy scripts):

- `abs_zalo_status`: Query bridge and connection health.
- `abs_zalo_list_groups` & `abs_zalo_list_all_groups`: List configured and live joined groups.
- `abs_zalo_recent_messages` & `abs_zalo_corpus_summary`: Fetch stored messages and aggregated telemetry.
- `abs_zalo_kick_member`: Kick members from groups (Admin/Owner).
- `abs_zalo_transfer_owner`: Transfer group ownership.
- `abs_zalo_add_deputy` & `abs_zalo_remove_deputy`: Manage group admins.
- `abs_zalo_invite_member`: Invite users into groups.
- `abs_zalo_create_poll` & `abs_zalo_lock_poll`: Interactive polling capabilities.
- `abs_zalo_react_message` & `abs_zalo_undo_message`: Reactions and message retraction.
- `abs_zalo_get_user_info`, `abs_zalo_get_group_info`, `abs_zalo_find_user`, `abs_zalo_list_friends`: Deep user and group intelligence.

## Hermes MCP Registration

Add to `~/.hermes/config.yaml`:

```yaml
mcpServers:
  abs-zalo:
    command: node
    args:
      - /path/to/abs-zalo-bot/mcp/server.js
    env:
      ZALO_BRIDGE_URL: http://127.0.0.1:3871
```
