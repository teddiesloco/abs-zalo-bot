# Personal QR adapter

## Use case

Personal QR is for internal intelligence: listen to approved sources, retain bounded local data, and produce a report to one configured destination.

It is **not** an official Zalo API and is not ban-proof. Use an account dedicated to this bridge. Do not use a personal main account or customer-facing broadcast flow.

## Safe lifecycle

```text
setup -> connect QR manually -> discover -> choose destination
-> allowlist source -> listen_only -> inspect -> digest_only
-> pause/kill switch -> disconnect
```

## QR thật nằm ở đâu?

Flow live của Personal QR là:

```text
POST /api/accounts/default/connect
  -> zca-js loginQR()
  -> QRCodeGenerated callback
  -> dashboard nhận ảnh QR
  -> chủ tự quét bằng điện thoại
  -> trạng thái connected
```

Dashboard lấy lại mã hiện tại qua:

```text
GET /api/accounts/default/qr
```

Nếu chạy trên máy local, mở dashboard tại `http://127.0.0.1:3871`. Nếu chạy trên VPS không có màn hình, dùng SSH tunnel hoặc reverse proxy HTTPS có auth để mở dashboard trên máy của chủ. Repo hiện **không tự gửi QR sang Telegram** và agent không được tự nhập OTP/PIN.

`force_qr=true` dùng khi mã cũ hết hạn hoặc cần bắt đầu phiên quét mới. QR thường có thời hạn ngắn; nếu hết hạn, bấm kết nối lại để tạo mã mới.

Đây là QR đăng nhập **Personal Zalo qua thư viện không chính thức**, không phải QR của Zalo OA và không phải cam kết không bị khóa tài khoản.

## What the agent may do

- start the local server;
- show the QR endpoint;
- report connection state;
- configure synthetic/local policy after owner direction;
- test with fake clients;
- pause or disconnect when explicitly requested.

## What the agent must not do

- scan QR on behalf of the user;
- enter OTP/PIN/2FA;
- read or print cookies, IMEI, session JSON;
- send to an arbitrary group;
- enable broadcast or source replies;
- infer a real group ID from a guess;
- copy runtime data into Git or chat.

## Session boundary

Sessions are stored under `data/sessions/<account_id>.json` with restricted permissions. `data/` is ignored. Do not delete a session casually; `wipe_session=true` is a deliberate logout/reset action.

## Health meanings

- `disconnected`: no live listener.
- `need_scan`: user action is required in the Zalo app.
- `reconnecting`: session/listener recovery is in progress.
- `connected`: account API and listener are live.
- `paused`: kill switch or explicit pause; outbound blocked.

`has_session=true` does not prove a live listener. Check `/healthz` and `/api/health`.

## First safe configuration

Use:

```text
source mode: listen_only
destination: one explicitly selected group
auto reply: off
DM reply: off
mention reply: off
```

Move to `digest_only` only after checking the source data is correct. Keep reports short and human-readable.
