/**
 * Quote Resolution — giải mã tin nhắn trích dẫn (reply/quote) trong nhóm Zalo.
 *
 * Khi khách quote một ảnh cũ rồi gõ "Cái này còn hàng không?", Zalo gửi:
 *   { quote: { msgId, content: { ... } } }
 * Nếu Agent chỉ đọc text hiện tại, nó sẽ hỏi ngược "Cái nào ạ?" — trải nghiệm tệ.
 *
 * Module này extract nội dung quoted và dán vào context prompt dưới dạng:
 *   [Trích dẫn từ @Tên] <nội dung tin gốc>
 * Hoặc [Trích dẫn] <nội dung tin gốc>
 */

import { extractText } from "./schema.js";

/**
 * Trích xuất toàn bộ thông tin có cấu trúc của tin nhắn được quote.
 * @param {object|undefined} rawQuote - data.quote từ raw Zalo message
 * @returns {object|null}
 */
export function extractQuote(rawQuote) {
  if (!rawQuote || typeof rawQuote !== "object") return null;
  const quote = rawQuote;
  let attachment = quote.attach;
  if (typeof attachment === "string" && attachment.trim()) {
    try {
      attachment = JSON.parse(attachment);
    } catch {
      attachment = null;
    }
  }

  const authorId = quote.ownerId ? String(quote.ownerId) : (quote.fromUid ? String(quote.fromUid) : null);
  const authorName = quote.ownerName || quote.dName || quote.fromD || quote.senderName || "";
  const text = resolveQuoteText(quote);
  const id = quote.msgId ? String(quote.msgId) : (quote.globalMsgId ? String(quote.globalMsgId) : null);
  const cliMsgId = quote.cliMsgId ? String(quote.cliMsgId) : null;
  const msgType = quote.msgType || quote.cliMsgType || "";

  return {
    id,
    cliMsgId,
    authorId,
    authorName,
    text,
    msgType,
  };
}

/**
 * Giải mã payload quote từ Zalo message data.
 * @param {object|undefined} quote   - data.quote từ raw Zalo message
 * @returns {string}                 - "" nếu không có / không đọc được
 */
export function resolveQuoteText(quote) {
  if (!quote) return "";

  // Zalo quote payload có thể chứa content.title hoặc content trực tiếp
  const content = quote.content ?? quote.msg ?? quote;

  // Text thẳng
  if (typeof content === "string" && content.trim()) {
    return content.trim().slice(0, 500);
  }

  // Content là object (ảnh, file, tin nhắn có cấu trúc)
  if (typeof content === "object" && content !== null) {
    // Ưu tiên title (sticker name, file name, album title)
    const title = content.title || content.name || "";
    const body = extractText(content);
    // extractText thường trả về title khi không có body thật — loại trùng
    const combined = (body && body !== title)
      ? [title, body].filter(Boolean).join(" — ").trim()
      : title.trim();
    if (combined) return combined.slice(0, 500);

    // Fallback: loại media
    const mediaType =
      content.type === 2 ? "[Ảnh]"
      : content.type === 3 ? "[Video]"
      : content.type === 5 ? "[File]"
      : content.type === 6 ? "[Nhãn dán]"
      : content.type === 8 ? "[Audio]"
      : "[Nội dung đa phương tiện]";
    return mediaType;
  }

  return "";
}

/**
 * Nếu event có quoted content, gắn thêm prefix [Trích dẫn từ @Tên] hoặc [Trích dẫn] vào text để Agent hiểu ngữ cảnh.
 * @param {object} event - Normalized event từ schema.js
 * @param {object|undefined} rawQuote - data.quote từ raw Zalo message hoặc extracted quote object
 * @returns {string}     - text đã kèm ngữ cảnh trích dẫn
 */
export function enrichTextWithQuote(event, rawQuote) {
  const quote = typeof rawQuote === "object" && rawQuote !== null && "authorName" in rawQuote
    ? rawQuote
    : extractQuote(rawQuote);
  if (!quote || !quote.text) return event?.text || "";

  const header = quote.authorName ? `[Trích dẫn từ @${quote.authorName}]` : `[Trích dẫn]`;
  return `${header} ${quote.text}\n${event?.text || ""}`;
}
