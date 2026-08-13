const MAX_TEXT_LENGTH = 3_500;

function clean(value) {
  return String(value ?? "").trim();
}

export function evaluateOaOutbound({ bot, recipientId, text } = {}) {
  const mode = clean(bot?.policy?.mode || "disabled").toLowerCase();
  const recipient = clean(recipientId);
  const body = String(text ?? "");

  if (!bot || bot.enabled === false) return { allow: false, reason: "bot_disabled", mode };
  if (mode === "disabled") return { allow: false, reason: "bot_disabled", mode };
  if (mode === "paused") return { allow: false, reason: "bot_paused", mode };
  if (!recipient) return { allow: false, reason: "recipient_required", mode };
  if (!body.trim()) return { allow: false, reason: "text_required", mode };
  if (body.length > MAX_TEXT_LENGTH) return { allow: false, reason: "text_too_long", mode };
  if (mode !== "approved_send") {
    return { allow: false, reason: "outbound_requires_approval", mode };
  }

  const allowlist = Array.isArray(bot.policy?.allow_user_ids)
    ? bot.policy.allow_user_ids.map(clean).filter(Boolean)
    : [];
  if (!allowlist.length) return { allow: false, reason: "recipient_allowlist_empty", mode };
  if (!allowlist.includes(recipient)) {
    return { allow: false, reason: "recipient_not_allowlisted", mode };
  }
  return { allow: true, reason: "approved", mode };
}

export const OA_MAX_TEXT_LENGTH = MAX_TEXT_LENGTH;
