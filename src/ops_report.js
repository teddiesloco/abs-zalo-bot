// Executive Zalo report format for managers — not technical logs.
// Never invent operational depth when message history is thin.

function num(n) {
  return Number(n || 0).toLocaleString("vi-VN");
}

function cleanLine(s, max = 100) {
  return String(s || "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);
}

/**
 * Build one professional ops message for the configured destination.
 * @param {object} p
 * @param {string} [p.title]
 * @param {string} [p.windowLabel] e.g. "24 giờ"
 * @param {object} p.stats { groups, users, member_links, messages_total, recent_source_msgs }
 * @param {Array}  [p.recentEvents] source messages (not destination)
 * @param {boolean} [p.autoReplyEnabled]
 * @param {boolean} [p.listening]
 * @param {string}  [p.note]
 */
export function buildOpsReport({
  title = "Tổng hợp vận hành — destination đã cấu hình",
  windowLabel = "24 giờ",
  stats = {},
  recentEvents = [],
  autoReplyEnabled = false,
  listening = true,
  note = "",
} = {}) {
  const groups = stats.groups ?? stats.sources ?? 0;
  const users = stats.users ?? 0;
  const links = stats.member_links ?? 0;
  const msgs = stats.messages_total ?? stats.messages ?? 0;
  const recent = stats.recent_source_msgs ?? recentEvents.length;

  const statusParts = [];
  statusParts.push(
    listening
      ? "Hệ thống đang theo dõi bình thường"
      : "Hệ thống chưa theo dõi tin mới"
  );
  statusParts.push(
    autoReplyEnabled
      ? "trả lời tự động đang bật"
      : "chưa bật trả lời tự động"
  );

  const lines = [];
  lines.push(title);
  lines.push("");
  lines.push("Trạng thái:");
  lines.push(statusParts.join(", ") + ".");
  lines.push("");
  lines.push("Số liệu hiện có:");
  lines.push(`${num(groups)} nhóm đã ghi nhận`);
  lines.push(`${num(users)} người dùng`);
  lines.push(`${num(links)} liên kết thành viên-nhóm`);
  lines.push(`${num(msgs)} tin nhắn đã lưu`);
  lines.push("");
  lines.push("Hoạt động gần đây:");

  if (recent > 0 && recentEvents.length) {
    lines.push(`Có ${num(recent)} tin từ nhóm nguồn trong ${windowLabel}.`);
    const bySource = new Map();
    for (const e of recentEvents.slice(0, 40)) {
      const name = e.source_name || e.source_id || "nhóm";
      bySource.set(name, (bySource.get(name) || 0) + 1);
    }
    const top = [...bySource.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5);
    for (const [name, count] of top) {
      lines.push(`• ${cleanLine(name, 60)}: ${count} tin`);
    }
    // Only surface issues when we actually have message text.
    const samples = recentEvents
      .map((e) => cleanLine(e.text, 90))
      .filter(Boolean)
      .slice(0, 3);
    if (samples.length) {
      lines.push("Ghi nhận gần đây:");
      for (const s of samples) lines.push(`- ${s}`);
    }
  } else if (recent > 0) {
    lines.push(`Có ${num(recent)} tin từ nhóm nguồn trong ${windowLabel}.`);
  } else {
    lines.push(`Chưa ghi nhận thêm tin mới trong ${windowLabel} qua.`);
  }

  lines.push("");
  lines.push("Nhận xét:");
  if (msgs < 10) {
    lines.push(
      "Dữ liệu nhóm và thành viên đã đủ để map vận hành ban đầu. Lịch sử tin nhắn cũ còn hạn chế, nên phần tổng hợp nội dung hiện chưa sâu."
    );
  } else if (recent === 0) {
    lines.push(
      "Đã có kho tin nhắn tích lũy, nhưng cửa sổ gần đây yên. Chưa đủ tín hiệu để đánh giá xu hướng vận hành."
    );
  } else {
    lines.push(
      "Đã có tín hiệu tin gần đây. Có thể theo dõi vấn đề nổi bật và việc cần follow-up khi số lượng tin đủ dày hơn."
    );
  }
  if (note) lines.push(cleanLine(note, 220));

  lines.push("");
  lines.push("Việc tiếp theo:");
  if (msgs < 10) {
    lines.push(
      "Tiếp tục theo dõi tin mới realtime. Khi dữ liệu đủ hơn, báo cáo sẽ đánh giá được xu hướng, vấn đề nổi bật và việc cần xử lý."
    );
  } else {
    lines.push(
      "Giữ theo dõi tin mới. Ưu tiên các nhóm có nhiều tin bất thường hoặc cần follow-up."
    );
  }

  // Hard cap for Zalo single message readability.
  return lines.join("\n").slice(0, 3200);
}

/** Strip leftover technical jargon if an upstream model returns it. */
export function scrubTechJargon(text) {
  return String(text || "")
    .replace(/\b(corpus|digest|outbound|READ_ONLY(?:_SOURCE)?|bridge|ask_reply|event_id)\b/gi, "")
    .replace(/[ \t]{2,}/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
