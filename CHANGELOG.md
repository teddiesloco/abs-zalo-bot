# Changelog

## v0.7.1 (2026-09-11)

### Ported from 2anh-zalo-bot v1.1.1–v1.3.0

- **Listener Auto-Restart:** Bắt sự kiện `closed` của `zca-js` khi listener đóng hoàn toàn (bot "điếc" ngầm), tự mở lại theo nhịp lũy tiến `[5s, 15s, 30s, 60s, 120s, 300s]` không cần khởi động thủ công.
- **Plaintext Fallback:** `performPersonalAction("send_message")` tự động lột style và gửi lại chữ thường khi Zalo từ chối tin nhắn có định dạng (mã lỗi số âm = server-side reject). Lỗi mạng không gửi lại tránh trùng tin.
- **Payload byte budget:** `measurePayloadBytes()` và `MAX_ZALO_PAYLOAD_BYTES = 3000` trong `zalo_styler.js` — bảo đảm gói tin không vượt ngưỡng thực đo 3.448 byte mà Zalo từ chối.
- **Fix `getGroupMembers`:** API mới `getGroupMembers(groupId)` trên `AccountRuntime` gọi `getGroupInfo` lấy danh sách UID thành viên trước, sau đó mới gọi `getGroupMembersInfo` đúng thứ tự, tránh lỗi API "không xác định".

## v0.7.0

- Added a one-command setup wizard for non-technical operators.
- Added doctor/dashboard-info commands and public verification gates.
- Added agent handoff instructions for AGENTS.md, Claude Code, and Codex CLI.
- Added public-safe installation, Personal QR, Official OA, operations, troubleshooting, and release docs.
- Kept Personal QR and Official OA boundaries separate and fail-closed.
