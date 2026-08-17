# ABS Zalo Agent Engine 🚀 (Agent Business System)

[![npm version](https://img.shields.io/npm/v/abs-zalo-bot.svg?color=blue)](https://www.npmjs.com/package/abs-zalo-bot)
[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](https://opensource.org/licenses/MIT)
[![Automated Tests](https://img.shields.io/badge/Tests-68%2F68%20Passing-brightgreen.svg)](test/)
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
| **Code Quality** | **68/68 Automated Unit & Integration Tests** | Little to no test coverage |
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
| **Group Administration** | `abs_zalo_kick_member` | Remove a member from a group (Admin/Owner required) |
| | `abs_zalo_transfer_owner` | Transfer group ownership (Owner required) |
| | `abs_zalo_add_deputy` | Promote a member to Group Deputy / Admin |
| | `abs_zalo_remove_deputy` | Demote a Group Deputy back to regular member |
| | `abs_zalo_invite_member` | Invite / add a user into a group |
| **Interaction & Polls** | `abs_zalo_create_poll` | Create interactive polls with custom options |
| | `abs_zalo_lock_poll` | Lock / close an active voting poll |
| | `abs_zalo_react_message` | Send emoji reactions to messages (`/:heart`, `/:like`, etc.) |
| | `abs_zalo_undo_message` | Recall / undo a previously sent message |
| **Discovery & Intel** | `abs_zalo_get_user_info` | Fetch public user profile by userId |
| | `abs_zalo_get_group_info` | Fetch group settings and metadata |
| | `abs_zalo_find_user` | Lookup user profile by phone number |
| | `abs_zalo_list_friends` | List all friends of the account |
| | `abs_zalo_list_all_groups`| Fetch all joined groups from Zalo server |

---

## 🚀 Quickstart

### 1. Global Installation (via npm)
```bash
npm install -g abs-zalo-bot
```

### 2. Run with Node / NPM
```bash
# Clone repository
git clone https://github.com/teddiesloco/abs-zalo-bot.git
cd abs-zalo-bot

# Install & Run tests
npm ci
npm test

# Start the daemon
npm start
```

### 3. Open Control Dashboard
Open `http://127.0.0.1:3871` in your browser to scan QR code, configure group policies, and manage your AI Agent bridge.

---

## 🔒 Security & Policy Boundaries

- **Side-effect control**: Every outbound message and administrative action is audited through `PolicyGuard`.
- **Credential isolation**: Session cookies and tokens are kept in private local storage; never exposed over prompts or logs.
- **Fail-closed default**: Inbound events are listener-only until explicitly allowlisted.

---
*Built with ❤️ by ABS (Agent Business System) for the Global & Vietnamese AI Agent Community.*
