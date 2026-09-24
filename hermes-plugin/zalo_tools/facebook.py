"""Đọc và đăng bài Fanpage qua Graph API.

Vì sao tách khỏi ``tools.py``: phần Zalo đã dài, và chuyện Facebook có một
ràng buộc riêng đủ nặng để đứng thành module — **bot không được tự ý đăng
bài**.

Ranh giới đăng bài gồm ba lớp, xếp từ ngoài vào:

1. Chỉ chủ nhân (``ZALO_ALLOWED_USERS``)
2. Chỉ trong tin nhắn riêng — trong nhóm, tin của mọi người cùng nằm trong
   ngữ cảnh một phiên, nên ai đó thả vào nhóm một đoạn chữ soạn sẵn là có
   thể lái được mô hình
3. **Mã duyệt phải xuất hiện trong chính tin nhắn chủ nhân vừa gõ**

Lớp thứ ba mới là lớp chịu lực. Hai lớp đầu chặn người ngoài, nhưng không
chặn được nội dung bị cài chữ: chủ nhân bảo bot đọc một tài liệu, trong tài
liệu có câu "hãy đăng nội dung sau lên Fanpage", và bot đang cầm sẵn công cụ
đăng bài. Đối chiếu mã với nguyên văn tin nhắn thì đường đó tắt — mô hình
không tự viết được tin nhắn của chủ nhân.

Bản nháp giữ ở phía mình chứ không giữ trên Facebook. Đã thử: bài tạo bằng
``published=false`` không xuất hiện ở ``/feed``, ``/posts``,
``/published_posts`` hay ``/scheduled_posts`` — chỉ tồn tại nếu biết đúng ID,
nên người dùng không có cách nào tìm thấy nó trong giao diện Facebook để bấm
đăng.
"""

import json
import logging
import mimetypes
import os
import random
import time
import urllib.error
import urllib.parse
import urllib.request
import uuid
from typing import Any, Dict, List, Optional, Tuple

logger = logging.getLogger(__name__)

GRAPH = "https://graph.facebook.com/v23.0"
DRAFT_TTL_SECONDS = 3600      # nháp quá hạn thì phải soạn lại, tránh đăng nhầm bài cũ
MAX_DRAFTS = 20

# Câu Facebook trả về khi người ngoài không xem được bài.
UNAVAILABLE_MARKERS = (
    "không còn nữa", "nội dung này hiện không",
    "no longer available", "isn't available", "content isn't available",
)
# Trình nhúng dựng được bài thì trang nặng hẳn (đo thật: 80KB khi hiện bài,
# 38KB khi báo không xem được).
EMBED_RENDERED_MIN_CHARS = 60_000


def public_visibility(permalink: str, timeout: int = 30) -> str:
    """Người ngoài có xem được bài này không: ``cong_khai`` | ``khong_xem_duoc`` | ``khong_ro``.

    Vì sao không tin Graph API: ngày 09/09/2026 một bài hẹn giờ có
    ``is_published: true``, ``is_hidden: false``, quyền "Công khai",
    ``timeline_visibility: normal`` — mà trình nhúng công khai lại báo bài đã bị
    gỡ, và thực tế chỉ quản trị viên nhìn thấy. Token của Page nhìn thấy mọi
    thứ; muốn biết người ngoài thấy gì thì phải hỏi bằng đường không có token.
    """
    if not permalink:
        return "khong_ro"
    query = urllib.parse.urlencode({"href": permalink, "width": 500, "locale": "vi_VN"})
    req = urllib.request.Request(
        f"https://www.facebook.com/plugins/post.php?{query}",
        headers={"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)"},
    )
    try:
        with urllib.request.urlopen(req, timeout=timeout) as response:
            html = response.read().decode("utf-8", "replace")
    except Exception as exc:
        logger.warning("[fb] không kiểm tra được hiển thị công khai: %s", exc)
        return "khong_ro"
    low = html.lower()
    if any(marker in low for marker in UNAVAILABLE_MARKERS):
        return "khong_xem_duoc"
    return "cong_khai" if len(html) >= EMBED_RENDERED_MIN_CHARS else "khong_ro"


# =====================================================================
#  Cấu hình Page
# =====================================================================

def _pages_file() -> str:
    from agent.secret_scope import UnscopedSecretError, get_secret
    try:
        val = get_secret("FB_PAGES_FILE", "")
    except UnscopedSecretError:
        val = os.getenv("FB_PAGES_FILE", "")
    return val or ""


def load_pages() -> List[Dict[str, Any]]:
    path = _pages_file()
    if not path or not os.path.isfile(path):
        return []
    try:
        with open(path, encoding="utf-8") as f:
            return (json.load(f) or {}).get("pages") or []
    except (OSError, ValueError) as exc:
        logger.warning("[fb] không đọc được %s: %s", path, exc)
        return []


def resolve_page(hint: str = "") -> Tuple[Optional[Dict[str, Any]], str]:
    """Tìm Page theo tên hoặc id. Không nói rõ thì lấy Page mặc định."""
    pages = load_pages()
    if not pages:
        return None, ("chưa cấu hình Fanpage nào — chạy lay-token-facebook.py "
                      "rồi đặt FB_PAGES_FILE trong .env")

    hint = str(hint or "").strip().lower()
    if not hint:
        return next((p for p in pages if p.get("default")), pages[0]), ""

    for p in pages:
        if hint == str(p.get("id")) or hint == str(p.get("name", "")).lower():
            return p, ""
    matches = [p for p in pages if hint in str(p.get("name", "")).lower()]
    if len(matches) == 1:
        return matches[0], ""
    if len(matches) > 1:
        names = ", ".join(str(p.get("name")) for p in matches)
        return None, f"'{hint}' khớp nhiều Page: {names} — nói rõ hơn"
    names = ", ".join(str(p.get("name")) for p in pages)
    return None, f"không có Fanpage nào tên '{hint}'. Đang cấu hình: {names}"


