# Thêm công cụ mới — những cái bẫy đã trả giá

Tài liệu này không mô tả kiến trúc (xem README). Nó ghi lại **những chỗ hỏng mà
không báo lỗi** — loại lỗi tốn nhiều giờ nhất, vì mọi thứ trông vẫn chạy đúng.

Điểm chung của sáu cái bẫy dưới đây: hệ thống không hề gãy. Log vẫn xanh, bot vẫn
trả lời, chỉ là trả lời sai thứ. Nên nguyên tắc bao trùm là **đo ở nơi người dùng
thật chạm tới**, không đo ở tầng gần mình nhất.

---

## 1. Hai bản module, hai trạng thái khác nhau

**Triệu chứng:** bot trả lời "Zalo chưa kết nối, chạy `npm start`…" trong khi
log vừa in `sidecar ready — logged in as …`.

Hermes nạp plugin dưới namespace riêng `hermes_plugins.<slug>`. Nếu adapter viết

```python
from plugins.zalo_tools.tools import set_active_adapter   # ✗
```

thì Python dựng ra một đối tượng module **thứ hai**, mang `_ACTIVE_ADAPTER` riêng:

```
adapter  ──gắn cầu vào──>  plugins.zalo_tools.tools          _ACTIVE_ADAPTER = adapter
agent    ──gọi công cụ──>  hermes_plugins.zalo_tools.tools   _ACTIVE_ADAPTER = None
```

Hai bên không bao giờ gặp nhau. Cách đúng là phân giải lúc chạy (xem `_zalo_tools()`
trong `zalo/adapter.py`) và **ghi tên module đã chọn vào log**:

```
[zalo] connected to sidecar at ws://… (công cụ: hermes_plugins.zalo_tools.tools)
```

> **Áp dụng rộng:** bất kỳ trạng thái nào chia sẻ giữa hai plugin đều dính bẫy này.
> Hằng số là chuỗi thì trùng lặp vô hại — chỉ **trạng thái thay đổi được** mới bắt
> buộc dùng chung một bản.

## 2. Plugin `kind: platform` nạp lười

Hermes hoãn import mọi platform plugin cho tới khi gateway thật sự chạm tới nền
tảng đó. Công cụ đăng ký ở đấy vào registry **muộn hơn** lúc Hermes chốt danh sách
toolset, nên bị coi là tên lạ và loại sạch — không một dòng cảnh báo.

**Quy tắc:** công cụ luôn nằm ở plugin `kind: standalone` riêng. Platform plugin
chỉ giữ adapter.

## 3. Hermes tự bật mọi toolset plugin nó chưa từng thấy

Đây là bẫy nguy hiểm nhất, vì nó **âm thầm vô hiệu hoá phân quyền**. Toolset mới
mặc định BẬT cho mọi phiên cho tới khi được khai là "đã biết":

```yaml
known_plugin_toolsets:
  zalo:
    - zalo_owner
    - zalo_public
```

Thiếu dòng này thì `zalo_owner` được cấp cho cả người lạ nhắn vào nhóm, dù adapter
đã giới hạn qua `toolsets_for_source()`.

## 4. Đừng đặt tên toolset trùng khoá nền tảng

Toolset tên `zalo` bị Hermes tự bật cho mọi phiên vì trùng khoá platform. Đổi
thành `zalo_owner` mới chặn được. (Đổi tên là cần, nhưng chưa đủ — vẫn phải làm
mục 3.)

## 5. Phân toolset chỉ là *giấu*, không phải *chặn*

Mục 3 và 4 cho thấy danh sách toolset có thể bị hệ thống can thiệp sau lưng mình.
Nên rào chắn thật phải nằm ở **tầng thực thi**: mỗi công cụ nhóm chủ nhân được
bọc một lớp kiểm tra danh tính người gửi (`_owner_only` trong `tools.py`). Dù công
cụ có lọt vào danh sách vì cấu hình sai, người ngoài gọi vẫn bị từ chối.

