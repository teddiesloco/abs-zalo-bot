# ABS Zalo Bot

**Install once · run from a dashboard button or one command · agents read the repo and know how to work in it**

A local/VPS Zalo bridge for Hermes and coding agents:

- **Zalo Personal QR**: listens to allowlisted sources, stores data locally, and posts digests to one destination. This is the *unofficial* path — internal/demo use with a dedicated account only.
- **Zalo OA**: the official adapter, kept separate from Personal QR, and the right choice for a customer-facing bot.
- **Policy Guard**: fail-closed by default. Nothing is sent until it is configured.
- **Dashboard**: a non-coder can connect the QR, pick sources, pick a destination, and flip the kill switch.
- **MCP**: agents can read status, groups, users and corpus, and ask for the destination through a safe contract.

> Just want it running for the owner? Read the **[Non-coder quickstart](docs/quickstart-non-coder.md)**.
>
> Handing this repo to Claude Code, Codex, Hermes or any other agent? The agent must read **[AGENTS.md](AGENTS.md)** and the **[Agent handoff](docs/agent-handoff.md)** before running any command.

---

## Tóm tắt tiếng Việt

Repo này là cầu nối Zalo cho agent. Hai đường tách biệt: **Personal QR** (không chính thức, dùng account riêng, chỉ nội bộ/demo) và **Zalo OA** (chính thức, dùng cho khách hàng). Mặc định **fail-closed** — chưa cấu hình thì không gửi gì cả.

Cài nhanh: `bash setup.sh` rồi `npm start`, mở `http://127.0.0.1:3871`. Bắt đầu ở chế độ `listen_only`, kiểm tra dữ liệu đúng rồi mới mở thêm.

Ba điều tuyệt đối không làm: không dán secret/OTP/PIN vào chat cho agent, không dùng account Zalo cá nhân chính để automation, không mở port 3871 thẳng ra Internet.

Tài liệu còn lại viết bằng tiếng Anh để mọi agent đọc được. Câu lệnh và tên biến giữ nguyên, đọc lướt vẫn theo được.

---

## Documentation map

Start here, in this order:

| File | What it is |
|---|---|
| `README.md` | This file — install, run, and what the project does |
| `docs/quickstart-non-coder.md` | Fastest path if you do not write code |
| `AGENTS.md` | Safety boundary every AI agent must follow |
| `docs/install.md` · `docs/configuration.md` | Setup and environment variables |
| `docs/personal-qr.md` · `docs/official-oa.md` | The two Zalo adapters |
| `docs/operations.md` · `docs/troubleshooting.md` | Running it day to day |
| `SECURITY.md` · `CONTRIBUTING.md` | Reporting issues and sending changes |
| `docs/internal/` | Design, spec, plan and verification notes kept for maintainers |

## Works with any AI coding tool

This repo follows the `AGENTS.md` convention that Codex, Cursor, Zed and other agents already read.
Each tool has its own entrypoint file; they all point at the same rule set:

| Tool | Entrypoint | How to start |
|---|---|---|
| Claude Code (Sonnet/Opus) | `CLAUDE.md` | open repo, run `claude` |
| Codex CLI (GPT) | `CODEX.md` + `AGENTS.md` | open repo, run `codex` |
| Antigravity / Gemini CLI | `GEMINI.md` | open repo, run the agent |
| Hermes Agent | `HERMES.md` + `SKILL.md` | `cp -r . ~/.hermes/skills/abs-zalo-bot` or attach via MCP |
| Cursor | `.cursorrules` | auto-loaded on open |
| GitHub Copilot | `.github/copilot-instructions.md` | auto-loaded in VS Code |
| Any other agent | `AGENTS.md` | drop the file into chat |

Same bootstrap for every tool:

```bash
node --version   # requires >= 22.5
npm ci
npm run doctor
npm test
```

## 1. Pick the right path before installing

| What you need | Pick | Notes |
|---|---|---|
| Listen to internal groups and digest them into one ops group | Personal QR | Unofficial. Use a dedicated account. No spam, no broadcast |
| Talk to customers: FAQ, leads, booking, official notices | Zalo OA | The official path. Needs OA credentials and an HTTPS webhook |
| Not sure yet | Start with Personal QR in `listen_only` | No automatic sending. Inspect the data first |

**Do not use your main personal Zalo account for automation.** Never auto-enter OTP/PIN, never bypass login, never broadcast.

---

## 2. Quick install — no coding required

### Requirements

- A Linux or macOS machine.
- Node.js **22.5 or newer**.
- A dedicated Zalo account if you use Personal QR.
- No API key is needed to run Personal QR in local listen/digest mode.

### Are a VPS, a model, and Telegram required?

