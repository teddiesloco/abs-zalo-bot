# Hướng dẫn cài đặt

## Supported runtime

- Node.js 22.5+.
- Linux hoặc macOS.
- npm đi cùng Node.js.
- Personal QR cần một account Zalo riêng.
- OA cần credentials do chủ OA quản lý.

## Điều kiện thật — cần gì, không cần gì

### Bắt buộc cho bản Personal QR

- Một máy chạy Linux hoặc macOS.
- Node.js `22.5+` và npm.
- Internet ổn định để cài dependency và kết nối Zalo Web.
- Một account Zalo **riêng cho bridge** và điện thoại để tự quét QR.

Không cần VPS hay model AI để cài và chạy listener ở chế độ `listen_only`.

### Khi nào cần VPS

VPS chỉ cần khi muốn chạy 24/7 hoặc không muốn phụ thuộc laptop. VPS nên có:

- Ubuntu/Debian hiện hành;
- ít nhất khoảng 1 vCPU, 1 GB RAM và 10 GB disk cho MVP local — đây là mức khởi điểm vận hành, không phải benchmark bảo đảm;
- HTTPS reverse proxy nếu dashboard/webhook cần truy cập từ ngoài;
- firewall, secret env/secret manager và backup riêng cho `data/`;
- cách mở dashboard an toàn trong lúc quét QR: SSH tunnel hoặc reverse proxy có auth.

Không mở `3871` thẳng ra Internet. QR/session là auth material; không gửi chúng vào log, issue hoặc chat.

### Khi nào cần model/API key

- `listen_only`: **không cần model** và không cần API key.
- Local fallback report: không cần model; nội dung do formatter deterministic tạo.
- Phân tích/suy luận bằng Hermes: cần một Hermes API server tương thích OpenAI `/v1/chat/completions`, cùng `HERMES_API_BASE`, `HERMES_API_MODEL` và key trong env nếu server yêu cầu.
- Không có model/API key thì hệ thống không tự bịa; nó dùng fallback hoặc giữ ở trạng thái review/dry-run tùy workflow.

Repo này không tự cài model, không tự cấp API key và không mặc định phụ thuộc OpenRouter/Anthropic/OpenAI.

### Có cần Telegram không?

Không để cài/chạy core bridge. Telegram chỉ là kênh vận hành tùy chọn do lớp triển khai bên ngoài cung cấp. Trên VPS headless, bản repo hiện hiển thị QR qua dashboard an toàn hoặc SSH tunnel; nó **chưa tự gửi ảnh QR vào Telegram**.

## Cài bằng wizard

```bash
bash setup.sh
```

Alias tương đương:

```bash
bash install.sh
npm run setup
```

Tham số:

```bash
bash setup.sh --non-interactive
bash setup.sh --skip-install
bash setup.sh --start
node scripts/setup.js doctor
node scripts/setup.js dashboard-info
```

### Wizard làm gì

- kiểm tra phiên bản Node;
- tạo `.env` từ `.env.example` nếu chưa có;
- tạo `config/bots.json` từ example nếu chưa có;
- tạo `data/`, `data/sessions/`, `data/qr/` với permission hạn chế;
- cài dependency bằng `npm ci`;
- chạy test và các gate offline;
- không login, không quét QR, không gửi message.

Wizard không ghi đè `.env` hoặc `config/bots.json` đã tồn tại.

## Cài thủ công

Chỉ dùng khi wizard không phù hợp:

```bash
node --version
npm ci
cp .env.example .env
cp config/bots.example.json config/bots.json
mkdir -p data/sessions data/qr
chmod 700 data data/sessions data/qr
npm test
npm run validate-config
npm run secret-scan
npm run syntax-check
npm run self-check
```

## Local vs VPS

### Local

- giữ `HOST=127.0.0.1`;
- mở dashboard trên cùng máy;
- không cần reverse proxy;
- phù hợp thử nghiệm và vận hành cá nhân.

### VPS

- giữ service bind localhost;
- dùng reverse proxy HTTPS;
- đặt dashboard token trong secret env;
- không gửi session/QR/cookie qua Telegram;
- dùng systemd template sau approval, không enable tự động.

## Sau cài đặt

```bash
npm start
```

Tài liệu thao tác: [quickstart-non-coder.md](quickstart-non-coder.md).