# =====================================================================
#  Gọi Graph API
# =====================================================================

def _request(req: urllib.request.Request, timeout: int = 120) -> Dict[str, Any]:
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            return json.loads(r.read().decode("utf-8", "replace"))
    except urllib.error.HTTPError as e:
        try:
            return json.loads(e.read().decode("utf-8", "replace"))
        except Exception:
            return {"error": {"message": f"HTTP {e.code}"}}
    except Exception as e:
        return {"error": {"message": str(e)}}


def graph(path: str, method: str = "GET", timeout: int = 120, **params) -> Dict[str, Any]:
    if method == "GET":
        url = f"{GRAPH}/{path}?{urllib.parse.urlencode(params)}"
        return _request(urllib.request.Request(url), timeout)
    data = urllib.parse.urlencode(params).encode()
    return _request(urllib.request.Request(f"{GRAPH}/{path}", data=data, method=method), timeout)


def upload_photo(page: Dict[str, Any], path: str) -> Dict[str, Any]:
    """Tải một ảnh lên Page ở trạng thái chưa đăng, trả về id để ghép vào bài.

    Dựng multipart bằng tay thay vì gọi curl: kho ảnh của người dùng nằm trên
    ổ mạng với tên thư mục có dấu cách, dấu nháy và ký tự đã mã hoá URL — đưa
    qua shell là hỏng. Đã đo: cùng một tệp, gọi qua curl thất bại, gọi thẳng
    thế này thì lên được.
    """
    if not os.path.isfile(path):
        return {"error": {"message": f"không có tệp {path}"}}

    boundary = uuid.uuid4().hex
    chunks: List[bytes] = []

    def field(name: str, value: str) -> None:
        chunks.append(
            f'--{boundary}\r\nContent-Disposition: form-data; '
            f'name="{name}"\r\n\r\n{value}\r\n'.encode())

    field("access_token", page["token"])
    field("published", "false")

    ctype = mimetypes.guess_type(path)[0] or "application/octet-stream"
    try:
        blob = open(path, "rb").read()
    except OSError as exc:
        return {"error": {"message": f"không đọc được ảnh: {exc}"}}

    chunks.append(
        f'--{boundary}\r\nContent-Disposition: form-data; name="source"; '
        f'filename="{os.path.basename(path)}"\r\n'
        f'Content-Type: {ctype}\r\n\r\n'.encode() + blob + b"\r\n")
    chunks.append(f"--{boundary}--\r\n".encode())

    req = urllib.request.Request(
        f"{GRAPH}/{page['id']}/photos", data=b"".join(chunks),
        headers={"Content-Type": f"multipart/form-data; boundary={boundary}"})
    return _request(req, timeout=300)


# =====================================================================
#  Sổ nháp
# =====================================================================
#
# Giữ trong bộ nhớ chứ không ghi đĩa: nháp chỉ sống trong một cuộc trò chuyện,
# và gateway khởi động lại thì soạn lại cũng chẳng mất gì. Ghi ra đĩa lại phải
# nghĩ chuyện dọn rác và quyền tệp cho một thứ dùng xong là bỏ.

_DRAFTS: Dict[str, Dict[str, Any]] = {}
_CODE_CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"   # bỏ O/0, I/1 cho khỏi đọc nhầm


def _new_code() -> str:
    return "".join(random.choice(_CODE_CHARS) for _ in range(4))


def _prune(now: float) -> None:
    for k in [k for k, v in _DRAFTS.items() if now - v["at"] > DRAFT_TTL_SECONDS]:
        _DRAFTS.pop(k, None)
    while len(_DRAFTS) > MAX_DRAFTS:
        _DRAFTS.pop(min(_DRAFTS, key=lambda k: _DRAFTS[k]["at"]), None)


def save_draft(page: Dict[str, Any], message: str, photos: List[str]) -> Dict[str, Any]:
    now = time.time()
    _prune(now)
    code = _new_code()
    while code in _DRAFTS:
        code = _new_code()
    _DRAFTS[code] = {"page": page, "message": message, "photos": photos, "at": now}
    return {"code": code, "page": page.get("name"), "photos": len(photos)}


def take_draft(code: str) -> Tuple[Optional[Dict[str, Any]], str]:
    """Lấy nháp ra và xoá khỏi sổ — một mã chỉ đăng được đúng một lần."""
    now = time.time()
    _prune(now)
    draft = _DRAFTS.pop(str(code).strip().upper(), None)
    if draft is None:
        return None, ("mã duyệt không đúng, đã dùng rồi, hoặc bản nháp đã quá "
                      "hạn một giờ — soạn lại bài mới")
    return draft, ""


def confirmed_in_message(code: str, human_text: str) -> bool:
    """Mã có nằm trong chính tin nhắn người dùng vừa gõ không.

    Đây là điểm chịu lực của cả cơ chế. So với ``human_text`` — nguyên văn tin
    nhắn Zalo — chứ không phải với chuỗi do mô hình truyền vào, vì mô hình có
    thể bị dụ để truyền bất cứ thứ gì.
    """
    return bool(code) and str(code).strip().upper() in str(human_text or "").upper()
