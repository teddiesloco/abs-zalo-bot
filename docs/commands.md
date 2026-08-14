# Commands reference

> **Tiếng Việt:** Bảng dưới liệt kê lệnh kèm *side effect* của từng lệnh — lệnh nào tạo file hay mở server đều ghi rõ. Không chạy lệnh gửi thật trong CI.

## Setup and diagnostics

| Command | What it does | Side effect |
|---|---|---|
| `bash setup.sh` | local install, example files, run gates | creates `.env`, local config, data |
| `bash setup.sh --non-interactive` | same, no prompts | creates local files |
| `bash setup.sh --start` | set up, then run the server in the foreground | starts a local server |
| `npm run doctor` | checks runtime/config/data/gates | creates the local database if needed |
| `node scripts/setup.js dashboard-info` | prints URL/bind/token status, never the token | sends nothing |
| `npm run status` | shows redacted status | reads the local DB |
| `npm run self-check` | checks the fail-closed baseline | creates/reads the local DB |

## Verification

```bash
npm test
npm run validate-config
npm run secret-scan
npm run syntax-check
npm run self-check
```

## Server

```bash
npm start
npm run dev
PORT=3872 npm start
```

Health without a dashboard token:

```bash
curl -s http://127.0.0.1:3871/healthz
```

Detailed health needs auth once a token is set:

```bash
curl -s http://127.0.0.1:3871/api/health -H 'x-bridge-token: <local-token>'
```

## Dashboard actions

- Connect QR
- Refresh
- Scan group IDs
- Kill switch ON/OFF
- Digest now
- Disconnect
- Save destination
- Add/update source mode
- Save role

## Safe API surface

| Method | Route | Purpose |
|---|---|---|
| `GET` | `/healthz` | basic liveness/readiness |
| `GET` | `/api/status` | redacted status; needs auth when a token is set |
| `GET` | `/api/health` | detailed health |
| `POST` | `/api/accounts/:id/connect` | start a QR/session connect |
| `GET` | `/api/accounts/:id/qr` | fetch the current QR; never returns a session |
| `POST` | `/api/destination` | set the destination |
| `POST` | `/api/sources` | add an allowlisted source |
| `POST` | `/api/digest/run` | run a digest under policy |
| `POST` | `/api/kill-switch` | pause/resume outbound |
| `POST` | `/webhooks/zalo/oa/:bot_id` | OA ingress normalise/ack; never sends by itself |

## Live send warning

- Personal report/digest: destination only, policy guard on, account connected.
- OA text send: the library adapter may call the provider once an external workflow has approved it. The core webhook never calls it.
- Never run a live send command in CI.
