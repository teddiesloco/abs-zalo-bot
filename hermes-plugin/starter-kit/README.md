# Hermes Zalo Starter Kit (Brain, Soul & Skills)

Bộ kit thiết lập trọn gói "Bộ Não" cho AI Agent khi kết nối với Zalo thông qua **ABS Zalo Bot**.

## 📦 Bộ kit bao gồm:

1. **`SOUL.md`**: Bản định hình tính cách trợ lý Zalo chuẩn ABS (ấm áp, tinh tế, tự nhiên, không sáo ngữ bot, tối ưu hiển thị chat điện thoại).
2. **`AGENT.md`**: Nguyên tắc vận hành, kiến trúc tất định (Deterministic AI) và ranh giới an toàn cho nhóm và cá nhân.
3. **`skills/zalo-customer-care`**: Kỹ năng tư vấn, chăm sóc khách hàng 1-1 và phân loại lead thực chiến.
4. **`skills/zalo-community-admin`**: Kỹ năng quản trị nhóm 24/7 (chào đón, trả lời FAQ, ghim thông báo, phòng chống spam).

---

## 🚀 Hướng dẫn kích hoạt 1-chạm vào Hermes Agent

### Bước 1: Sao chép Skills vào Hermes
```bash
# Tạo thư mục skills trong Hermes
mkdir -p ~/.hermes/skills

# Copy bộ kỹ năng Zalo thực chiến
cp -R skills/* ~/.hermes/skills/
```

### Bước 2: Nạp Soul & Agent Persona vào Profile của Hermes
```bash
# Thêm Soul vào profile Hermes của bạn (ví dụ profile mặc định default)
cat SOUL.md >> ~/.hermes/SOUL.md
```

### Bước 3: Cấu hình Agent Profile trong `config.toml` của ABS Zalo Bot
Mở file `config.toml` của abs-zalo-bot và thêm cấu hình profile tương ứng cho nhóm hoặc tài khoản:

```toml
[[agent_profiles]]
id = "zalo_concierge"
account_id = "default"
source_id = "*" # Hoặc điền ID nhóm Zalo cụ thể
gateway_skill = "zalo-customer-care"
tool_pack = "operator"
```

Khi có tin nhắn Zalo gửi đến, Hermes Agent sẽ tự động nạp linh hồn (Soul) và kích hoạt kỹ năng tương ứng để trò chuyện cực kỳ duyên dáng và chuyên nghiệp!
