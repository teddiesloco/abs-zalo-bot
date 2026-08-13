# ABS-Zalo-Bot — Context & Runtime Constraints

## Environment

- Node.js: >=22.5 (the current SQLite implementation uses `node:sqlite`).
- Linux VPS: Docker or systemd; local development: foreground process.
- Default timezone: UTC; convert for customer-facing reports at the edge.
- Default bind: `127.0.0.1`; public OA webhook needs HTTPS reverse proxy.

## Environment variables

```text
PORT=3871
HOST=127.0.0.1
DATA_DIR=./data
CONFIG_PATH=./config.toml
BOTS_FILE=./config/bots.json
DASHBOARD_TOKEN=<local-secret>
ZALO_BRIDGE_TOKEN=<local-secret>

# Personal QR runtime
ZALO_PHONE_LABEL=<operator-label>
KEEPALIVE_AUTO_CONNECT=false
POLICY_REQUIRE_CONNECTED=true
ALLOW_FAKE_SEND=false

# OA defaults; per-bot names are referenced by bots.json
ZALO_OA_TOKEN_URL=https://oauth.zaloapp.com/v4/oa/access_token
ZALO_OA_MESSAGE_URL=https://openapi.zalo.me/v3.0/oa/message/cs
ZALO_OA_WEBHOOK_SECRET=<optional-local-secret>

# Brain/workflow is optional
HERMES_API_BASE=http://127.0.0.1:8642/v1
HERMES_API_SERVER_KEY=<local-secret>
HERMES_API_MODEL=<model-id>
N8N_WEBHOOK_URL=<optional-https-url>
```

## Budgets

- HTTP body: 256 KB.
- Text send: 3,500 chars max by default.
- OA provider retry: max 3, exponential backoff capped.
- Personal ingest: configured hourly/day quota.
- SQLite retention: 30 days default, configurable 1–3650.
- No raw payload retention by default for public starter; enable only with explicit local policy.

## Security boundaries

- Never put secrets in `config.toml`, `bots.example.json`, README, tests, MCP output or Git history.
- OAuth refresh token is an env/secret-manager input; access token is memory-only.
- Personal session files are local 0600 and never sent to Telegram or browser status.
- Validate webhook signature when provider/edge supplies a stable signature; otherwise put the endpoint behind an authenticated reverse proxy and document the deployment boundary.
- Every outbound includes `bot_id`/account scope, recipient and audit correlation.
- Public starter does not promise ban-proof personal automation; recommend OA for customer-facing production.

## Context loading order for coding agents

1. `AGENTS.md`
2. `internal/00-DESIGN.md` and `internal/01-SPEC.md`
3. task section in `internal/02-PLAN.md`
4. relevant source/test only
5. `internal/04-VERIFY.md` before declaring done
