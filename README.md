# ABS Zalo Bot


**Cài một lần · chạy được bằng nút/command đơn giản · agent và Codex đọc là biết cách làm việc**

Đây là một bridge Zalo local/VPS cho Hermes và các coding agent:

- **Zalo Personal QR**: nghe nguồn được phép, lưu dữ liệu cục bộ, tổng hợp về destination. Đây là đường *không chính thức*, chỉ dùng cho nội bộ/demo với account riêng.
- **Zalo OA**: adapter chính thức, tách riêng khỏi personal QR, phù hợp hơn cho customer-facing bot.
- **Policy Guard**: mặc định fail-closed; chưa cấu hình thì không gửi.
- **Dashboard**: người không biết code vẫn có thể kết nối QR, chọn nguồn, chọn destination, bật/tắt kill switch.
- **MCP**: agent có thể đọc status, groups, users, corpus và hỏi destination theo contract an toàn.

> Nếu chỉ muốn “cài cho chủ dùng được”, đọc **[Quickstart cho người không biết code](docs/quickstart-non-coder.md)**.
>
> Nếu giao repo cho Claude Code, Codex, Hermes hoặc agent khác, agent phải đọc **[AGENTS.md](AGENTS.md)** và **[Agent handoff](docs/agent-handoff.md)** trước khi chạy lệnh.

---



## Documentation map

Start here, in this order:

| File | What it is |
|---|---|
| `README.md` | This file — install, run, and what the project does |
| `docs/quickstart-non-coder.md` | Fastest path if you do not write code |
| `AGENTS.md` | Safety boundary every AI agent must follow |
| `docs/install.md` · `docs/configuration.md` | Setup and environment variables |
| `docs/personal-qr.md` · `docs/official-oa.md` | The two Zalo adapters |
| `docs/operations.md` · `docs/troubleshooting.md` | Running it day to day |
| `SECURITY.md` · `CONTRIBUTING.md` | Reporting issues and sending changes |
| `docs/internal/` | Design, spec, plan and verification notes kept for maintainers |


## Works with any AI coding tool

This repo follows the `AGENTS.md` convention that Codex, Cursor, Zed and other agents already read.
Each tool has its own entrypoint file; they all point at the same rule set:

| Tool | Entrypoint | How to start |
|---|---|---|
| Claude Code (Sonnet/Opus) | `CLAUDE.md` | open repo, run `claude` |
| Codex CLI (GPT) | `CODEX.md` + `AGENTS.md` | open repo, run `codex` |
| Antigravity / Gemini CLI | `GEMINI.md` | open repo, run the agent |
| Hermes Agent | `HERMES.md` + `SKILL.md` | `cp -r . ~/.hermes/skills/abs-zalo-bot` or attach via MCP |
| Cursor | `.cursorrules` | auto-loaded on open |
| GitHub Copilot | `.github/copilot-instructions.md` | auto-loaded in VS Code |
| Any other agent | `AGENTS.md` | drop the file into chat |

Same bootstrap for every tool:

```bash
node --version   # requires >= 22.5
npm ci
npm run doctor
npm test
```


## 1. Chọn đúng đường trước khi cài

| Nhu cầu | Chọn | Ghi chú |
|---|---|---|
| Nghe group nội bộ rồi tổng hợp về một group điều hành | Personal QR | Không chính thức, dùng account riêng, không spam/broadcast |
| Chat với khách, FAQ, lead, booking, thông báo chính thức | Zalo OA | Đường chính thức; cần OA credentials và HTTPS webhook |
| Chưa biết chọn gì | Bắt đầu Personal QR ở `listen_only` | Không bật gửi tự động; chỉ kiểm tra dữ liệu trước |

**Không dùng account Zalo cá nhân chính cho automation.** Không tự động nhập OTP/PIN, không bypass login, không gửi broadcast.

---

## 2. Cài nhanh — không cần biết code

### Cần có

- Máy Linux hoặc macOS.
- Node.js **22.5 trở lên**.
- Một account Zalo riêng nếu dùng Personal QR.
- Không cần API key để chạy Personal QR ở chế độ nghe/tổng hợp local.

