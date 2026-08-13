# Official Zalo OA adapter

## Why OA is separate

Zalo OA is the official path for customer-facing use. It uses OAuth credentials and HTTPS webhooks, not a Personal QR session. The two paths share policy ideas but do not share credentials or runtime state.

## Local setup

```bash
cp config/bots.example.json config/bots.json
```

Keep the example bot disabled or in `draft_first` until credentials and policy are reviewed. The file `config/bots.json` is local and ignored.

Credential values belong in `.env` or a secret manager. The public registry stores only env variable names:

```json
{
  "credential": {
    "app_id_env": "ZALO_OA_APP_ID_DEMO_OA",
    "app_secret_env": "ZALO_OA_APP_SECRET_DEMO_OA",
    "refresh_token_env": "ZALO_OA_REFRESH_TOKEN_DEMO_OA"
  }
}
```

Do not commit or send the values.

## Adapter behavior

The adapter:

- refreshes an access token in memory;
- caches it until the safety window;
- records a rotated refresh token only as an in-memory receipt for manual secret-store rotation;
- sends text only when called by an approved outer workflow;
- returns stable errors without provider response payloads.

The adapter does not auto-send on import and does not call the network during tests unless a caller invokes it.

## Webhook route

```text
POST /webhooks/zalo/oa/:bot_id
```

The route:

1. bounds request body size;
2. resolves bot from the route;
3. verifies the optional configured HMAC signature;
4. ignores unsupported event types;
5. normalizes `user_send_text`;
6. acknowledges quickly;
7. invokes only the caller-provided event callback.

It does **not** call AI or send a reply. Use a queue/worker outside the ingress handler if a product needs processing.

## HTTPS boundary

A public webhook must sit behind HTTPS and an authenticated reverse proxy or configured signature. Do not expose the local dashboard port directly.

Recommended rollout:

1. deploy ingress in acknowledge-only mode;
2. test with synthetic webhook payloads;
3. verify event IDs and logs are redacted;
4. connect a queue/worker;
5. keep outbound `draft_first`;
6. add explicit recipient allowlist and approval evidence;
7. only then consider a controlled send.

## No hidden automation

The repository does not create an OA, register an app, enter OTP/PIN, publish a menu, broadcast, or approve outbound. Those remain operator actions and provider/account responsibilities.
