# Troubleshooting

## First response for any problem

```bash
node --version
npm run doctor
npm run status
```

Do not send `.env`, `data/`, QR, session, database, cookies, IMEI or raw messages to the agent.

## Setup errors

### Node version too old

Install Node.js 22.5+ and reopen the terminal:

```bash
node --version
bash setup.sh
```

### npm install fails

Capture only the final error lines. Check network/package registry, then retry `npm ci`. Do not replace the lockfile with `npm install` casually.

### Permission denied on setup.sh

```bash
bash setup.sh
```

No executable bit is required when invoking it through Bash.

## Server errors

### Port already in use

Use another local port:

```bash
PORT=3872 npm start
```

Open the matching port. Do not kill an unknown process automatically.

### `/healthz` is down

The server is not ready. Check the foreground terminal. Run `npm run doctor`. Do not conclude it is a Zalo provider problem until the local process is healthy.

### `unauthorized`

Use the local dashboard token through the `x-bridge-token` header. Do not put a token in a public URL or paste it into chat.

## QR errors

### `need_scan`

The user must scan QR in the Zalo app. The agent cannot complete OTP/PIN/2FA.

### `reconnecting`

The stored session exists but the listener is recovering. Wait for a bounded period, then inspect `/healthz` and `/api/health`. Do not delete the session immediately.

### Session reset required

Only the owner should intentionally use the dashboard disconnect/wipe option. This forces a fresh QR login and is not a routine fix.

## Policy errors

| Error | Meaning | Fix |
|---|---|---|
| `destination_unset` | no safe outbound target | select destination explicitly |
| `target_not_destination` | attempted cross-group send | stop; inspect caller/policy |
| `not_connected` | no live account API | connect QR/session first |
| `account_paused` | account/global pause | inspect kill switch and resume deliberately |
| `recipient_allowlist_empty` | OA approved send has no recipients | add explicit reviewed recipient |
| `outbound_requires_approval` | draft-only policy | approve through outer workflow |

## OA errors

- `credential_missing`: env value is absent; set it locally, never in chat.
- `token_refresh_failed`: inspect provider status and secret-store rotation; do not retry blindly.
- `webhook_signature_invalid`: compare configured secret/edge signature using synthetic evidence; never print the secret.
- `bot_not_found`: route bot ID is not in local `config/bots.json`.
- `bot_disabled`: enable only after policy review.

## Tests

Run the smallest relevant command first, then the full gate:

```bash
npm test
npm run validate-config
npm run secret-scan
npm run syntax-check
npm run self-check
```

A test failure is not permission to bypass safety checks or delete runtime data.