### VPS, model và Telegram có bắt buộc không?

- **VPS:** không bắt buộc để thử hoặc chạy local. Chỉ cần khi muốn chạy 24/7; MVP nên bắt đầu khoảng 1 vCPU / 1 GB RAM / 10 GB disk và phải có HTTPS/auth nếu truy cập từ ngoài. Đây là mức khởi điểm vận hành, không phải cam kết tải.
- **Model/API key:** không bắt buộc cho `listen_only` hoặc local fallback. Chỉ cần Hermes API tương thích OpenAI `/v1/chat/completions` nếu muốn dùng LLM để phân tích/viết lại báo cáo. Repo không tự cài model và không tự cấp key.
- **Telegram:** không bắt buộc cho core bridge. QR trên máy local/VPS được xem trong dashboard; bản repo hiện chưa tự forward ảnh QR qua Telegram.
- **QR live:** có route thật `POST /api/accounts/:id/connect`, callback `QRCodeGenerated`, `GET /api/accounts/:id/qr` và dashboard hiển thị. Việc quét/xác nhận trên điện thoại vẫn là thao tác của chủ account.

Nếu không biết Node.js đang có chưa, giao đúng câu này cho agent:

> “Hãy kiểm tra máy này có Node.js 22.5+ chưa. Nếu chưa, hướng dẫn tôi cài; không nhập secret, OTP hay PIN thay tôi.”

### Một lệnh cài

Từ thư mục repo:

```bash
bash setup.sh
```

Setup sẽ tự động:

1. kiểm tra Node.js;
2. tạo `.env` local nếu chưa có;
3. tạo `config/bots.json` từ file mẫu nếu chưa có;
4. tạo thư mục dữ liệu với quyền local;
5. chạy `npm ci`;
6. chạy test, validate config, secret scan, syntax check và self-check;
7. in ra bước tiếp theo bằng tiếng Việt.

Setup **không** đăng nhập Zalo, không quét QR, không gửi tin, không tự nhập OTP/PIN và không đụng credential thật.

Nếu agent/CI cần chạy không hỏi:

```bash
bash setup.sh --non-interactive
```

Muốn setup xong rồi chạy luôn foreground:

```bash
bash setup.sh --start
```

### Chạy dashboard

Nếu chưa dùng `--start`:

```bash
npm start
```

Mở trình duyệt tại:

```text
http://127.0.0.1:3871
```

Dashboard mặc định bind localhost. Với máy remote/VPS, **không mở port thẳng ra Internet**; dùng reverse proxy HTTPS và token/auth riêng.

---

## 3. Kết nối Personal QR lần đầu

1. Chạy `npm start`.
2. Mở dashboard.
3. Bấm **Kết nối QR** — dashboard gọi route live và hiển thị ảnh QR.
4. Dùng điện thoại quét QR bằng **account riêng**.
5. Chờ trạng thái `connected`.
6. Bấm **Quét group IDs** nếu cần cập nhật danh sách.
7. Chọn một group làm **Destination group**.
8. Thêm nguồn ở phần **Allowlist source**.
9. Bắt đầu bằng `listen_only`.
10. Chỉ khi đã kiểm tra dữ liệu đúng, chuyển một nguồn sang `digest_only`.

Ý nghĩa mode:

- `off`: tắt nguồn.
- `listen_only`: chỉ lưu, không tổng hợp/gửi.
- `digest_only`: đưa vào bản tổng hợp theo yêu cầu/lịch.
- `alert_only`: chỉ candidate ưu tiên cao mới được xét cảnh báo.
- `mention_only`: vẫn bị chặn reply khi `READ_ONLY_SOURCE=true`.
- `reply_enabled`: không tự vượt qua Policy Guard; chỉ dùng khi policy riêng đã được review.

**Mặc định an toàn:** source không được trả lời; DM không trả lời; mention không trả lời; outbound chỉ đến destination đã cấu hình.

Với VPS headless, mở dashboard qua SSH tunnel hoặc reverse proxy HTTPS có auth. Không mở port `3871` trực tiếp ra Internet và không gửi QR/session vào log hoặc chat.

---

## 4. Kiểm tra sau khi cài

