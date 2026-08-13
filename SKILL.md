---
name: abs-zalo-bot
description: Use when operating ABS Zalo Bot (Agent Business System) — Zalo channel adapter — QR personal Zalo, READ_ONLY corpus, configured destination on-demand reports, Policy Guard, Hermes tools mcp_zalo_personal_*.
triggers:
  - ABS Zalo Bot
  - Zalo channel adapter
  - Zalo Personal MCP
  - mcp_zalo_personal
  - configured destination
  - READ_ONLY_SOURCE Zalo
---

# ABS Zalo Bot — Zalo channel adapter + MCP

Adapter kênh Zalo cho agent. Hai đường tách biệt: **Zalo OA (chính thức)** và **Zalo cá nhân qua QR (không chính thức, chỉ dùng nội bộ/demo)**. Không phải core của agent nào.

## Naming

| Name | Role |
|------|------|
| Bridge | Daemon `:3871` — session, listener, corpus, Policy Guard |
| **Zalo Personal MCP** | Thin stdio facade `mcp/server.js` |
| Hermes tools | `mcp_zalo_personal_*` |

## Artifact

`./`

## Battle ops

```bash
cd /path/to/abs-zalo-bot
npm start
curl -s -X POST http://127.0.0.1:3871/api/accounts/default/connect -H 'content-type: application/json' -d '{}'
npm run smoke
# optional real send to configured destination:
BATTLE_SEND=true npm run smoke
```

Check: `GET /api/battle-ready` → `battle_ready: true`

## MCP tools

`zalo_status` · `zalo_list_groups` · `zalo_list_users` · `zalo_group_members` ·
`zalo_recent_messages` · `zalo_corpus_summary` · `zalo_backfill` ·
`zalo_ask_destination` · `zalo_refresh_discovery`

## Safety defaults

READ_ONLY_SOURCE · destination-only configured destination · no source/DM/mention reply

## Related research

- Mọi wrapper Zalo cá nhân đều dựng trên `zca-js` và chịu chung giới hạn: 1 listener mỗi tài khoản, session mong manh, có rủi ro khoá tài khoản. Xem `MCP.md` để biết đã khảo sát những gói nào.
- `minhkhoa0502/zalo-personal-mcp` → thin MCP + daemon pattern

See `MCP.md`.
