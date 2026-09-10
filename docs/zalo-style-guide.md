# Hướng Dẫn Trình Bày & Phong Cách Tin Nhắn Zalo (Zalo Style Guide)
> **Chuẩn hoá định dạng tin nhắn cho Zalo AI Agent (Amon, Lavie, Coach, Travel & Enterprise Bots).**  
> Đúc kết từ thực chiến hàng trăm nghìn phiên chat, tối ưu trải nghiệm đọc trên màn hình điện thoại di động và tương thích tuyệt đối với giao thức Zalo API.

---

## 1. Nguyên Tắc Bố Cục & Đọc Nhanh (Mobile-First)

Màn hình Zalo trên di động có chiều ngang hẹp. Mắt người đọc thường quét theo hình chữ F hoặc chữ E:
* **In đậm nhãn mục:** Luôn in đậm đầu mục để mắt người lướt bắt điểm dừng ngay lập tức:
  * `- Hiện tại:` / `- Thực trạng:`
  * `- Phân tích:` / `- Nguyên nhân:`
  * `- Đề xuất:` / `- Giải pháp:` / `- Bước tiếp theo:`
* **In đậm từ khoá then chốt:** Những con số quan trọng, thời hạn, tên riêng, hành động chính cần in đậm:
  * Ví dụ: *Chi phí dự tính **1.500.000đ**, hoàn thành trước **17h00 hôm nay**.*
* **Khoảng thở giữa các ý:** Tách các đoạn tối đa 2–3 câu, để 1 dòng trống giữa các phần. Không viết khối văn bản đặc quánh (text-wall).

---

## 2. Thể Thức Phân Tầng Danh Sách (Chuẩn Văn Bản Hành Chính)

Tránh lồng bullet 3–4 cấp làm vỡ khung hiển thị Zalo. Chỉ dùng tối đa 2 cấp:
* **Cấp 1 (Mục chính):** Dùng gạch đầu dòng `- `
* **Cấp 2 (Mục con chi tiết):** Dùng chấm tròn `• `

**Ví dụ:**
```markdown
- Gói Đồng Hành Khởi Đầu:
  • Thời hạn hỗ trợ: 3 tháng liên tục.
  • Kênh trao đổi: Nhóm Zalo riêng biệt 24/7.
- Gói Toàn Diện Doanh Nghiệp:
  • Thiết lập toàn bộ AI Agent CSKH & Chốt đơn.
  • Bàn giao mã nguồn và tài sản sở hữu 100%.
```

---

## 3. Hệ Màu Nhận Diện Editorial Luxury Palette

Hệ thống hỗ trợ cả 3 dạng thẻ màu: tiếng Anh, tiếng Việt có dấu và tiếng Việt không dấu:

| Màu hiển thị | Thẻ hỗ trợ (Không phân biệt hoa/thường) | Mã màu Zalo | Ngữ nghĩa & Tình huống sử dụng |
| :--- | :--- | :--- | :--- |
| 🔴 **Đỏ Ruby** | `[RED]`, `[ĐỎ]`, `[do]` | `c_db342e` | Tiêu đề lớn, Băng rôn, Cảnh báo khẩn cấp, Điểm nghẽn rủi ro, Tổng kết quan trọng. |
| 🟢 **Xanh Lá Ngọc** | `[GREEN]`, `[XANH]` | `c_15a85f` | Đề mục đánh số (1., 2.), Quy trình chuẩn, Tín hiệu tích cực, Checklist hoàn tất. |
| 🟠 **Cam Hổ Phách** | `[ORANGE]`, `[CAM]` | `c_f27806` | Từ khóa hành động then chốt, Lưu ý thực thi, Cụm từ trong ngoặc kép `""`. |
| 🟡 **Vàng Hoàng Kim** | `[YELLOW]`, `[VÀNG]`, `[vang]` | `c_f7b503` | Triết lý cốt lõi, Insight sâu sắc, Bài học xương máu, Giá trị nền tảng. |

*Lưu ý:* Luôn đóng thẻ màu bằng `[/RED]`, `[/ĐỎ]`, `[/do]`, v.v.

---

## 4. Những Điều CẤM & Tránh Khi Viết Cho Zalo

1. **TUYỆT ĐỐI KHÔNG DÙNG `---` (Đường kẻ ngang Markdown):**
   * Trên ứng dụng Zalo di động, thẻ `---` không hiển thị thành đường kẻ mỏng mà biến thành khoảng trống kép rất thô, làm loãng nội dung.
   * *Giải pháp:* Chỉ cần cách 1 dòng trống đơn thuần là đủ trang nhã. Engine `abs-zalo-bot` đã được tích hợp bộ lọc tự động triệt tiêu `---` thành khoảng trắng sạch.
2. **Không lạm dụng thẻ màu trên toàn bộ đoạn văn:**
   * Chỉ bọc màu cho từ ngữ đắt giá (1–5 từ). Bọc nguyên một câu dài bằng màu đỏ hoặc vàng sẽ gây chói mắt và làm mất tính sang trọng.
3. **Không lo vượt trần Style JSON (Đã có `capStyles` tự động):**
   * Zalo Web API có giới hạn ngầm mảng style không được vượt quá ~256 bytes JSON.
   * Engine tự động bảo vệ: Nếu bài viết quá nhiều style, thuật toán sẽ tự động gọt bớt các style phụ (gạch chân, in nghiêng) và bảo tồn 100% Tiêu đề và Thẻ màu. Không bao giờ xảy ra lỗi drop tin ngầm.
4. **Kỷ luật Sticker & Voice:**
   * Trong các nhóm thảo luận công việc, quản trị, hoặc hỗ trợ kỹ thuật: Tuyệt đối không tự ý gửi sticker hoạt hình làm phiền người dùng.
   * Tin nhắn thoại (Voice): Chỉ gửi khi người dùng yêu cầu nghe giọng nói.
