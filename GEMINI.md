# Gemini / Antigravity entrypoint

Read these first, in order:

1. `AGENTS.md` — safety boundary: what you may and may not change
3. `docs/agent-handoff.md` — full context packet
4. `README.md`

Then run:

```bash
node --version   # requires >= 22.5
npm ci
npm run doctor
npm test
```

## Three rules you must never break

- **Every outbound message is a side effect.** `draft_first` and an empty recipient allowlist
  stay fail-closed. The agent drafts; a human approves before anything is sent.
- **Safety decisions live in code, not in prompts.** Normalization, policy, routing, audit and
  redaction are deterministic. Do not move them into an LLM.
- **Do not add** broadcast, spam, friend-list mutation, group administration, login bypass,
  OTP/PIN handling, or arbitrary personal sends.

## Zalo OA and personal QR stay separate

The official OA adapter and the unofficial personal-QR adapter must not share logic or sessions.
Personal QR is for your own account, internal use or demo only.

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
