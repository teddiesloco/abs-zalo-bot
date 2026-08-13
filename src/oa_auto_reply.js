import { createOaAdapterMap, getBot } from './bot_registry.js';

function text(value) {
  return String(value ?? '').trim();
}

function readAnswer(payload) {
  return text(payload?.answer).slice(0, 3_500);
}

// This worker is reachable only from an already verified, normalized OA event.
// It never offers a public send endpoint, so a reply cannot be triggered without
// a customer message arriving at the signed webhook first.
export function createOaAutoReplyWorker({
  registry,
  adapters = createOaAdapterMap({ registry }),
  publicChatUrl = process.env.ABS_BRAIN_CHAT_URL || '',
  publicBridgeToken = process.env.ABS_BRAIN_TOKEN || '',
  fetchImpl = globalThis.fetch,
  now = () => Date.now(),
} = {}) {
  const seenEvents = new Set();
  const recentBySender = new Map();

  function allowedInbound(bot, event) {
    if (!bot || bot.enabled === false || bot.adapter !== 'zalo_oa') return { allow: false, reason: 'bot_disabled' };
    if (bot.policy?.mode !== 'inbound_auto_reply') return { allow: false, reason: 'inbound_auto_reply_disabled' };
    if (!text(event?.sender_id) || !text(event?.text)) return { allow: false, reason: 'event_invalid' };
    if (!text(publicBridgeToken)) return { allow: false, reason: 'public_bridge_token_missing' };
    const key = `${bot.bot_id}:${event.sender_id}`;
    const hour = 60 * 60_000;
    const history = (recentBySender.get(key) || []).filter((at) => now() - at < hour);
    const limit = Math.max(1, Number(bot.policy?.max_messages_per_hour) || 20);
    if (history.length >= limit) return { allow: false, reason: 'sender_rate_limited' };
    recentBySender.set(key, [...history, now()]);
    return { allow: true, key };
  }

  async function handle(event) {
    const bot = getBot(registry, event?.bot_id);
    if (seenEvents.has(event?.event_id)) return { ok: true, skipped: 'duplicate_event' };
    const decision = allowedInbound(bot, event);
    if (!decision.allow) return { ok: true, skipped: decision.reason };
    try {
      const response = await fetchImpl(publicChatUrl, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          [process.env.ABS_BRAIN_TOKEN_HEADER || 'x-abs-token']: publicBridgeToken,
          [process.env.ABS_BRAIN_ID_HEADER || 'x-abs-external-id']: `zalo-oa:${bot.bot_id}:${event.sender_id}`,
        },
        body: JSON.stringify({ message: event.text, channel: 'zalo-oa' }),
      });
      const payload = await response.json().catch(() => ({}));
      const answer = readAnswer(payload);
      if (!response.ok || !answer) return { ok: false, error: 'public_chat_unavailable' };

      const adapter = adapters.get(bot.bot_id);
      if (!adapter) return { ok: false, error: 'oa_adapter_unavailable' };
      const delivery = await adapter.sendText({
        recipient_id: event.sender_id,
        text: answer,
        correlation_id: event.event_id,
      });
      // Mark only after provider acceptance. A temporary chat/provider failure
      // must not make the customer's message permanently unanswerable.
      seenEvents.add(event.event_id);
      return { ok: true, delivered: true, delivery };
    } catch (error) {
      return { ok: false, error: 'auto_reply_failed' };
    }
  }

  return { handle };
}
