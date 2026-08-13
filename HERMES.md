# Hermes Agent entrypoint

Two ways to install. Either works.

Read `AGENTS.md`, `BRAND.md` and `docs/agent-handoff.md` first.

## Option 1 — Install as a skill (fastest)

```bash
git clone https://github.com/teddiesloco/abs-zalo-bot.git
cp -r abs-zalo-bot ~/.hermes/skills/abs-zalo-bot
```

Hermes reads `SKILL.md` at the repo root (frontmatter `name: abs-zalo-bot`) and picks it up
when you mention Zalo, Zalo groups, or Zalo OA.

## Option 2 — Attach as an MCP server (most tools)

```bash
cd abs-zalo-bot
npm ci
npm run doctor
npm start          # daemon on port 3871
npm run mcp        # stdio MCP facade
```

Register it in your Hermes MCP config:

```json
{
  "mcpServers": {
    "abs-zalo": {
      "command": "node",
      "args": ["/path/to/abs-zalo-bot/mcp/server.js"]
    }
  }
}
```

Available tools: `zalo_status`, `zalo_list_groups`, `zalo_list_users`, `zalo_group_members`,
`zalo_recent_messages`, `zalo_corpus_summary`, `zalo_backfill`, `zalo_ask_destination`,
`zalo_refresh_discovery`.

## Boundaries Hermes must keep

- **Every outbound message is a side effect.** `draft_first` and an empty allowlist stay
  fail-closed. Hermes drafts, a human approves, then it sends.
- **Safety decisions live in code, not prompts.**
- **Do not add** broadcast, spam, friend-list mutation, group administration, login bypass,
  or OTP/PIN handling.
- **Personal QR is the unofficial path** — your own account, internal or demo use only.
  Real customers go through Zalo OA.

## Quick check

```bash
npm test                 # 66 tests
npm run validate-config
npm run secret-scan
curl -s http://127.0.0.1:3871/api/battle-ready
```

---

## Tóm tắt tiếng Việt (dành cho agent và người đọc Việt Nam)

Đây là adapter kênh Zalo cho AI agent. Hai đường tách biệt: **Zalo OA** (chính thức, dùng cho
khách hàng thật) và **Zalo cá nhân qua QR** (không chính thức, chỉ dùng nội bộ hoặc demo với
tài khoản của chính bạn).

Ba ranh giới không được phá:

1. **Mọi tin gửi đi là side effect.** `draft_first` và danh sách người nhận rỗng phải giữ
   fail-closed. Agent soạn, người duyệt rồi mới gửi.
2. **Quyết định an toàn nằm trong code, không nằm trong prompt.** Chuẩn hoá, chặn lọc, ghi vết,
   che dữ liệu đều là code.
3. **Không thêm** broadcast, spam, sửa danh sách bạn bè, quản trị nhóm, bỏ qua đăng nhập,
   xử lý OTP/PIN, hay gửi tin cá nhân tuỳ ý.

Không hardcode đường dẫn máy chủ, endpoint hay token — tất cả đi qua biến môi trường.