## 6. Composite `hermes-<platform>` tự sinh kéo theo cả kanban

Bẫy này ảnh hưởng **mọi** plugin platform, không riêng Zalo.

`hermes-zalo` không có trong `TOOLSETS`. Khi thiếu, `resolve_toolset()` tự sinh nó
bằng `_HERMES_CORE_TOOLS` — và bộ lõi ấy chứa sẵn 14 công cụ `kanban_*`. Khối
"recover non-configurable toolsets" trong `tools_config.py` thấy
`kanban ⊆ universe` nên bật kanban cho **mọi** người nhắn vào nền tảng, đi vòng
qua `toolsets_for_source()`. Không cấu hình nào cản được:
`known_builtin_toolsets` không ăn thua (kanban không phải "recently shipped"),
còn `agent.disabled_toolsets` thì áp dụng toàn cục cho mọi nền tảng.

Cách xử lý ở đây (`define_platform_composite()` trong `tools.py`): **định nghĩa
tường minh** `hermes-zalo` để nhánh tự sinh không chạy nữa, lấy
`_HERMES_CORE_TOOLS` làm gốc (để bám theo Hermes khi nâng cấp) và trừ đi đúng
phần kanban. Chủ nhân vẫn dùng kanban qua Zalo được vì adapter liệt kê thẳng
`kanban` trong override dành riêng cho họ.

> Nhớ dọn `toolsets._resolve_toolset_memo` sau khi định nghĩa: bộ đệm khoá theo
> registry chứ không theo `TOOLSETS`, nên định nghĩa đến muộn có thể bị kết quả
> đã đệm che mất.

---

## Ghép API zca-js: đọc `.d.ts`, đừng tin trí nhớ

Tên trường giữa các API **không** thống nhất. Đầu ra của API này thường không
vừa đầu vào của API kia.

Ví dụ đã trả giá — `zalo_send_sticker` im lặng thất bại suốt vì:

| | Hình dạng |
|---|---|
| `searchSticker` **trả về** | `{sticker_id, cate_id, type}` — snake_case |
| `sendSticker` **đòi** | `{id, cateId, type}` — camelCase, tên khác |

Truyền thẳng object sang thì `id`/`cateId` thành `undefined`, Zalo trả
`"Missing sticker id"`, còn agent thì thử vài lượt rồi tự chế lại câu trả lời
bằng emoji chữ — nhìn từ ngoài y như bot "không thích" gửi sticker.

Cũng vậy, **số lượng tham số** phải khớp. `getGroupChatHistory(groupId, count?)`
chỉ nhận hai; gọi ba tham số thì `null` rơi vào chỗ `count` và số tin yêu cầu bị
bỏ qua trong im lặng.

**Quy trình bắt buộc trước khi thêm một công cụ gọi API mới:**

```bash
cat node_modules/zca-js/dist/apis/<tenApi>.d.ts
```

Đọc đúng ba thứ: **thứ tự tham số**, **số lượng tham số**, **tên trường** của
object. Rồi gọi thử thật qua cầu nối trước khi viết công cụ Python.

---

## Kiểm chứng: đo đúng tầng

Ba lần trong quá trình làm, phép thử báo xanh trong khi hệ thống thật vẫn hỏng —
đều vì đo ở tầng thấp hơn tầng người dùng chạm tới:

| Đã đo | Bỏ qua mất | Hệ quả |
|---|---|---|
| `resolve_toolset()` trực tiếp | `_get_platform_tools()` | tưởng agent có công cụ, thực ra không |
| script Node gọi thẳng bridge | toàn bộ tầng Python | sticker "gửi được" nhưng bot vẫn không gửi được |
| số toolset trả về | công cụ có gọi nổi không | tưởng phân quyền xong, thực ra công cụ chết |

**Thứ tự kiểm chứng đúng, từ yếu tới mạnh:**