Các lệnh không gửi tin thật:

```bash
npm run doctor
npm run status
npm test
npm run validate-config
npm run secret-scan
npm run syntax-check
npm run self-check
```

Kiểm tra kết quả:

- `npm test`: toàn bộ test pass.
- `npm run doctor`: không có lỗi cấu hình public/runtime.
- `status`: không in cookie, IMEI, refresh token hay raw session.
- `self-check`: destination/allowlist trống vẫn là trạng thái fail-closed bình thường.

Smoke test daemon:

```bash
npm run smoke
```

`npm run smoke` chỉ kiểm tra health/MCP/safety. **Không gửi tin thật** nếu chưa đặt `BATTLE_SEND=true`.

---

## 5. OA chính thức

Personal QR và OA là hai đường khác nhau. Đừng trộn session Personal với OAuth OA.

### Chuẩn bị local

```bash
cp config/bots.example.json config/bots.json
```

Mở `config/bots.json`, giữ bot ở `draft_first` và chỉ bật sau khi đã có credentials hợp lệ. File này đã bị ignore, không commit.

Credentials đặt trong `.env` hoặc secret manager local, **không dán vào chat, issue, README hay prompt agent**. Chỉ dùng tên biến đã khai báo trong `credential`:

- `ZALO_OA_APP_ID_DEMO_OA`
- `ZALO_OA_APP_SECRET_DEMO_OA`
- `ZALO_OA_REFRESH_TOKEN_DEMO_OA`
- `ZALO_OA_WEBHOOK_SECRET`

Giá trị thật không nằm trong repo public.

### Webhook

Route adapter:

```text
POST /webhooks/zalo/oa/:bot_id
```

Handler thực hiện ingress validation và normalize text event, sau đó acknowledge nhanh. Handler **không tự gọi AI và không tự gửi trả lời**. Workflow/agent bên ngoài phải có approval và policy riêng trước outbound.

Production cần:

- HTTPS reverse proxy;
- signature hoặc authenticated edge;
- giới hạn body;
- log chỉ gồm event ID/receipt đã redact;
- `draft_first` trước khi bật bất kỳ send path nào.

Xem chi tiết: [docs/official-oa.md](docs/official-oa.md).

---

## 6. Cấu trúc repo cho agent/CLI

```text
AGENTS.md                    luật bất biến cho mọi agent
CLAUDE.md                    entrypoint cho Claude Code
CODEX.md                     entrypoint/checklist cho Codex CLI
README.md                    trang chủ và quickstart
CONTRIBUTING.md              quy tắc đóng góp
SECURITY.md                  cách báo lỗ hổng
docs/internal/00-DESIGN.md                 kiến trúc
docs/internal/01-SPEC.md                   contract I/O
docs/internal/02-PLAN.md                   thứ tự build
docs/internal/03-HARNESS.md                offline test harness
docs/internal/04-VERIFY.md                 verification gate
docs/internal/05-CONTEXT.md                runtime constraints

setup.sh / install.sh        cài một lệnh
scripts/setup.js             setup + doctor + dashboard info
scripts/public-gate.js       validate-config/secret-scan/syntax-check

src/                       runtime deterministic
  policy.js                inbound/outbound guard
  store.js                 SQLite local
  zalo_runtime.js          personal QR listener
  bot_registry.js          registry + credential references
  oa_adapter.js            official OA OAuth/send boundary
  oa_webhook.js            official OA ingress boundary
  server.js                dashboard/API/webhook route

config/bots.example.json     registry mẫu public
config/bots.json             registry local, ignored
.env.example                biến môi trường mẫu
.env                        local, ignored

data/                      SQLite/session/QR, ignored
public/                     dashboard static
mcp/                        MCP stdio facade
test/                      offline tests
```

---

## 7. Luật dành cho agent, Claude Code và Codex

Agent phải làm theo thứ tự:

```text
1. đọc AGENTS.md
2. đọc docs/agent-handoff.md
3. chạy npm run doctor
4. đọc đúng file liên quan, không nạp cả repo vô ích
5. sửa nhỏ, test ngay
6. báo evidence thật: command, exit code, file, test
```

