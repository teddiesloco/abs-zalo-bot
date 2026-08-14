# Agent handoff — đọc trước khi làm việc

Tài liệu này là context packet cho Claude Code, Codex CLI, Hermes, OpenCode hoặc agent khác. Agent không có quyền phát ngôn/thay mặt chủ trong public action; chỉ làm trong boundary đã được duyệt.

## Boot sequence bắt buộc

```bash
pwd
node --version
npm run doctor
```

Sau đó đọc đúng phần liên quan:

1. `AGENTS.md` — luật bất biến.
3. `README.md` — user flow.
4. `internal/00-DESIGN.md` — kiến trúc.
5. `internal/01-SPEC.md` — contract.
6. `internal/02-PLAN.md` — thứ tự task.
7. `internal/04-VERIFY.md` — evidence gate.
8. `docs/` — hướng dẫn cụ thể.

Không nạp toàn bộ source nếu task chỉ chạm một module.

## Mục tiêu mặc định

- làm cho chủ dùng được dù không biết code;
- ưu tiên wizard, docs rõ, command có output ổn định;
- giữ Personal QR và Official OA tách biệt;
- deterministic safety chạy trước AI/provider;
- test offline trước live verification.

## Quyền và cấm

Agent được:

- đọc/sửa source trong repo;
- tạo docs, tests, config example;
- chạy npm test, public gates, self-check;
- chạy local server foreground/background có health check;
- tạo draft hoặc test fixture synthetic.

Agent không được tự làm:

- nhập OTP/PIN, cookie, IMEI, refresh token hay API secret;
- yêu cầu chủ dán secret vào chat;
- gửi message thật, broadcast, spam, publish, deploy hoặc bật systemd;
- đổi credential/quyền truy cập;
- xoá `data/`, session, database hoặc file hàng loạt;
- nói “đã chạy/live/publish” khi chưa có output thật.

Nếu cần một quyết định đổi scope, tiền, quyền, public action hoặc khó rollback: hỏi chủ đúng một câu, kèm phương án em khuyên dùng.

## Flow task chuẩn

### Install/setup

```bash
bash setup.sh --non-interactive
npm run doctor
```

Nếu thiếu Node, báo chính xác phiên bản đang có và hướng dẫn cài. Không tự cài phần mềm hệ thống nếu chưa được phép.

### Code change

```text
đọc contract -> viết/sửa test -> chạy test -> sửa tối thiểu -> chạy test lại -> gates -> báo evidence
```

Không thay đổi behavior safety chỉ để làm test xanh.

### Server/background

Nếu chạy background:

1. start bằng process manager của môi trường;
2. kiểm tra `GET /healthz`;
3. kiểm tra `GET /api/health` sau auth boundary;
4. chỉ tiếp tục khi output xác nhận server ready;
5. khi xong thì dừng process nếu đó chỉ là test.

### QR/login

Dừng tại checkpoint giao diện. Hướng dẫn chủ tự quét QR và tự xác nhận trên điện thoại. Không đọc/hiển thị session material.

### OA

OA webhook chỉ ingress/normalize/ack. Không nối AI/send vào webhook nếu chưa có approval, queue, policy và test outbound riêng.

## Những command an toàn

```bash
npm run doctor
npm test
npm run validate-config
npm run secret-scan
npm run syntax-check
npm run self-check
npm run status
npm run smoke
```

`npm run smoke` không gửi thật mặc định. `BATTLE_SEND=true` là side effect riêng, không tự bật.

## Format báo cáo bắt buộc

Mỗi lần trả kết quả:

```text
Kết luận: một câu
Đã làm: file/command cụ thể
Evidence: exit code, test count, endpoint hoặc artifact thật
Ảnh hưởng: nếu có
Còn lại: blocker/uncertainty thật
Bước tiếp theo: một hành động rõ
```

Không đưa secret, raw message, cookie, QR, database hoặc real ID vào báo cáo.

## Nếu user chỉ nói “cài cho tôi”

Agent chọn flow mặc định:

1. setup local;
2. run tests/gates;
3. start dashboard localhost;
4. hướng dẫn QR thủ công;
5. giữ `listen_only`;
6. hỏi một câu duy nhất khi cần chọn destination;
7. không gửi tin thật.

## Nếu user không biết code

Không bắt user đọc stack trace. Dịch lỗi thành:

- chuyện gì chưa xong;
- ảnh hưởng gì;
- họ cần bấm/gõ gì;
- agent đã kiểm chứng gì.

## Release/public repo

Trước khi đề nghị public:

```bash
npm ci
npm test
npm run validate-config
npm run secret-scan
npm run syntax-check
npm run self-check
git diff --check
```

Nếu chưa có GitHub auth/remote/publish receipt, báo `publish blocked`, không giả định đã public.