1. Đọc `.d.ts` — biết hình dạng đúng
2. Gọi thật qua cầu nối — biết API sống
3. Gọi qua handler Python với `set_turn_context` — biết phân quyền và ngữ cảnh đúng
4. **Tag bot trong nhóm thật** — cái duy nhất chứng minh cả chuỗi thông

Chỉ bước 4 mới là bằng chứng. Ba bước trên chỉ giúp thu hẹp chỗ hỏng.

---

## Log lúc đăng ký plugin KHÔNG tới được tệp

Plugin nạp trước khi handler ghi log gắn vào, nên mọi `logger.info` trong
`register()` biến mất — kể cả khi đăng ký thành công. Đừng dùng nó để xác minh.

Chỗ đo được thật là **trong adapter lúc `connect()`**: logger ở đó đã hoạt động,
và nó nằm trong đúng tiến trình gateway đang chạy. Xem
`_log_permission_selfcheck()` — mỗi lần khởi động ghi đúng hai dòng:

```
[zalo] tự kiểm quyền — chủ nhân: 92 công cụ (39 Zalo), nhạy cảm: [...]
[zalo] tự kiểm quyền — người trong nhóm: 13 công cụ (13 Zalo), không có công cụ nhạy cảm
```

Nếu dòng thứ hai có bất kỳ công cụ nhạy cảm nào, phân quyền đã hỏng — biết ngay
lúc khởi động thay vì đợi ai đó phát hiện trong nhóm.


---

## Trạng thái từng công cụ (kiểm chứng 2026-09-06)

Đã gọi thật qua cầu nối, không suy từ tài liệu. Bot lúc kiểm là **phó nhóm** ở
nhóm thử.

**Chạy được — 31 công cụ.** Toàn bộ nhóm đọc dữ liệu, gửi nội dung (văn bản,
sticker, tệp, liên kết, thoại, chuyển tiếp), bình chọn, lời nhắc, đổi tên nhóm,
link nhóm, tắt thông báo, ghim, hồ sơ bot, sổ người quen, kho tài liệu, đọc
trang web.

**Hỏng hoặc không ổn định — 3 công cụ:**

| Công cụ | Triệu chứng | Nguyên nhân |
|---|---|---|
| `zalo_read_history` | HTTP 404 | Giới hạn zca-js 2.1.2, gọi đúng chữ ký vẫn hỏng |
| `zalo_undo` | Không dùng được | `sendMessage` chỉ trả `{msgId}`, còn `undo` đòi cả `cliMsgId` — không có đường lấy |
| `zalo_web_search` | **Chập chờn** — cùng lúc có truy vấn được, có truy vấn lỗi | Đang dùng chế độ không khoá của Exa. Đặt `EXA_API_KEY` cho ổn định |

`zalo_undo` sửa được: listener vẫn nhận lại tin bot tự gửi (kèm `cliMsgId`), nên
có thể đệm một bảng `msgId → cliMsgId` ngắn hạn rồi tra khi thu hồi.

**Chưa kiểm được — 6 công cụ.** Chúng để lại dấu vết vĩnh viễn hoặc tác động
tới người thật, nên không thử tự động: `zalo_create_note` (không có API xoá ghi
chú), `zalo_create_group`, `zalo_invite_to_groups`, `zalo_join_group_link`,
`zalo_group_member_change`, `zalo_group_deputy`, `zalo_review_member` (cần có
người đang chờ duyệt). Tham số của chúng đã đối chiếu với `.d.ts`, nhưng đối
chiếu không phải là bằng chứng.

---

## Hai lỗi khả dụng đã sửa trong đợt này

**`zalo_list_groups` trả về vô dụng.** `getAllGroups` một mình chỉ cho
`{groupId: version}` — agent nhận một nắm số và không nói nổi cho người dùng
biết đó là nhóm nào. Nay gọi thêm `getGroupInfo` để trả tên, sĩ số và vai trò
của bot trong nhóm.

