/**
 * Đổi "@Tên hiển thị" trong tin bot gửi vào nhóm thành tag Zalo thật.
 *
 * Tên phải khớp một người trong danh bạ nhóm và không có dấu hiệu còn tiếp;
 * hai người trùng tên thì để nguyên dạng chữ để tránh tag nhầm người.
 */

const NAME_CHAR = /[\p{L}\p{N}_]/u;
const NAME_CONTINUES = /^ \p{Lu}/u;
const MENTION_ALL = /^all(?![\p{L}\p{N}_])/iu;
export const MENTION_ALL_UID = "-1";

function normalize(text) {
  return String(text || "").toLocaleLowerCase("vi");
}

/**
 * @param {string} msg Chữ đã qua bộ dịch Markdown (vị trí tính trên chuỗi này).
 * @param {{uid: string, name: string}[]} members
 * @param {{selfUid?: string, continuesInNextChunk?: boolean, canMentionAll?: boolean}} options
 * @returns {{pos: number, len: number, uid: string}[]}
 */
export function findMentions(msg, members, { selfUid = "", continuesInNextChunk = false, canMentionAll = true } = {}) {
  const text = String(msg ?? "");
  const people = Array.isArray(members) ? members : [];
  if (!text.includes("@") || (!people.length && !canMentionAll)) return [];

  const uidsByName = new Map();
  for (const member of people) {
    const uid = String(member?.uid ?? member?.userId ?? member?.id ?? "");
    const name = String(member?.name ?? member?.displayName ?? member?.dName ?? "").trim();
    if (!uid || !name || uid === String(selfUid)) continue;
    const key = normalize(name);
    const entry = uidsByName.get(key) ?? { length: name.length, uids: new Set() };
    entry.uids.add(uid);
    uidsByName.set(key, entry);
  }

  // Khớp tên dài trước: "@Lương Hải Anh Cnt" không bị khớp nhầm thành "@Lương"
  const names = [...uidsByName.entries()].sort((a, b) => b[1].length - a[1].length);

  const mentions = [];
  for (let at = text.indexOf("@"); at !== -1; at = text.indexOf("@", at + 1)) {
    if (at > 0 && NAME_CHAR.test(text[at - 1])) continue; // a@b trong email
    if (canMentionAll && MENTION_ALL.test(text.slice(at + 1))) {
      mentions.push({ pos: at, len: "@All".length, uid: MENTION_ALL_UID });
      at += "All".length;
      continue;
    }
    const match = names.find(([key, { length }]) => {
      const after = text.slice(at + 1 + length);
      return (
        normalize(text.slice(at + 1, at + 1 + length)) === key &&
        !NAME_CHAR.test(after[0] ?? "") &&
        !NAME_CONTINUES.test(after) &&
        !(continuesInNextChunk && after.trim() === "")
      );
    });
    if (!match) continue;
    const [, { length, uids }] = match;
    if (uids.size !== 1) continue;
    mentions.push({ pos: at, len: length + 1, uid: [...uids][0] });
    at += length;
  }
  return mentions;
}

/**
 * Danh bạ thành viên từng nhóm, cache tạm để tối ưu tốc độ gửi tin.
 */
export function createMemberDirectory({ fetchMembers, ttlMs = 10 * 60 * 1000, now = Date.now } = {}) {
  const cache = new Map();
  return {
    async get(groupId) {
      const key = String(groupId);
      const hit = cache.get(key);
      if (hit && now() - hit.at < ttlMs) return hit.members;
      try {
        const res = typeof fetchMembers === "function" ? await fetchMembers(key) : [];
        const members = Array.isArray(res) ? res : Array.isArray(res?.members) ? res.members : [];
        cache.set(key, { at: now(), members });
        return members;
      } catch (err) {
        return hit?.members ?? [];
      }
    },
    clear() {
      cache.clear();
    },
  };
}

