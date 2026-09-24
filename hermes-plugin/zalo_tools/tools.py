"""Công cụ Zalo cho Hermes Agent.

Mỗi công cụ ở đây là một lệnh gửi qua cầu WebSocket sang sidecar zca-js. Nhờ
lệnh ``invoke`` tổng quát bên cầu nối, thêm công cụ mới chỉ là thêm một mục
trong file này — không phải sửa cả hai phía.

Vì sao dùng công cụ thay cho trang quản trị: mọi thứ ở đây trước kia phải bấm
tay trong dashboard. Nói với agent "ghim tin nhắn đó lại" nhanh hơn mở trình
duyệt, tìm đúng hội thoại rồi gạt công tắc — và agent còn tự làm được cả chuỗi
việc mà giao diện không có nút nào tương ứng.

An toàn: cầu nối chỉ chấp nhận các hàm zca-js nằm trong danh sách trắng. Những
hàm dễ làm khoá tài khoản (gửi lời mời kết bạn hàng loạt, chặn người, giải tán
nhóm) hoặc chạm tới tiền bạc cố tình bị bỏ ra ngoài.
"""

import contextvars
import asyncio
import hashlib
import json
import logging
import os
import re
import secrets
import time
import unicodedata
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, List, Optional

logger = logging.getLogger(__name__)

# Hai toolset, hai mức quyền.
#
# TOOLSET_PUBLIC gom những việc chỉ tác động trong chính cuộc trò chuyện đang
# diễn ra. TOOLSET_OWNER gom những việc vươn ra ngoài nó — sang nhóm khác, sang
# hồ sơ tài khoản, hoặc phơi ra thông tin riêng của chủ.
#
# Toolset công khai KHÔNG kèm bộ công cụ lõi của Hermes (terminal, read_file,
# write_file, browser…). Đó mới là điểm mấu chốt: nếu người ngoài được dùng
# `hermes-zalo` thì họ chạy được lệnh shell và đọc được mọi tệp trên máy chủ,
# kể cả tệp chứa khoá API.
TOOLSET_PUBLIC = "zalo_public"
# Cố tình KHÔNG đặt tên trùng khoá nền tảng ("zalo"): Hermes tự bật toolset
# cùng tên với nền tảng cho mọi phiên, nên đặt trùng thì người ngoài cũng nhận
# luôn bộ công cụ dành riêng cho chủ.
TOOLSET_OWNER = "zalo_owner"
# Công cụ chỉ có nghĩa trong lượt chạy cron. Không nằm trong bộ nào
# toolsets_for_source trả về, nên chat thường không bao giờ thấy.
TOOLSET_CRON = "zalo_cron"
# Toolset ghép cho việc hẹn giờ do thành viên nhóm tạo: tra cứu và đọc lịch sử
# chính nhóm đó, không có gì khác. Xem define_cron_member_toolset().
TOOLSET_CRON_MEMBER = "zalo_cron_member"
CRON_MEMBER_TOOLS = (
    "zalo_web_search", "zalo_web_read", "zalo_kb_list", "zalo_kb_read", "zalo_group_history",
)

# Ngữ cảnh của lượt tin đang xử lý. Dùng ContextVar chứ không phải biến thường:
# gateway xử lý nhiều lượt song song, biến thường sẽ lẫn người này sang người
# kia — đúng loại lỗi khiến ai cũng thành chủ nhân.
_TURN: contextvars.ContextVar[Optional[Dict[str, Any]]] = contextvars.ContextVar(
    "zalo_turn", default=None
)
_CONFIRMED: contextvars.ContextVar[bool] = contextvars.ContextVar(
    "zalo_confirmed", default=False
)
_PENDING_CONFIRMATIONS: Dict[tuple, Dict[str, Any]] = {}
_CONFIRMATION_TTL_SECONDS = 300


def set_turn_context(*, sender_uid: str, thread_id: str, is_group: bool,
                     is_owner: bool, text: str = "", reply_msg_id: str = "",
                     reply_cli_msg_id: str = "", reply_is_own: bool = False,
                     msg_id: str = "", sender_name: str = "") -> None:
    """Adapter gọi trước khi đẩy tin vào agent.

    ``text`` là NGUYÊN VĂN tin nhắn người dùng vừa gõ, chưa qua tay mô hình.
    Đây là thứ duy nhất trong cả lượt mà mô hình không tự sinh ra được, nên
    những hành động cần người thật gật đầu (đăng bài lên Fanpage) đem mã duyệt
    ra đối chiếu với chính chuỗi này. Một tài liệu bị cài chữ có dụ được mô
    hình đến mấy cũng không đặt được chữ vào tin nhắn của chủ nhân.
    """
    _TURN.set({
        "sender_uid": str(sender_uid),
        "thread_id": str(thread_id),
        "is_group": bool(is_group),
        "is_owner": bool(is_owner),
        "text": str(text or ""),
        "reply_msg_id": str(reply_msg_id or ""),
        "reply_cli_msg_id": str(reply_cli_msg_id or ""),
        "reply_is_own": bool(reply_is_own),
        "msg_id": str(msg_id or ""),
        "sender_name": str(sender_name or ""),
    })


def bind_turn(turn: Optional[Dict[str, Any]]) -> None:
    """Gắn lại danh tính cho lượt agent sắp chạy.

    Hermes xử lý tin xếp hàng trong task tạo ra từ task của lượt trước, nên
    ContextVar kế thừa danh tính người gửi trước. Adapter gọi hàm này mỗi lượt
    để lượt nào cũng mang đúng người gửi của nó. Rỗng nghĩa là không ai.
    """
    _TURN.set(dict(turn) if turn else {})


def _turn() -> Dict[str, Any]:
    return _TURN.get() or {}


def current_authorization(*, confirmed: bool = False) -> Dict[str, Any]:
    """Return the non-model authority envelope attached to a bridge frame."""
    turn = _turn()
    if not turn:
        # Ngoài lượt chat (cron, thông báo của gateway) không có người gửi nào.
        # Sidecar cho vai trò này gửi văn bản / báo đang gõ tới BẤT KỲ hội
        # thoại nào, không được làm gì khác.
        return {
            "actorUid": "",
            "actorRole": "system",
            "sourceThreadId": "",
            "sourceThreadType": THREAD_USER,
            "confirmed": False,
        }
    auth = {
        "actorUid": str(turn.get("sender_uid") or ""),
        "actorRole": "owner" if turn.get("is_owner") else "public",
        "sourceThreadId": str(turn.get("thread_id") or ""),
        "sourceThreadType": THREAD_GROUP if turn.get("is_group") else THREAD_USER,
        "confirmed": bool(confirmed),
    }
    if turn.get("cron_job_id"):
        auth["cronJobId"] = str(turn["cron_job_id"])
    return auth


def _current_thread() -> Optional[str]:
    return _turn().get("thread_id")


def _current_thread_kind() -> str:
    return "group" if _turn().get("is_group") else "dm"

# Adapter đang sống tự ghi tên mình vào đây khi kết nối, để các công cụ tìm
# được đường ra cầu nối. Công cụ được đăng ký lúc nạp plugin, còn adapter thì
# mãi sau mới dựng — nên không truyền thẳng tham chiếu được.
_ACTIVE_ADAPTER = None

THREAD_USER = 0
THREAD_GROUP = 1


def set_active_adapter(adapter) -> None:
    global _ACTIVE_ADAPTER
    _ACTIVE_ADAPTER = adapter


def clear_active_adapter(adapter=None) -> None:
    global _ACTIVE_ADAPTER
    if adapter is None or _ACTIVE_ADAPTER is adapter:
        _ACTIVE_ADAPTER = None


# =====================================================================
#  Lượt chạy cron — gắn danh tính khi không có tin nhắn nào
# =====================================================================
#
# Cron chạy không kèm tin nhắn nên _TURN rỗng và mọi công cụ Zalo tự chặn.
# Hermes truyền `task_id = "cron:<job_id>:<lần chạy>"` vào từng lời gọi công
# cụ (cron/scheduler.py), nên đọc lại job là biết cron này gửi về đâu, do ai tạo.
#
# Job tạo bằng công cụ cron gốc của Hermes — chỉ chủ nhân cầm công cụ đó — chạy
# với quyền chủ nhân. Job do zalo_group_cron tạo mang `origin.zalo_scope =
# "group"` và chạy với quyền công khai của người tạo, khoá trong đúng nhóm.
# KHÔNG dựa vào origin.user_id: trong nhóm dùng chung phiên, Hermes có thể ghi
# vào đó UID của một thành viên khác.

GROUP_CRON_SCOPE = "group"


def _cron_jobs():
    """Module quản lý job cron của Hermes — tách thành hàm để test thay được."""
    from cron import jobs
    return jobs


def _cron_job_id(kw: Dict[str, Any]) -> str:
    parts = str(kw.get("task_id") or "").split(":")
    return parts[1] if len(parts) >= 2 and parts[0] == "cron" and parts[1] else ""


def _cron_target(job: Dict[str, Any]) -> str:
    """Hội thoại Zalo mà job gửi kết quả về; rỗng nếu job không gửi về Zalo."""
    for part in str(job.get("deliver") or "").split(","):
        part = part.strip()
        if part.startswith("zalo:"):
            return part[len("zalo:"):].split(":", 1)[0]
    origin = job.get("origin")
    if isinstance(origin, dict) and str(origin.get("platform") or "") == "zalo":
        return str(origin.get("chat_id") or "")
    return ""


def _is_group_cron(job: Dict[str, Any]) -> bool:
    origin = job.get("origin")
    return isinstance(origin, dict) and origin.get("zalo_scope") == GROUP_CRON_SCOPE


def _allowed_owner_uids() -> List[str]:
    from agent.secret_scope import UnscopedSecretError, get_secret
    try:
        raw = get_secret("ZALO_ALLOWED_USERS", "")
    except UnscopedSecretError:
        # Đang multiplex mà không có scope: os.environ có thể là chủ của hồ sơ
        # khác — coi như không có chủ nhân nào thay vì đọc nhầm sang họ.
        return []
    return [uid.strip() for uid in str(raw or "").split(",") if uid.strip()]


def _cron_is_group(target: str, origin: Dict[str, Any], owners: List[str]) -> bool:
    known = getattr(_ACTIVE_ADAPTER, "_known_thread_types", None) or {}
    if target in known:
        return known[target] == THREAD_GROUP
    chat_type = str(origin.get("chat_type") or "").lower()
    if chat_type in {"group", "dm"}:
        return chat_type == "group"
    if target in owners:
        return False
    return len(target) >= 19


def _cron_turn(kw: Dict[str, Any]) -> Optional[Dict[str, Any]]:
    """Dựng turn cho lời gọi công cụ đến từ cron; None nghĩa là không gắn gì."""
    job_id = _cron_job_id(kw)
    if not job_id:
        return None
    try:
        job = _cron_jobs().get_job(job_id)
    except Exception as exc:
        logger.warning("[zalo] không đọc được job cron %s: %s", job_id, exc)
        return None
    if not job:
        return None
    target = _cron_target(job)
    if not target:
        return None
    origin = job.get("origin") if isinstance(job.get("origin"), dict) else {}

    if _is_group_cron(job):
        creator = str(origin.get("zalo_creator_uid") or "")
        if not creator:
            return None
        return {
            "sender_uid": creator,
            "sender_name": str(origin.get("zalo_creator_name") or ""),
            "thread_id": target,
            "is_group": True,
            "is_owner": False,
            "text": "",
            "cron_job_id": job_id,
        }

    if "zalo_scope" in origin or "zalo_creator_uid" in origin:
        # Mang dấu vết cron nhóm mà không hợp lệ (sai giá trị, thiếu dấu) thì
        # không gắn gì — tuyệt đối không rơi xuống thành cron của chủ nhân.
        return None

    owners = _allowed_owner_uids()
    if not owners:
        return None
    return {
        "sender_uid": owners[0],
        "sender_name": "",
        "thread_id": target,
        "is_group": _cron_is_group(target, origin, owners),
        "is_owner": True,
        # Không có tin người thật gõ: mã duyệt đăng Fanpage không bao giờ khớp.
        "text": "",
        "cron_job_id": job_id,
    }


def _with_cron_turn(handler, tool_name: str):
    """Lớp bọc ngoài cùng: gắn danh tính cho lời gọi công cụ từ một lượt cron.

    Lượt chat đang có thì giữ nguyên — không bao giờ ghi đè người gửi thật.
    """
    async def guarded(args: Dict[str, Any], **kw) -> str:
        if _turn():
            return await handler(args, **kw)
        turn = _cron_turn(kw)
        if turn is None:
            return await handler(args, **kw)
        token = _TURN.set(turn)
        try:
            return await handler(args, **kw)
        finally:
            _TURN.reset(token)

    guarded.__name__ = getattr(handler, "__name__", tool_name)
    guarded.__doc__ = getattr(handler, "__doc__", None)
    return guarded


def _err(message: str) -> str:
    return json.dumps({"success": False, "error": message}, ensure_ascii=False)


def _ok(payload: Any) -> str:
    return json.dumps({"success": True, "result": payload}, ensure_ascii=False, default=str)


def _thread_type(kind: Optional[str]) -> int:
    return THREAD_GROUP if str(kind or "").lower() == "group" else THREAD_USER


def _scoped_thread(args: Dict[str, Any], key: str = "thread_id") -> tuple:
    """Chốt hội thoại đích cho một công cụ công khai.

    Người ngoài chỉ được tác động lên đúng cuộc trò chuyện họ đang tham gia.
    Nếu không ràng buộc, một tham số ``thread_id`` tuỳ ý là đủ để họ nhờ bot
    gửi tin hay tạo bình chọn trong nhóm khác mà họ không có mặt.

    Trả về ``(thread_id, kind, error)``; ``error`` khác None nghĩa là chặn.
    """
    turn = _turn()
    asked = str(args.get(key) or "").strip()
    current = _current_thread()

    if turn.get("is_owner"):
        # Chủ nhân được nhắm tới hội thoại bất kỳ.
        target = asked or current
        if not target:
            return None, None, _err(f"cần `{key}`")
        kind = args.get("thread_kind") or (_current_thread_kind() if target == current else "dm")
        return target, kind, None

    if not current:
        return None, None, _err("không xác định được cuộc trò chuyện hiện tại")
    if asked and asked != current:
        return None, None, _err(
            "chỉ dùng được trong chính cuộc trò chuyện này — không nhắm tới hội thoại khác"
        )
    return current, _current_thread_kind(), None


def _self_uid() -> str:
    """UID của chính tài khoản bot, rỗng nếu chưa nối được cầu."""
    adapter = _ACTIVE_ADAPTER
    profile = getattr(adapter, "_self_profile", None) or {}
    return str(profile.get("user_id") or "")


async def _invoke(method: str, args: List[Any]) -> str:
    """Gọi một hàm zca-js qua cầu nối và gói kết quả lại thành JSON."""
    adapter = _ACTIVE_ADAPTER
    if adapter is None:
        return _err(
            "Zalo chưa kết nối. Chạy `npm start` trong thư mục abs-zalo-bot, "
            "rồi khởi động lại gateway."
        )
    if _CONFIRMED.get():
        ack = await adapter.invoke(method, args, confirmed=True)
    else:
        ack = await adapter.invoke(method, args)
    if ack is None:
        return _err(f"Sidecar không phản hồi lệnh {method} (quá hạn chờ)")
    if not ack.get("ok"):
        return _err(ack.get("error") or f"{method} thất bại")
    return _ok(ack.get("result"))


# =====================================================================
#  Nhóm 1 — Gửi nội dung phong phú
# =====================================================================

async def zalo_send_file(args: Dict[str, Any], **_kw) -> str:
    paths = args.get("paths") or ([args["path"]] if args.get("path") else [])
    if not paths:
        return _err("cần `path` hoặc `paths`")
    thread_id, kind, err = _scoped_thread(args)
    if err:
        return err

    # Đây là công cụ công khai và nó nhận đường dẫn tệp trên máy chủ. Nếu để
    # nguyên thì bất kỳ ai trong nhóm cũng chỉ cần nhờ "gửi giúp mình tệp
    # E:\\Hermes\\.env" là bot ngoan ngoãn tải khoá API lên nhóm. Việc lọc bí
    # mật của Hermes không cứu được: nó soát văn bản, còn đây là tệp nhị phân
    # đi thẳng lên máy chủ Zalo.
    #
    # Nên người ngoài chỉ gửi được tệp NẰM TRONG kho tài liệu — đúng phạm vi
    # mà zalo_kb_read đã mở, không rộng thêm một tấc nào. Chủ nhân giữ nguyên
    # quyền gửi tệp bất kỳ.
    turn = _turn()
    if turn and not turn.get("is_owner"):
        root = _kb_root()
        if root is None:
            return _err("chưa cấu hình kho tài liệu nên chưa gửi tệp được")
        safe = []
        for p in paths:
            target = _kb_resolve(root, p)
            if target is None or not target.is_file():
                return _err(f"chỉ gửi được tệp trong kho tài liệu, không gửi được '{p}'")
            rel = target.relative_to(root).as_posix()
            if not _kb_allowed(rel):
                return _err(f"tệp '{rel}' nằm ngoài phạm vi được phép chia sẻ")
            safe.append(str(target))
        paths = safe

    # Gửi qua sendMessage chứ KHÔNG qua uploadAttachment.
    #
    # `uploadAttachment` chỉ đẩy tệp lên CDN của Zalo rồi trả về fileUrl —
    # nó không đăng tệp thành tin nhắn. API báo thành công, agent tin là đã
    # gửi và nói với người dùng như vậy, nhưng trong nhóm chẳng có gì. Không
    # có dấu hiệu nào để lần ra, vì mọi thứ đều "thành công".
    #
    # Dấu hiệu phân biệt: uploadAttachment trả về fileUrl/fileId, còn
    # sendMessage trả về `attachment: [{msgId}]` — có msgId mới là tin thật.
    caption = str(args.get("caption") or "").strip()
    return await _invoke("sendMessage", [
        {"msg": caption, "attachments": paths},
        thread_id, _thread_type(kind),
    ])