**Tạo được lời nhắc mà không xoá được.** Đặt nhầm giờ là lời nhắc nằm lại trong
nhóm vĩnh viễn, phải nhờ người vào Zalo xoá tay. Đã thêm `zalo_remove_reminder`.

Bài học chung: một công cụ "gọi không lỗi" chưa chắc dùng được. Phải nhìn vào
thứ nó trả về và hỏi *agent làm gì được với cái này*, và mỗi hành động tạo ra
thứ gì đó phải có đường dọn tương ứng.


## Một lỗ hổng phát hiện khi rà lại quyền trong nhóm

`zalo_send_file` là công cụ **công khai** và nó nhận đường dẫn tệp trên máy chủ.
Không giới hạn thư mục, nên bất kỳ ai trong nhóm chỉ cần nhờ *"gửi giúp mình
tệp `<hermes-home>/.env`"* là bot tải khoá API lên nhóm.

Việc lọc bí mật của Hermes không cứu được: nó soát **văn bản** đầu ra, còn đây
là tệp nhị phân đi thẳng lên máy chủ Zalo. Nhắc trong prompt cũng không phải là
ranh giới.

Đã vá: người ngoài chỉ gửi được tệp **nằm trong kho tài liệu** — đúng phạm vi
`zalo_kb_read` đã mở, không rộng thêm một tấc. Chủ nhân giữ nguyên quyền gửi tệp
bất kỳ.

Bài học rộng hơn: **mỗi công cụ công khai nhận đường dẫn, URL hay ID đều phải
được hỏi lại là "người ngoài truyền giá trị xấu nhất vào đây thì sao"**. Lần rà
đầu chỉ chia công cụ theo mức nguy hiểm mà quên soi từng tham số một.

---

## Ba lỗi tìm ra khi chạy thật trong nhóm

Cả ba đều không lộ ra ở bất kỳ phép thử tầng dưới nào.

### `uploadAttachment` báo thành công nhưng không gửi gì

Agent nói *"em đã gửi đính kèm 2 file"*, lịch sử phiên xác nhận nó **đã gọi**
`zalo_send_file` hai lần và cả hai trả `success: true` — nhưng trong nhóm không
có tệp nào.

`uploadAttachment` chỉ đẩy tệp lên CDN của Zalo và trả về `fileUrl`/`fileId`.
Nó **không** đăng tệp thành tin nhắn. Muốn gửi thật phải dùng
`sendMessage({msg, attachments}, threadId, type)`.

Dấu hiệu phân biệt nằm ngay ở giá trị trả về:

| Cách gọi | Trả về | Thành tin nhắn? |
|---|---|---|
| `uploadAttachment` | `{fileUrl, fileId, totalSize…}` | ❌ |
| `sendMessage` + `attachments` | `{message:{msgId}, attachment:[{msgId}]}` | ✅ |

**Quy tắc rút ra: mọi API gửi nội dung phải trả về `msgId`. Không có `msgId`
thì chưa có tin nhắn nào cả, dù `success: true`.**

### Tin nhắn kèm link bị vứt trong im lặng

`msg.data.content` không phải lúc nào cũng là chuỗi. Dán một đường link, gửi
ảnh hay tệp thì Zalo đổi nó thành object `{title, description, href, thumb…}`.
Code cũ chỉ nhận chuỗi nên tin có link thành rỗng, và bị bỏ ngay ở dòng
`if not text: return` — **không một dòng log nào**, nên nhìn từ ngoài y như bot
cố tình phớt lờ.

Cách phát hiện: đối chiếu tin nhắn thấy trên điện thoại với log. Tin không kèm
link đều có log, tin kèm link không có dòng nào — chênh lệch đó chỉ ra chỗ hỏng.

### Tiến trình nội bộ nhảy vào nhóm

`⌛ Working — 3 min — iteration 3/500, zalo_kb_list` hiện giữa cuộc trò chuyện.