- **VPS:** not required to try it or run locally. Only needed for 24/7 operation. For an MVP, start around 1 vCPU / 1 GB RAM / 10 GB disk, and put HTTPS plus auth in front of it if it is reachable from outside. That is a starting point for operations, not a load guarantee.
- **Model/API key:** not required for `listen_only` or the local fallback. You only need a Hermes API compatible with OpenAI's `/v1/chat/completions` if you want an LLM to analyse or rewrite digests. This repo does not install a model and does not issue keys.
- **Telegram:** not required for the core bridge. The QR is shown in the dashboard on the local machine or VPS; this version does not forward the QR image over Telegram.
- **Live QR:** there are real routes — `POST /api/accounts/:id/connect`, the `QRCodeGenerated` callback, `GET /api/accounts/:id/qr` — and the dashboard renders it. Scanning and confirming on the phone stays a manual action by the account owner.

If you do not know whether Node.js is installed, hand the agent exactly this:

> "Check whether this machine has Node.js 22.5+. If not, walk me through installing it. Do not enter any secret, OTP or PIN on my behalf."

### One install command

From the repo directory:

```bash
bash setup.sh
```

Setup will:

1. check Node.js;
2. create a local `.env` if missing;
3. create `config/bots.json` from the example if missing;
4. create the data directory with local-only permissions;
5. run `npm ci`;
6. run tests, config validation, secret scan, syntax check and self-check;
7. print the next step.

Setup does **not** log into Zalo, scan a QR, send messages, enter OTP/PIN, or touch real credentials.

For agents or CI that must run unattended:

```bash
bash setup.sh --non-interactive
```

To set up and immediately run in the foreground:

```bash
bash setup.sh --start
```

### Run the dashboard

If you did not use `--start`:

```bash
npm start
```

Then open:

```text
http://127.0.0.1:3871
```

The dashboard binds to localhost by default. On a remote machine or VPS, **do not expose the port directly to the Internet** — use an HTTPS reverse proxy with its own token/auth.

---

## 3. First Personal QR connection

1. Run `npm start`.
2. Open the dashboard.
3. Click **Connect QR** — the dashboard calls the live route and renders the QR image.
4. Scan it from your phone using a **dedicated account**.
5. Wait for status `connected`.
6. Click **Scan group IDs** if the group list needs refreshing.
7. Pick one group as the **destination group**.
8. Add sources under **Allowlist source**.
9. Start in `listen_only`.
10. Only after the stored data looks right, move one source to `digest_only`.

What the modes mean:

- `off`: source disabled.
- `listen_only`: store only. No digest, no send.
- `digest_only`: included in digests on request or on schedule.
- `alert_only`: only high-priority candidates are considered for alerts.
- `mention_only`: still blocked from replying while `READ_ONLY_SOURCE=true`.
- `reply_enabled`: does not override Policy Guard on its own. Use only with a reviewed policy.

**Safe defaults:** sources are not replied to, DMs are not replied to, mentions are not replied to, and outbound goes only to the configured destination.

On a headless VPS, reach the dashboard over an SSH tunnel or an authenticated HTTPS reverse proxy. Do not open port `3871` to the Internet, and never put a QR or session into logs or chat.

---

## 4. Verify the install

None of these send a real message:

```bash
npm run doctor
npm run status
npm test
npm run validate-config
npm run secret-scan
npm run syntax-check
npm run self-check
```

What to look for:

- `npm test`: everything passes.
- `npm run doctor`: no public/runtime config errors.
- `status`: never prints cookies, IMEI, refresh tokens or a raw session.
- `self-check`: an empty destination/allowlist is a normal fail-closed state.

Daemon smoke test:

```bash
npm run smoke
```

`npm run smoke` only checks health, MCP and safety. It **does not send a real message** unless `BATTLE_SEND=true` is set.

---

## 5. Official OA

Personal QR and OA are two different paths. Never mix a Personal session with OA OAuth.

### Local preparation

```bash
cp config/bots.example.json config/bots.json
```

Open `config/bots.json`, keep the bot on `draft_first`, and enable it only once valid credentials exist. That file is git-ignored and must not be committed.

Put credentials in `.env` or a local secret manager — **never in chat, issues, the README, or an agent prompt**. Only the variable names declared under `credential` are used:

- `ZALO_OA_APP_ID_DEMO_OA`
- `ZALO_OA_APP_SECRET_DEMO_OA`
- `ZALO_OA_REFRESH_TOKEN_DEMO_OA`
- `ZALO_OA_WEBHOOK_SECRET`

Real values never live in the public repo.

### Webhook

Adapter route:

```text
POST /webhooks/zalo/oa/:bot_id
```

The handler validates ingress, normalises text events, and acknowledges quickly. It **does not call an AI and does not send a reply**. Any outbound must go through an external workflow or agent with its own approval and policy.

Production needs:

- an HTTPS reverse proxy;
- a signature check or an authenticated edge;
- a body size limit;
- logs limited to redacted event IDs/receipts;
- `draft_first` before enabling any send path.

Details: [docs/official-oa.md](docs/official-oa.md).

---

## 6. Repo layout for agents and CLIs

