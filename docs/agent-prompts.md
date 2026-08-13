# Copy-paste prompts for agents

Các prompt dưới đây dành cho chủ không biết code. Có thể dán nguyên văn vào Claude Code, Codex CLI, Hermes hoặc agent tương tự khi đang đứng trong thư mục repo.

## Cài lần đầu

```text
Đọc AGENTS.md, BRAND.md, docs/agent-handoff.md và README.md trước. Kiểm tra Node.js 22.5+. Chạy bash setup.sh --non-interactive. Không yêu cầu hoặc in secret, cookie, IMEI, QR/session, OTP/PIN. Không đăng nhập, không gửi tin và không deploy. Sau đó báo command, exit code và bước tiếp theo bằng tiếng Việt dễ hiểu.
```

## Mở cho chủ dùng

```text
Đọc docs/agent-handoff.md. Chạy npm run doctor, rồi start server foreground nếu doctor pass. Kiểm tra GET /healthz trước khi nói server đã sẵn sàng. In URL dashboard nhưng không in token. Hướng dẫn tôi tự quét QR trên điện thoại; không tự nhập OTP/PIN. Giữ source ở listen_only và không gửi tin thật.
```

## Kiểm tra trạng thái

```text
Không sửa gì và không gửi tin. Chạy npm run doctor, npm run status và healthz. Giải thích: connected chưa, listener sống chưa, destination đã đặt chưa, source mode nào đang bật, kill switch đang ở đâu. Không hiển thị raw session hay secret.
```

## Sửa lỗi test

```text
Đọc AGENTS.md và internal/04-VERIFY.md. Chạy npm test. Chỉ đọc file liên quan đến test fail đầu tiên. Sửa tối thiểu, chạy lại test và public gates. Không bỏ qua test, không tắt Policy Guard, không đụng .env/data/session.
```

## Muốn bật OA

```text
Đọc docs/official-oa.md và internal/01-SPEC.md. Chỉ kiểm tra registry example, env variable names, webhook signature/normalize bằng fixture. Không yêu cầu tôi dán credential vào chat. Không bật approved_send, không gửi provider message, không publish/deploy.
```

## Muốn chuẩn bị public release

```text
Đọc docs/release-checklist.md. Chạy npm ci, npm test, npm run validate-config, npm run secret-scan, npm run syntax-check, npm run self-check và git diff --check. Báo blocked nếu chưa có GitHub auth/remote/publish receipt; không giả định đã public.
```

## Format báo cáo mong muốn

```text
Kết luận:
Đã làm:
Evidence:
Ảnh hưởng:
Còn lại:
Bước tiếp theo:
```