# Mỗi người trong nhóm tạo tối đa bấy nhiêu tệp trong một giờ (chủ nhân không giới hạn):
# nhóm vài trăm người mà ai cũng nhờ dựng tệp dài thì bot nghẽn và tốn token.
FILE_QUOTA_PER_HOUR = 5
_FILE_QUOTA: Dict[str, List[float]] = {}


async def zalo_make_file(args: Dict[str, Any], **_kw) -> str:
    """Dựng tệp Word/PowerPoint/Excel/PDF từ nội dung bot soạn rồi gửi vào nhóm đang chat.

    Người trong nhóm không có công cụ ghi tệp hay chạy lệnh, nên công cụ này chỉ nhận nội
    dung (xem file_maker) và dựng trong thư mục tạm, gửi xong là xoá.
    """
    from . import file_maker

    turn = _turn() or {}
    is_owner = bool(turn.get("is_owner"))
    if not is_owner and not turn.get("is_group"):
        return _err("chỉ tạo tệp cho thầy cô trong nhóm; nhắn riêng thì chưa hỗ trợ")
    thread_id, kind, err = _scoped_thread(args)
    if err:
        return err

    uid = str(turn.get("sender_uid") or "")
    now = time.time()
    if not is_owner:
        recent = [ts for ts in _FILE_QUOTA.get(uid, []) if now - ts < 3600]
        _FILE_QUOTA[uid] = recent
        if len(recent) >= FILE_QUOTA_PER_HOUR:
            wait = int((3600 - (now - recent[0])) // 60) + 1
            return _err(f"mỗi người tạo tối đa {FILE_QUOTA_PER_HOUR} tệp mỗi giờ — thử lại sau khoảng {wait} phút")

    import shutil
    import tempfile

    directory = tempfile.mkdtemp(prefix="zalo-file-")
    try:
        try:
            path = await asyncio.to_thread(
                file_maker.make_file,
                args.get("format"),
                args.get("title") or "",
                directory=directory,
                filename=args.get("filename"),
                content=args.get("content"),
                slides=args.get("slides"),
                sheets=args.get("sheets"),
            )
        except file_maker.FileSpecError as exc:
            return _err(str(exc))
        except ImportError:
            return _err("máy chủ chưa cài thư viện tạo tệp (python-docx, python-pptx, openpyxl, fpdf2)")
        caption = str(args.get("caption") or "").strip()
        sent = await _invoke("sendMessage", [
            {"msg": caption, "attachments": [str(path)]},
            thread_id, _thread_type(kind),
        ])
        if not is_owner and json.loads(sent).get("success"):
            _FILE_QUOTA.setdefault(uid, []).append(now)
        return sent
    finally:
        shutil.rmtree(directory, ignore_errors=True)


async def zalo_send_voice(args: Dict[str, Any], **_kw) -> str:
    url = str(args.get("url") or "").strip()
    if not url:
        return _err("cần `url`")
    thread_id, kind, err = _scoped_thread(args)
    if err:
        return err
    if os.path.isfile(url):
        turn = _turn()
        if not turn.get("is_owner"):
            root = _kb_root()
            target = _kb_resolve(root, url) if root is not None else None
            if target is None or not target.is_file():
                return _err("chỉ gửi được voice cục bộ nằm trong kho tài liệu")
            rel = target.relative_to(root).as_posix()
            if not _kb_allowed(rel):
                return _err(f"tệp '{rel}' nằm ngoài phạm vi được phép chia sẻ")
            url = str(target)
        adapter = _ACTIVE_ADAPTER
        if adapter is None:
            return _err("Zalo chưa kết nối")
        result = await adapter.send_voice(
            str(thread_id), url, metadata={"chat_type": kind}
        )
        if not result.success:
            return _err(result.error or "gửi voice thất bại")
        return _ok({"message_id": result.message_id})
    # Với URL, sidecar tự gửi yêu cầu HEAD tới địa chỉ đó từ máy chủ. Người
    # ngoài mà truyền địa chỉ nội bộ là dò được mạng LAN/localhost.
    if not _turn().get("is_owner") and not _is_public_url(url):
        return _err("chỉ gửi được voice từ địa chỉ web công cộng (http/https)")
    return await _invoke("sendVoice", [
        {"voiceUrl": url, "ttl": args.get("ttl", 0)}, thread_id, _thread_type(kind),
    ])


async def zalo_send_sticker(args: Dict[str, Any], **_kw) -> str:
    keyword = (args.get("keyword") or "").strip()
    if not keyword:
        return _err("cần `keyword`")
    thread_id, kind, err = _scoped_thread(args)
    if err:
        return err

    found = await _invoke("searchSticker", [keyword])
    payload = json.loads(found)
    if not payload.get("success"):
        return found
    stickers = payload.get("result") or []
    if isinstance(stickers, dict):
        stickers = stickers.get("items") or []
    if not stickers:
        return _err(f"không tìm thấy sticker nào cho '{keyword}'")

    # searchSticker trả về StickerBasic {type, cate_id, sticker_id} còn
    # sendSticker đòi {id, cateId, type}. Tên trường khác hẳn nhau, nên truyền
    # thẳng object sang thì id/cateId thành undefined và Zalo lặng lẽ không gửi.
    top = stickers[0]
    if not isinstance(top, dict):
        return _err(f"sticker trả về không đúng định dạng: {top!r}")
    sticker_id = top.get("sticker_id", top.get("id"))
    cate_id = top.get("cate_id", top.get("cateId"))
    if sticker_id is None or cate_id is None:
        return _err(f"sticker thiếu id/cateId: {sorted(top)}")
    payload_out = {
        "id": int(sticker_id),
        "cateId": int(cate_id),
        "type": int(top.get("type", 0)),
    }

    return await _invoke("sendSticker", [payload_out, thread_id, _thread_type(kind)])


async def zalo_send_link(args: Dict[str, Any], **_kw) -> str:
    url = args.get("url")
    if not url:
        return _err("cần `url`")
    thread_id, kind, err = _scoped_thread(args)
    if err:
        return err
    return await _invoke("sendLink", [
        {"link": url, "msg": args.get("message", "")}, thread_id, _thread_type(kind),
    ])


async def zalo_forward(args: Dict[str, Any], **_kw) -> str:
    message = args.get("message")
    targets = args.get("thread_ids") or []
    if not message or not targets:
        return _err("cần `message` và `thread_ids`")
    return await _invoke("forwardMessage", [
        {"message": message}, [str(target) for target in targets],
        _thread_type(args.get("thread_kind")),
    ])


# =====================================================================
#  Nhóm 2 — Đọc ngữ cảnh
# =====================================================================

HISTORY_RANGE_CHAR_BUDGET = 60_000
HISTORY_RANGE_MAX_HOURS = 24 * 7
HISTORY_RANGE_PAGE = 300
_VN_TZ = timezone(timedelta(hours=7))


def _history_line(msg: Dict[str, Any]) -> str:
    """Một tin thành một dòng gọn "[13/09 17:02] Tên: nội dung" để tiết kiệm token."""
    try:
        when = datetime.fromtimestamp(int(msg.get("ts") or 0) / 1000, tz=_VN_TZ).strftime("%d/%m %H:%M")
    except (TypeError, ValueError, OSError):
        when = "--/-- --:--"
    who = "Bot" if msg.get("isSelf") else (msg.get("senderName") or msg.get("senderUid") or "?")
    text = " / ".join(part.strip() for part in str(msg.get("text") or "").splitlines() if part.strip())
    if not text:
        text = f"[{msg.get('msgType') or 'tin không có chữ'}]"
    return f"[{when}] {who}: {text[:1000]}"


async def _read_history_range(adapter: Any, thread_id: str, kind: Any, args: Dict[str, Any]) -> str:
    """Đọc hết tin trong N giờ qua, lật trang tới khi hết hoặc chạm ngân sách chữ.

    Dành cho việc tổng hợp thảo luận khi chủ nhân yêu cầu: 100 tin gần nhất
    không đủ cho một nhóm cộng đồng. Chỉ dừng ở ranh giới trang, nên con trỏ trả
    về luôn đọc tiếp đúng chỗ, không mất tin nào.
    """
    try:
        hours = float(args.get("since_hours") or 24)
    except (TypeError, ValueError):
        return _err("since_hours phải là số giờ, ví dụ 24")
    hours = min(max(hours, 0.1), HISTORY_RANGE_MAX_HOURS)
    now_ms = int(time.time() * 1000)
    since_ms = now_ms - int(hours * 3600 * 1000)
    cursor = str(args.get("cursor") or "").strip() or None

    lines: List[str] = []
    size = 0
    next_cursor = None
    while True:
        ack = await adapter.read_history_range(
            thread_id, since_ms, now_ms, cursor=cursor, limit=HISTORY_RANGE_PAGE,
            metadata={"chat_type": kind},
        )
        if not ack or not ack.get("ok"):
            return _err((ack or {}).get("error", "không đọc được lịch sử Zalo"))
        result = ack.get("result") or {}
        for msg in result.get("messages") or []:
            line = _history_line(msg)
            lines.append(line)
            size += len(line) + 1
        cursor = result.get("nextCursor")
        if not cursor:
            break
        if size >= HISTORY_RANGE_CHAR_BUDGET:
            next_cursor = cursor
            break

    return _ok({
        "thread_id": thread_id,
        "since_hours": hours,
        "count": len(lines),
        "con_nua": bool(next_cursor),
        "next_cursor": next_cursor,
        "huong_dan": (
            "Còn tin chưa đọc: gọi lại zalo_read_history với cùng since_hours và cursor = next_cursor "
            "cho tới khi con_nua = false, rồi mới tổng hợp."
            if next_cursor else "Đã đọc hết tin trong khoảng thời gian này."
        ),
        "text": "\n".join(lines),
    })


async def zalo_read_history(args: Dict[str, Any], **_kw) -> str:
    thread_id, kind, err = _scoped_thread(args)
    if err:
        return err
    adapter = _ACTIVE_ADAPTER
    if adapter is None:
        return _err("Zalo chưa kết nối")
    if args.get("since_hours") is not None or args.get("cursor"):
        return await _read_history_range(adapter, str(thread_id), kind, args)
    count = min(int(args.get("count", 30)), 100)
    ack = await adapter.read_history(
        str(thread_id), count, metadata={"chat_type": kind}
    )
    if not ack or not ack.get("ok"):
        return _err((ack or {}).get("error", "không đọc được lịch sử Zalo"))
    return _ok(ack.get("result"))


async def zalo_group_history(args: Dict[str, Any], **_kw) -> str:
    """Đọc lịch sử của đúng hội thoại mà lượt cron này gửi kết quả về.

    Không nhận `thread_id` từ mô hình: hội thoại lấy từ turn do _with_cron_turn
    dựng từ job, nên prompt của thành viên có viết gì cũng không đọc được nhóm khác.
    """
    turn = _turn()
    if not turn.get("cron_job_id"):
        return _err("công cụ này chỉ dùng trong việc hẹn giờ của nhóm")
    thread_id = str(turn.get("thread_id") or "")
    if not thread_id:
        return _err("không xác định được nhóm của việc hẹn giờ")
    adapter = _ACTIVE_ADAPTER
    if adapter is None:
        return _err("Zalo chưa kết nối")
    count = max(1, min(int(args.get("count", 30) or 30), 100))
    ack = await adapter.read_history(
        thread_id, count, metadata={"chat_type": "group" if turn.get("is_group") else "dm"}
    )
    if not ack or not ack.get("ok"):
        return _err((ack or {}).get("error", "không đọc được lịch sử Zalo"))
    return _ok(ack.get("result"))


async def zalo_list_groups(args: Dict[str, Any], **_kw) -> str:
    """Liệt kê nhóm kèm TÊN, không phải chỉ dãy ID.

    ``getAllGroups`` một mình chỉ trả về ``{groupId: version}`` — agent nhận
    được một nắm số và không nói nổi cho người dùng biết đó là nhóm nào. Phải
    hỏi thêm ``getGroupInfo`` mới ra tên, sĩ số và vai trò của bot trong nhóm.
    """
    listed = await _invoke("getAllGroups", [])
    payload = json.loads(listed)
    if not payload.get("success"):
        return listed

    grid = (payload.get("result") or {}).get("gridVerMap") or {}
    group_ids = list(grid.keys())
    if not group_ids:
        return _ok({"count": 0, "groups": []})

    detail = await _invoke("getGroupInfo", [group_ids])
    dpayload = json.loads(detail)
    if not dpayload.get("success"):
        # Vẫn còn hơn không: trả ID để agent có cái mà tra tiếp.
        return _ok({"count": len(group_ids), "groups": [{"id": g} for g in group_ids],
                    "note": "không lấy được tên nhóm"})

    info = (dpayload.get("result") or {}).get("gridInfoMap") or {}
    self_uid = str(_self_uid() or "")
    groups = []
    for gid in group_ids:
        d = info.get(gid) or {}
        deputies = [str(x) for x in (d.get("adminIds") or [])]
        groups.append({
            "id": gid,
            "name": d.get("name") or "",
            "members": d.get("totalMember"),
            "my_role": ("trưởng nhóm" if str(d.get("creatorId")) == self_uid
                        else "phó nhóm" if self_uid and self_uid in deputies
                        else "thành viên"),
        })
    return _ok({"count": len(groups), "groups": groups})


async def zalo_group_members(args: Dict[str, Any], **_kw) -> str:
    # getGroupMembersInfo của zca-js nhận ID THÀNH VIÊN, không nhận ID nhóm —
    # truyền ID nhóm vào là luôn ra rỗng. Sidecar lo cả hai bước qua lệnh
    # group_members: hỏi getGroupInfo lấy danh sách ID rồi mới tra hồ sơ.
    thread_id, _kind, err = _scoped_thread(args)
    if err:
        return err
    adapter = _ACTIVE_ADAPTER
    if adapter is None:
        return _err("Zalo chưa kết nối")
    ack = await adapter.group_members(str(thread_id))
    if not ack or not ack.get("ok"):
        return _err((ack or {}).get("error", "không lấy được danh sách thành viên"))
    return _ok(ack.get("result"))


async def zalo_find_user(args: Dict[str, Any], **_kw) -> str:
    phone = (args.get("phone") or "").strip()
    username = (args.get("username") or "").strip()
    if phone:
        return await _invoke("findUser", [phone])
    if username:
        return await _invoke("findUserByUsername", [username])
    return _err("cần `phone` hoặc `username`")


async def zalo_user_info(args: Dict[str, Any], **_kw) -> str:
    uid = str(args.get("user_id") or "")
    if not uid:
        return _err("cần `user_id`")
    return await _invoke("getUserInfo", [uid])


async def zalo_list_friends(args: Dict[str, Any], **_kw) -> str:
    return await _invoke("getAllFriends", [])


# =====================================================================
#  Nhóm 3 — Tính năng riêng của Zalo
# =====================================================================

async def zalo_create_poll(args: Dict[str, Any], **_kw) -> str:
    question = (args.get("question") or "").strip()
    options = args.get("options") or []
    if not question or len(options) < 2:
        return _err("cần `question` và ít nhất 2 `options`")
    group_id, _kind, err = _scoped_thread(args, "group_id")
    if err:
        return err
    return await _invoke("createPoll", [{
        "question": question,
        "options": options,
        "allowMultiChoices": bool(args.get("multi_choice", False)),
        "allowAddNewOption": bool(args.get("allow_add_option", False)),
        "hideVotePreview": bool(args.get("hide_preview", False)),
        "isAnonymous": bool(args.get("anonymous", False)),
    }, group_id])


async def zalo_poll_detail(args: Dict[str, Any], **_kw) -> str:
    poll_id = str(args.get("poll_id") or "")
    if not poll_id:
        return _err("cần `poll_id`")
    return await _invoke("getPollDetail", [poll_id])


async def zalo_lock_poll(args: Dict[str, Any], **_kw) -> str:
    poll_id = str(args.get("poll_id") or "")
    if not poll_id:
        return _err("cần `poll_id`")
    return await _invoke("lockPoll", [poll_id])


def _poll_ids(values: Any) -> Optional[List[int]]:
    """Mã bình chọn/phương án của Zalo là số nhỏ (dưới 2^53); nhận chuỗi hoặc số."""
    if not isinstance(values, list):
        return None
    ids = []
    for value in values:
        text = str(value).strip()
        if not text.isdigit():
            return None
        ids.append(int(text))
    return ids


async def zalo_vote_poll(args: Dict[str, Any], **_kw) -> str:
    poll_id = str(args.get("poll_id") or "").strip()
    if not poll_id.isdigit():
        return _err("cần `poll_id` dạng số (lấy từ zalo_poll_detail)")
    option_ids = _poll_ids(args.get("option_ids"))
    if option_ids is None:
        return _err("`option_ids` phải là danh sách mã phương án (lấy từ zalo_poll_detail); danh sách rỗng là rút phiếu")
    return await _invoke("votePoll", [int(poll_id), option_ids])


async def zalo_add_poll_options(args: Dict[str, Any], **_kw) -> str:
    poll_id = str(args.get("poll_id") or "").strip()
    if not poll_id.isdigit():
        return _err("cần `poll_id` dạng số (lấy từ zalo_poll_detail)")
    options = [str(option).strip() for option in (args.get("options") or []) if str(option).strip()]
    if not options:
        return _err("cần ít nhất một phương án mới trong `options`")
    keep = _poll_ids(args.get("keep_voted_option_ids") or [])
    if keep is None:
        return _err("`keep_voted_option_ids` phải là danh sách mã phương án")
    vote_new = bool(args.get("vote", False))
    return await _invoke("addPollOptions", [{
        "pollId": int(poll_id),
        "options": [{"voted": vote_new, "content": option} for option in options],
        "votedOptionIds": keep,
    }])


async def zalo_create_note(args: Dict[str, Any], **_kw) -> str:
    title = (args.get("title") or "").strip()
    if not title:
        return _err("cần `title`")
    group_id, _kind, err = _scoped_thread(args, "group_id")
    if err:
        return err
    return await _invoke("createNote", [{
        "title": title,
        "pinAct": bool(args.get("pin", True)),
    }, group_id])


async def zalo_create_reminder(args: Dict[str, Any], **_kw) -> str:
    title = (args.get("title") or "").strip()
    start_time = args.get("start_time")
    if not title or start_time is None:
        return _err("cần `title` và `start_time` (mốc thời gian tính bằng mili giây)")
    thread_id, kind, err = _scoped_thread(args)
    if err:
        return err
    return await _invoke("createReminder", [{
        "title": title,
        "startTime": int(start_time),
        "repeat": int(args.get("repeat", 0)),
    }, thread_id, _thread_type(kind)])


async def zalo_list_reminders(args: Dict[str, Any], **_kw) -> str:
    thread_id, kind, err = _scoped_thread(args)
    if err:
        return err
    return await _invoke("getListReminder", [
        {"page": 1, "count": 20}, thread_id, _thread_type(kind),
    ])


async def zalo_remove_reminder(args: Dict[str, Any], **_kw) -> str:
    """Xoá một lời nhắc.

    Có mặt vì trước đây tạo được mà không xoá được: đặt nhầm giờ là lời nhắc
    nằm lại trong nhóm vĩnh viễn, phải nhờ người vào Zalo xoá tay.
    """
    reminder_id = str(args.get("reminder_id") or "")
    if not reminder_id:
        return _err("cần `reminder_id` (lấy từ zalo_list_reminders)")
    thread_id, kind, err = _scoped_thread(args)
    if err:
        return err
    return await _invoke("removeReminder", [reminder_id, thread_id, _thread_type(kind)])


async def zalo_pin_conversation(args: Dict[str, Any], **_kw) -> str:
    thread_id = str(args.get("thread_id") or "")
    if not thread_id:
        return _err("cần `thread_id`")
    return await _invoke("setPinnedConversations", [
        bool(args.get("pinned", True)), thread_id, _thread_type(args.get("thread_kind")),
    ])


async def zalo_mute(args: Dict[str, Any], **_kw) -> str:
    thread_id = str(args.get("thread_id") or "")
    if not thread_id:
        return _err("cần `thread_id`")
    duration = int(args.get("duration", -1))  # -1 = vĩnh viễn
    action = 1 if bool(args.get("muted", True)) else 3
    return await _invoke("setMute", [
        {"duration": duration, "action": action},
        thread_id, _thread_type(args.get("thread_kind")),
    ])


# =====================================================================
#  Nhóm 4 — Sửa sai & quản trị nhóm
# =====================================================================

def _with_quoted_undo_target(args: Dict[str, Any]) -> Dict[str, Any]:
    """Use the replied-to bot message when undo IDs were omitted."""
    resolved = dict(args)
    if resolved.get("msg_id") or resolved.get("cli_msg_id"):
        return resolved
    turn = _turn()
    if turn.get("reply_is_own") and turn.get("reply_msg_id") and turn.get("reply_cli_msg_id"):
        resolved["msg_id"] = str(turn["reply_msg_id"])
        resolved["cli_msg_id"] = str(turn["reply_cli_msg_id"])
    return resolved


async def zalo_undo(args: Dict[str, Any], **_kw) -> str:
    args = _with_quoted_undo_target(args)
    thread_id, kind, err = _scoped_thread(args)
    if err:
        return err
    msg_id = str(args.get("msg_id") or "") or None
    cli_msg_id = str(args.get("cli_msg_id") or "") or None
    adapter = _ACTIVE_ADAPTER
    if adapter is None:
        return _err("Zalo chưa kết nối")
    ack = await adapter.undo_message(
        str(thread_id), msg_id, cli_msg_id, metadata={"chat_type": kind},
        confirmed=_CONFIRMED.get(),
    )
    if not ack or not ack.get("ok"):
        return _err((ack or {}).get("error", "không thu hồi được tin Zalo"))
    return _ok(ack.get("result"))


async def zalo_rename_group(args: Dict[str, Any], **_kw) -> str:
    name = (args.get("name") or "").strip()
    group_id = str(args.get("group_id") or "")
    if not name or not group_id:
        return _err("cần `name` và `group_id`")
    return await _invoke("changeGroupName", [name, group_id])


async def zalo_group_member_change(args: Dict[str, Any], **_kw) -> str:
    group_id = str(args.get("group_id") or "")
    uids = args.get("user_ids") or []
    action = str(args.get("action") or "").lower()
    if not group_id or not uids or action not in {"add", "remove"}:
        return _err("cần `group_id`, `user_ids`, và `action` là 'add' hoặc 'remove'")
    method = "addUserToGroup" if action == "add" else "removeUserFromGroup"
    return await _invoke(method, [[str(uid) for uid in uids], group_id])


async def zalo_group_deputy(args: Dict[str, Any], **_kw) -> str:
    group_id = str(args.get("group_id") or "")
    uid = str(args.get("user_id") or "")
    action = str(args.get("action") or "").lower()
    if not group_id or not uid or action not in {"add", "remove"}:
        return _err("cần `group_id`, `user_id`, và `action` là 'add' hoặc 'remove'")
    method = "addGroupDeputy" if action == "add" else "removeGroupDeputy"
    return await _invoke(method, [uid, group_id])


async def zalo_pending_members(args: Dict[str, Any], **_kw) -> str:
    group_id = str(args.get("group_id") or "")
    if not group_id:
        return _err("cần `group_id`")
    return await _invoke("getPendingGroupMembers", [group_id])


async def zalo_review_member(args: Dict[str, Any], **_kw) -> str:
    group_id = str(args.get("group_id") or "")
    uids = args.get("user_ids") or []
    approve = bool(args.get("approve", True))
    if not group_id or not uids:
        return _err("cần `group_id` và `user_ids`")
    return await _invoke("reviewPendingMemberRequest", [{
        "members": [str(uid) for uid in uids],
        "isApprove": approve,
    }, group_id])


# =====================================================================
#  Nhóm 5 — Lập nhóm & lời mời
# =====================================================================

async def zalo_create_group(args: Dict[str, Any], **_kw) -> str:
    members = args.get("member_ids") or []
    if not members:
        return _err("cần `member_ids` — Zalo không cho lập nhóm rỗng")
    options: Dict[str, Any] = {"members": [str(m) for m in members]}
    if args.get("name"):
        options["name"] = str(args["name"])
    if args.get("avatar_path"):
        options["avatarSource"] = str(args["avatar_path"])
    return await _invoke("createGroup", [options])


async def zalo_invite_to_groups(args: Dict[str, Any], **_kw) -> str:
    user_id = str(args.get("user_id") or "")
    group_ids = args.get("group_ids") or []
    if not user_id or not group_ids:
        return _err("cần `user_id` và `group_ids`")
    return await _invoke("inviteUserToGroups", [user_id, [str(g) for g in group_ids]])


async def zalo_group_link(args: Dict[str, Any], **_kw) -> str:
    group_id = str(args.get("group_id") or "")
    if not group_id:
        return _err("cần `group_id`")
    action = str(args.get("action") or "detail").lower()
    if action == "enable":
        return await _invoke("enableGroupLink", [group_id])
    if action == "disable":
        return await _invoke("disableGroupLink", [group_id])
    return await _invoke("getGroupLinkDetail", [group_id])


async def zalo_join_group_link(args: Dict[str, Any], **_kw) -> str:
    link = (args.get("link") or "").strip()
    if not link:
        return _err("cần `link`")
    return await _invoke("joinGroupLink", [link])


# =====================================================================
#  Nhóm 6 — Hồ sơ của chính tài khoản bot
# =====================================================================

async def zalo_set_bio(args: Dict[str, Any], **_kw) -> str:
    bio = args.get("bio")
    if bio is None:
        return _err("cần `bio` (chuỗi rỗng để xoá dòng mô tả)")
    return await _invoke("updateProfileBio", [str(bio)])


async def zalo_set_active_status(args: Dict[str, Any], **_kw) -> str:
    if "active" not in args:
        return _err("cần `active` (true để hiện đang hoạt động, false để ẩn)")
    return await _invoke("updateActiveStatus", [bool(args["active"])])


# =====================================================================
#  Nhóm 7 — Kho tài liệu tư vấn (chỉ đọc, giới hạn trong một thư mục)
# =====================================================================
#
# Người trong nhóm không có `read_file` — nếu có thì họ đọc được mọi tệp
# trên máy chủ, kể cả tệp chứa khoá API. Nhưng để tư vấn sản phẩm thì bot
# vẫn cần đọc tài liệu. Hai công cụ dưới đây mở đúng một cánh cửa hẹp:
# chỉ đọc, chỉ trong thư mục ZALO_KB_DIR, và mọi đường dẫn đều được ép về
# đường dẫn thật rồi kiểm tra lại — nên `../` hay symlink không thoát ra
# ngoài được.

KB_MAX_BYTES = 60_000
KB_TEXT_SUFFIXES = {
    ".md", ".txt", ".html", ".htm", ".json", ".yaml", ".yml",
    ".csv", ".xml", ".rst", ".ini", ".toml",
}

# Tài liệu nhị phân đọc được nhờ bộ trích văn bản sẵn có của Hermes
# (``tools/read_extract.py``). Kho tài liệu thực tế của một đơn vị phần lớn là
# .docx và .pdf chứ không phải Markdown, nên chỉ nhận tệp văn bản thuần thì
# danh sách sẽ rỗng.
KB_DOC_SUFFIXES = {".docx", ".xlsx", ".pdf", ".doc", ".pptx", ".ppt", ".rtf", ".epub", ".odt"}

# Lối tắt tới tài liệu trên mây. Khi kho tài liệu là một ổ Google Drive gắn qua
# RaiDrive/Drive for desktop, mọi tài liệu Google gốc (Docs, Sheets, Slides)
# KHÔNG hiện thành .docx mà thành một tệp `.gdoc.URL` bé xíu chứa đúng một
# dòng địa chỉ. Bỏ qua nhóm này là mù với một phần lớn kho: đo trên kho Đoàn
# thật thì 553/5388 tệp (10%) thuộc dạng đó, trong đó có đúng tài liệu người
# dùng đang hỏi.
KB_LINK_SUFFIXES = {".url"}


def _kb_readable(suffix: str) -> bool:
    low = suffix.lower()
    return low in KB_TEXT_SUFFIXES or low in KB_DOC_SUFFIXES or low in KB_LINK_SUFFIXES


def _kb_extract(path) -> Optional[str]:
    """Rút văn bản từ tài liệu nhị phân. None nghĩa là không rút được."""
    try:
        from tools.read_extract import extract_document_text, is_extractable_document
    except Exception:
        return None
    try:
        if not is_extractable_document(str(path)):
            return None
        return extract_document_text(str(path))
    except Exception as exc:
        logger.debug("[zalo] không rút được văn bản từ %s: %s", path, exc)
        return None

# Thư mục không bao giờ đọc tới, kể cả khi nằm trong kho.
#
# Kho tài liệu thường trỏ vào một thư mục dự án chứ không phải một thư mục
# tài liệu thuần — và thư mục dự án thì lẫn cả mã nguồn, bản sao lưu đơn
# hàng, biến môi trường. Chặn theo tên thư mục là lớp phòng thủ thứ hai, sau
# lớp ép đường dẫn về trong kho.
KB_SKIP_DIRS = {
    "node_modules", "dist", "build", "out", "coverage", "__pycache__",
    "venv", ".venv", "vendor", "tmp", "temp", "cache",
}

# Tên gợi ý dữ liệu riêng tư — bỏ qua dù nằm ở đâu.
KB_SKIP_PATTERNS = (
    "backup", "order", "customer", "khach", "don-hang", "donhang",
    "secret", "credential", "password", "token", "private",
)


def _kb_public_dirs() -> tuple:
    """Các thư mục cấp 1 được phép lộ ra trong kho. Rỗng nghĩa là cả kho.

    Kho tài liệu thật thường là cả một ổ đĩa nhiều năm dồn lại, trong khi người
    trong nhóm chỉ cần vài thư mục của năm hiện hành. Khai báo
    ``ZALO_KB_PUBLIC_DIRS`` (các tên cách nhau bằng dấu phẩy) để đóng phần còn
    lại. Giới hạn áp cho mọi người, kể cả chủ nhân: danh sách tệp được đệm dùng
    chung giữa các lượt, nên phạm vi phụ thuộc người hỏi sẽ khiến lượt này thấy
    kết quả đệm của lượt kia. Chủ nhân cần đọc chỗ khác thì đã có read_file.
    """
    try:
        from agent.secret_scope import UnscopedSecretError, get_secret
        try:
            raw = get_secret("ZALO_KB_PUBLIC_DIRS", "")
        except UnscopedSecretError:
            raw = os.getenv("ZALO_KB_PUBLIC_DIRS", "")
    except Exception:
        raw = os.getenv("ZALO_KB_PUBLIC_DIRS", "")
    return tuple(part.strip().strip("/").lower() for part in str(raw or "").split(",") if part.strip())


def _kb_allowed(rel_posix: str) -> bool:
    """Đường dẫn tương đối này có nên lộ ra cho người hỏi không."""
    parts = rel_posix.split("/")
    scope = _kb_public_dirs()
    if scope and (len(parts) < 2 or parts[0].strip().lower() not in scope):
        return False       # ngoài phạm vi khai báo, kể cả tệp nằm ngay gốc kho
    for part in parts:
        if part.startswith("."):          # .git, .env, .backup, .astro…
            return False
        if part.lower() in KB_SKIP_DIRS:
            return False
    low = rel_posix.lower()
    return not any(p in low for p in KB_SKIP_PATTERNS)


def _kb_root() -> Optional["Path"]:
    from pathlib import Path
    raw = (_kb_dir_setting() or "").strip()
    if not raw:
        return None
    try:
        root = Path(raw).expanduser().resolve(strict=True)
    except (OSError, RuntimeError):
        return None
    return root if root.is_dir() else None


def _kb_dir_setting() -> str:
    import os
    from agent.secret_scope import UnscopedSecretError, get_secret
    try:
        val = get_secret("ZALO_KB_DIR", "")
    except UnscopedSecretError:
        val = os.getenv("ZALO_KB_DIR", "")
    return val or ""


def _kb_resolve(root, relative: str):
    """Ép một đường dẫn tương đối về trong ``root``. Trả None nếu thoát ra ngoài."""
    from pathlib import Path
    try:
        target = (root / str(relative).lstrip("/\\")).resolve()
    except (OSError, RuntimeError, ValueError):
        return None
    try:
        target.relative_to(root)
    except ValueError:
        return None       # `../` hoặc symlink trỏ ra ngoài
    return target


# Đệm danh sách tệp của kho tài liệu.
#
# Kho thường nằm trên ổ mạng (RaiDrive gắn Google Drive chẳng hạn). Khi ổ đang
# nguội, duyệt hết cây thư mục có thể mất tới bốn phút — đo được 239,98s trên
# một kho 1180 thư mục, trong khi lần duyệt ngay sau đó chỉ 0,7s. Người trong
# nhóm hỏi một câu rồi ngồi chờ bốn phút thì coi như bot hỏng.
#
# Danh sách tệp thay đổi hiếm, nên đệm lại là đủ. Đệm theo cây đầy đủ rồi lọc
# trong bộ nhớ, để câu hỏi với từ khoá khác cũng không phải duyệt lại.
_KB_CACHE: Dict[str, Any] = {"root": None, "at": 0.0, "files": None, "skipped": 0}
_KB_CACHE_TTL = 300.0


def _kb_listing(root, query: str):
    """Danh sách tệp trong kho, lấy từ đệm nếu còn hạn."""
    import time as _t
    now = _t.monotonic()
    fresh = (
        _KB_CACHE["files"] is not None
        and _KB_CACHE["root"] == str(root)
        and now - _KB_CACHE["at"] < _KB_CACHE_TTL
    )
    if not fresh:
        t0 = _t.monotonic()
        # Duyệt KHÔNG lọc và nới hạn mức: đệm phải chứa cả cây thì lọc theo từ
        # khoá trong bộ nhớ mới không sót tệp nằm sâu. Hạn mức 200 của lần
        # duyệt thường là để giới hạn thứ trả về cho agent, không phải để giới
        # hạn thứ ta biết.
        files, skipped = _kb_walk(root, "", limit=20000)
        took = _t.monotonic() - t0
        _KB_CACHE.update(root=str(root), at=now, files=files, skipped=skipped)
        if took > 5:
            logger.warning("[zalo] duyệt kho tài liệu mất %.1fs — ổ mạng đang nguội", took)

    files = _KB_CACHE["files"]
    if query:
        files = [f for f in files if query in str(f.get("path", "")).lower()]
    return files, _KB_CACHE["skipped"], fresh


async def zalo_kb_list(args: Dict[str, Any], **_kw) -> str:
    root = _kb_root()
    if root is None:
        return _err("chưa cấu hình kho tài liệu (ZALO_KB_DIR)")

    query = (args.get("query") or "").strip().lower()
    files, skipped, _ = _kb_listing(root, query)

    # Đệm giữ cả cây, nhưng chỉ đưa cho agent một nắm vừa phải — nhồi vài nghìn
    # đường dẫn vào ngữ cảnh vừa tốn token vừa làm nó khó chọn.
    total = len(files)
    shown = files[:200]
    payload = {"root": root.name or str(root), "files": shown, "count": total}
    if total > len(shown):
        # Kho lớn thì 200 tệp đầu thường rơi hết vào một thư mục, khiến agent
        # tưởng kho chỉ có chừng đó. Kèm bảng thư mục cấp 1 để nó biết còn
        # những nhánh nào mà thu hẹp `query` cho đúng.
        folders: Dict[str, int] = {}
        for item in files:
            head = str(item.get("path", "")).split("/")[0]
            if head:
                folders[head] = folders.get(head, 0) + 1
        payload["folders"] = dict(sorted(folders.items(), key=lambda kv: -kv[1])[:30])
        payload["note"] = (f"chỉ hiện {len(shown)}/{total} tệp — xem `folders` rồi thu hẹp bằng "
                           f"tham số `query` (tên thư mục hoặc tên tệp) để tìm đúng thứ cần")
    if skipped:
        payload["skipped"] = skipped
    return _ok(payload)


def _kb_walk(root, query: str, limit: int = 200):
    """Duyệt kho tài liệu, bỏ qua những nhánh không đọc được.

    Dùng ``os.walk`` chứ không phải ``Path.rglob``: kho tài liệu hay nằm trên
    ổ mạng (RaiDrive, OneDrive, SMB) nơi một đường dẫn quá dài hoặc một thư
    mục mất kết nối làm cả phép duyệt ném lỗi giữa chừng. Ở đây một nhánh
    hỏng chỉ bị bỏ qua, phần còn lại vẫn liệt kê được.
    """
    import os

    files = []
    skipped = 0
    root_str = str(root)

    def on_error(_exc):
        nonlocal skipped
        skipped += 1

    for dirpath, dirnames, filenames in os.walk(root_str, onerror=on_error):
        # Cắt sớm những thư mục không bao giờ đọc tới — đỡ phải lội vào
        # node_modules hay .git trên ổ mạng chậm.
        dirnames[:] = [
            d for d in dirnames
            if not d.startswith(".") and d.lower() not in KB_SKIP_DIRS
        ]
        for name in sorted(filenames):
            suffix = os.path.splitext(name)[1]
            if not _kb_readable(suffix):
                continue
            full = os.path.join(dirpath, name)
            try:
                rel = os.path.relpath(full, root_str).replace("\\", "/")
                if not _kb_allowed(rel):
                    continue
                if query and query not in rel.lower():
                    continue
                files.append({"path": rel, "size": os.path.getsize(full)})
            except OSError:
                skipped += 1
                continue
            if len(files) >= limit:
                return files, skipped
    return files, skipped


async def _kb_read_shortcut(target, rel_out: str) -> str:
    """Đọc một lối tắt `.url` bằng cách tải chính tài liệu nó trỏ tới."""
    try:
        raw = target.read_text(encoding="utf-8", errors="replace")
    except OSError as exc:
        return _err(f"không đọc được lối tắt: {exc}")

    url = ""
    for line in raw.splitlines():
        if line.strip().lower().startswith("url="):
            url = line.split("=", 1)[1].strip()
            break
    if not url:
        return _err(f"lối tắt '{rel_out}' không chứa địa chỉ nào")

    # Bắt buộc kiểm tra: một tệp .url là nội dung do người khác đặt vào kho.
    # Nếu ai đó thả vào một lối tắt trỏ tới http://127.0.0.1/... thì đây thành
    # đường vòng đọc dữ liệu nội bộ, đi qua lưng cả bộ chặn của zalo_web_read.
    if not _is_public_url(url):
        return _err(f"lối tắt '{rel_out}' trỏ tới địa chỉ không công khai — bỏ qua")

    fetched = await _core("web_extract", {"urls": [_google_export_url(url)]}, attempts=2)
    try:
        results = (json.loads(fetched).get("results") or [{}])[0]
    except (ValueError, TypeError, AttributeError):
        results = {}
    content = (results.get("content") or "").strip()
    if not content:
        return _err(
            f"'{rel_out}' là lối tắt tới {url} nhưng chưa tải được nội dung"
            f"{' — ' + str(results.get('error'))[:80] if results.get('error') else ''}"
        )
    truncated = len(content) > KB_MAX_BYTES
    return _ok({"path": rel_out, "source_url": url, "kind": "lối tắt tài liệu Google",
                "content": content[:KB_MAX_BYTES], "truncated": truncated})


async def zalo_kb_read(args: Dict[str, Any], **_kw) -> str:
    root = _kb_root()
    if root is None:
        return _err("chưa cấu hình kho tài liệu (ZALO_KB_DIR)")

    rel = (args.get("path") or "").strip()
    if not rel:
        return _err("cần `path` — dùng zalo_kb_list để xem có những tệp nào")

    target = _kb_resolve(root, rel)
    if target is None or not target.is_file():
        return _err(f"không có tệp '{rel}' trong kho tài liệu")

    # Áp cùng bộ lọc như khi liệt kê. Nếu chỉ lọc lúc liệt kê thì đoán đúng
    # tên tệp là đọc được — che khỏi danh sách không phải là chặn.
    if not _kb_allowed(target.relative_to(root).as_posix()):
        return _err(f"không có tệp '{rel}' trong kho tài liệu")

    if not _kb_readable(target.suffix):
        return _err(f"không đọc được định dạng '{target.suffix}'")

    rel_out = target.relative_to(root).as_posix()

    # Lối tắt tới tài liệu trên mây: đọc địa chỉ trong tệp rồi tải nội dung
    # thật về. Không làm vậy thì agent chỉ nhận được ba dòng INI vô nghĩa.
    if target.suffix.lower() in KB_LINK_SUFFIXES:
        return await _kb_read_shortcut(target, rel_out)

    # Tài liệu nhị phân (.docx, .pdf…) đi qua bộ trích văn bản của Hermes.
    if target.suffix.lower() in KB_DOC_SUFFIXES:
        text = _kb_extract(target)
        if text is None:
            return _err(
                f"không rút được nội dung từ '{rel_out}'. Tệp có thể là bản quét "
                "ảnh không có lớp chữ, hoặc thiếu thư viện đọc định dạng này."
            )
        truncated = len(text) > KB_MAX_BYTES
        return _ok({"path": rel_out, "content": text[:KB_MAX_BYTES], "truncated": truncated})

    try:
        raw = target.read_bytes()[: KB_MAX_BYTES + 1]
    except OSError as exc:
        return _err(f"không đọc được tệp: {exc}")

    truncated = len(raw) > KB_MAX_BYTES
    return _ok({
        "path": rel_out,
        "content": raw[:KB_MAX_BYTES].decode("utf-8", errors="replace"),
        "truncated": truncated,
    })


# =====================================================================
#  Nhóm 8 — Tra cứu Internet (bản bọc, chỉ đọc ra ngoài)
# =====================================================================
#
# Người trong nhóm không được cấp thẳng ``web_search``/``web_extract`` của
# Hermes. Lý do không phải vì hai công cụ đó nguy hiểm, mà vì mọi toolset sẵn
# có chứa chúng (``debugging``, ``coding``) đều kèm luôn ``terminal`` và
# ``read_file`` — cấp một cái là cấp cả cụm.
#
# Bọc lại còn được thêm một việc quan trọng: chặn tra cứu quay ngược vào máy
# chủ. ``web_extract`` nhận URL tuỳ ý, nên nếu để nguyên thì một địa chỉ như
# ``http://127.0.0.1:20128/v1/models`` hay ``file:///…/.env`` là đủ để đọc
# nội bộ qua đường Internet.

_BLOCKED_HOST_SUFFIXES = (".localhost", ".local", ".internal", ".lan", ".home.arpa")


def _google_export_url(raw: str) -> str:
    """Đổi link Google Docs/Sheets/Slides sang đường xuất bản văn bản.

    Link `/edit` của Google trả về khung ứng dụng JavaScript chứ không phải nội
    dung — bộ đọc trang web nhận về một trang trống kèm nút đăng nhập, và rất
    dễ kết luận nhầm là "tài liệu không được chia sẻ". Thực ra tài liệu công
    khai vẫn đọc được bình thường qua đường `/export`.

    Chỉ đổi đường dẫn, không đổi quyền: tài liệu riêng tư vẫn trả về trang đăng
    nhập như trước.
    """
    import re
    from urllib.parse import urlparse

    try:
        u = urlparse(str(raw).strip())
    except ValueError:
        return raw
    if (u.hostname or "").lower() not in ("docs.google.com", "drive.google.com"):
        return raw

    m = re.search(r"/(document|spreadsheets|presentation|file)/d/([A-Za-z0-9_-]+)", u.path)
    if not m:
        return raw
    kind, doc_id = m.group(1), m.group(2)

    if kind == "document":
        return f"https://docs.google.com/document/d/{doc_id}/export?format=txt"
    if kind == "spreadsheets":
        return f"https://docs.google.com/spreadsheets/d/{doc_id}/export?format=csv"
    if kind == "presentation":
        return f"https://docs.google.com/presentation/d/{doc_id}/export/txt"
    return f"https://drive.google.com/uc?export=download&id={doc_id}"


def _is_public_url(raw: str) -> bool:
    """Chỉ cho phép http/https trỏ ra địa chỉ công cộng."""
    import ipaddress
    from urllib.parse import urlparse

    try:
        u = urlparse(str(raw).strip())
    except ValueError:
        return False

    if u.scheme not in ("http", "https"):
        return False                      # chặn file://, ftp://, gopher://…

    host = (u.hostname or "").strip().lower()
    if not host:
        return False
    if host == "localhost" or host.endswith(_BLOCKED_HOST_SUFFIXES):
        return False

    try:
        ip = ipaddress.ip_address(host)
    except ValueError:
        return True                       # tên miền — để tầng mạng lo tiếp
    return not (
        ip.is_private or ip.is_loopback or ip.is_link_local
        or ip.is_reserved or ip.is_multicast or ip.is_unspecified
    )


async def _core(tool_name: str, args: Dict[str, Any], *, attempts: int = 1) -> str:
    """Gọi lại một công cụ lõi của Hermes qua registry.

    ``attempts`` > 1 dành cho công cụ web. Chưa cấu hình khoá backend thì Hermes
    xoay vòng qua các dịch vụ không khoá (Firecrawl, Keenable, Exa) và mỗi cái
    hỏng vào lúc khác nhau — đo được 3/6 lần thất bại trên cùng một URL.

    Có khoá rồi thì tỉ lệ hỏng gần như biến mất (đo 4/4 tìm kiếm, 5/6 đọc trang
    — lần trượt duy nhất là do trang đích không cho thu thập chứ không phải do
    backend). Nên giữ số lần thử ở mức thấp: một trang thật sự không đọc được
    thì thử lại chỉ tổ bắt người trong nhóm chờ thêm mà kết quả vẫn thế.
    """
    from tools.registry import registry

    last = ""
    for i in range(max(1, attempts)):
        try:
            result = registry.dispatch(tool_name, args)
            if hasattr(result, "__await__"):
                result = await result
            text = (result if isinstance(result, str)
                    else json.dumps(result, ensure_ascii=False, default=str))
        except Exception as exc:
            last = _err(f"{tool_name} lỗi: {exc}")
            continue

        if not _core_result_empty(text):
            return text
        last = text
        if i + 1 < attempts:
            await asyncio.sleep(0.6)
    return last


def _core_result_empty(text: str) -> bool:
    """Kết quả có thật sự rỗng không — để biết còn đáng thử lại nữa hay thôi."""
    try:
        data = json.loads(text)
    except (ValueError, TypeError):
        return False
    if isinstance(data, dict):
        if data.get("success") is False:
            return True
        results = data.get("results")
        if isinstance(results, list) and results:
            return all(not (r or {}).get("content") for r in results if isinstance(r, dict))
    return False


async def zalo_web_search(args: Dict[str, Any], **_kw) -> str:
    query = (args.get("query") or "").strip()
    if not query:
        return _err("cần `query`")
    limit = max(1, min(int(args.get("limit", 5) or 5), 10))
    return await _core("web_search", {"query": query, "limit": limit}, attempts=2)


async def zalo_web_read(args: Dict[str, Any], **_kw) -> str:
    raw = args.get("urls") or ([args["url"]] if args.get("url") else [])
    if isinstance(raw, str):
        raw = [raw]
    urls = [str(u).strip() for u in raw if str(u).strip()]
    if not urls:
        return _err("cần `url` hoặc `urls`")

    blocked = [u for u in urls if not _is_public_url(u)]
    if blocked:
        return _err(
            "chỉ đọc được địa chỉ web công cộng (http/https), không đọc địa chỉ "
            f"nội bộ: {', '.join(blocked[:3])}"
        )
    # Đổi sau khi kiểm tra an toàn, không phải trước — để phép kiểm luôn nhìn
    # đúng địa chỉ người dùng đưa vào.
    urls = [_google_export_url(u) for u in urls]
    return await _core("web_extract", {"urls": urls[:5]}, attempts=2)


# =====================================================================
#  Nhóm 9 — Sổ hồ sơ người quen
# =====================================================================
#
# ``memories/USER.md`` của Hermes chỉ có một hồ sơ — của chủ nhân. Trong nhóm
# Zalo thì mỗi người một khác, nên cần cuốn sổ tra theo UID.
#
# Ranh giới: hồ sơ ở đây là lời tự khai, không phải danh tính đã xác thực. Nó
# chỉ dùng để xưng hô và hiểu ngữ cảnh, không bao giờ dùng để cấp quyền —
# quyền vẫn chỉ dựa vào ZALO_ALLOWED_USERS.

async def zalo_remember_person(args: Dict[str, Any], **_kw) -> str:
    from .people import remember_person

    turn = _turn()
    sender = turn.get("sender_uid") or ""
    if not sender:
        return _err("không xác định được người đang trò chuyện")

    # Chủ nhân ghi hộ được cho người khác; người thường chỉ ghi cho chính mình.
    # Nếu ai cũng ghi hộ được thì một người có thể gán nhãn sai cho người khác,
    # rồi bot mang nhãn đó ra dùng ở lượt sau.
    target = str(args.get("user_id") or "").strip() or sender
    if target != sender and not turn.get("is_owner"):
        return _err("chỉ ghi được hồ sơ của chính mình")

    fields = args.get("fields")
    if fields is not None and not isinstance(fields, dict):
        return _err("`fields` phải là một đối tượng, ví dụ {\"lĩnh vực\": \"kỹ thuật\"}")

    if not any([args.get("name"), args.get("note"), fields]):
        return _err("cần ít nhất một trong `name`, `note`, `fields`")

    try:
        entry = remember_person(
            target,
            name=args.get("name", ""),
            note=args.get("note", ""),
            fields=fields,
            updated_by=sender,
        )
    except ValueError as exc:
        return _err(str(exc))
    return _ok({"user_id": target, "profile": entry})


async def zalo_recall_person(args: Dict[str, Any], **_kw) -> str:
    from .people import get_person

    turn = _turn()
    sender = turn.get("sender_uid") or ""
    target = str(args.get("user_id") or "").strip() or sender
    if target != sender and not turn.get("is_owner"):
        return _err("chỉ xem được hồ sơ của chính mình")

    person = get_person(target)
    if not person:
        return _ok({"user_id": target, "profile": None, "note": "chưa có hồ sơ"})
    return _ok({"user_id": target, "profile": person})


async def zalo_list_people(args: Dict[str, Any], **_kw) -> str:
    from .people import list_people
    return _ok(list_people(limit=max(1, min(int(args.get("limit", 50) or 50), 200))))


async def zalo_forget_person(args: Dict[str, Any], **_kw) -> str:
    from .people import forget_person

    uid = str(args.get("user_id") or "").strip()
    if not uid:
        return _err("cần `user_id`")
    return _ok({"user_id": uid, "removed": forget_person(uid)})


# =====================================================================
#  Nhóm 11 — Việc hẹn giờ do thành viên nhóm tạo
# =====================================================================
#
# Công cụ cron gốc của Hermes nhận script, thư mục làm việc, bộ công cụ tuỳ ý —
# đưa cho người ngoài là cho chạy lệnh trên máy. Công cụ này chỉ mở đúng một
# việc: hẹn giờ để bot soạn nội dung rồi gửi vào chính nhóm đang trò chuyện.
# Mọi trường nguy hiểm của job bị khoá cứng ở đây, không nhận từ mô hình.

GROUP_CRON_PROMPT_MAX = 1000
GROUP_CRON_NAME_MAX = 80
GROUP_CRON_MIN_GAP_MINUTES = 1440
GROUP_CRON_PER_CREATOR = 3
GROUP_CRON_PER_GROUP = 10
GROUP_CRON_LOOKAHEAD = 20
_GROUP_CRON_PROMPT_SEPARATOR = "\n---\n"
_GROUP_CRON_TOO_OFTEN = "việc hẹn giờ của nhóm chỉ được lặp tối đa 1 lần mỗi ngày"

# Chỉ nhận cron 5 trường gồm số, * , - / và tên tháng/thứ tiếng Anh. croniter còn
# hiểu các ký hiệu lạ như R (ngẫu nhiên — bốc lại mỗi lần chạy, lách được giới
# hạn 1 lần/ngày), H, L, W, # — thành viên không được dùng.
_GROUP_CRON_FIELD_RE = re.compile(
    r"^(?:[0-9*,/\-]|JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC|MON|TUE|WED|THU|FRI|SAT|SUN)+$",
    re.IGNORECASE,
)
_GROUP_CRON_BAD_EXPR = (
    "lịch lặp chỉ nhận biểu thức cron 5 trường gồm số, *, dấu phẩy, gạch ngang, "
    "gạch chéo và tên tháng/thứ"
)


def _sanitize_cron_creator_name(name: str) -> str:
    """Làm sạch tên hiển thị Zalo của người tạo trước khi đưa vào prompt cron.

    Tên này do thành viên trong nhóm tự đặt, không qua tay mô hình — bỏ ký tự
    Unicode dạng định dạng (zero-width, bidi, BOM: category "Cf") để không cài
    được ký tự ẩn vào phần đầu prompt, rồi gộp khoảng trắng và cắt bớt.
    """
    cleaned = "".join(ch for ch in name if unicodedata.category(ch) != "Cf")
    return " ".join(cleaned.split())[:60]


def _group_cron_prompt(prompt: str, creator_name: str) -> str:
    who = creator_name or "một thành viên"
    header = (
        f"Việc hẹn giờ do {who} tạo trong nhóm Zalo này. Chỉ viết đúng nội dung "
        "sẽ gửi vào nhóm, không chào hỏi thừa, không nhắc tới việc hẹn giờ."
    )
    return f"{header}{_GROUP_CRON_PROMPT_SEPARATOR}{prompt}"


def _cron_min_gap_minutes(expr: str) -> Optional[float]:
    """Khoảng cách ngắn nhất (phút) giữa hai lần chạy liền nhau của biểu thức cron.

    Đo nhiều lần chứ không chỉ hai lần đầu: `0 9,10 * * *` có lần cách 23 giờ
    nhưng cũng có lần cách 1 giờ.
    """
    from datetime import datetime

    jobs = _cron_jobs()
    if not jobs._ensure_croniter():
        return None
    try:
        it = jobs.croniter(expr, datetime.now())
        times = [it.get_next(datetime) for _ in range(GROUP_CRON_LOOKAHEAD)]
    except Exception:
        return None
    gaps = [(later - earlier).total_seconds() / 60 for earlier, later in zip(times, times[1:])]
    return min(gaps) if gaps else None


def _group_cron_schedule_problem(schedule: Dict[str, Any]) -> str:
    """Lịch này có vượt giới hạn của việc hẹn giờ nhóm không. Rỗng là hợp lệ."""
    from datetime import datetime

    kind = schedule.get("kind")
    if kind == "once":
        try:
            run_at = datetime.fromisoformat(str(schedule.get("run_at")))
        except ValueError:
            return "không đọc được thời điểm hẹn"
        now = datetime.now(run_at.tzinfo) if run_at.tzinfo else datetime.now()
        return "" if run_at > now else "thời điểm hẹn đã qua — chọn một giờ trong tương lai"
    if kind == "interval":
        minutes = float(schedule.get("minutes") or 0)
        return "" if minutes >= GROUP_CRON_MIN_GAP_MINUTES else _GROUP_CRON_TOO_OFTEN
    if kind == "cron":
        expr = str(schedule.get("expr") or "")
        fields = expr.split()
        if len(fields) != 5 or not all(_GROUP_CRON_FIELD_RE.match(field) for field in fields):
            return _GROUP_CRON_BAD_EXPR
        gap = _cron_min_gap_minutes(expr)
        if gap is None:
            return "không đọc được lịch lặp này"
        return "" if gap >= GROUP_CRON_MIN_GAP_MINUTES else _GROUP_CRON_TOO_OFTEN
    return "không hỗ trợ kiểu lịch này"


def _group_cron_create(args: Dict[str, Any], turn: Dict[str, Any]) -> str:
    prompt = str(args.get("prompt") or "").strip()
    if not prompt:
        return _err("cần `prompt` — việc bot sẽ làm khi đến giờ")
    if len(prompt) > GROUP_CRON_PROMPT_MAX:
        return _err(f"`prompt` dài quá {GROUP_CRON_PROMPT_MAX} ký tự")
    raw_schedule = str(args.get("schedule") or "").strip()
    if not raw_schedule:
        return _err("cần `schedule`, ví dụ 'every day at 7am' hoặc '2026-09-18T07:30'")
    creator = str(turn.get("sender_uid") or "")
    if not creator:
        return _err("không xác định được người tạo")

    jobs = _cron_jobs()
    try:
        schedule = jobs.parse_schedule(raw_schedule)
    except ValueError as exc:
        return _err(str(exc))
    problem = _group_cron_schedule_problem(schedule)
    if problem:
        return _err(problem)

    creator_name = _sanitize_cron_creator_name(str(turn.get("sender_name") or ""))

    # Cùng bộ quét công cụ cron gốc dùng. Không import được thì từ chối, không
    # bỏ qua: đây là lớp chặn prompt cài lệnh ẩn.
    #
    # Quét trên PROMPT ĐÃ GHÉP (phần đầu kèm tên người tạo + prompt của người
    # dùng), không chỉ mỗi phần người dùng gõ: Hermes quét lại đúng chuỗi đã
    # ghép này ở mọi lần chạy, nên tên hiển thị Zalo (thành viên tự đặt, có
    # thể cài ký tự ẩn hay từ khoá đe doạ) mà không bị soát ở đây thì job vẫn
    # được tạo rồi bị chặn ở mọi lần chạy sau, giữ nguyên hạn mức mà không
    # bao giờ gửi được.
    try:
        from tools.cronjob_tools import _scan_cron_prompt
    except ImportError:
        return _err("bản Hermes này không kiểm được nội dung việc hẹn giờ nên chưa tạo")
    blocked = _scan_cron_prompt(_group_cron_prompt(prompt, creator_name))
    if blocked:
        return _err(blocked)

    group = str(turn.get("thread_id") or "")
    if not turn.get("is_owner"):
        active = [
            job for job in jobs.list_jobs(include_disabled=False)
            if _is_group_cron(job) and not jobs.is_terminal_job(job)
        ]
        mine = sum(1 for job in active if str(job["origin"].get("zalo_creator_uid") or "") == creator)
        if mine >= GROUP_CRON_PER_CREATOR:
            return _err(f"bạn đã có {mine} việc hẹn giờ đang bật — tối đa {GROUP_CRON_PER_CREATOR}. Xoá bớt rồi tạo lại")
        here = sum(1 for job in active if _cron_target(job) == group)
        if here >= GROUP_CRON_PER_GROUP:
            return _err(f"nhóm này đã có {here} việc hẹn giờ đang bật — tối đa {GROUP_CRON_PER_GROUP}")

    name = (
        " ".join(str(args.get("name") or "").split())[:GROUP_CRON_NAME_MAX]
        or " ".join(prompt.split())[:40]
    )
    job = jobs.create_job(
        prompt=_group_cron_prompt(prompt, creator_name),
        schedule=raw_schedule,
        name=name,
        repeat=1 if schedule.get("kind") == "once" else None,
        deliver=f"zalo:{group}",
        origin={
            "platform": "zalo",
            "chat_id": group,
            "chat_name": group,
            "chat_type": "group",
            "thread_id": None,
            "user_id": creator,
            "zalo_scope": GROUP_CRON_SCOPE,
            "zalo_creator_uid": creator,
            "zalo_creator_name": creator_name,
        },
        enabled_toolsets=[TOOLSET_CRON_MEMBER, "no_mcp"],
    )
    return _ok({
        "job_id": job.get("id"),
        "ten": job.get("name"),
        "lich": job.get("schedule_display") or schedule.get("display"),
        "lan_toi": job.get("next_run_at"),
    })


def _group_cron_list(turn: Dict[str, Any]) -> str:
    group = str(turn.get("thread_id") or "")
    jobs = _cron_jobs()
    items = []
    for job in jobs.list_jobs(include_disabled=True):
        if _cron_target(job) != group:
            continue
        item = {
            "job_id": job.get("id"),
            "ten": job.get("name"),
            "lich": job.get("schedule_display"),
            "lan_toi": job.get("next_run_at"),
            "trang_thai": jobs.effective_job_state(job),
        }
        if _is_group_cron(job):
            origin = job["origin"]
            item["nguoi_tao"] = origin.get("zalo_creator_name") or origin.get("zalo_creator_uid")
            item["noi_dung"] = str(job.get("prompt") or "").split(_GROUP_CRON_PROMPT_SEPARATOR, 1)[-1]
        else:
            # Việc của chủ nhân: cho biết là có, không lộ nội dung giao việc.
            item["nguoi_tao"] = "chủ nhân"
        items.append(item)
    return _ok({"count": len(items), "jobs": items})


def _group_cron_remove(args: Dict[str, Any], turn: Dict[str, Any]) -> str:
    job_id = str(args.get("job_id") or "").strip()
    if not job_id:
        return _err("cần `job_id` — lấy từ action 'list'")
    group = str(turn.get("thread_id") or "")
    jobs = _cron_jobs()
    job = jobs.get_job(job_id)
    if not job or _cron_target(job) != group:
        return _err("nhóm này không có việc hẹn giờ đó")
    if _is_group_cron(job):
        creator = str(job["origin"].get("zalo_creator_uid") or "")
        if not (turn.get("is_owner") or creator == str(turn.get("sender_uid") or "")):
            return _err("chỉ người tạo hoặc chủ nhân được xoá việc hẹn giờ này")
    elif not turn.get("is_owner"):
        return _err("việc hẹn giờ của chủ nhân chỉ chủ nhân xoá được")
    return _ok({"job_id": job["id"], "da_xoa": bool(jobs.remove_job(job["id"]))})


async def zalo_group_cron(args: Dict[str, Any], **_kw) -> str:
    turn = _turn()
    if turn.get("cron_job_id"):
        return _err("việc hẹn giờ không được tự tạo, xem hay xoá việc hẹn giờ khác")
    if not turn.get("is_group") or not turn.get("thread_id"):
        return _err("chỉ dùng được trong nhóm Zalo")
    action = str(args.get("action") or "").strip().lower()
    if action == "create":
        return _group_cron_create(args, turn)
    if action == "list":
        return _group_cron_list(turn)
    if action == "remove":
        return _group_cron_remove(args, turn)
    return _err("`action` phải là create, list hoặc remove")


# =====================================================================
#  Khai báo công cụ
# =====================================================================

def _schema(name: str, description: str, properties: Dict[str, Any], required: List[str]) -> Dict[str, Any]:
    return {
        "name": name,
        "description": description,
        "parameters": {
            "type": "object",
            "properties": properties,
            "required": required,
            "additionalProperties": False,
        },
    }


_ZALO_ID = {
    "type": "string",
    "description": "ID Zalo dạng chuỗi; không dùng số vì ID dài sẽ bị JavaScript làm tròn.",
}
_ZALO_ID_LIST = {
    "type": "array",
    "items": _ZALO_ID,
}
_THREAD_ID = _ZALO_ID
_THREAD_KIND = {
    "type": "string",
    "enum": ["group", "dm"],
    "description": "Loại hội thoại. Mặc định 'dm'.",
}
_GROUP_ID = _ZALO_ID

# =====================================================================
#  Nhóm 10 — Fanpage Facebook
# =====================================================================

async def zalo_fb_pages(args: Dict[str, Any], **_kw) -> str:
    from . import facebook as fb
    pages = fb.load_pages()
    if not pages:
        return _err("chưa cấu hình Fanpage nào — chạy lay-token-facebook.py "
                    "rồi đặt FB_PAGES_FILE trong .env")
    return _ok({"count": len(pages), "pages": [
        {"name": x.get("name"), "id": x.get("id"), "default": bool(x.get("default"))}
        for x in pages]})


async def zalo_fb_posts(args: Dict[str, Any], **_kw) -> str:
    from . import facebook as fb
    page, err = fb.resolve_page(args.get("page", ""))
    if err:
        return _err(err)
    limit = max(1, min(int(args.get("limit", 5) or 5), 25))
    r = fb.graph(f"{page['id']}/posts", access_token=page["token"], limit=limit,
                 fields="id,message,created_time,permalink_url,"
                        "comments.summary(true).limit(0),reactions.summary(true).limit(0)")
    if "error" in r:
        return _err(f"Facebook: {r['error'].get('message', '')[:160]}")
    out = []
    for x in r.get("data") or []:
        out.append({
            "id": x.get("id"),
            "ngay": (x.get("created_time") or "")[:10],
            "noi_dung": (x.get("message") or "")[:1500],
            "link": x.get("permalink_url"),
            "binh_luan": ((x.get("comments") or {}).get("summary") or {}).get("total_count"),
            "cam_xuc": ((x.get("reactions") or {}).get("summary") or {}).get("total_count"),
        })
    return _ok({"page": page.get("name"), "count": len(out), "posts": out})


async def zalo_fb_comments(args: Dict[str, Any], **_kw) -> str:
    from . import facebook as fb
    post_id = str(args.get("post_id") or "").strip()
    if not post_id:
        return _err("cần `post_id` — lấy từ zalo_fb_posts")
    page, err = fb.resolve_page(args.get("page", ""))
    if err:
        return _err(err)
    limit = max(1, min(int(args.get("limit", 25) or 25), 100))
    r = fb.graph(f"{post_id}/comments", access_token=page["token"], limit=limit,
                 order="reverse_chronological",
                 fields="from,message,created_time,like_count")
    if "error" in r:
        return _err(f"Facebook: {r['error'].get('message', '')[:160]}")
    out = [{
        "nguoi": ((x.get("from") or {}).get("name")) or "(ẩn danh)",
        "ngay": (x.get("created_time") or "")[:16].replace("T", " "),
        "noi_dung": (x.get("message") or "")[:600],
        "thich": x.get("like_count"),
    } for x in (r.get("data") or [])]
    return _ok({"post_id": post_id, "count": len(out), "comments": out})


async def zalo_fb_check(args: Dict[str, Any], **_kw) -> str:
    """Soát một bài đã đăng: Facebook khai gì, và người ngoài có xem được không."""
    from . import facebook as fb
    post_id = str(args.get("post_id") or "").strip()
    if not post_id:
        return _err("cần `post_id` — lấy từ zalo_fb_posts hoặc kết quả zalo_fb_publish")
    page, err = fb.resolve_page(args.get("page", ""))
    if err:
        return _err(err)

    r = fb.graph(post_id, access_token=page["token"],
                 fields="id,created_time,is_published,is_hidden,timeline_visibility,"
                        "privacy,permalink_url,scheduled_publish_time")
    if "error" in r:
        return _err(f"Facebook: {r['error'].get('message', '')[:160]}")

    link = r.get("permalink_url")
    visibility = await asyncio.to_thread(fb.public_visibility, link)
    return _ok({
        "post_id": r.get("id"),
        "page": page.get("name"),
        "link": link,
        "facebook_khai": {
            "da_dang": r.get("is_published"),
            "bi_an": r.get("is_hidden"),
            "dong_thoi_gian": r.get("timeline_visibility"),
            "quyen": (r.get("privacy") or {}).get("description"),
            "hen_gio": r.get("scheduled_publish_time"),
        },
        "hien_thi_cong_khai": visibility,
        "huong_dan": (
            "Người ngoài xem được bài này." if visibility == "cong_khai" else
            "Bài chưa tới giờ đăng nên chưa soi được." if r.get("scheduled_publish_time") else
            "Facebook KHÔNG cho người ngoài xem bài này — báo chủ nhân để xoá và đăng lại."
            if visibility == "khong_xem_duoc" else
            "Chưa kiểm tra được, thử lại sau hoặc mở link bằng cửa sổ ẩn danh."
        ),
    })


async def zalo_fb_draft(args: Dict[str, Any], **_kw) -> str:
    """Soạn bài rồi CHỜ chủ nhân gõ mã duyệt. Không đăng gì ở bước này."""
    from . import facebook as fb
    message = str(args.get("message") or "").strip()
    if not message:
        return _err("cần `message` — nội dung bài đăng")
    page, err = fb.resolve_page(args.get("page", ""))
    if err:
        return _err(err)

    raw = args.get("photos") or ([args["photo"]] if args.get("photo") else [])
    if isinstance(raw, str):
        raw = [raw]
    photos = [str(x).strip() for x in raw if str(x).strip()][:10]
    for path in photos:
        if not os.path.isfile(path):
            return _err(f"không có tệp ảnh '{path}' — dùng zalo_kb_list để tìm đúng đường dẫn")

    saved = fb.save_draft(page, message, photos)
    return _ok({
        **saved,
        "huong_dan": (
            f"Đã soạn xong nhưng CHƯA đăng. Hãy đưa TOÀN VĂN bài viết cho chủ "
            f"nhân xem, kèm tên Fanpage '{page.get('name')}' và số ảnh, rồi nói "
            f"rõ: muốn đăng thì nhắn lại mã {saved['code']}. Tuyệt đối không tự "
            f"gọi zalo_fb_publish thay chủ nhân."
        ),
    })


async def zalo_fb_publish(args: Dict[str, Any], **_kw) -> str:
    """Đăng bản nháp. Chỉ chạy khi mã duyệt nằm trong tin nhắn chủ nhân vừa gõ."""
    from . import facebook as fb
    code = str(args.get("code") or "").strip().upper()
    if not code:
        return _err("cần `code` — mã duyệt chủ nhân vừa nhắn")

    # Điểm chịu lực: đối chiếu với NGUYÊN VĂN tin nhắn người dùng, không phải
    # với chuỗi mô hình truyền vào. Mô hình có thể bị dụ để truyền bất cứ thứ
    # gì, nhưng không viết được tin nhắn thay chủ nhân.
    human = _turn().get("text") or ""
    if not fb.confirmed_in_message(code, human):
        logger.warning("[fb] chặn đăng bài: mã %s không có trong tin nhắn chủ nhân", code)
        return _err(
            "chưa đăng. Mã duyệt phải do chính chủ nhân gõ trong tin nhắn của "
            "họ. Hãy hỏi lại chủ nhân và chờ họ nhắn mã, đừng tự điền."
        )

    # Kiểm giờ hẹn TRƯỚC khi lấy bản nháp: take_draft dùng một lần là mất.
    scheduled_time = args.get("scheduled_publish_time")
    if scheduled_time in (None, ""):
        scheduled_time = None
    else:
        try:
            scheduled_time = int(scheduled_time)
        except (TypeError, ValueError):
            return _err("`scheduled_publish_time` phải là UNIX timestamp tính bằng giây")

    draft, err = fb.take_draft(code)
    if err:
        return _err(err)

    page, message, photos = draft["page"], draft["message"], draft["photos"]

    media_ids = []
    for path in photos:
        up = fb.upload_photo(page, path)
        if "error" in up:
            return _err(f"tải ảnh '{os.path.basename(path)}' thất bại: "
                        f"{up['error'].get('message', '')[:120]}")
        media_ids.append(up.get("id"))

    params = {"access_token": page["token"], "message": message}
    for i, mid in enumerate(media_ids):
        params[f"attached_media[{i}]"] = json.dumps({"media_fbid": mid})

    # Facebook chỉ nhận giờ hẹn từ 10 phút tới 75 ngày sau; ngoài khoảng đó
    # Graph API trả lỗi rõ ràng nên không tự kiểm lại ở đây.
    if scheduled_time is not None:
        params["published"] = "false"
        params["scheduled_publish_time"] = scheduled_time

    r = fb.graph(f"{page['id']}/feed", "POST", timeout=300, **params)
    if "error" in r:
        return _err(f"Facebook: {r['error'].get('message', '')[:160]}")

    post_id = r.get("id")
    info = fb.graph(post_id, access_token=page["token"], fields="permalink_url")
    link = info.get("permalink_url")
    logger.info("[fb] đã %s %s lên %s", "lên lịch" if scheduled_time else "đăng", post_id, page.get("name"))

    # Đăng xong phải soi bằng mắt người ngoài trước khi nói với chủ nhân là
    # xong: Graph API từng khai "đã đăng, công khai" cho bài mà chỉ quản trị
    # viên nhìn thấy. Bài hẹn giờ thì chưa có gì để soi, đợi tới giờ đăng.
    visibility = "chua_toi_gio" if scheduled_time else await asyncio.to_thread(fb.public_visibility, link)
    guide = {
        "cong_khai": "Bài đã hiện công khai, người ngoài xem được.",
        "khong_xem_duoc": ("Facebook KHÔNG cho người ngoài xem bài này dù Graph API báo đã đăng. "
                           "Nói thẳng với chủ nhân, đừng báo là đã đăng xong."),
        "khong_ro": "Chưa kiểm tra được hiển thị công khai — báo chủ nhân là chưa chắc chắn.",
        "chua_toi_gio": "Bài mới chỉ được hẹn giờ. Tới giờ đăng hãy dùng zalo_fb_check để soát lại.",
    }[visibility]
    return _ok({
        "da_dang": True,
        "len_lich": scheduled_time is not None,
        "thoi_gian_hen": scheduled_time,
        "page": page.get("name"),
        "post_id": post_id,
        "so_anh": len(media_ids),
        "link": link,
        "hien_thi_cong_khai": visibility,
        "huong_dan": guide,
    })



TOOLS = [
    # --- Nhóm 10: Fanpage Facebook ---
    ("zalo_fb_pages", "📘", _schema(
        "zalo_fb_pages",
        "Liệt kê các Fanpage Facebook đã cấu hình, kèm Page nào là mặc định.",
        {},
        [],
    ), zalo_fb_pages, TOOLSET_OWNER),

    ("zalo_fb_posts", "📰", _schema(
        "zalo_fb_posts",
        "Đọc các bài đăng gần nhất của một Fanpage, kèm số bình luận và cảm xúc.",
        {
            "page": {"type": "string", "description":
                     "Tên hoặc id Fanpage. Bỏ trống thì dùng Page mặc định."},
            "limit": {"type": "integer", "description": "Số bài, tối đa 25 (mặc định 5)."},
        },
        [],
    ), zalo_fb_posts, TOOLSET_OWNER),

    ("zalo_fb_comments", "💬", _schema(
        "zalo_fb_comments",
        "Đọc bình luận dưới một bài đăng Fanpage, mới nhất trước. Dùng khi cần "
        "nắm xem mọi người đang hỏi gì để tổng hợp lại.",
        {
            "post_id": _ZALO_ID,
            "page": {"type": "string", "description": "Tên hoặc id Fanpage."},
            "limit": {"type": "integer", "description": "Số bình luận, tối đa 100."},
        },
        ["post_id"],
    ), zalo_fb_comments, TOOLSET_OWNER),

    ("zalo_fb_draft", "📝", _schema(
        "zalo_fb_draft",
        "Soạn một bài đăng Fanpage và lấy mã duyệt. CHƯA đăng gì cả. Sau khi "
        "gọi, phải đưa toàn văn bài viết cho chủ nhân xem và chờ họ nhắn lại mã.",
        {
            "message": {"type": "string", "description": "Toàn văn nội dung bài đăng."},
            "page": {"type": "string", "description":
                     "Tên hoặc id Fanpage. Bỏ trống thì dùng Page mặc định."},
            "photo": {"type": "string", "description":
                      "Đường dẫn một ảnh trên máy hoặc trong kho tài liệu."},
            "photos": {"type": "array", "items": {"type": "string"},
                       "description": "Nhiều ảnh, tối đa 10."},
        },
        ["message"],
    ), zalo_fb_draft, TOOLSET_OWNER),

    ("zalo_fb_check", "🔍", _schema(
        "zalo_fb_check",
        "Soát một bài Fanpage đã đăng: Facebook khai gì (đã đăng, bị ẩn, quyền) "
        "và quan trọng hơn là người ngoài có xem được không. Dùng sau khi đăng, "
        "và dùng lại khi bài hẹn giờ đã tới giờ.",
        {
            "post_id": {"type": "string", "description": "ID bài, lấy từ zalo_fb_posts hoặc kết quả đăng."},
            "page": {"type": "string", "description": "Tên hoặc ID Fanpage. Bỏ trống là Page mặc định."},
        },
        ["post_id"],
    ), zalo_fb_check, TOOLSET_OWNER),

    ("zalo_fb_publish", "🚀", _schema(
        "zalo_fb_publish",
        "Đăng hoặc hẹn giờ đăng bản nháp lên Fanpage. CHỈ gọi sau khi chính chủ "
        "nhân đã nhắn mã duyệt trong tin nhắn của họ — không bao giờ tự điền mã thay họ.",
        {
            "code": {"type": "string", "description": "Mã duyệt chủ nhân vừa nhắn."},
            "scheduled_publish_time": {
                "type": "integer",
                "description": "Hẹn giờ đăng: UNIX timestamp tính bằng giây, từ 10 phút tới "
                               "75 ngày sau. Bỏ trống để đăng ngay.",
            },
        },
        ["code"],
    ), zalo_fb_publish, TOOLSET_OWNER),

    # --- Nhóm 11: việc hẹn giờ của nhóm ---
    ("zalo_group_cron", "⏲️", _schema(
        "zalo_group_cron",
        "Hẹn giờ cho nhóm Zalo đang trò chuyện: đến giờ bot tự soạn và gửi nội "
        "dung vào nhóm (nhắc họp, bản tin, tóm tắt nhóm). `create` tạo việc mới, "
        "`list` xem các việc của nhóm, `remove` xoá theo `job_id`. Lặp tối đa 1 "
        "lần mỗi ngày; mỗi người tối đa 3 việc, mỗi nhóm tối đa 10.",
        {
            "action": {"type": "string", "enum": ["create", "list", "remove"]},
            "prompt": {"type": "string", "description":
                       "Việc bot làm khi đến giờ, tối đa 1000 ký tự. Viết đủ ý vì lúc "
                       "chạy bot không nhớ cuộc trò chuyện này."},
            "schedule": {"type": "string", "description":
                         "Lịch: 'every day at 7am', 'every monday 9am', '0 7 * * *', "
                         "'2026-09-18T07:30' (một lần), 'in 2h' (một lần)."},
            "name": {"type": "string", "description": "Tên ngắn cho việc hẹn giờ."},
            "job_id": {"type": "string", "description": "Mã việc hẹn giờ cần xoá, lấy từ action 'list'."},
        },
        ["action"],
    ), zalo_group_cron, TOOLSET_PUBLIC),

    # --- Nhóm 1: gửi nội dung ---
    ("zalo_send_file", "📎", _schema(
        "zalo_send_file",
        "Gửi ảnh, video hoặc tệp lên một hội thoại Zalo. Dùng khi cần đưa cho "
        "người dùng một tài liệu vừa tạo, ảnh chụp màn hình hay bản báo cáo.",
        {
            "thread_id": _THREAD_ID,
            "thread_kind": _THREAD_KIND,
            "path": {"type": "string", "description":
                     "Đường dẫn tệp. Người trong nhóm chỉ gửi được tệp thuộc kho "
                     "tài liệu — dùng đúng đường dẫn mà zalo_kb_list trả về."},
            "paths": {"type": "array", "items": {"type": "string"},
                      "description": "Nhiều tệp cùng lúc."},
            "caption": {"type": "string", "description":
                        "Lời nhắn đi kèm tệp, ví dụ tên tài liệu."},
        },
        ["thread_id"],
    ), zalo_send_file, TOOLSET_PUBLIC),

    ("zalo_make_file", "📄", _schema(
        "zalo_make_file",
        "Tạo tệp Word (docx), PowerPoint (pptx), Excel (xlsx) hoặc PDF từ nội dung em soạn "
        "rồi gửi luôn vào nhóm đang chat — dùng khi thầy cô nhờ làm giáo án, đề, danh sách, "
        "slide, bảng điểm dưới dạng tệp. Chỉ dùng trong nhóm; mỗi người tối đa 5 tệp/giờ. "
        "Tệp chỉ có chữ và bảng, không chèn ảnh; hệ thống tự trình bày: Word theo thể thức "
        "Nghị định 30 (A4, Times New Roman, chữ đen — in nộp được), PDF/PowerPoint/Excel có màu, "
        "bảng tô nền, số trang. Soạn cho đẹp: chia mục bằng # rõ ràng, dữ liệu so sánh thì dùng bảng, "
        "mỗi slide 3–6 ý ngắn, slide chỉ có tiêu đề (bullets rỗng) làm slide chuyển phần. "
        "Chỉ báo đã gửi khi kết quả trả về thành công.",
        {
            "thread_id": _THREAD_ID,
            "thread_kind": _THREAD_KIND,
            "format": {"type": "string", "enum": ["docx", "pptx", "xlsx", "pdf"],
                       "description": "Loại tệp."},
            "title": {"type": "string", "description": "Tiêu đề tài liệu, cũng dùng làm tên tệp."},
            "filename": {"type": "string", "description": "Tên tệp mong muốn (không bắt buộc)."},
            "content": {"type": "string", "description":
                        "Với docx/pdf: nội dung Markdown — # tiêu đề, - gạch đầu dòng, 1. đánh số, "
                        "**đậm**, bảng dạng | a | b |. Tối đa 30.000 ký tự. Công thức viết Unicode (H₂O, x²)."},
            "slides": {"type": "array", "description": "Với pptx: tối đa 40 slide, mỗi slide tối đa 15 ý.",
                       "items": {"type": "object", "properties": {
                           "title": {"type": "string"},
                           "bullets": {"type": "array", "items": {"type": "string"}},
                       }}},
            "sheets": {"type": "array", "description":
                       "Với xlsx: tối đa 5 trang tính; `rows` là các dòng, dòng đầu là tiêu đề cột.",
                       "items": {"type": "object", "properties": {
                           "name": {"type": "string"},
                           "rows": {"type": "array", "items": {"type": "array", "items": {}}},
                       }}},
            "caption": {"type": "string", "description": "Lời nhắn đi kèm tệp."},
        },
        ["thread_id", "format", "title"],
    ), zalo_make_file, TOOLSET_PUBLIC),

    ("zalo_send_voice", "🎙️", _schema(
        "zalo_send_voice",
        "Gửi tin nhắn thoại từ một URL âm thanh (định dạng .aac). Kết hợp với "
        "công cụ chuyển văn bản thành giọng nói để trả lời bằng giọng.",
        {
            "thread_id": _THREAD_ID,
            "thread_kind": _THREAD_KIND,
            "url": {"type": "string", "description":
                    "URL công khai hoặc đường dẫn tệp âm thanh local do text_to_speech trả về."},
            "ttl": {"type": "integer", "description": "Thời gian tự xoá (ms). 0 = không xoá."},
        },
        ["thread_id", "url"],
    ), zalo_send_voice, TOOLSET_PUBLIC),

    ("zalo_send_sticker", "🎨", _schema(
        "zalo_send_sticker",
        "Tìm và gửi một sticker Zalo theo từ khoá. Dùng cho câu chuyện nhẹ "
        "nhàng, chúc mừng, cảm ơn.",
        {
            "thread_id": _THREAD_ID,
            "thread_kind": _THREAD_KIND,
            "keyword": {"type": "string", "description": "Từ khoá tìm sticker, ví dụ 'vui', 'cảm ơn'."},
        },
        ["thread_id", "keyword"],
    ), zalo_send_sticker, TOOLSET_PUBLIC),

    ("zalo_send_link", "🔗", _schema(
        "zalo_send_link",
        "Gửi một liên kết kèm thẻ xem trước (ảnh, tiêu đề) thay vì chỉ dán URL trần.",
        {
            "thread_id": _THREAD_ID,
            "thread_kind": _THREAD_KIND,
            "url": {"type": "string", "description": "Liên kết cần gửi."},
            "message": {"type": "string", "description": "Lời nhắn đi kèm."},
        },
        ["thread_id", "url"],
    ), zalo_send_link, TOOLSET_PUBLIC),

    ("zalo_forward", "↪️", _schema(
        "zalo_forward",
        "Chuyển tiếp một tin nhắn sang nhiều hội thoại khác.",
        {
            "message": {"type": "string", "description": "Nội dung cần chuyển tiếp."},
            "thread_ids": {**_ZALO_ID_LIST, "description": "Danh sách hội thoại nhận."},
            "thread_kind": _THREAD_KIND,
        },
        ["message", "thread_ids"],
    ), zalo_forward, TOOLSET_OWNER),

    # --- Nhóm 2: đọc ngữ cảnh ---
    ("zalo_read_history", "📜", _schema(
        "zalo_read_history",
        "Đọc tin của một DM hoặc nhóm Zalo từ SQLite bền vững. Mặc định lấy `count` tin gần nhất. "
        "Muốn tổng hợp thảo luận (vd. 'tổng hợp nhóm hôm nay') thì truyền `since_hours`: công cụ đọc "
        "HẾT tin trong khoảng đó, trả từng dòng '[ngày giờ] Tên: nội dung'; nếu `con_nua` = true thì gọi "
        "lại với `cursor` = `next_cursor` cho tới hết rồi mới tổng hợp.",
        {
            "thread_id": _THREAD_ID,
            "thread_kind": _THREAD_KIND,
            "count": {"type": "integer", "description": "Số tin gần nhất muốn đọc (tối đa 100, mặc định 30)."},
            "since_hours": {"type": "number", "description": "Đọc hết tin trong N giờ qua (tối đa 168). Dùng khi cần tổng hợp."},
            "cursor": {"type": "string", "description": "Đọc tiếp từ `next_cursor` của lần gọi trước (giữ nguyên since_hours)."},
        },
        ["thread_id"],
    ), zalo_read_history, TOOLSET_OWNER),

    ("zalo_group_history", "🗒️", _schema(
        "zalo_group_history",
        "Chỉ dùng trong việc hẹn giờ của nhóm: đọc các tin gần đây của chính nhóm "
        "mà việc hẹn giờ này gửi kết quả về, để tóm tắt hay nhắc lại cho đúng.",
        {"count": {"type": "integer", "description": "Số tin muốn đọc (tối đa 100, mặc định 30)."}},
        [],
    ), zalo_group_history, TOOLSET_CRON),

    ("zalo_list_groups", "👥", _schema(
        "zalo_list_groups",
        "Liệt kê các nhóm Zalo mà tài khoản này đang tham gia.",
        {}, [],
    ), zalo_list_groups, TOOLSET_OWNER),

    ("zalo_group_members", "🧑‍🤝‍🧑", _schema(
        "zalo_group_members",
        "Xem danh sách thành viên một nhóm, kèm tên hiển thị.",
        {"thread_id": _GROUP_ID},
        ["thread_id"],
    ), zalo_group_members, TOOLSET_PUBLIC),

    ("zalo_find_user", "🔍", _schema(
        "zalo_find_user",
        "Tìm một người dùng Zalo theo số điện thoại hoặc tên đăng nhập.",
        {
            "phone": {"type": "string", "description": "Số điện thoại."},
            "username": {"type": "string", "description": "Tên đăng nhập Zalo."},
        },
        [],
    ), zalo_find_user, TOOLSET_OWNER),

    ("zalo_user_info", "👤", _schema(
        "zalo_user_info",
        "Xem hồ sơ một người dùng Zalo theo UID.",
        {"user_id": _ZALO_ID},
        ["user_id"],
    ), zalo_user_info, TOOLSET_OWNER),

    ("zalo_list_friends", "📇", _schema(
        "zalo_list_friends",
        "Liệt kê danh bạ bạn bè Zalo.",
        {}, [],
    ), zalo_list_friends, TOOLSET_OWNER),

    # --- Nhóm 3: tính năng riêng của Zalo ---
    ("zalo_create_poll", "🗳️", _schema(
        "zalo_create_poll",
        "Tạo một cuộc bình chọn trong nhóm Zalo. Hữu ích khi cần chốt lịch, "
        "lấy ý kiến tập thể.",
        {
            "group_id": _GROUP_ID,
            "question": {"type": "string", "description": "Câu hỏi bình chọn."},
            "options": {"type": "array", "items": {"type": "string"},
                        "description": "Các phương án, tối thiểu 2."},
            "multi_choice": {"type": "boolean", "description": "Cho chọn nhiều phương án."},
            "allow_add_option": {"type": "boolean", "description": "Cho người khác thêm phương án."},
            "anonymous": {"type": "boolean", "description": "Bình chọn kín."},
            "hide_preview": {"type": "boolean", "description": "Ẩn kết quả cho tới khi khoá."},
        },
        ["group_id", "question", "options"],
    ), zalo_create_poll, TOOLSET_OWNER),

    ("zalo_poll_detail", "📊", _schema(
        "zalo_poll_detail",
        "Xem kết quả một cuộc bình chọn: ai chọn gì, bao nhiêu phiếu.",
        {"poll_id": _ZALO_ID},
        ["poll_id"],
    ), zalo_poll_detail, TOOLSET_OWNER),

    ("zalo_lock_poll", "🔒", _schema(
        "zalo_lock_poll",
        "Khoá một cuộc bình chọn, không cho bỏ phiếu thêm.",
        {"poll_id": _ZALO_ID},
        ["poll_id"],
    ), zalo_lock_poll, TOOLSET_OWNER),

    ("zalo_vote_poll", "✅", _schema(
        "zalo_vote_poll",
        "Bot tự bỏ phiếu trong một cuộc bình chọn Zalo. Gọi zalo_poll_detail trước để lấy "
        "`option_id` của phương án; truyền danh sách rỗng để rút phiếu. Phiếu mới thay phiếu cũ "
        "của bot. Phương án chưa có thì dùng zalo_add_poll_options.",
        {
            "poll_id": _ZALO_ID,
            "option_ids": {"type": "array", "items": _ZALO_ID,
                           "description": "Mã phương án muốn chọn (option_id); rỗng = rút phiếu."},
        },
        ["poll_id", "option_ids"],
    ), zalo_vote_poll, TOOLSET_OWNER),

    ("zalo_add_poll_options", "➕", _schema(
        "zalo_add_poll_options",
        "Thêm phương án mới vào một cuộc bình chọn Zalo đang mở (bình chọn phải cho thêm phương án), "
        "có thể bỏ phiếu luôn cho phương án vừa thêm.",
        {
            "poll_id": _ZALO_ID,
            "options": {"type": "array", "items": {"type": "string"},
                        "description": "Nội dung các phương án mới."},
            "vote": {"type": "boolean", "description": "Bot bỏ phiếu cho phương án vừa thêm."},
            "keep_voted_option_ids": {"type": "array", "items": _ZALO_ID,
                                      "description": "Mã phương án bot đang chọn và muốn giữ phiếu (xem voted trong zalo_poll_detail)."},
        },
        ["poll_id", "options"],
    ), zalo_add_poll_options, TOOLSET_OWNER),

    ("zalo_create_note", "📌", _schema(
        "zalo_create_note",
        "Tạo ghi chú ghim ở đầu nhóm Zalo — nơi mọi thành viên đều thấy.",
        {
            "group_id": _GROUP_ID,
            "title": {"type": "string", "description": "Nội dung ghi chú."},
            "pin": {"type": "boolean", "description": "Ghim lên đầu nhóm. Mặc định có."},
        },
        ["group_id", "title"],
    ), zalo_create_note, TOOLSET_OWNER),

    ("zalo_create_reminder", "⏰", _schema(
        "zalo_create_reminder",
        "Đặt lời nhắc gốc của Zalo trong một hội thoại. Khác với cron của "
        "Hermes: lời nhắc này hiện ngay trong Zalo cho mọi thành viên thấy.",
        {
            "thread_id": _THREAD_ID,
            "thread_kind": _THREAD_KIND,
            "title": {"type": "string", "description": "Nội dung nhắc."},
            "start_time": {"type": "integer",
                           "description": "Thời điểm nhắc, tính bằng mili giây kể từ epoch."},
            "repeat": {"type": "integer",
                       "description": "0 không lặp, 1 hằng ngày, 2 hằng tuần, 3 hằng tháng."},
        },
        ["thread_id", "title", "start_time"],
    ), zalo_create_reminder, TOOLSET_PUBLIC),

    ("zalo_list_reminders", "🔔", _schema(
        "zalo_list_reminders",
        "Xem các lời nhắc đang đặt trong một hội thoại.",
        {"thread_id": _THREAD_ID, "thread_kind": _THREAD_KIND},
        ["thread_id"],
    ), zalo_list_reminders, TOOLSET_PUBLIC),

    ("zalo_remove_reminder", "🗑️", _schema(
        "zalo_remove_reminder",
        "Xoá một lời nhắc đã đặt. Dùng khi đặt nhầm giờ hoặc việc đã xong.",
        {
            "thread_id": _THREAD_ID,
            "thread_kind": _THREAD_KIND,
            "reminder_id": _ZALO_ID,
        },
        ["thread_id", "reminder_id"],
    ), zalo_remove_reminder, TOOLSET_PUBLIC),

    ("zalo_pin_conversation", "📍", _schema(
        "zalo_pin_conversation",
        "Ghim hoặc bỏ ghim một hội thoại lên đầu danh sách chat.",
        {
            "thread_id": _THREAD_ID,
            "thread_kind": _THREAD_KIND,
            "pinned": {"type": "boolean", "description": "true để ghim, false để bỏ."},
        },
        ["thread_id"],
    ), zalo_pin_conversation, TOOLSET_OWNER),

    ("zalo_mute", "🔕", _schema(
        "zalo_mute",
        "Tắt hoặc bật lại thông báo của một hội thoại.",
        {
            "thread_id": _THREAD_ID,
            "thread_kind": _THREAD_KIND,
            "muted": {"type": "boolean", "description": "true để tắt thông báo."},
            "duration": {"type": "integer",
                         "description": "Số giây tắt. -1 là vĩnh viễn (mặc định)."},
        },
        ["thread_id"],
    ), zalo_mute, TOOLSET_OWNER),

    # --- Nhóm 4: sửa sai & quản trị ---
    ("zalo_undo", "↩️", _schema(
        "zalo_undo",
        "Thu hồi một tin do chính bot gửi. Bỏ trống mã tin để thu hồi tin "
        "gần nhất của bot trong hội thoại; có thể truyền msg_id/cli_msg_id cụ thể.",
        {
            "thread_id": _THREAD_ID,
            "thread_kind": _THREAD_KIND,
            "msg_id": _ZALO_ID,
            "cli_msg_id": _ZALO_ID,
        },
        ["thread_id"],
    ), zalo_undo, TOOLSET_OWNER),

    ("zalo_rename_group", "✏️", _schema(
        "zalo_rename_group",
        "Đổi tên một nhóm Zalo. Cần quyền quản trị nhóm.",
        {
            "group_id": _GROUP_ID,
            "name": {"type": "string", "description": "Tên mới."},
        },
        ["group_id", "name"],
    ), zalo_rename_group, TOOLSET_OWNER),

    ("zalo_group_member_change", "🚪", _schema(
        "zalo_group_member_change",
        "Thêm hoặc xoá thành viên khỏi nhóm. Cần quyền quản trị. Việc này ảnh "
        "hưởng tới người thật — hãy xác nhận với chủ trước khi làm.",
        {
            "group_id": _GROUP_ID,
            "user_ids": {**_ZALO_ID_LIST, "description": "Danh sách UID."},
            "action": {"type": "string", "enum": ["add", "remove"]},
        },
        ["group_id", "user_ids", "action"],
    ), zalo_group_member_change, TOOLSET_OWNER),

    ("zalo_group_deputy", "🎖️", _schema(
        "zalo_group_deputy",
        "Trao hoặc thu hồi quyền phó nhóm cho một thành viên.",
        {
            "group_id": _GROUP_ID,
            "user_id": _ZALO_ID,
            "action": {"type": "string", "enum": ["add", "remove"]},
        },
        ["group_id", "user_id", "action"],
    ), zalo_group_deputy, TOOLSET_OWNER),

    ("zalo_pending_members", "📥", _schema(
        "zalo_pending_members",
        "Xem danh sách người đang chờ được duyệt vào nhóm.",
        {"group_id": _GROUP_ID},
        ["group_id"],
    ), zalo_pending_members, TOOLSET_OWNER),

    ("zalo_review_member", "✅", _schema(
        "zalo_review_member",
        "Duyệt hoặc từ chối người xin vào nhóm.",
        {
            "group_id": _GROUP_ID,
            "user_ids": _ZALO_ID_LIST,
            "approve": {"type": "boolean", "description": "true là duyệt, false là từ chối."},
        },
        ["group_id", "user_ids"],
    ), zalo_review_member, TOOLSET_OWNER),

    # --- Nhóm 5: lập nhóm & lời mời ---
    ("zalo_create_group", "🆕", _schema(
        "zalo_create_group",
        "Lập một nhóm Zalo mới với danh sách thành viên cho trước. Dùng khi "
        "cần một chỗ riêng cho một việc cụ thể. Việc này tạo ra nhóm thật và "
        "gửi thông báo tới từng người — hãy xác nhận với chủ trước khi làm.",
        {
            "member_ids": {
                **_ZALO_ID_LIST,
                "description": "UID những người sẽ được thêm vào. Bắt buộc, không được rỗng.",
            },
            "name": {"type": "string", "description": "Tên nhóm."},
            "avatar_path": {"type": "string", "description": "Đường dẫn ảnh đại diện nhóm."},
        },
        ["member_ids"],
    ), zalo_create_group, TOOLSET_OWNER),

    ("zalo_invite_to_groups", "✉️", _schema(
        "zalo_invite_to_groups",
        "Mời một người vào một hoặc nhiều nhóm cùng lúc. Gửi lời mời thật tới "
        "người đó — hãy hỏi chủ trước.",
        {
            "user_id": _ZALO_ID,
            "group_ids": {**_ZALO_ID_LIST, "description": "Các nhóm muốn mời vào."},
        },
        ["user_id", "group_ids"],
    ), zalo_invite_to_groups, TOOLSET_OWNER),

    ("zalo_group_link", "🔗", _schema(
        "zalo_group_link",
        "Xem, bật hoặc tắt link mời của một nhóm. Dùng `action` = 'detail' để "
        "lấy link hiện có, 'enable' để bật, 'disable' để thu hồi.",
        {
            "group_id": _GROUP_ID,
            "action": {"type": "string", "enum": ["detail", "enable", "disable"],
                       "description": "Mặc định 'detail'."},
        },
        ["group_id"],
    ), zalo_group_link, TOOLSET_OWNER),

    ("zalo_join_group_link", "🚪", _schema(
        "zalo_join_group_link",
        "Tham gia một nhóm Zalo bằng link mời. Sau khi vào, tài khoản bot sẽ "
        "đọc được tin nhắn của nhóm đó.",
        {"link": {"type": "string", "description": "Link mời nhóm Zalo."}},
        ["link"],
    ), zalo_join_group_link, TOOLSET_OWNER),

    # --- Nhóm 6: hồ sơ tài khoản bot ---
    ("zalo_set_bio", "📝", _schema(
        "zalo_set_bio",
        "Đổi dòng mô tả trên hồ sơ Zalo của chính tài khoản bot. Truyền chuỗi "
        "rỗng để xoá.",
        {"bio": {"type": "string", "description": "Nội dung mô tả mới."}},
        ["bio"],
    ), zalo_set_bio, TOOLSET_OWNER),

    ("zalo_set_active_status", "🟢", _schema(
        "zalo_set_active_status",
        "Bật hoặc tắt hiển thị trạng thái đang hoạt động của tài khoản bot. "
        "Tắt đi thì người khác không thấy bot online.",
        {"active": {"type": "boolean", "description": "true là hiện, false là ẩn."}},
        ["active"],
    ), zalo_set_active_status, TOOLSET_OWNER),

    # --- Nhóm 7: kho tài liệu tư vấn ---
    ("zalo_kb_list", "📚", _schema(
        "zalo_kb_list",
        "Liệt kê tài liệu trong kho tri thức để tư vấn (sản phẩm, dịch vụ, "
        "hướng dẫn). Gọi công cụ này trước để biết có những tệp nào, rồi mới "
        "đọc tệp phù hợp bằng zalo_kb_read. Chỉ dùng khi câu hỏi thật sự cần "
        "tra tài liệu — chuyện trò thông thường thì trả lời thẳng.",
        {"query": {"type": "string",
                   "description": "Lọc theo tên tệp, ví dụ 'gia' hay 'huong-dan'. Để trống là liệt kê tất cả."}},
        [],
    ), zalo_kb_list, TOOLSET_PUBLIC),

    ("zalo_kb_read", "📖", _schema(
        "zalo_kb_read",
        "Đọc một tệp trong kho tài liệu tư vấn. Đường dẫn lấy từ zalo_kb_list. "
        "Chỉ đọc được tệp văn bản nằm trong kho, không ra ngoài được.",
        {"path": {"type": "string",
                  "description": "Đường dẫn tương đối trong kho, ví dụ 'docs/bang-gia.md'."}},
        ["path"],
    ), zalo_kb_read, TOOLSET_PUBLIC),

    # --- Nhóm 8: tra cứu Internet ---
    ("zalo_web_search", "🔎", _schema(
        "zalo_web_search",
        "Tìm kiếm trên Internet. Dùng khi câu hỏi cần thông tin mới hoặc nằm "
        "ngoài kiến thức sẵn có và kho tài liệu.",
        {
            "query": {"type": "string", "description": "Nội dung cần tìm."},
            "limit": {"type": "integer", "description": "Số kết quả, 1-10. Mặc định 5."},
        },
        ["query"],
    ), zalo_web_search, TOOLSET_PUBLIC),

    ("zalo_web_read", "🌐", _schema(
        "zalo_web_read",
        "Đọc nội dung một hoặc vài trang web theo địa chỉ. Chỉ đọc được địa "
        "chỉ công cộng http/https, tối đa 5 trang mỗi lần.",
        {
            "url": {"type": "string", "description": "Địa chỉ trang cần đọc."},
            "urls": {"type": "array", "items": {"type": "string"},
                     "description": "Nhiều địa chỉ cùng lúc, tối đa 5."},
        },
        [],
    ), zalo_web_read, TOOLSET_PUBLIC),

    # --- Nhóm 9: sổ hồ sơ người quen ---
    ("zalo_remember_person", "🧠", _schema(
        "zalo_remember_person",
        "Ghi nhớ thông tin người đang trò chuyện để lần sau xưng hô và tư vấn "
        "cho đúng. Gọi khi họ tự giới thiệu — tên, công việc, lĩnh vực, sở "
        "thích, nhu cầu. Chỉ lưu điều họ tự nói ra, đừng suy đoán. Không lưu "
        "thông tin nhạy cảm như số tài khoản hay mật khẩu.",
        {
            "name": {"type": "string", "description": "Tên hoặc cách xưng hô họ muốn."},
            "note": {"type": "string", "description": "Ghi chú ngắn về họ."},
            "fields": {"type": "object",
                       "description": "Các mục rời, ví dụ {\"lĩnh vực\": \"kỹ thuật\", \"đơn vị\": \"phòng IT\"}."},
            "user_id": _ZALO_ID,
        },
        [],
    ), zalo_remember_person, TOOLSET_PUBLIC),

    ("zalo_recall_person", "🔖", _schema(
        "zalo_recall_person",
        "Xem lại hồ sơ đã lưu của một người. Thường không cần gọi — hồ sơ của "
        "người đang nhắn đã được kẹp sẵn vào đầu cuộc trò chuyện.",
        {"user_id": _ZALO_ID},
        [],
    ), zalo_recall_person, TOOLSET_PUBLIC),

    ("zalo_list_people", "📒", _schema(
        "zalo_list_people",
        "Liệt kê những người bot đã ghi nhớ, mới nhất trước.",
        {"limit": {"type": "integer", "description": "Số hồ sơ, tối đa 200. Mặc định 50."}},
        [],
    ), zalo_list_people, TOOLSET_OWNER),

    ("zalo_forget_person", "🗑️", _schema(
        "zalo_forget_person",
        "Xoá hồ sơ một người khỏi sổ nhớ.",
        {"user_id": _ZALO_ID},
        ["user_id"],
    ), zalo_forget_person, TOOLSET_OWNER),
]


DANGEROUS_TOOL_NAMES = frozenset({
    "zalo_lock_poll", "zalo_pin_conversation", "zalo_mute", "zalo_undo",
    "zalo_rename_group", "zalo_group_member_change", "zalo_group_deputy",
    "zalo_review_member", "zalo_create_group", "zalo_invite_to_groups",
    "zalo_group_link", "zalo_join_group_link", "zalo_set_bio",
    "zalo_set_active_status",
})

_CONFIRM_SCHEMA = {
    "type": "string",
    "pattern": "^[A-F0-9]{6}$",
    "description": "Chỉ dùng khi lần gọi trước trả về confirmation_required: truyền đúng mã sáu ký tự đó sau khi chủ nhân nhắn XÁC NHẬN <MÃ>.",
}

# `detail` của zalo_group_link chỉ đọc nên không cần mã; hai action `enable`
# và `disable` được kiểm tra lúc thực thi. Mã không bắt buộc ở schema: mặc định
# không cần mã, còn khi bật thì lần gọi đầu phải tạo challenge thay vì bị JSON
# Schema chặn trước handler.
for _name, _emoji, _tool_schema, _handler, _toolset in TOOLS:
    if _name not in DANGEROUS_TOOL_NAMES:
        continue
    _parameters = _tool_schema["parameters"]
    _properties = _parameters.setdefault("properties", {})
    _properties.pop("confirm", None)
    _properties["confirmation_code"] = dict(_CONFIRM_SCHEMA)
    _parameters["required"] = [item for item in _parameters["required"] if item != "confirm"]


# Hai công cụ này chỉ chạy trong tin nhắn riêng. Trong nhóm, tin của mọi thành
# viên cùng nằm trong ngữ cảnh một phiên — ai đó thả vào nhóm một đoạn chữ soạn
# sẵn là có thể lái mô hình mà chủ nhân không hề biết. Nhắn riêng thì ngữ cảnh
# chỉ có lời chủ nhân.
DM_ONLY_TOOLS = frozenset({"zalo_fb_draft", "zalo_fb_publish"})


def _confirmation_required(tool_name: str, args: Dict[str, Any]) -> bool:
    if tool_name == "zalo_group_link":
        return str(args.get("action") or "detail").lower() in {"enable", "disable"}
    return tool_name in DANGEROUS_TOOL_NAMES


def _confirmation_codes_enabled() -> bool:
    """Có bắt chủ nhân gửi lại mã xác nhận cho thao tác nguy hiểm không (mặc định: không).

    Tắt thì chủ nhân nhắn là bot làm luôn, trong nhóm hay nhắn riêng đều vậy —
    người ngoài vẫn không chạm được vì các công cụ này chỉ nằm trong bộ của chủ
    và sidecar kiểm lại lần nữa. Bật ``ZALO_CONFIRM_DANGEROUS=true`` thì mỗi thao
    tác cần chủ nhân gửi lại ``XÁC NHẬN <MÃ>``, chặn thêm trường hợp tài liệu hay
    trang web bot đọc có cài lệnh ẩn dụ bot tự làm ngay trong lượt chat của chủ.
    Đọc lúc gọi chứ không lúc nạp module, để đổi .env rồi khởi động lại là ăn.
    """
    return str(os.getenv("ZALO_CONFIRM_DANGEROUS") or "").strip().lower() in {"1", "true", "yes", "on"}


def _confirmed_action(handler, tool_name: str):
    async def guarded(args: Dict[str, Any], **kw) -> str:
        call_args = dict(args)
        required = _confirmation_required(tool_name, call_args)
        confirmed = False
        if required and not _confirmation_codes_enabled():
            if not _turn().get("is_owner"):
                return _err("thao tác này chỉ chủ nhân mới được thực hiện")
            if tool_name == "zalo_undo":
                call_args = _with_quoted_undo_target(call_args)
            confirmed = True
        elif required:
            turn = _turn()
            if not turn.get("is_owner"):
                return _err("thao tác này chỉ chủ nhân mới được xác nhận")
            now = time.monotonic()
            for pending_key, pending in list(_PENDING_CONFIRMATIONS.items()):
                if pending["expires_at"] <= now:
                    _PENDING_CONFIRMATIONS.pop(pending_key, None)
            actor = str(turn.get("sender_uid") or "")
            thread = str(turn.get("thread_id") or "")
            key = (actor, thread, tool_name)
            pending = _PENDING_CONFIRMATIONS.get(key)
            if tool_name == "zalo_undo":
                call_args = _with_quoted_undo_target(call_args)
                if (pending and not call_args.get("msg_id") and not call_args.get("cli_msg_id")):
                    previous = pending.get("arguments") or {}
                    same_destination = all(
                        str(call_args.get(name) or "") == str(previous.get(name) or "")
                        for name in ("thread_id", "thread_kind")
                    )
                    if same_destination and previous.get("msg_id") and previous.get("cli_msg_id"):
                        call_args["msg_id"] = previous["msg_id"]
                        call_args["cli_msg_id"] = previous["cli_msg_id"]
            normalized_args = {
                name: value for name, value in call_args.items()
                if name not in {"confirm", "confirmation_code"}
            }
            fingerprint = hashlib.sha256(
                json.dumps(normalized_args, sort_keys=True, ensure_ascii=False, default=str).encode("utf-8")
            ).hexdigest()
            supplied = str(call_args.get("confirmation_code") or "").strip().upper()
            phrase = f"XÁC NHẬN {supplied}" if supplied else ""
            # Gộp khoảng trắng: gõ trên điện thoại hay lọt dấu cách đôi.
            human_text = " ".join(str(turn.get("text") or "").split()).upper()
            if (pending and supplied and secrets.compare_digest(supplied, pending["code"])
                    and secrets.compare_digest(fingerprint, pending["fingerprint"])
                    and phrase == human_text):
                _PENDING_CONFIRMATIONS.pop(key, None)
                confirmed = True
            else:
                if not pending or pending["fingerprint"] != fingerprint:
                    pending = {
                        "code": secrets.token_hex(3).upper(),
                        "fingerprint": fingerprint,
                        "arguments": normalized_args,
                        "expires_at": now + _CONFIRMATION_TTL_SECONDS,
                    }
                    _PENDING_CONFIRMATIONS[key] = pending
                return json.dumps({
                    "success": False,
                    "error": f"Cần chủ nhân gửi một tin nhắn mới: XÁC NHẬN {pending['code']}",
                    "confirmation_required": True,
                    "confirmation_code": pending["code"],
                }, ensure_ascii=False)
        token = _CONFIRMED.set(confirmed)
        try:
            return await handler(call_args, **kw)
        finally:
            _CONFIRMED.reset(token)

    guarded.__name__ = getattr(handler, "__name__", tool_name)
    guarded.__doc__ = getattr(handler, "__doc__", None)
    return guarded


def _dm_only(handler, tool_name: str):
    async def guarded(args: Dict[str, Any], **kw) -> str:
        turn = _turn()
        if turn and turn.get("is_group"):
            logger.info("[zalo] chặn %s — chỉ dùng được khi nhắn riêng", tool_name)
            return _err("việc này chỉ làm được khi nhắn riêng với mình, "
                        "không làm trong nhóm")
        return await handler(args, **kw)

    guarded.__name__ = getattr(handler, "__name__", tool_name)
    guarded.__doc__ = getattr(handler, "__doc__", None)
    return guarded



def _owner_only(handler, tool_name: str):
    """Bọc một công cụ để chỉ chủ nhân gọi được.

    Đây mới là rào chắn thật. Việc chia toolset chỉ giấu công cụ khỏi danh
    sách — mà Hermes lại tự bật mọi toolset của plugin trừ khi bị tắt tường
    minh, nên không thể trông cậy vào nó một mình. Kiểm tra ngay tại điểm
    thực thi thì dù công cụ có lọt vào danh sách, người ngoài gọi vẫn bị từ
    chối.
    """
    async def guarded(args: Dict[str, Any], **kw) -> str:
        turn = _turn()
        if not turn.get("is_owner"):
            logger.info("[zalo] chặn %s — %s không phải chủ nhân",
                        tool_name, turn.get("sender_uid"))
            return _err("công cụ này chỉ chủ nhân dùng được")
        return await handler(args, **kw)

    guarded.__name__ = getattr(handler, "__name__", tool_name)
    guarded.__doc__ = getattr(handler, "__doc__", None)
    return guarded


_PUBLIC_TOOL_NAMES = frozenset(name for name, _e, _s, _h, toolset in TOOLS if toolset == TOOLSET_PUBLIC)
# Hai cầu nối chỉ đọc của Tool Search. ``tool_call`` thì xét công cụ thật bên trong.
_TOOL_SEARCH_READS = frozenset({"tool_search", "tool_describe"})


def _busy_input_injects() -> bool:
    """Hermes có thể chèn tin mới vào lượt đang chạy không (``interrupt``/``steer``).

    Chế độ ``queue`` thì tin mới chờ thành lượt riêng, không lẫn vào lượt này.
    Chỉ tin là ``queue`` khi cả biến môi trường gateway đặt lúc khởi động lẫn
    config.yaml hiện tại đều nói vậy: lệnh ``/busy`` đổi config lúc đang chạy mà
    không đổi biến môi trường. Lệch nhau hoặc không đọc được thì coi như có chèn
    — thà hạ quyền nhầm còn hơn.
    """
    modes = []
    env_mode = os.getenv("HERMES_GATEWAY_BUSY_INPUT_MODE", "")
    if env_mode:
        modes.append(env_mode)
    try:
        from hermes_cli.config import load_config_readonly

        modes.append(str(((load_config_readonly() or {}).get("display") or {}).get("busy_input_mode") or ""))
    except Exception:
        return True
    return not all(mode.strip().lower() == "queue" for mode in modes)


def _outsider_spoke_after(turn: Dict[str, Any]) -> bool:
    """Có người ngoài gọi bot trong cùng hội thoại sau khi lượt này bắt đầu không.

    Chế độ ``busy_input_mode`` interrupt/steer của Hermes chèn tin mới vào lượt
    đang chạy, nên lượt của chủ nhân có thể đang xử lý cả lời của người ngoài.
    """
    adapter, seq = _ACTIVE_ADAPTER, turn.get("seq")
    if adapter is None or seq is None or not _busy_input_injects():
        return False
    return any(
        other.get("thread_id") == turn.get("thread_id")
        and not other.get("is_owner")
        and other.get("seq", 0) > seq
        for other in list((getattr(adapter, "_turns", None) or {}).values())
    )


def _member_may_call(name: str, args: Any) -> bool:
    if name in _PUBLIC_TOOL_NAMES or name in _TOOL_SEARCH_READS:
        return True
    if name == "tool_call":
        # Lõi thường đã tháo ra công cụ thật trước khi gọi hook; phòng khi chưa.
        try:
            from tools.tool_search import resolve_underlying_call

            underlying, _args, error = resolve_underlying_call(args if isinstance(args, dict) else {})
        except Exception:
            return False
        return bool(underlying) and not error and underlying != "tool_call" and _member_may_call(underlying, {})
    try:
        from tools.registry import registry

        return str(registry.get_toolset_for_tool(name) or "").startswith("mcp-")
    except Exception:
        return False


def guard_member_tool_call(tool_name: str = "", args: Any = None, **_kw) -> Optional[Dict[str, str]]:
    """Hook ``pre_tool_call``: lượt không phải của riêng chủ nhân chỉ chạy được công cụ công khai.

    toolsets_for_source chỉ đưa ``zalo_public`` cho người ngoài, nhưng Hermes
    còn "đóng băng" danh sách công cụ theo phiên (``restore_agent_tool_prefix``):
    phiên nhóm do chủ nhân mở trước thì lượt sau của bất kỳ ai cũng được cấp lại
    ``terminal``, ``read_file``, ``vision_analyze``… Chặn tại điểm thực thi thì
    dù công cụ lọt vào danh sách, người ngoài gọi vẫn không chạy được. Lượt của
    chủ nhân mà có người ngoài gọi bot chen vào cũng bị hạ về mức công khai.

    Không có lượt Zalo (CLI, nền tảng khác, cron) thì để yên.
    """
    turn = _TURN.get()
    if not turn:
        return None
    if (turn.get("is_owner") or turn.get("core_tools")) and not _outsider_spoke_after(turn):
        return None
    name = str(tool_name or "")
    if _member_may_call(name, args):
        return None
    logger.warning("[zalo] chặn %s — lượt của %s không phải của riêng chủ nhân", name, turn.get("sender_uid"))
    reason = ("lượt của chủ nhân nhưng có tin người khác chen vào"
              if turn.get("is_owner") or turn.get("core_tools")
              else "lượt này do người trong nhóm gửi")
    # Nói luôn đường đi đúng: model chỉ nhìn thấy công cụ lõi đã bị ghim vào
    # phiên, còn công cụ Zalo công khai thì nằm sau tool_search — bị chặn mà
    # không được chỉ chỗ thì nó bỏ cuộc và trả lời "không tra được".
    return {
        "action": "block",
        "message": (f"Công cụ {name} chỉ dùng được trong lượt của riêng chủ nhân ({reason}). "
                    "Cần tra tài liệu thì dùng zalo_kb_list rồi zalo_kb_read, cần gửi tệp thì "
                    "zalo_send_file, cần xem lại tin cũ thì zalo_read_history — tìm bằng "
                    "tool_search nếu chưa thấy. Đừng gọi lại công cụ này."),
    }


def define_platform_composite() -> None:
    """Định nghĩa tường minh toolset ``hermes-zalo``.

    Khi toolset này không tồn tại, Hermes tự sinh nó bằng
    ``_HERMES_CORE_TOOLS`` — và bộ lõi ấy chứa sẵn cả nhóm ``kanban_*``. Hậu
    quả: khối "recover non-configurable toolsets" trong ``tools_config`` thấy
    ``kanban ⊆ universe`` nên bật kanban cho MỌI người nhắn vào nền tảng, kể
    cả người lạ trong nhóm. Không cấu hình nào cản được — đây là đường đi
    vòng qua ``toolsets_for_source()``, nên bảng công việc riêng của chủ nhân
    thành đọc/ghi công khai.

    Định nghĩa tường minh ở đây khiến nhánh tự sinh không chạy nữa. Vẫn lấy
    ``_HERMES_CORE_TOOLS`` làm gốc để bám theo Hermes khi nâng cấp, chỉ trừ
    đúng phần kanban. Chủ nhân vẫn dùng kanban qua Zalo được: adapter liệt kê
    thẳng ``kanban`` trong override dành riêng cho họ.
    """
    try:
        from toolsets import (_HERMES_CORE_TOOLS, create_custom_toolset,
                              resolve_toolset)
    except ImportError as exc:
        logger.warning("[zalo] không định nghĩa được hermes-zalo: %s", exc)
        return

    core = set(_HERMES_CORE_TOOLS)
    private = set(resolve_toolset("kanban", include_registry=False))
    create_custom_toolset(
        name="hermes-zalo",
        description="Công cụ lõi Hermes cho nền tảng Zalo (không gồm kanban).",
        tools=sorted(core - private),
        includes=[],
    )
    # Bộ nhớ đệm của resolve_toolset khoá theo registry chứ không theo
    # TOOLSETS, nên một định nghĩa đến muộn có thể bị kết quả đã đệm che mất.
    try:
        import toolsets as _ts
        _ts._resolve_toolset_memo.clear()
    except Exception:
        pass

    logger.info("[zalo] hermes-zalo: %d công cụ (đã loại %d công cụ kanban)",
                len(core - private), len(private))


def define_cron_member_toolset() -> None:
    """Định nghĩa toolset ``zalo_cron_member`` cho việc hẹn giờ do thành viên tạo.

    Job của thành viên ghim ``enabled_toolsets = [zalo_cron_member, no_mcp]``,
    nên lúc chạy agent chỉ cầm đúng CRON_MEMBER_TOOLS — không terminal, không
    đọc tệp, không MCP, không nhắm hội thoại khác.
    """
    try:
        from toolsets import create_custom_toolset
    except ImportError as exc:
        logger.warning("[zalo] không định nghĩa được %s: %s", TOOLSET_CRON_MEMBER, exc)
        return

    create_custom_toolset(
        name=TOOLSET_CRON_MEMBER,
        description="Công cụ cho việc hẹn giờ do thành viên nhóm Zalo tạo.",
        tools=list(CRON_MEMBER_TOOLS),
        includes=[],
    )
    try:
        import toolsets as _ts
        _ts._resolve_toolset_memo.clear()
    except Exception:
        pass


def register_tools(ctx) -> None:
    """Đăng ký công cụ Zalo, chia làm hai mức quyền."""
    counts = {TOOLSET_PUBLIC: 0, TOOLSET_OWNER: 0, TOOLSET_CRON: 0}
    for name, emoji, schema, handler, toolset in TOOLS:
        guarded = handler
        if toolset == TOOLSET_OWNER:
            guarded = _owner_only(
                _confirmed_action(
                    _dm_only(handler, name) if name in DM_ONLY_TOOLS else handler,
                    name,
                ),
                name,
            )
        try:
            ctx.register_tool(
                name=name,
                toolset=toolset,
                schema=schema,
                handler=_with_cron_turn(guarded, name),
                is_async=True,
                description=schema["description"],
                emoji=emoji,
            )
            counts[toolset] = counts.get(toolset, 0) + 1
        except Exception as exc:  # pragma: no cover — đăng ký hỏng không được làm chết plugin
            logger.warning("[zalo] không đăng ký được công cụ %s: %s", name, exc)
    logger.info(
        "[zalo] đã đăng ký %d công cụ — %d công khai, %d chỉ chủ nhân, %d cho cron",
        sum(counts.values()), counts.get(TOOLSET_PUBLIC, 0), counts.get(TOOLSET_OWNER, 0),
        counts.get(TOOLSET_CRON, 0),
    )
