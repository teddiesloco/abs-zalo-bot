# Non-coder quickstart

Goal: install locally, open the dashboard, scan the QR, and start in listen-only mode. No coding required.

> **Tiếng Việt:** Chạy `bash setup.sh`, rồi `npm start`, mở `http://127.0.0.1:3871`. Quét QR bằng **account riêng**, chọn destination, để nguồn ở `listen_only`. Chưa chọn destination thì bot không gửi — đó là an toàn, không phải lỗi. Không đưa OTP/PIN cho agent.

## Step 0 — know what you are installing

There are two paths:

- **Personal QR**: a dedicated Zalo account, unofficial, for listening to and digesting internal groups.
- **OA**: the official account, and the better fit when you talk to customers.

This page covers Personal QR because it is the easiest to try. Building a bot for customers? Go to [Official OA](official-oa.md) instead.

## Step 1 — run setup

Open Terminal, go to the repo directory, and run:

```bash
bash setup.sh
```

Wait until the check lines pass. If setup says Node is too old, install Node.js 22.5+ and run it again. You do not need to edit any code.

## Step 2 — open the dashboard

```bash
npm start
```

Leave that window open. In a browser, go to:

```text
http://127.0.0.1:3871
```

On a remote machine or VPS, do not expose the port directly to the Internet. Have an agent set up HTTPS/auth once the boundary is clear.

## Step 3 — scan the QR

1. Click **Connect QR**.
2. Open Zalo on your phone.
3. Scan with your dedicated account.
4. If the phone asks for confirmation, confirm it yourself on the phone.
5. Wait for the dashboard to show `connected`.

An agent must never receive or enter an OTP/PIN for you.

## Step 4 — choose where reports go

In the **Destination group** box:

1. Click **Scan group IDs**.
2. Pick the ops group that should receive reports.
3. Save the destination.

With no destination set, the bot is not allowed to send. That is a normal safe state.

## Step 5 — choose sources to listen to

Under **Allowlist source**:

1. pick a group;
2. set the mode to `listen_only`;
3. click add/update;
4. wait for a few new messages;
5. only once the data looks right, switch to `digest_only`.

Do not start with `reply_enabled`.

## Step 6 — verify

Open a second terminal:

```bash
npm run doctor
npm run status
```

Ask your agent:

> "Check whether the bridge is connected, whether a destination is set, which sources are on listen_only/digest_only — and do not send any real message."

## Step 7 — try a digest

You can click **Digest now** in the dashboard. If it is not connected or has no destination, the system blocks instead of guessing.

The smoke test does not send by default:

```bash
npm run smoke
```

Do not run `BATTLE_SEND=true` until the operator has explicitly approved both the destination and the content.

## Stopping

In the `npm start` window, press `Ctrl+C`. If you need to block sending right now, click **Kill switch ON** first.

## If something breaks

Do not delete `data/`, do not rush to delete the session, and do not send your `.env` to anyone. Run:

```bash
npm run doctor
```

Then give your agent only the redacted error text — never a token, cookie, QR or database.
