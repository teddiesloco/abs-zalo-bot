# Configuration

## File ownership

| File | Có commit? | Ai dùng |
|---|---:|---|
| `.env.example` | Có | template tên biến |
| `.env` | Không | giá trị local/secret |
| `config.toml` | Có | default an toàn |
| `config/bots.example.json` | Có | registry example |
| `config/bots.json` | Không | registry local |
| `data/` | Không | SQLite/session/QR/runtime |

## Personal defaults

`config.toml` mặc định:

- `read_only_source=true`;
- `listen_all_groups=false`;
- `listen_dms=false`;
- `auto_alert=false`;
- `auto_reply_default=false`;
- destination rỗng;
- bind localhost.

Không đổi các default này chỉ để demo nhanh.

## Important environment variables

### Runtime

```text
HOST=127.0.0.1
PORT=3871
DATA_DIR=./data
CONFIG_PATH=./config.toml
BOTS_FILE=./config/bots.json
DASHBOARD_TOKEN=<local-secret>
```

### Personal safety

```text
KEEPALIVE_AUTO_CONNECT=false
ALLOW_FAKE_SEND=false
LISTEN_ALL_GROUPS=false
RETAIN_RAW_TEXT=false
REDACT_PII=true
DESTINATION_GROUP_NAME=
```

### Optional Hermes

```text
HERMES_WEBHOOK_URL=
HERMES_WEBHOOK_TOKEN=
HERMES_API_BASE=http://127.0.0.1:8642/v1
HERMES_API_SERVER_KEY=
HERMES_API_MODEL=hermes-agent
```

### OA

Credential values stay outside Git:

```text
ZALO_OA_APP_ID_DEMO_OA=
ZALO_OA_APP_SECRET_DEMO_OA=
ZALO_OA_REFRESH_TOKEN_DEMO_OA=
ZALO_OA_WEBHOOK_SECRET=
```

Only local operator/secret manager fills the right-hand side. Never paste these values into Telegram or agent prompts.

## Registry policy

Each bot has:

- `bot_id` and `tenant_id` synthetic/local identifiers;
- adapter: `zalo_oa` or `zalo_personal_qr`;
- enabled flag;
- credential env references, never raw values;
- policy mode.

Public example stays `draft_first` with an empty allowlist. `approved_send` requires an explicit recipient allowlist and review.

## Permission model

Personal dashboard roles:

- `owner`: full policy/config operations;
- `admin`: configuration and pause/resume;
- `operator`: digest/report;
- `viewer`: read-only status/help.

Authorization uses platform IDs, not display names.

## Changing config safely

1. stop or pause outbound;
2. back up local config outside Git;
3. edit only the intended field;
4. run `npm run doctor`;
5. run `npm test` and gates;
6. start foreground and verify `/healthz`;
7. only then consider persistent service.
