# Changelog

## v0.9.1 (2026-09-17)

### ABS Enterprise Features

- **LaTeX to Unicode Math Engine (`src/zalo_math.js`):** Tự động chuyển đổi công thức toán, phương trình hoá học và ký tự Hy Lạp thành Unicode superscript/subscript tự nhiên trước khi gửi Zalo.
- **Auto Unicode Injection in Styler:** Tích hợp trực tiếp vào `parseMarkdownStyles`, làm sạch mọi biểu thức `$Ca^{2+}$`, `H_2O`, `x^2`, `\rightarrow` trước khi định dạng và chunk tin nhắn.

## v0.9.0 (2026-09-15)

### Voice & Audio Engine

- **Voice Note Transcoding for iPhone & Zalo PC:** Đóng gói âm thanh qua ffmpeg sang container M4A (AAC mono 44.1kHz, 64k) kèm cờ `+faststart` (đưa atom `moov` lên đầu stream) và tự động nối đuôi `.m4a` vào link CDN Zalo (`withAudioExtension`), giải quyết triệt để lỗi không nghe được hoặc undefined duration trên iOS (AVPlayer) và Desktop (Chromium).
- **Voice Dedup Guard (10 phút):** Cơ chế `createVoiceDedupGuard` ghi nhớ chữ ký `(chatId, filePath, size, mtime)` trong 10 phút, ngăn chặn việc bot gửi lặp 2 lần tin thoại khi gateway tự động nhặt tag media TTS.
- **Owner Wakeup & Short Name Parsing:** Chủ nhân (`isOwner === true`) được phép đánh thức bot trực tiếp mà không cần gõ `@` (*"Amon ơi"*, *"chào Amon"*, *"Amon đâu"*...). Hỗ trợ nhận diện text tag gõ tay khi nhóm ẩn danh sách thành viên.
- **Bare Call Context Buffer:** Nhận diện khi được gọi trơ tên bot kèm thán từ đệm (`isBareCall`) để bốc rolling context 5 tin gần nhất từ store nạp cho model.
- **Owner-only Groups Mode:** Hỗ trợ cấu hình `owner_only_groups` (`ZALO_OWNER_ONLY_GROUPS`). Trong các nhóm này, bot chỉ âm thầm lưu tin nhắn làm tai mắt (`owner_only_group_silent_store`), tuyệt đối im lặng với người ngoài, chỉ phản hồi khi chủ nhân ra lệnh.

## v0.7.1 (2026-09-11)

### Resilience & Byte Budget

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
