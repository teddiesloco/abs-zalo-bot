"""Bộ công cụ Zalo — đăng ký sớm để Hermes công nhận toolset.

Vì sao tách khỏi ``plugins/platforms/zalo``: Hermes nạp mọi plugin
``kind: platform`` theo kiểu lười (xem ``_register_deferred_platform``) để
``hermes chat`` không phải import cả hai chục nền tảng mỗi lần khởi động. Hệ
quả là công cụ do một platform plugin đăng ký chỉ vào registry khi gateway
chạm tới nền tảng đó — muộn hơn lúc Hermes lập danh sách khoá toolset, nên
``zalo`` và ``zalo_public`` bị coi là tên lạ và agent mất sạch công cụ.

Plugin ``standalone`` nạp ngay lúc khám phá, nên đặt công cụ ở đây là đủ.
Adapter nền tảng vẫn nằm bên ``platforms/zalo`` và import lại từ đây.
"""

from .tools import (define_cron_member_toolset, define_platform_composite,
                    guard_member_tool_call, register_tools)

__all__ = ["register"]


def register(ctx) -> None:
    """Điểm vào plugin — Hermes gọi lúc khám phá."""
    register_tools(ctx)
    # Rào chắn tại điểm thực thi: Hermes cấp lại công cụ đã ghim của phiên nhóm
    # cho mọi lượt, kể cả lượt của người ngoài. Xem guard_member_tool_call().
    ctx.register_hook("pre_tool_call", guard_member_tool_call)
    # Phải chạy sau register_tools: định nghĩa dựa trên bộ công cụ lõi và
    # cần dọn bộ nhớ đệm của resolve_toolset sau khi registry đã đổi.
    define_platform_composite()
    define_cron_member_toolset()
