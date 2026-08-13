# ABS-Zalo-Bot — Offline Harness

## Mục tiêu

Test không cần QR, Zalo credential, Gemini/DeepSeek/Hermes API key, n8n server hay mạng thật.

## Fakes

- `fakeFetch`: ghi method, URL, headers, form/body; trả token/provider fixtures.
- `fakeClientFactory`: mô phỏng QR callback, session login và listener.
- `tmpDir`: SQLite runtime tạm, xóa theo test runner.
- `fakeClock`: test token expiry và cooldown bằng timestamp truyền vào.

## Fixtures bắt buộc

1. OA token refresh thành công.
2. OA access token còn hạn không refresh lại.
3. OAuth lỗi 401/invalid response không retry mù.
4. Refresh token rotation không ghi secret ra output.
5. OA user text hợp lệ.
6. OA event không phải text và payload thiếu field.
7. Webhook signature đúng/sai nếu bật.
8. Personal empty allowlist bị chặn.
9. Multi-bot/account không gửi chéo tenant.
10. Duplicate, too-long, secret-looking body và paused policy bị chặn.
11. MCP khởi động khi daemon down mà chỉ báo lỗi ở stderr.
12. QR endpoint trả QR nhưng không trả cookie/imei/session.

## Commands

```bash
npm ci
npm test
npm run self-check
npm run secret-scan
npm run validate-config
```

## Evidence format

Mỗi command phải lưu exit code và stdout/stderr thực tế. `npm run smoke` là live daemon smoke, chỉ chạy khi operator đã chủ động login; không dùng DB cũ để kết luận live.
