# ABS-Zalo-Bot — Specification

## 1. Bot registry

The local file `config/bots.json` (git-ignored) has this shape:

```json
{
  "version": 1,
  "bots": [
    {
      "bot_id": "demo-oa",
      "tenant_id": "demo",
      "name": "Demo OA",
      "adapter": "zalo_oa",
      "enabled": true,
      "credential": {
        "app_id_env": "ZALO_OA_APP_ID_DEMO_OA",
        "app_secret_env": "ZALO_OA_APP_SECRET_DEMO_OA",
        "refresh_token_env": "ZALO_OA_REFRESH_TOKEN_DEMO_OA"
      },
      "policy": {"mode": "draft_first", "allow_user_ids": []}
    }
  ]
}
```

`adapter` is one of `zalo_personal_qr | zalo_oa`. `bot_id` and `tenant_id` accept only letters, digits, `.`, `_` and `-` — no path traversal.

## 2. Adapter contract

Every channel adapter must provide:

```js
{
  id: string,
  type: "zalo_personal_qr" | "zalo_oa",
  status(): { bot_id, type, state, ready, last_error? },
  receive(input): Promise<NormalizedInboundEvent | null>,
  sendText({ recipient_id, text, correlation_id }): Promise<SendReceipt>
}
```

A minimal `SendReceipt`:

```json
{"ok":true,"adapter":"zalo_oa","bot_id":"demo-oa","recipient_id":"user-1","provider_message_id":"optional","correlation_id":"req-1"}
```

## 3. Normalized inbound event

```json
{
  "event_id":"sha256-or-provider-id",
  "bot_id":"demo-oa",
  "tenant_id":"demo",
  "adapter":"zalo_oa",
  "event_type":"user_send_text",
  "sender_id":"user-1",
  "sender_name":"optional display name",
  "text":"hello",
  "is_self":false,
  "received_at":"2026-01-01T00:00:00.000Z",
  "raw_metadata":{"provider_event":"redacted metadata only"}
}
```

A raw webhook payload must never come back in status, logs or an MCP response. Store text under the local retention policy if needed.

## 4. OA OAuth contract

Default token URL: `https://oauth.zaloapp.com/v4/oa/access_token`.

Request: `POST application/x-www-form-urlencoded` with `app_id`, `grant_type=refresh_token` and `refresh_token`. Send `secret_key` per provider configuration when the credential requires it.

Expected response: `access_token`, `refresh_token` when rotation applies, and `expires_in`. The access token stays in memory; the refresh token is read from env only. If the provider issues a new refresh token, the adapter returns an internal receipt so the operator can store it manually in the secret store — it never writes to Git.

Default send URL: `https://openapi.zalo.me/v3.0/oa/message/cs`.

Request body:

```json
{"recipient":{"user_id":"user-1"},"message":{"text":"Hello"}}
```

The `access_token` header is set by the token manager. URL and headers can be overridden through config to keep up with Zalo's API versions.

## 5. OA webhook contract

`POST /webhooks/zalo/oa/:bot_id` receives the provider payload. The handler:

1. limits the body to 256 KB;
2. resolves the bot from the route, never trusting a bot ID in the body;
3. checks the optional shared signature when enabled;
4. normalises `user_send_text` into an event;
5. returns HTTP 200 quickly with `{ok:true,event_id}`;
6. leaves async handling to the outer workflow/brain, which calls `sendText` only after approval and policy checks.

Provider payloads change over time. The parser must tolerate missing fields and return `null` for non-text events.

## 6. Personal QR contract

The personal adapter keeps these endpoints:

- `POST /api/accounts/:account_id/connect` → returns `{connecting,status,qr}` quickly.
- `GET /api/accounts/:account_id/qr` → the current QR. Never returns a session.
- session `data/sessions/<account_id>.json`, mode 0600.

One account has exactly one live listener. `force_qr` clears runtime memory; it does not delete the session file unless `wipe_session=true`.

## 7. Policy states

`disabled → draft_first → approved_send → paused`.

- `disabled`: receiving/writing may be off, outbound is blocked.
- `draft_first`: creates a draft and never sends on its own.
- `approved_send`: sends only to the allowlisted recipient, within quota.
- `paused`: kill switch engaged, outbound blocked.

Personal sources default to `listen_only`. An OA customer bot may use `draft_first`, and never enables `approved_send` by itself.

## 8. Error contract

Errors use stable codes: `config_invalid`, `bot_not_found`, `credential_missing`, `token_refresh_failed`, `webhook_signature_invalid`, `recipient_required`, `text_required`, `outbound_blocked`, `provider_error`, `not_connected`.

Never retry credential, policy or signature errors. Retry at most 3 times for timeouts and 5xx, with bounded backoff.
