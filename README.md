# ABS Zalo Agent Engine 🚀 (Agent Business System)

[![npm version](https://img.shields.io/npm/v/abs-zalo-bot.svg?color=blue)](https://www.npmjs.com/package/abs-zalo-bot)
[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](https://opensource.org/licenses/MIT)
[![Automated Tests](https://img.shields.io/badge/Tests-85%2F85%20Passing-brightgreen.svg)](test/)
[![AI Agent Ready](https://img.shields.io/badge/AI%20Agent-Hermes%20%7C%20Claude%20Code%20%7C%20Codex-purple.svg)](mcp/)
[![Model Context Protocol](https://img.shields.io/badge/MCP-Standard%20v1.3.0-blueviolet.svg)](mcp/)

**The Free, Transparent & Autonomous Zalo AI Agent Engine for Developers, Hermes, Claude Code, and Multi-Agent Frameworks.**

Install once · run with 1 command or browser QR · AI Agents connect via Model Context Protocol (MCP) to manage Zalo autonomously, safely, and transparently.

---

## 🌟 Why ABS Zalo Agent Engine?

| Core Advantage | ABS Zalo Agent Engine | Conventional Bots & Scrapers |
| :--- | :--- | :--- |
| **Pricing & Freedom** | **100% Free & Open-Source (MIT)** | Paid licenses / Black-box scripts |
| **Architecture** | **Dual-Adapter: Personal QR + Official OA (Webhook)** | Single unofficial scraping adapter |
| **Safety & Privacy** | **Fail-Closed PolicyGuard + Secret Redaction** | No guardrails (high ban/checkpoint risk) |
| **AI Integration** | **Native Model Context Protocol (MCP Stdio Server)** | Raw HTTP webhooks / Manual glue code |
| **Code Quality** | **72/72 Automated Unit & Integration Tests** | Little to no test coverage |
| **Multi-Agent Ready** | **Hermes Agent, Claude Code, OpenAI Codex, Cursor** | Single-system or standalone CLI only |

---

## 🇻🇳 Tóm tắt tiếng Việt

`abs-zalo-bot` là hạ tầng **Zalo AI Agent** mã nguồn mở miễn phí, an toàn và minh bạch nhất cho các nhà phát triển và doanh nghiệp:

1. **Zalo Cá nhân (Personal Engine)**: Quản trị nhóm chuyên sâu (Kick thành viên, chuyển nhượng Trưởng nhóm, bổ nhiệm Phó nhóm), tạo & khoá bình chọn (Polls), thả reaction emoji, thu hồi tin nhắn (Recall/Undo), và tự động ghi nhận ngữ cảnh (Corpus Listener).
2. **Zalo Official Account (OA Doanh nghiệp)**: Webhook 2 chiều chuẩn bảo mật HMAC, tự động tiếp nhận khách hàng, hỗ trợ phân loại Lead Generation & CSKH 24/7.
3. **Bảo mật & Minh bạch (Fail-Closed Policy Guard)**: Tự động che giấu OTP/thông tin nhạy cảm, chống spam, bảo vệ an toàn tài khoản Zalo.
4. **Chuẩn Quốc Tế MCP (Model Context Protocol)**: Kết nối trực tiếp và cấp quyền cho AI Agents (Hermes, Claude Code, Codex, Cursor...) làm việc tự chủ mà không cần viết thêm API wrapper.

---

## ⚡ MCP Tool Surface for AI Agents (`abs-zalo-mcp`)

Attach `npx abs-zalo-bot` or `node mcp/server.js` to your Agent configuration:

| Category | Tool Name | Description |
| :--- | :--- | :--- |
| **Telemetry & Health** | `abs_zalo_status` | Check bridge status, safety flags, and message corpus count |
| | `abs_zalo_list_groups` | List allowlisted source & destination groups |
| | `abs_zalo_recent_messages` | Read captured message streams with full metadata |
| | `abs_zalo_corpus_summary` | Get aggregated inventory of users, groups, and logs |
| **Group Administration** | `abs_zalo_rename_group` | Rename group name (Admin/Leader required) |
| | `abs_zalo_change_group_avatar` | Change group avatar image from URL or file |
| | `abs_zalo_create_group_note` | Create and pin announcement/note at the top |
| | `abs_zalo_get_pending_members` | List members waiting for approval to join |
| | `abs_zalo_review_pending_member` | Approve or reject pending member requests |
| | `abs_zalo_block_group_member` | Block a member permanently from the group |
| | `abs_zalo_unblock_group_member` | Unblock a previously blocked member |
| | `abs_zalo_get_group_link` | Get public group invite link (URL) |
| | `abs_zalo_set_group_link` | Enable or disable public group join link |
| | `abs_zalo_update_group_settings` | Configure group permissions (lock chat, pin, etc.) |
| | `abs_zalo_kick_member` | Remove a member from a group (Admin/Owner required) |
| | `abs_zalo_transfer_owner` | Transfer group ownership (Owner required) |
| | `abs_zalo_add_deputy` | Promote a member to Group Deputy / Admin |
| | `abs_zalo_remove_deputy` | Demote a Group Deputy back to regular member |
| | `abs_zalo_invite_member` | Invite / add a user into a group |
| **Interaction & Polls** | `abs_zalo_create_poll` | Create interactive polls with custom options |
| | `abs_zalo_lock_poll` | Lock / close an active voting poll |
| | `abs_zalo_react_message` | Send emoji reactions to messages (`/:heart`, `/:like`, etc.) |
| | `abs_zalo_undo_message` | Recall / undo a previously sent message |
| **Personal lifecycle** | `abs_zalo_personal_action` | Explicitly confirmed rich message/reply/mention/file, sticker, voice/video, forward, typing, group lifecycle/settings and friend lifecycle actions |
| **Agent readiness** | `abs_zalo_readiness` | Read-only checklist for connection, destination, Hermes brain, profile and safe live mode |
| **Capability packs** | `abs_zalo_capability_packs` | Shows the active `reader` / `operator` / `admin` MCP guard level |
| **Discovery & Intel** | `abs_zalo_get_user_info` | Fetch public user profile by userId |
| | `abs_zalo_get_group_info` | Fetch group settings and metadata |
| | `abs_zalo_find_user` | Lookup user profile by phone number |
| | `abs_zalo_list_friends` | List all friends of the account |
| | `abs_zalo_list_all_groups`| Fetch all joined groups from Zalo server |

---

## 🚀 Quickstart

### Prerequisites
- **Node.js 22.5.0+** (LTS recommended) on any OS: Windows, macOS, Linux.
- *Zero C++ compilation tools required* — utilizes pure JavaScript with Node.js built-in `node:sqlite`.

---

### Option A: Windows (PC / Laptop — 1-Click Setup)

1. **Clone repository**:
   ```cmd
   git clone https://github.com/teddiesloco/abs-zalo-bot.git
   cd abs-zalo-bot
   ```
2. **Setup (1-Click)**:
   - Double-click **`setup.bat`** (or in PowerShell run `.\setup.ps1`).
   - It will automatically verify Node.js, install packages, and initialize local configuration.
3. **Start Bot**:
   - Double-click **`start.bat`** (or run `npm start`).
   - It will launch the bot and automatically open `http://localhost:3871/connect` in your browser.
4. **Login**: Scan the QR code on the browser screen with your Zalo app on your phone.

> **💡 Run 24/7 in Background on Windows (without keeping CMD open):**
> ```cmd
> npm install -g pm2
> pm2 start src/cli.js --name abs-zalo-bot
> pm2 startup
> pm2 save
> ```

---

### Option B: macOS & Linux (Local Desktop / Laptop)

1. **Clone & Setup**:
   ```bash
   git clone https://github.com/teddiesloco/abs-zalo-bot.git
   cd abs-zalo-bot
   ./install.sh
   ```
2. **Start the Bot**:
   ```bash
   npm start
   ```
3. **Login**:
   Open `http://127.0.0.1:3871/connect` in Safari/Chrome to scan the QR code.

---

### Option C: Docker (Windows Docker Desktop / Mac / Linux / NAS)

1. **Start with Docker Compose**:
   ```bash
   docker compose up -d
   ```
2. **Login**:
   Open `http://localhost:3871/connect` in your browser to scan the QR code.
3. **Check Logs**:
   ```bash
   docker compose logs -f
   ```

---

### Option D: Production Linux VPS (systemd)

For headless servers and 24/7 background operation:
```bash
./setup.sh
sudo cp abs-zalo-bot.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now abs-zalo-bot
```
*(On headless VPS, view QR via SSH tunnel: `ssh -N -L 13871:127.0.0.1:3871 user@your-vps` then open `http://127.0.0.1:13871/connect`).*

### Hermes Profile Pack

Add one or more `[[agent_profiles]]` blocks to private `config.toml` to give each account or destination an owner-authored identity, mission, voice, operating rules, knowledge anchors and intended tool pack. These fields are inserted only into the Hermes system instruction; inbound Zalo messages cannot rewrite them.

Start MCP with `ABS_ZALO_TOOL_PACK=reader` (default). Move deliberately to `operator` for reactions/polls/recall, or `admin` for group and personal lifecycle actions. This is an extra MCP guard; explicit confirmation and bridge policy still apply.

### Hermes Zalo media bridge

Set `HERMES_ZALO_MEDIA_INGEST=true` only on the private bridge host to stage inbound Zalo attachments for an authenticated Hermes platform plugin. The bridge returns opaque attachment references and serves the staged local file through its authenticated `/v1/hermes/media/:eventId/:attachmentId` endpoint; it never passes provider CDN URLs or Zalo session data to Hermes. Images, documents, audio/voice and video are bounded to 25 MB for images/files and 100 MB for audio/video.

### Hermes Zalo Gateway (0.5+)

`hermes-plugin/platforms/zalo` is an installable Hermes gateway adapter. It polls the authenticated local bridge and converts only normalized, approved Zalo events into Hermes `MessageEvent`s; it never handles QR, cookies, sessions or arbitrary `zca-js` calls.

Before it receives a single event, set all of `HERMES_ZALO_GATEWAY_ENABLED=true`, a non-empty `HERMES_ZALO_ALLOWED_THREADS`, and a non-empty `HERMES_ZALO_ALLOWED_USERS`. Sender references are privacy-safe hashes returned by the bridge—not a display name. Groups default to `HERMES_ZALO_GROUP_MODE=mention`. The plugin can connect with `HERMES_ZALO_ALLOW_AUTOREPLY=false`, but reply/typing remain rejected until that separate opt-in is set to `true`.

For profile-aware quality, select `gateway_skill = "your-owner-authored-hermes-skill"` in each `[[agent_profiles]]` record. Hermes then auto-loads that skill for that source/profile, while the bridge still owns policy, confirmation, audit and outbound bounds. Detailed installation: [`hermes-plugin/README.md`](hermes-plugin/README.md).

---

## 🎨 Zalo Rich Text & Auto Styling Engine (Built-in)

`abs-zalo-bot` automatically compiles Markdown syntax and brand color tags into native Zalo TextStyle formatting:

- `# Heading 1`: Large Header (`f_18`) + Bold (`b`) + Ruby Red (`c_db342e`).
- `## Heading 2`: Header Bold (`b`) + Emerald Green (`c_15a85f`).
- `### Heading 3`: Header Bold (`b`) + Amber Orange (`c_f27806`).
- `**bold**`: Zalo Bold (`b`).
- `*italic*`: Zalo Italic (`i`).
- `__underline__`: Zalo Underline (`u`).
- `~~strikethrough~~`: Zalo StrikeThrough (`s`).
- Color tags: `[RED]...[/RED]` (Ruby Red), `[GREEN]...[/GREEN]` (Emerald Green), `[ORANGE]...[/ORANGE]` (Amber Orange), `[YELLOW]...[/YELLOW]` (Royal Gold) — supports Vietnamese equivalents `[ĐỎ]`, `[XANH]`, `[CAM]`, `[VÀNG]`.
- **Safe Bubble Chunker (`splitIntoSafeZaloChunks`)**: Automatically breaks long outputs into sequential bubbles <= 650 chars, permanently eliminating Zalo API Error 118 ("Content too long").

---

## 🧠 Hermes Agent Starter Kit (`hermes-plugin/starter-kit/`)

Ready-to-use "Digital Brain" template for Hermes Agent:

1. **`SOUL.md`**: Conversational, warm, Vietnamese executive assistant voice (zero corporate slop, short mobile-optimized sentences, authentic tone).
2. **`AGENT.md`**: Deterministic AI architecture, safety rules, fail-closed boundaries, mention-only in groups.
3. **`skills/zalo-customer-care`**: 1-on-1 customer service, empathetic problem diagnosis, and natural lead qualification.
4. **`skills/zalo-community-admin`**: 24/7 group moderation (new member welcome, FAQ answering, rule pinning, spam defense).

To enable, run 1 command:
```bash
cp -R hermes-plugin/starter-kit/skills/* ~/.hermes/skills/
cat hermes-plugin/starter-kit/SOUL.md >> ~/.hermes/SOUL.md
```

---

## 🔄 Seamless Zero-Downtime Upgrade (For Existing Users)

If you already installed `abs-zalo-bot` (v0.4.0 or v0.5.0), upgrading to **v0.6.0** takes 5 seconds with **ZERO data loss and NO QR re-scan**:

- **If installed via NPM:**
  ```bash
  npm install -g abs-zalo-bot@latest
  ```
- **If cloned via Git:**
  ```bash
  git pull origin main
  npm install
  ```
- **If running via Docker:**
  ```bash
  docker compose pull && docker compose up -d
  ```

> *Your active login sessions (`data/sessions/`), databases (`data/bridge.sqlite3`), and `.env` settings are 100% preserved. The bot seamlessly reconnects without requesting a new QR scan.*

---

## ⭐ Support & Community Nudge

If ABS Zalo Bot helps your operations or business, please consider starring the repository:

```bash
# Star via GitHub CLI
gh repo star teddiesloco/abs-zalo-bot
```
Or click Star directly at: **[https://github.com/teddiesloco/abs-zalo-bot](https://github.com/teddiesloco/abs-zalo-bot)** ⭐

---

## 🔒 Security & Policy Boundaries

- **Side-effect control**: Every outbound message and administrative action is audited through `PolicyGuard`.
- **Credential isolation**: Session cookies and tokens are kept in private local storage; never exposed over prompts or logs.
- **Fail-closed default**: Inbound events are listener-only until explicitly allowlisted.
- **Explicit side effects**: Personal lifecycle actions require `confirm: true` at the local bridge; file attachments are accepted only beneath `ABS_ZALO_MEDIA_ROOT`.

---
*Built with ❤️ by ABS (Agent Business System) for the Global & Vietnamese AI Agent Community.*