Hermes có mặc định hiển thị riêng cho từng nền tảng (`_PLATFORM_DEFAULTS`),
nhưng **plugin platform không có mặc định nào** nên rơi vào cấu hình toàn cục
vốn dành cho terminal. Nhóm chat giống kênh Slack chứ không giống terminal: mỗi
dòng là một tin vĩnh viễn ai cũng thấy, không sửa lại được.

Khai trong `config.yaml`:

```yaml
display:
  platforms:
    zalo:
      tool_progress: "off"
      long_running_notifications: false
      busy_ack_detail: false
```

> Bất kỳ plugin platform nào cũng nên khai khối này ngay khi dựng, đừng đợi tới
> lúc tiến trình nội bộ rơi vào mặt khách hàng.

---

## Chậm ở đâu: đo, đừng đoán

Một lượt trả lời mất **320 giây** trong khi mô hình được quảng cáo là siêu
nhanh. Đo từng tầng thì thấy mô hình vô can:

| Tầng | Thời gian |
|---|---|
| Gọi mô hình (đo trực tiếp qua router) | 1,8 – 3,0s |
| Gọi mô hình kèm 14 lược đồ công cụ | 3,1 – 5,2s |
| Mọi công cụ khi ổ đĩa đang nóng | < 1s |

Mốc thời gian trong `state.db` chỉ đúng thủ phạm:

```
  5.3s   gọi tool_search
  1.6s   gọi zalo_kb_list
239.98s  ← kết quả zalo_kb_list
  0.7s   ← lần gọi thứ hai, cùng công cụ
 30.02s  ← zalo_send_file
 30.03s  ← zalo_send_file
```

Lần hai chỉ 0,7s. Đây là chênh lệch **nguội / nóng** của ổ mạng: kho tài liệu
nằm trên RaiDrive gắn Google Drive, và khi nguội thì duyệt 1180 thư mục hoặc
kéo một tệp về đều mất hàng chục giây tới vài phút.

Hai bản vá:

* **Đệm danh sách kho** (`_kb_listing`, TTL 300s) — đo được 4,6s lần đầu và
  0,00s các lần sau. Đệm cả cây rồi lọc trong bộ nhớ, nên câu hỏi với từ khoá
  khác cũng không phải duyệt lại.
* **Nới thời gian chờ riêng cho lệnh đọc tệp** (`SLOW_METHODS`, 150s). Hai lần
  đo được 30,02s và 30,03s — sát ngưỡng `ACK_TIMEOUT_SECONDS = 30` tới mức chỉ
  cần chậm thêm chút là hỏng. Nới riêng nhóm này chứ không nới tất cả: một lệnh
  gửi chữ mà treo 2 phút thì nên báo hỏng sớm.

> Truy vết bằng mốc thời gian trong `state.db` hiệu quả hơn hẳn việc đoán, vì
> nó chỉ thẳng ra khoảng trống nằm ở đâu. Con số tròn (30,0 / 240,0) luôn đáng
> ngờ — hoặc là timeout, hoặc là một hằng số nào đó, hiếm khi là công việc thật.

## Công cụ web chập chờn vì không có khoá backend

`web_search` và `web_extract` khi chưa cấu hình khoá sẽ xoay vòng qua các dịch
vụ không khoá (Firecrawl, Keenable, Exa). Đo cùng một URL sáu lần: **3 lần hỏng,
3 lần được** — mỗi lần một backend khác nhau báo lỗi.

Đã thêm thử lại trong `_core` — che bớt triệu chứng, đưa tỉ lệ lên 4/5.

**Cách chữa thật là đặt khoá.** Sau khi cắm `EXA_API_KEY`, đo lại với đầu vào
khác nhau mỗi lần (để bộ đệm không che kết quả):

| | Chưa có khoá | Có khoá |
|---|---|---|
| `web_search` | chập chờn | **4/4**, mỗi lượt ~1–1,5s |
| `web_extract` | 3/6 | **5/6** |

