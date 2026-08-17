# ABS Zalo Bot (Agent Business System)

**The Most Powerful Autonomous Zalo Engine for AI Agents & Hermes**

Install once · run from a dashboard button or one command · agents read the repo and know how to operate autonomously.

An enterprise-ready local/VPS Zalo bridge for Hermes, Claude Code, Codex and multi-agent systems:

- **Zalo Personal QR Engine**: Realtime listener, group management (kick, promote, transfer owner), interactive polls, message reactions, recall (undo), media upload, and destination digests.
- **Zalo Official Account (OA)**: Enterprise webhook adapter for customer support, lead capture, and AI chatbot automation with strict HMAC verification.
- **Policy Guard & RBAC**: Fail-closed by default. Multi-tiered permissions prevent unauthorized mutations or unapproved outbound side-effects.
- **Unified Control Dashboard**: Human-in-the-loop web UI (`http://127.0.0.1:3871`) for QR scanning, source group allowlisting, and emergency kill-switch.
- **Model Context Protocol (MCP)**: Native stdio MCP server (`abs-zalo-mcp`) providing 15+ specialized AI tools for group administration, user intelligence, and interactive workflows.

> Just want it running for the owner? Read the **[Non-coder quickstart](docs/quickstart-non-coder.md)**.
>
> Handing this repo to Claude Code, Codex, Hermes or any other agent? Read **[AGENTS.md](AGENTS.md)** and **[MCP.md](MCP.md)**.

---

## 🇻🇳 Tóm tắt tiếng Việt

`abs-zalo-bot` là hạ tầng kết nối Zalo toàn diện nhất cho AI Agents và Hermes:

1. **Zalo Cá nhân (Personal Engine)**: Quản trị nhóm chuyên sâu (kick thành viên, chuyển nhượng trưởng nhóm, bổ nhiệm/bãi nhiệm phó nhóm), tạo & khoá bình chọn (Polls), thả reaction, thu hồi tin nhắn (Undo), tra cứu thông tin người dùng/nhóm, và tự động thu thập ngữ cảnh (Corpus Listener).
2. **Zalo OA (Doanh nghiệp)**: Webhook 2 chiều chuẩn xác thực HMAC, quản lý hội thoại khách hàng, hỗ trợ lead generation & CSKH tự động.
3. **Bảo mật & Phân quyền (RBAC Policy Guard)**: Mặc định `fail-closed`, kiểm soát chặt chẽ quyền hạn trước khi thực thi bất kỳ tác vụ gửi tin hay quản trị nhóm nào.

Cài nhanh: `bash setup.sh` rồi `npm start`, mở `http://127.0.0.1:3871`.

---

## ⚡ MCP Tool Surface for AI Agents (`abs-zalo-mcp`)

| Category | Tool Name | Description |
| :--- | :--- | :--- |
| **Telemetry & Health** | `abs_zalo_status` | Check bridge connection, safety flags & corpus counts |
| | `abs_zalo_list_groups` | List allowlisted source & destination groups |
| | `abs_zalo_recent_messages` | Read captured message streams with rich metadata |
| | `abs_zalo_corpus_summary` | Get aggregated inventory of users, groups, and logs |
| **Group Administration** | `abs_zalo_kick_member` | Remove a member from a group (Admin/Owner required) |
| | `abs_zalo_transfer_owner` | Transfer group ownership (Owner required) |
| | `abs_zalo_add_deputy` | Promote a member to Group Deputy / Admin |
| | `abs_zalo_remove_deputy` | Demote a Group Deputy back to regular member |
| | `abs_zalo_invite_member` | Invite a user into a group |
| **Interaction & Polls** | `abs_zalo_create_poll` | Create interactive polls with custom options |
| | `abs_zalo_lock_poll` | Lock / close an active voting poll |
| | `abs_zalo_react_message` | Send emoji reactions to messages (`/:heart`, `/:like`, etc.) |
| | `abs_zalo_undo_message` | Recall / undo a previously sent message |
| **Discovery & Search** | `abs_zalo_get_user_info` | Fetch public user profile by userId |
| | `abs_zalo_get_group_info` | Fetch group settings and metadata |
| | `abs_zalo_find_user` | Lookup user profile by phone number |
| | `abs_zalo_list_friends` | List all friends of the account |
| | `abs_zalo_list_all_groups`| Fetch all joined groups from Zalo server |

---

## 🚀 Quickstart & Verification

```bash
# 1. Install dependencies
npm ci

# 2. Run system doctor & verify tests (68 tests passing)
npm run doctor
npm test

# 3. Start the daemon (Port 3871)
npm start

# 4. Attach MCP Server to Hermes or Claude Desktop
node mcp/server.js
```

## 🔒 Security & Policy Boundaries

- **Side-effect control**: Every outbound message and administrative action is audited through `PolicyGuard`.
- **Credential isolation**: All session cookies and tokens are kept in private local storage; never exposed over prompts or logs.
- **Fail-closed default**: Inbound events are listener-only until explicitly allowlisted.

---
*Built with ❤️ by ABS (Agent Business System).*
