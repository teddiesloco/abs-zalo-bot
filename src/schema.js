// Shared constants + pure helpers. No secrets. No network.
import crypto from "node:crypto";
import { extractAttachmentCandidates } from "./hermes_media.js";
import { extractQuote, enrichTextWithQuote } from "./quote_resolver.js";

export const ACCOUNT_STATUSES = Object.freeze([
  "disconnected",
  "need_scan",
  "reconnecting",
  "connected",
  "paused",
]);

export const SOURCE_MODES = Object.freeze([
  "off",
  "listen_only",
  "digest_only",
  "alert_only",
  "mention_only",
  "reply_enabled",
]);

export const ROLES = Object.freeze(["owner", "admin", "operator", "viewer"]);

export const MESSAGE_TYPES = Object.freeze([
  "text",
  "image",
  "file",
  "audio",
  "video",
  "sticker",
  "unknown",
]);

export function utcNow() {
  return new Date().toISOString();
}

export function sha256(text) {
  return crypto.createHash("sha256").update(String(text ?? ""), "utf8").digest("hex");
}

export function stableEventId(parts) {
  return sha256(parts.filter((p) => p != null && p !== "").join("|")).slice(0, 32);
}

export function safeJsonParse(raw, fallback = null) {
  try {
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
}

const SECRET_KEY =
  /^(cookie|cookies|imei|password|secret|authorization|access_token|refresh_token|dashboard_token|user_agent)$/i;
// "session" alone is too broad (has_session, sessions_dir). Only raw session blobs.
const SECRET_SESSION_KEY = /^(session|session_data|session_blob|credentials)$/i;

export function redactSecrets(value) {
  if (value == null) return value;
  if (typeof value === "string") {
    // Avoid redacting ordinary short labels; only long secret-looking payloads.
    if (/(eyJ|cookie=|imei=)/i.test(value) && value.length > 40) return "[redacted]";
    return value;
  }
  if (Array.isArray(value)) return value.map(redactSecrets);
  if (typeof value === "object") {
    const out = {};
    for (const [k, v] of Object.entries(value)) {
      if (SECRET_KEY.test(k) || SECRET_SESSION_KEY.test(k)) {
        out[k] = "[redacted]";
        continue;
      }
      out[k] = redactSecrets(v);
    }
    return out;
  }
  return value;
}

export function normalizeMode(mode) {
  const m = String(mode || "off").trim().toLowerCase();
  return SOURCE_MODES.includes(m) ? m : "off";
}

export function classifyMessageType(content) {
  if (typeof content === "string") return "text";
  if (!content || typeof content !== "object") return "unknown";
  if (content.href || content.thumb || content.title) return "image";
  if (content.fileUrl || content.fileName) return "file";
  if (content.voiceUrl || content.duration != null && content.fileSize) return "audio";
  if (content.videoUrl) return "video";
  if (content.id && content.cateId != null) return "sticker";
  return "unknown";
}

export function extractText(content) {
  if (typeof content === "string") return content;
  if (!content || typeof content !== "object") return "";
  if (typeof content.title === "string") return content.title;
  if (typeof content.description === "string") return content.description;
  if (typeof content.fileName === "string") return content.fileName;
  return "";
}

/**
 * Normalize a zca-js style message into the internal event schema.
 * account_id is required so multi-session never collides.
 */
function quoteContent(quote) {
  if (!quote || typeof quote !== "object") return null;
  let attachment = quote.attach;
  if (typeof attachment === "string" && attachment.trim()) {
    try {
      attachment = JSON.parse(attachment);
    } catch {
      attachment = null;
    }
  }
  return attachment || quote.content || quote;
}

function quoteText(quote) {
  if (!quote || typeof quote !== "object") return "";
  const value = quote.msg ?? quote.content;
  if (typeof value === "string" && value.trim()) return value.trim().slice(0, 500);
  const content = quoteContent(quote);
  if (!content || typeof content !== "object") return "";
  const title = String(content.title || content.name || content.fileName || "").trim();
  return (extractText(content) || title).trim().slice(0, 500);
}
export function normalizeInboundMessage({ accountId, message, sourceName = "" }) {
  if (!accountId) throw new Error("account_id required");
  if (!message) throw new Error("message required");

  const isGroup = Number(message.type) === 1 || message.type === "group";
  const sourceType = isGroup ? "group" : "dm";
  const sourceId = String(message.threadId ?? message.thread_id ?? "");
  const data = message.data || {};
  const messageId = String(data.msgId ?? data.messageId ?? data.cliMsgId ?? message.messageId ?? "");
  const senderId = String(data.uidFrom ?? data.senderId ?? message.senderId ?? "");
  const senderName = String(data.dName ?? data.displayName ?? data.senderName ?? "");
  const content = data.content;
  const messageType = classifyMessageType(content);
  const rawText = extractText(content);
  const ownText = rawText;
  const quotedText = quoteText(data.quote);
  const quoteObj = extractQuote(data.quote);
  const text = quotedText ? `[Trích dẫn] ${quotedText}\n${ownText}`.trim() : ownText;
  const createdAt = data.ts
    ? new Date(Number(data.ts) || data.ts).toISOString()
    : utcNow();
  const isSelf = Boolean(message.isSelf);
  const isQuoteOfSelf = Boolean(quoteObj?.authorId && String(quoteObj.authorId) === String(accountId));
  const isMention =
    Boolean(data.mentions?.length) ||
    Boolean(data.quote) ||
    isQuoteOfSelf ||
    /@/.test(text);

  const eventId = stableEventId([
    accountId,
    sourceType,
    sourceId,
    messageId,
    senderId,
    createdAt,
    text.slice(0, 80),
  ]);

  return {
    event_id: eventId,
    account_id: String(accountId),
    source_type: sourceType,
    source_id: sourceId,
    source_name: sourceName || String(data.threadName || ""),
    sender_id: senderId,
    sender_name: senderName,
    message_id: messageId || eventId,
    message_type: messageType,
    text,
    raw_text: rawText,
    is_self: isSelf,
    is_mention: isMention,
    quote: quoteObj,
    raw_metadata: {
      thread_type: message.type,
      cli_msg_id: data.cliMsgId ?? null,
      has_quote: Boolean(data.quote),
      quoted_message_id: data.quote?.msgId ? String(data.quote.msgId) : null,
      quoted_author_id: data.quote?.ownerId ? String(data.quote.ownerId) : null,
      quote: quoteObj,
      mention_count: Array.isArray(data.mentions) ? data.mentions.length : 0,
    },
    // Ephemeral only: AccountRuntime stages approved media and removes URLs
    // before Store persists the event.
    attachment_candidates: [
      ...extractAttachmentCandidates(content),
      ...extractAttachmentCandidates(quoteContent(data.quote)),
    ].slice(0, 4),
    created_at: createdAt,
  };
}
