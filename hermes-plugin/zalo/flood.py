"""Chặn người nhắn dồn dập vào bot.

Khác với bộ giãn nhịp bên Node (bảo vệ tài khoản Zalo khỏi bị coi là spam),
cái này bảo vệ hai thứ khác:

* **Tiền.** Bot chỉ trả lời khi bị tag, nhưng mỗi lần tag là một lượt gọi mô
  hình. Ai đó tag hai mươi lần trong một phút là hai mươi lượt tính phí.
* **Nhóm.** Bot bị kéo vào một chuỗi trả lời liên tục sẽ làm loãng cuộc trò
  chuyện của những người khác.

Ba điều cố ý làm để không ảnh hưởng người dùng thật:

1. **Ngưỡng rộng tay.** Sáu tin trong mười lăm giây là nhanh hơn nhịp gõ của
   người đang hỏi bình thường khá nhiều. Người dùng thật gần như không chạm
   tới.
2. **Báo một lần rồi mới im.** Im lặng đột ngột khiến bot trông như hỏng, và
   người ta sẽ tag thêm nữa — phản tác dụng. Nói rõ một câu thì họ biết mà
   dừng.
3. **Chủ nhân được miễn.** Việc miễn trừ do bên gọi quyết định, không nhét
   vào đây, để lớp này chỉ làm đúng một việc là đếm.
"""

import time
from collections import deque
from typing import Deque, Dict, Tuple

# Ba trạng thái trả về cho bên gọi.
OK = "ok"                  # cho qua
JUST_MUTED = "just_muted"  # vừa chạm ngưỡng — nên báo đúng một câu
MUTED = "muted"            # đang trong thời gian nghỉ — im lặng


class FloodGuard:
    """Đếm tin theo cửa sổ trượt cho từng người gửi."""

    def __init__(self, threshold: int = 6, window_s: float = 15.0,
                 mute_s: float = 90.0) -> None:
        self._threshold = max(2, int(threshold))
        self._window = max(1.0, float(window_s))
        self._mute = max(1.0, float(mute_s))
        self._hits: Dict[str, Deque[float]] = {}
        self._muted_until: Dict[str, float] = {}

    def check(self, uid: str, now: float = None) -> str:
        """Ghi nhận một tin và cho biết có nên xử lý tiếp không."""
        if not uid:
            return OK
        now = time.monotonic() if now is None else now

        until = self._muted_until.get(uid)
        if until is not None:
            if now < until:
                return MUTED
            # Hết hạn nghỉ: xoá sạch dấu vết để họ bắt đầu lại từ đầu, không
            # phải vừa hết nghỉ đã dính tiếp vì mấy tin cũ còn trong cửa sổ.
            del self._muted_until[uid]
            self._hits.pop(uid, None)

        hits = self._hits.setdefault(uid, deque())
        hits.append(now)
        cutoff = now - self._window
        while hits and hits[0] < cutoff:
            hits.popleft()

        if len(hits) > self._threshold:
            self._muted_until[uid] = now + self._mute
            self._hits.pop(uid, None)
            return JUST_MUTED

        self._prune(now)
        return OK

    def remaining(self, uid: str, now: float = None) -> int:
        """Còn bao nhiêu giây nữa mới hết nghỉ. 0 nếu không bị nghỉ."""
        now = time.monotonic() if now is None else now
        until = self._muted_until.get(uid)
        return max(0, int(until - now)) if until else 0

    def _prune(self, now: float) -> None:
        """Dọn người đã lâu không nhắn, để bộ nhớ không phình theo thời gian.

        Bot chạy 24/7 trong nhiều nhóm, mỗi người lạ đi qua để lại một mục —
        không dọn thì đây là một chỗ rò rỉ chậm nhưng chắc chắn.
        """
        if len(self._hits) < 256:
            return
        cutoff = now - self._window
        for uid in [u for u, h in self._hits.items() if not h or h[-1] < cutoff]:
            self._hits.pop(uid, None)
        for uid in [u for u, t in self._muted_until.items() if t < now]:
            self._muted_until.pop(uid, None)