```text
AGENTS.md                    non-negotiable rules for every agent
CLAUDE.md                    entrypoint for Claude Code
CODEX.md                     entrypoint/checklist for Codex CLI
README.md                    home page and quickstart
CONTRIBUTING.md              contribution rules
SECURITY.md                  how to report a vulnerability
docs/internal/00-DESIGN.md   architecture
docs/internal/01-SPEC.md     I/O contract
docs/internal/02-PLAN.md     build order
docs/internal/03-HARNESS.md  offline test harness
docs/internal/04-VERIFY.md   verification gate
docs/internal/05-CONTEXT.md  runtime constraints

setup.sh / install.sh        one-command install
scripts/setup.js             setup + doctor + dashboard info
scripts/public-gate.js       validate-config/secret-scan/syntax-check

src/                       deterministic runtime
  policy.js                inbound/outbound guard
  store.js                 local SQLite
  zalo_runtime.js          personal QR listener
  bot_registry.js          registry + credential references
  oa_adapter.js            official OA OAuth/send boundary
  oa_webhook.js            official OA ingress boundary
  server.js                dashboard/API/webhook routes

config/bots.example.json     public example registry
config/bots.json             local registry, git-ignored
.env.example                 example environment variables
.env                         local, git-ignored

data/                      SQLite/session/QR, git-ignored
public/                    dashboard static files
mcp/                       MCP stdio facade
test/                      offline tests
```

---

## 7. Rules for agents, Claude Code and Codex

Agents work in this order:

```text
1. read AGENTS.md
2. read docs/agent-handoff.md
3. run npm run doctor
4. open only the relevant files — do not load the whole repo
5. make small changes and test immediately
6. report real evidence: command, exit code, file, test
```

An agent must **never**:

- ask the owner to paste an API key, refresh token, cookie, IMEI, session, OTP or PIN into chat;
- enter an OTP/PIN or confirm a third-party login on the owner's behalf;
- enable public send, broadcast, deploy, systemd or credential changes without approval;
- treat "code written" as "code ran" — every done claim needs runtime evidence;
- claim a GitHub publish without real auth and a real receipt;
- use an LLM to decide deterministic gates such as empty, duplicate, quota, policy or signature.

Full instructions: [docs/agent-handoff.md](docs/agent-handoff.md).

---

## 8. Quick troubleshooting

### `Node.js 22.5+ is required`

Install a current Node.js LTS, open a new terminal, then:

```bash
node --version
bash setup.sh
```

### The dashboard will not open

```bash
npm run doctor
npm start
```

If port 3871 is taken, use another one:

```bash
PORT=3872 npm start
```

Then open `http://127.0.0.1:3872`.

### The QR does not appear

- Check that `npm start` is still running.
- Click **Connect QR** again.
- Do not give a PIN/OTP to an agent — do it yourself on the phone/app.
- Use a dedicated account, not your main personal one.

### `not_connected` on digest/send

That is the safety block doing its job. Connect the QR, check the destination, then retry. Do not delete the session unless you intend to log in again.

### `destination_unset`

Open the dashboard and pick a destination group. Never set a destination from a guessed ID.

### `npm test` fails

Do not skip tests. Hand the agent this:

> "Run npm test, read the first failing test, find the cause in the related file/test, make the smallest fix, and run it again. Do not touch secrets or runtime data."

### Stop all outbound immediately

Click **Kill switch ON** in the dashboard, or:

```bash
curl -X POST http://127.0.0.1:3871/api/kill-switch \
  -H 'content-type: application/json' \
  -d '{"paused":true}'
```

---

## 9. Stopping, backups and data

Stop a foreground run with `Ctrl+C`.

Local data lives in `data/` and is never committed. The Personal session is stored with restricted permissions. Never hand the database, session or QR to an agent or a third party without redacting it first.

Before a large config change:

```bash
cp .env .env.backup.local
cp config/bots.json config/bots.backup.local.json
```

Those local backups must not be committed either.

---

## 10. Production checklist

An open dashboard is not production. You need all of:

- clear account/OA ownership;
- a reviewed allowlist and destination;
- green tests;
- secrets in a secret manager or env, never in Git;
- HTTPS + auth on any public endpoint;
- a kill switch you have actually tested;
- logs free of PII and credentials;
- systemd/Docker enabled only after approval;
- a live smoke test with real evidence;
- a tested rollback: pause, disconnect, disable bot.

The systemd file in this repo is a template. It does not enable itself.

---

## Next documents

- [Non-coder quickstart](docs/quickstart-non-coder.md)
- [Install guide](docs/install.md)
- [Agent handoff](docs/agent-handoff.md)
- [Personal QR](docs/personal-qr.md)
- [Official OA](docs/official-oa.md)
- [Commands](docs/commands.md)
- [Configuration](docs/configuration.md)
- [Operations](docs/operations.md)
- [Troubleshooting](docs/troubleshooting.md)
- [Release checklist](docs/release-checklist.md)
- [MCP notes](MCP.md)

## License

MIT. See [LICENSE](LICENSE).

**There is no "100% safe".** Official OA is the path to prefer for customers; Personal QR is unofficial, carries platform risk, and belongs only inside a boundary you have reviewed.
