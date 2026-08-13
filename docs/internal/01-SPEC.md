# ABS-Zalo-Bot — Specification

## 1. Bot registry

Local file `config/bots.json` (ignored by Git) có shape:

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

`adapter` nhận một trong `zalo_personal_qr | zalo_oa`. `bot_id` và `tenant_id` chỉ gồm chữ, số, `.`, `_`, `-`; không cho path traversal.

## 2. Adapter contract

Mọi channel adapter phải cung cấp:

```js
{
  id: string,
  type: "zalo_personal_qr" | "zalo_oa",
  status(): { bot_id, type, state, ready, last_error? },
  receive(input): Promise<NormalizedInboundEvent | null>,
  sendText({ recipient_id, text, correlation_id }): Promise<SendReceipt>
}
```

`SendReceipt` tối thiểu:

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
  "text":"xin chào",
  "is_self":false,
  "received_at":"2026-01-01T00:00:00.000Z",
  "raw_metadata":{"provider_event":"redacted metadata only"}
}
```

Raw webhook payload không được trả lại trong status, log hoặc MCP response. Lưu text theo retention/policy local nếu cần.

## 4. OA OAuth contract

Token URL mặc định: `https://oauth.zaloapp.com/v4/oa/access_token`.

Request: `POST application/x-www-form-urlencoded` với `app_id`, `grant_type=refresh_token`, `refresh_token`; gửi `secret_key` theo cấu hình provider nếu credential yêu cầu.

Expected response: `access_token`, `refresh_token` tùy rotation, `expires_in`. Access token giữ trong memory; refresh token chỉ đọc từ env. Nếu provider cấp refresh token mới, adapter trả receipt nội bộ để operator lưu thủ công vào secret store, không tự ghi Git.

Send URL mặc định: `https://openapi.zalo.me/v3.0/oa/message/cs`.

Request body:

```json
{"recipient":{"user_id":"user-1"},"message":{"text":"Xin chào"}}
```

Header `access_token` được đặt từ token manager. URL/header có thể override qua config để theo kịp API version của Zalo.

## 5. OA webhook contract

`POST /webhooks/zalo/oa/:bot_id` nhận provider payload. Handler:

1. giới hạn body 256 KB;
2. xác định bot từ route, không tin bot ID trong body;
3. kiểm tra optional shared signature nếu bật;
4. normalize `user_send_text` thành event;
5. trả HTTP 200 nhanh với `{ok:true,event_id}`;
6. workflow/brain xử lý async ở lớp ngoài và gọi `sendText` sau approval/policy.

Payload provider có thể thay đổi; parser phải chịu được missing fields và trả `null` cho event không phải text.

## 6. Personal QR contract

Personal adapter giữ endpoint:

- `POST /api/accounts/:account_id/connect` → trả nhanh `{connecting,status,qr}`.
- `GET /api/accounts/:account_id/qr` → QR hiện tại, không trả session.
- session `data/sessions/<account_id>.json`, mode 0600.

Một account chỉ có một live listener. `force_qr` xóa runtime memory, không xóa session file nếu không có `wipe_session=true`.

## 7. Policy states

`disabled → draft_first → approved_send → paused`.

- `disabled`: nhận/ghi có thể tắt, outbound chặn.
- `draft_first`: tạo draft, không tự gửi.
- `approved_send`: chỉ gửi đúng recipient/allowlist và quota.
- `paused`: kill switch, chặn outbound.

Personal source mặc định `listen_only`; OA customer bot có thể `draft_first`, không tự bật `approved_send`.

## 8. Error contract

Lỗi có mã ổn định: `config_invalid`, `bot_not_found`, `credential_missing`, `token_refresh_failed`, `webhook_signature_invalid`, `recipient_required`, `text_required`, `outbound_blocked`, `provider_error`, `not_connected`.

Không retry các lỗi credential/policy/signature. Retry tối đa 3 lần cho timeout/5xx với backoff bounded.
