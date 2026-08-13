# Zalo Personal MCP — battle-ready notes

## npm research: `n8n-nodes-zalo-user-by-noti`

- Package: community n8n nodes for **personal Zalo** via **`zca-js`**
- Features: QR login, 144 ops, realtime trigger
- Same hard limits as us:
  - unofficial API / ban risk
  - **1 listener / account**
  - cookie/session fragile
- Useful as **protocol surface map**, not as runtime for Hermes
- We do **not** depend on this package (n8n-only packaging). We share the same protocol lib idea: `zca-js`

## Cold architecture (ours)

```
Hermes Agent
  └─ MCP stdio  mcp/server.js   (tools only)
        └─ HTTP bridge :3871    (daemon + zca-js + SQLite + Policy Guard)
              └─ Zalo personal account (READ_ONLY_SOURCE)
```

Why not put zca-js inside MCP process?
- Hermes may spawn MCP per session → multi-listener collision
- Bridge is the single long-lived owner of the Zalo session

## Battle commands

```bash
cd /path/to/abs-zalo-bot
npm start
curl -s -X POST :3871/api/accounts/default/connect -H 'content-type: application/json' -d '{}'
npm test
npm run smoke
BATTLE_SEND=true npm run smoke   # sends ONE report to the configured destination
```

## Hermes MCP

Config key: `zalo-personal` in `~/.hermes/config.yaml`
Tools appear as `mcp_zalo_personal_*` after **new session**.

## Safety (shared SIM)

- READ_ONLY_SOURCE on
- outbound only to the configured destination
- no DM / mention / source replies
- history REST often 404 → rely on listener corpus
