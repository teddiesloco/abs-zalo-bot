# Commands reference

## Setup and diagnostics

| Command | Tác dụng | Side effect |
|---|---|---|
| `bash setup.sh` | cài local + tạo file mẫu + chạy gates | tạo `.env`, config local, data |
| `bash setup.sh --non-interactive` | same, không hỏi | tạo local files |
| `bash setup.sh --start` | setup rồi chạy server foreground | mở local server |
| `npm run doctor` | kiểm tra runtime/config/data/gates | tạo database local nếu cần |
| `node scripts/setup.js dashboard-info` | in URL/bind/token status, không in token | không gửi |
| `npm run status` | xem status đã redact | đọc local DB |
| `npm run self-check` | kiểm tra fail-closed baseline | tạo/đọc local DB |

## Verification

```bash
npm test
npm run validate-config
npm run secret-scan
npm run syntax-check
npm run self-check
```

## Server

```bash
npm start
npm run dev
PORT=3872 npm start
```

Health không cần dashboard token:

```bash
curl -s http://127.0.0.1:3871/healthz
```

Health chi tiết cần auth khi token đã đặt:

```bash
curl -s http://127.0.0.1:3871/api/health -H 'x-bridge-token: <local-token>'
```

## Dashboard actions

- Kết nối QR
- Refresh
- Quét group IDs
- Kill switch ON/OFF
- Digest now
- Disconnect
- Lưu destination
- Thêm/cập nhật source mode
- Lưu role

## Safe API surface

| Method | Route | Mục đích |
|---|---|---|
| `GET` | `/healthz` | liveness/readiness cơ bản |
| `GET` | `/api/status` | status redact, cần auth nếu token bật |
| `GET` | `/api/health` | health chi tiết |
| `POST` | `/api/accounts/:id/connect` | bắt đầu QR/session connect |
| `GET` | `/api/accounts/:id/qr` | lấy QR hiện tại, không trả session |
| `POST` | `/api/destination` | đặt destination |
| `POST` | `/api/sources` | thêm source allowlist |
| `POST` | `/api/digest/run` | chạy digest theo policy |
| `POST` | `/api/kill-switch` | pause/resume outbound |
| `POST` | `/webhooks/zalo/oa/:bot_id` | OA ingress normalize/ack; không tự send |

## Live send warning

- Personal report/digest: chỉ destination, policy guard, account connected.
- OA text send: library adapter có thể gọi provider khi workflow ngoài đã duyệt; webhook core không tự gọi.
- Không dùng lệnh live send trong CI.
