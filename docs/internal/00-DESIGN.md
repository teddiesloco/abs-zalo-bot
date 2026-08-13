# ABS-Zalo-Bot — Design

## Định vị

ABS-Zalo-Bot (Agent Business System) là starter platform mã nguồn mở để đóng gói Zalo thành một channel adapter cho Hermes Agent, Claude Code, Codex, n8n và các agent runtime khác.

Một bản cài có thể quản lý nhiều bot độc lập. Mỗi bot có `bot_id`, adapter, tenant, session/credential, allowlist, policy và audit riêng.

## Nguyên tắc lõi

- **Adapter trước, nền tảng sau:** agent runtime nào cũng dùng cùng contract; không patch core agent.
- **Official first:** Zalo OA là đường production mặc định; Zalo cá nhân QR là adapter tùy chọn, dedicated account, rủi ro ToS ghi rõ.
- **Fail-closed:** chưa cấu hình bot, token, allowlist hoặc outbound policy thì không gửi.
- **One listener/account:** không chạy hai listener trên cùng nick cá nhân.
- **Credential isolation:** token/session chỉ ở runtime local, không vào Git, prompt, log, response status hay memory.
- **Human boundary:** tạo draft không đồng nghĩa gửi; publish, broadcast, credential và deploy cần approval riêng.
- **Deterministic core:** normalize, dedupe, rate-limit, token refresh, routing và policy không giao cho LLM.

## Kiến trúc

```text
Claude Code / Codex / n8n / agent runtime của bạn
                         |
              ABS channel contract + MCP
                         |
                 Bot Registry / Tenant
                    /             \
           Personal QR          Zalo OA
           (zca-js)        (official OAuth/webhook)
                |                    |
          session 0600        access token memory
                \                    /
                 Policy + Store + Audit
                         |
             optional Hermes brain / n8n workflow
                         |
                  approved outbound
```

## Luồng onboarding

1. Agent đọc `AGENTS.md` và `docs/agent-handoff.md`.
2. Tạo `bots.json` từ `config/bots.example.json`; không ghi secret.
3. Với personal: mở dashboard, tạo QR, user quét trên điện thoại, session lưu local 0600.
4. Với OA: cấu hình app ID/secret/refresh token qua env, đăng ký webhook public HTTPS.
5. Chạy self-check offline trước; foreground verify sau; systemd/Docker 24/7 chỉ bật sau review.

## Phạm vi v0.1

- Personal QR runtime hiện có, multi-account schema-ready và onboarding endpoint.
- OA OAuth refresh, webhook normalize và text send adapter có fetch injection để test offline.
- Bot registry/config example, MCP facade, n8n workflow starter, Docker Compose, systemd template.
- Public-safe docs, CI, secret scan và deterministic test harness.

## Không làm trong v0.1

- Không bypass login, CAPTCHA, rate limit hay ToS của Zalo.
- Không tự động spam/broadcast bằng nick cá nhân.
- Không tự tạo OA, tự đăng ký app, tự nhập OTP/PIN hoặc tự xác nhận production.
- Không gắn AI provider bắt buộc vào core; workflow có thể dùng Hermes, Gemini, DeepSeek hoặc provider khác qua HTTP.
- Không hứa “an toàn 100%”; official OA giảm rủi ro nền tảng, còn policy/rate-limit vẫn là trách nhiệm triển khai.

## Định nghĩa Done

Một clone sạch phải có thể: `npm ci` → `npm test` → `npm run self-check` → chạy dashboard localhost; đọc được contract từ Claude Code/Codex; tạo personal QR path hoặc OA token path mà không cần secret trong repo; mọi outbound đều có policy/audit evidence.
