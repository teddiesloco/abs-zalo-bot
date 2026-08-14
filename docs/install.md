# Install guide

> **Tiếng Việt:** Cần Node.js 22.5+ trên Linux/macOS. Chạy `bash setup.sh` là xong. VPS, model AI và Telegram đều **không bắt buộc** để chạy chế độ `listen_only`.

## Supported runtime

- Node.js 22.5+.
- Linux or macOS.
- npm, which ships with Node.js.
- Personal QR needs a dedicated Zalo account.
- OA needs credentials held by the OA owner.

## What you actually need — and what you do not

### Required for Personal QR

- A Linux or macOS machine.
- Node.js `22.5+` and npm.
- A stable connection to install dependencies and reach Zalo Web.
- A Zalo account **dedicated to the bridge**, plus a phone to scan the QR yourself.

You do not need a VPS or an AI model to install and run the listener in `listen_only`.

### When you need a VPS

Only for 24/7 operation, or when you do not want to depend on a laptop. A VPS should have:

- a current Ubuntu/Debian;
- roughly 1 vCPU, 1 GB RAM and 10 GB disk for a local MVP — a starting point for operations, not a guaranteed benchmark;
- an HTTPS reverse proxy if the dashboard/webhook must be reachable from outside;
- a firewall, secrets in env or a secret manager, and separate backups for `data/`;
- a safe way to open the dashboard while scanning the QR: an SSH tunnel, or a reverse proxy with auth.

Do not expose `3871` to the Internet. A QR and a session are auth material — never put them in logs, issues or chat.

### When you need a model/API key

- `listen_only`: **no model** and no API key.
- Local fallback reports: no model. Content comes from a deterministic formatter.
- Analysis/reasoning through Hermes: needs a Hermes API server compatible with OpenAI's `/v1/chat/completions`, plus `HERMES_API_BASE`, `HERMES_API_MODEL`, and a key in env if the server requires one.
- With no model or key, the system does not invent anything. It uses the fallback, or stays in review/dry-run depending on the workflow.

This repo does not install a model, does not issue API keys, and does not depend on OpenRouter/Anthropic/OpenAI by default.

### Is Telegram required?

No — not to install or run the core bridge. Telegram is an optional operations channel supplied by an outer deployment layer. On a headless VPS this version shows the QR through the dashboard or an SSH tunnel; it **does not send the QR image to Telegram**.

## Install with the wizard

```bash
bash setup.sh
```

Equivalent aliases:

```bash
bash install.sh
npm run setup
```

Flags:

```bash
bash setup.sh --non-interactive
bash setup.sh --skip-install
bash setup.sh --start
node scripts/setup.js doctor
node scripts/setup.js dashboard-info
```

### What the wizard does

- checks the Node version;
- creates `.env` from `.env.example` if missing;
- creates `config/bots.json` from the example if missing;
- creates `data/`, `data/sessions/` and `data/qr/` with restricted permissions;
- installs dependencies with `npm ci`;
- runs the tests and the offline gates;
- never logs in, scans a QR, or sends a message.

The wizard does not overwrite an existing `.env` or `config/bots.json`.

## Manual install

Only when the wizard does not fit:

```bash
node --version
npm ci
cp .env.example .env
cp config/bots.example.json config/bots.json
mkdir -p data/sessions data/qr
chmod 700 data data/sessions data/qr
npm test
npm run validate-config
npm run secret-scan
npm run syntax-check
npm run self-check
```

## Local vs VPS

### Local

- keep `HOST=127.0.0.1`;
- open the dashboard on the same machine;
- no reverse proxy needed;
- good for testing and personal operation.

### VPS

- keep the service bound to localhost;
- put an HTTPS reverse proxy in front;
- keep the dashboard token in a secret env;
- never send a session/QR/cookie over Telegram;
- use the systemd template only after approval — it does not enable itself.

## After installing

```bash
npm start
```

Operating instructions: [quickstart-non-coder.md](quickstart-non-coder.md).