Agent **không được**:

- hỏi chủ dán API key, refresh token, cookie, IMEI, session, OTP hoặc PIN vào chat;
- tự nhập OTP/PIN hoặc tự xác nhận login bên thứ ba;
- bật public send, broadcast, deploy, systemd, credential change nếu chưa được duyệt;
- coi “đã viết code” là “đã chạy”; mọi claim done phải có runtime evidence;
- nói đã publish GitHub nếu chưa có auth và receipt thật;
- gọi LLM để quyết định các gate deterministic như empty, duplicate, quota, policy, signature.

Bộ chỉ dẫn đầy đủ: [docs/agent-handoff.md](docs/agent-handoff.md).

---

## 8. Troubleshooting nhanh

### `Node.js 22.5+ is required`

Cài Node.js bản LTS mới, mở terminal mới rồi chạy:

```bash
node --version
bash setup.sh
```

### Dashboard không mở

```bash
npm run doctor
npm start
```

Nếu port 3871 đang dùng, chạy với port khác:

```bash
PORT=3872 npm start
```

Sau đó mở `http://127.0.0.1:3872`.

### QR không hiện

- Kiểm tra `npm start` còn đang chạy.
- Bấm **Kết nối QR** lại.
- Không nhập PIN/OTP vào agent; tự thao tác trên điện thoại/app.
- Dùng account riêng, không dùng account cá nhân chính.

### `not_connected` khi digest/send

Đây là chặn an toàn. Kết nối QR trước, kiểm tra destination, rồi chạy lại. Không xoá session trừ khi chủ động muốn đăng nhập lại.

### `destination_unset`

Vào dashboard, chọn Destination group. Không đặt destination bằng ID đoán mò.

### `npm test` fail

Không bỏ qua test. Giao agent câu:

> “Chạy npm test, đọc test fail đầu tiên, xác định nguyên nhân bằng file/test liên quan, sửa tối thiểu rồi chạy lại. Không đụng secret/runtime data.”

### Muốn dừng ngay outbound

Trong dashboard bấm **Kill switch ON**, hoặc:

```bash
curl -X POST http://127.0.0.1:3871/api/kill-switch \
  -H 'content-type: application/json' \
  -d '{"paused":true}'
```

---

## 9. Dừng, backup và dữ liệu

Dừng foreground bằng `Ctrl+C`.

Dữ liệu local nằm trong `data/` và không được commit. Session Personal được lưu quyền hạn chế. Không gửi database/session/QR cho agent hoặc bên ngoài nếu chưa redact.

Trước khi đổi cấu hình lớn:

```bash
cp .env .env.backup.local
cp config/bots.json config/bots.backup.local.json
```

Các file backup local này cũng không được commit.

---

## 10. Production checklist

Chưa coi là production chỉ vì dashboard đã mở. Cần đủ:

- account/OA ownership rõ;
- allowlist và destination đã review;
- test xanh;
- secret ở secret manager/env, không ở Git;
- HTTPS + auth cho endpoint public;
- kill switch đã thử;
- logs không lộ PII/credential;
- systemd/Docker chỉ bật sau approval;
- live smoke có evidence thật;
- rollback: pause/disconnect/disable bot đã kiểm tra.

Systemd file trong repo chỉ là template, không tự enable.

---

## Tài liệu tiếp theo

- [Quickstart người không biết code](docs/quickstart-non-coder.md)
- [Hướng dẫn cài đặt](docs/install.md)
- [Agent handoff](docs/agent-handoff.md)
- [Personal QR](docs/personal-qr.md)
- [Official OA](docs/official-oa.md)
- [Commands](docs/commands.md)
- [Configuration](docs/configuration.md)
- [Operations](docs/operations.md)
- [Troubleshooting](docs/troubleshooting.md)
- [Release checklist](docs/release-checklist.md)
- [MCP notes](MCP.md)

## License

MIT. Xem [LICENSE](LICENSE).

**Không có “an toàn 100%”.** Official OA là đường nên ưu tiên cho khách hàng; Personal QR là đường unofficial có rủi ro nền tảng và chỉ nên dùng trong boundary đã review.
