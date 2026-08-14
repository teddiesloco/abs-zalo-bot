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

## Where the real QR comes from

The live Personal QR flow is:

```text
POST /api/accounts/default/connect
  -> zca-js loginQR()
  -> QRCodeGenerated callback
  -> dashboard receives the QR image
  -> owner scans it on their own phone
  -> status becomes connected
```

The dashboard re-fetches the current code with:

```text
GET /api/accounts/default/qr
```

Running locally, open the dashboard at `http://127.0.0.1:3871`. On a headless VPS, use an SSH
tunnel or an authenticated HTTPS reverse proxy to open the dashboard on the owner's machine.
This repo **does not forward the QR to Telegram**, and an agent must never enter an OTP/PIN.

Use `force_qr=true` when the previous code has expired or a fresh scan session is needed. QR
codes are short-lived; if one expires, click connect again to generate a new one.

This is a **Personal Zalo login QR issued through an unofficial library**. It is not a Zalo OA
QR, and it is not a promise that the account will never be locked.

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