Lần trượt duy nhất là `moet.gov.vn`, và Exa trả rõ `CRAWL_LIVECRAWL_TIMEOUT` —
trang đích không cho thu thập chứ không phải backend hỏng. Lượt đó tính phí $0.

Vì backend đã ổn định, số lần thử lại giảm từ 3 xuống 2: một trang thật sự
không đọc được thì thử lại chỉ tổ bắt người trong nhóm chờ thêm.

## Link Google Docs: `/edit` không phải là nội dung

Link `/edit` trả về khung ứng dụng JavaScript, nên bộ đọc trang nhận được một
trang gần như trống kèm nút đăng nhập — và rất dễ kết luận nhầm là *"tài liệu
không được chia sẻ"*. Tài liệu công khai vẫn đọc được bình thường qua đường
`/export`:

| Loại | Đường đọc được |
|---|---|
| Docs | `/document/d/<id>/export?format=txt` |
| Sheets | `/spreadsheets/d/<id>/export?format=csv` |
| Slides | `/presentation/d/<id>/export/txt` |
| Tệp Drive | `/uc?export=download&id=<id>` |

`_google_export_url()` đổi tự động. Đổi **sau** khi kiểm tra an toàn, không phải
trước — để phép kiểm luôn nhìn đúng địa chỉ người dùng đưa vào.

---

## Kho tài liệu trên Google Drive: 10% số tệp vô hình

Bot báo *"chưa có tờ trình cho năm học 26-27"* trong khi người dùng mở File
Explorer ra thì thấy rõ. Soát thẳng ổ đĩa mới ra:

```
ĐOÀN CNT 26-27\...\01. Đội Thanh niên Xung kích\ĐỘI TNXK - TỜ TRÌNH CÔNG NHẬN BLĐ KHOÁ MỚI.gdoc.URL
```

Đuôi tệp là **`.gdoc.URL`**. Khi kho tài liệu là một ổ Google Drive gắn qua
RaiDrive (hoặc Drive for desktop), mọi tài liệu Google **gốc** — Docs, Sheets,
Slides — không hiện thành `.docx` mà thành một tệp lối tắt bé xíu:

```ini
[InternetShortcut]
URL=https://docs.google.com/document/d/<id>/edit?usp=drivesdk
```

Bộ lọc định dạng chỉ nhận `.docx`, `.pdf`, `.txt`… nên toàn bộ nhóm này bị bỏ
qua trong im lặng. Đếm trên kho thật: **553/5388 tệp (10,3%)** là `.url` —
trong đó có đúng tài liệu người dùng đang hỏi.

Bot không hề báo lỗi. Nó liệt kê những tệp nó *thấy được*, không tìm thấy thứ
cần, rồi kết luận là "chưa có" — nghe rất thuyết phục và hoàn toàn sai.

Bản vá: coi `.url` là một loại đọc được, đọc địa chỉ trong tệp rồi tải chính
tài liệu đó về qua đường `/export`. Kết quả: số tệp khớp "xung kích" tăng từ 3
lên 10, và tài liệu kia đọc ra đủ 922 ký tự.

> **Bắt buộc kiểm địa chỉ trước khi tải.** Một tệp `.url` là nội dung do người
> khác đặt vào kho. Thả vào một lối tắt trỏ tới `http://127.0.0.1/...` là có
> ngay đường vòng đọc dữ liệu nội bộ, đi qua lưng bộ chặn của `zalo_web_read`.
> Đã thử bốn dạng (loopback, metadata đám mây, `file://`, lối tắt rỗng) — chặn
> hết.

Bài học chung: **khi bot nói "không tìm thấy", hãy kiểm bộ lọc trước khi tin
nó.** Một câu trả lời tự tin dựa trên dữ liệu bị lọc mất còn nguy hiểm hơn một
lỗi rõ ràng, vì không ai nghĩ tới chuyện đi kiểm lại.
