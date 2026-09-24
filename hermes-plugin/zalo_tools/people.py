"""Sổ hồ sơ người quen trên Zalo.

Hermes có sẵn ``memories/USER.md``, nhưng đó là **một** hồ sơ — của chủ nhân.
Trong một nhóm Zalo thì mỗi người là một người khác nhau, nên cần một cuốn sổ
tra theo UID Zalo: ai vừa nhắn, bot lật đúng trang của người đó.

Lưu bằng JSON chứ không phải SQLite. Quy mô ở đây là vài chục tới vài trăm
người trong mấy nhóm — một tệp đọc được bằng mắt thường và sửa được bằng tay
đáng giá hơn một cơ sở dữ liệu phải mở bằng công cụ riêng.

Cấu trúc::

    {
      "1234567890123456789": {
        "name": "Minh",
        "note": "Giáo viên Hoá, phụ trách Đoàn trường",
        "fields": {"lĩnh vực": "giáo dục", "vai trò": "phó bí thư"},
        "updated_at": 1788400000,
        "updated_by": "1234567890123456789"
      }
    }

Ranh giới quan trọng: hồ sơ ở đây là **lời tự khai**, không phải danh tính đã
xác thực. Ai cũng có thể nói "tôi là quản trị viên". Vì vậy nó chỉ dùng để
xưng hô và hiểu ngữ cảnh — không bao giờ được dùng để cấp quyền. Quyền vẫn
chỉ dựa vào ``ZALO_ALLOWED_USERS``.
"""

import json
import logging
import os
import time
from pathlib import Path
from typing import Any, Dict, Optional

logger = logging.getLogger(__name__)

MAX_NAME = 80
MAX_NOTE = 400
MAX_FIELDS = 12
MAX_FIELD_LEN = 120
MAX_PEOPLE = 5000


def _store_path() -> Path:
    """Nơi cất sổ. Mặc định nằm cạnh dữ liệu của sidecar."""
    explicit = (os.getenv("ZALO_PEOPLE_FILE") or "").strip()
    if explicit:
        return Path(explicit).expanduser()

    home = os.getenv("HERMES_HOME")
    base = Path(home).expanduser() if home else Path.home() / ".hermes"
    return base / "zalo" / "people.json"


def _load() -> Dict[str, Any]:
    path = _store_path()
    try:
        if not path.exists():
            return {}
        with path.open(encoding="utf-8") as fh:
            data = json.load(fh)
        return data if isinstance(data, dict) else {}
    except (OSError, json.JSONDecodeError) as exc:
        logger.warning("[zalo] không đọc được sổ hồ sơ (%s): %s", path, exc)
        return {}


def _save(data: Dict[str, Any]) -> bool:
    path = _store_path()
    try:
        path.parent.mkdir(parents=True, exist_ok=True)
        # Ghi ra tệp tạm rồi thay thế: mất điện giữa chừng không làm hỏng sổ cũ.
        tmp = path.with_suffix(".json.tmp")
        with tmp.open("w", encoding="utf-8") as fh:
            json.dump(data, fh, ensure_ascii=False, indent=2)
        tmp.replace(path)
        return True
    except OSError as exc:
        logger.warning("[zalo] không ghi được sổ hồ sơ (%s): %s", path, exc)
        return False


def _clip(value: Any, limit: int) -> str:
    return str(value or "").strip()[:limit]


def get_person(uid: str) -> Optional[Dict[str, Any]]:
    return _load().get(str(uid))


def describe_person(uid: str) -> str:
    """Một dòng ngắn để kẹp vào ngữ cảnh cho model. Rỗng nếu chưa biết ai."""
    p = get_person(uid)
    if not p:
        return ""

    bits = []
    if p.get("name"):
        bits.append(p["name"])
    fields = p.get("fields") or {}
    if isinstance(fields, dict):
        bits += [f"{k}: {v}" for k, v in list(fields.items())[:MAX_FIELDS]]
    if p.get("note"):
        bits.append(p["note"])
    return " · ".join(b for b in bits if b)


def remember_person(
    uid: str,
    *,
    name: str = "",
    note: str = "",
    fields: Optional[Dict[str, Any]] = None,
    updated_by: str = "",
) -> Dict[str, Any]:
    """Ghi hoặc bổ sung hồ sơ. Trường để trống thì giữ nguyên giá trị cũ."""
    uid = str(uid).strip()
    if not uid:
        raise ValueError("thiếu UID")

    data = _load()
    if uid not in data and len(data) >= MAX_PEOPLE:
        raise ValueError("sổ hồ sơ đã đầy")

    entry = dict(data.get(uid) or {})
    if name:
        entry["name"] = _clip(name, MAX_NAME)
    if note:
        entry["note"] = _clip(note, MAX_NOTE)

    if fields:
        merged = dict(entry.get("fields") or {})
        for k, v in list(fields.items())[:MAX_FIELDS]:
            key = _clip(k, 40)
            if key:
                merged[key] = _clip(v, MAX_FIELD_LEN)
        entry["fields"] = dict(list(merged.items())[:MAX_FIELDS])

    entry["updated_at"] = int(time.time())
    if updated_by:
        entry["updated_by"] = str(updated_by)

    data[uid] = entry
    _save(data)
    return entry


def forget_person(uid: str) -> bool:
    data = _load()
    if str(uid) not in data:
        return False
    data.pop(str(uid), None)
    _save(data)
    return True


def list_people(limit: int = 100) -> Dict[str, Any]:
    data = _load()
    items = sorted(
        data.items(), key=lambda kv: kv[1].get("updated_at", 0), reverse=True
    )[:limit]
    return {"count": len(data), "people": {k: v for k, v in items}}