function escapeRegExp(str) {
  return String(str || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function extractBotNames(displayName = "") {
  const raw = String(displayName || "").trim();
  if (!raw) return [];
  const names = new Set([raw.toLowerCase()]);
  const parts = raw.split(/\s+/).filter(Boolean);
  if (parts.length > 1) {
    for (const part of parts) {
      const lower = part.toLowerCase();
      if (lower.length >= 2) names.add(lower);
    }
    if (parts.length >= 3) {
      const lastTwo = parts.slice(-2).join(" ").toLowerCase();
      names.add(lastTwo);
    }
  }
  return [...names].sort((a, b) => b.length - a.length);
}

const CALL_ONLY_WORDS = new Set([
  "ơi", "oi", "à", "a", "ạ", "đâu", "dau", "đâu rồi", "dau roi",
  "đây", "day", "alo", "hey", "hi", "hello", "nhé", "nhe", "nha",
  "với", "voi", "giúp", "giup", "xem", "nghe", "đó", "do",
  "rồi", "roi", "kìa", "kia", "này", "nay",
]);

/**
 * Kiểm tra xem tin nhắn có nhắc tới Bot không:
 * 1. Zalo frame mentions (nếu có UID của bot).
 * 2. Gõ tay @bot, @TênHiểnThị, @TênNgắn.
 * 3. Nếu là Chủ nhân (isOwner === true): Cho phép gọi thẳng không cần @ (vd: "Amon ơi", "Lavie đâu rồi", "chào Amon").
 */
export function isBotMentioned(
  text,
  { displayName = "", selfUid = "", isOwner = false, frameMentions = [] } = {}
) {
  const raw = String(text || "").trim();
  if (!raw) return false;

  // 1. Zalo native frame mentions
  if (selfUid && Array.isArray(frameMentions) && frameMentions.length) {
    const hasSelf = frameMentions.some((m) => {
      const uid = String(m?.uid ?? m?.userId ?? m?.id ?? "");
      return uid === String(selfUid);
    });
    if (hasSelf) return true;
  }

  const botNames = extractBotNames(displayName);
  const escapedNames = ["bot", ...botNames.map(escapeRegExp)].join("|");

  // 2. Explicit text mentions: @bot, @Tên
  const mentionRe = new RegExp(`(^|\\s)@(?:${escapedNames})(?:\\s|[.,?!:;]|\$)`, "i");
  if (mentionRe.test(raw)) return true;

  // 3. Chủ nhân gọi trực tiếp không cần @
  if (isOwner && botNames.length > 0) {
    const namesAlt = botNames.map(escapeRegExp).join("|");
    // Bắt đầu bằng tên bot: "Amon ...", "Lavie: ..."
    const startRe = new RegExp(`^(?:${namesAlt})(?:\\s+|[.,?!:;]|\$)`, "i");
    if (startRe.test(raw)) return true;

    // Cụm gọi thông dụng: "Amon ơi", "chào Amon", "Amon đâu", "nhờ Amon"
    const callRe = new RegExp(
      `(?:(?:chào|chao|alo|hey|hi|nhờ|nho|hỏi|hoi)\\s+(?:${namesAlt})|(?:${namesAlt})\\s*(?:ơi|oi|à|a|ạ|đâu|dau))`,
      "i"
    );
    if (callRe.test(raw)) return true;
  }

  return false;
}

/**
 * Kiểm tra xem có phải là Bare Call (chỉ gọi trơ tên bot kèm từ đệm, không có nội dung)
 * để bốc lịch sử tin nhắn gần nhất trong nhóm làm context trả lời.
 */
export function isBareCall(text, displayName = "") {
  const raw = String(text || "").trim();
  if (!raw) return false;

  const botNames = extractBotNames(displayName);
  let cleaned = raw;

  // Loại bỏ @mention
  cleaned = cleaned.replace(/@\S+/g, " ");

  // Loại bỏ tên bot
  for (const name of ["bot", ...botNames]) {
    const re = new RegExp(`\\b${escapeRegExp(name)}\\b`, "gi");
    cleaned = cleaned.replace(re, " ");
  }

  // Tách các từ còn lại, bỏ dấu câu
  const tokens = cleaned
    .toLowerCase()
    .replace(/[.,?!:;~^/\-_+*#()]/g, " ")
    .split(/\s+/)
    .filter(Boolean);

  if (tokens.length === 0) return true;

  // Nếu tất cả các từ còn lại đều là từ gọi đệm
  const allCallWords = tokens.every((token) => CALL_ONLY_WORDS.has(token));
  return allCallWords;
}

