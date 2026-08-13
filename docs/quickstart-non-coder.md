# Quickstart cho người không biết code

Mục tiêu: cài local, mở dashboard, quét QR và bắt đầu ở chế độ chỉ nghe. Không cần viết code.

## Bước 0 — biết mình đang cài gì

Có hai loại:

- **Personal QR**: account Zalo riêng, không chính thức, dùng để nghe/tổng hợp nội bộ.
- **OA**: tài khoản chính thức, phù hợp hơn khi nói chuyện với khách.

Trang này hướng dẫn Personal QR vì đây là đường dễ thử nhất. Nếu làm bot cho khách, chuyển sang [Official OA](official-oa.md).

## Bước 1 — chạy setup

Mở Terminal, vào thư mục repo, chạy:

```bash
bash setup.sh
```

Chờ tới khi thấy các dòng kiểm tra pass. Nếu setup báo Node quá cũ, cài Node.js 22.5+ rồi chạy lại. Không cần sửa code.

## Bước 2 — mở dashboard

```bash
npm start
```

Giữ cửa sổ này mở. Mở trình duyệt và vào:

```text
http://127.0.0.1:3871
```

Nếu dùng máy khác/VPS, đừng mở port thẳng ra Internet. Nhờ agent cấu hình HTTPS/auth sau khi đã hiểu rõ boundary.

## Bước 3 — quét QR

1. Bấm **Kết nối QR**.
2. Mở Zalo trên điện thoại.
3. Dùng account riêng để quét.
4. Nếu điện thoại hỏi xác nhận, tự xác nhận trên điện thoại.
5. Chờ dashboard hiện `connected`.

Agent không được nhận hoặc nhập OTP/PIN thay bạn.

## Bước 4 — chọn nơi nhận báo cáo

Trong ô **Destination group**:

1. Bấm **Quét group IDs**.
2. Chọn group điều hành muốn nhận báo cáo.
3. Lưu destination.

Nếu chưa chọn destination thì bot không được gửi. Đây là trạng thái an toàn bình thường.

## Bước 5 — chọn nguồn để nghe

Trong **Allowlist source**:

1. chọn một group;
2. đặt mode `listen_only`;
3. bấm thêm/cập nhật;
4. chờ một ít tin mới;
5. chỉ khi dữ liệu đúng, chuyển sang `digest_only`.

Đừng bắt đầu bằng `reply_enabled`.

## Bước 6 — kiểm tra

Mở terminal thứ hai:

```bash
npm run doctor
npm run status
```

Hỏi agent:

> “Kiểm tra bridge đang connected chưa, destination đã đặt chưa, nguồn nào đang listen_only/digest_only, và không gửi tin thật.”

## Bước 7 — thử tổng hợp

Có thể bấm **Digest now** trên dashboard. Nếu chưa connected hoặc chưa có destination, hệ thống sẽ chặn thay vì đoán.

Smoke test mặc định không gửi:

```bash
npm run smoke
```

Không chạy `BATTLE_SEND=true` nếu chưa được operator duyệt rõ destination và nội dung.

## Dừng hệ thống

Trong cửa sổ `npm start`, nhấn `Ctrl+C`. Nếu cần chặn gửi ngay, bấm **Kill switch ON** trước.

## Nếu gặp lỗi

Không xoá `data/`, không xoá session vội, không gửi `.env` cho người khác. Chạy:

```bash
npm run doctor
```

Sau đó gửi cho agent chỉ phần lỗi đã redact, không gửi token/cookie/QR/database.
