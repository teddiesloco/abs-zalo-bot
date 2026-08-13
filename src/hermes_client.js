// Hermes brain client.
// 1) Prefer local Hermes API server OpenAI-compatible chat (/v1/chat/completions)
// 2) Else optional webhook JSON contract
// 3) Else local mock / ops fallback
import { randomUUID } from "node:crypto";
import { sanitizeForHermes } from "./privacy.js";

export function buildHermesRequest({
  accountId,
  purpose,
  source,
  messages,
  constraints = {},
}) {
  const safeMessages = [];
  for (const m of messages || []) {
    const s = sanitizeForHermes(m.text || "");
    if (!s.ok) continue;
    safeMessages.push({
      message_id: m.message_id || m.event_id || "",
      sender_name: m.sender_name || m.sender_display_name || "",
      text: s.text,
      created_at: m.created_at || "",
    });
  }
  return {
    request_id: randomUUID(),
    account_id: String(accountId),
    purpose: purpose || "digest",
    source: source || {},
    messages: safeMessages,
    constraints: {
      max_output_messages: 1,
      output_destination: "destination_group",
      no_raw_sensitive_data: true,
      tone: "ngắn gọn, rõ ý, tiếng Việt",
      ...constraints,
    },
  };
}

export function validateHermesResponse(data) {
  if (!data || typeof data !== "object") {
    return { ok: false, reason: "not_object" };
  }
  const action = String(data.action || "").toLowerCase();
  if (!["send", "ignore", "manual_review"].includes(action)) {
    return { ok: false, reason: "bad_action" };
  }
  const priority = String(data.priority || "low").toLowerCase();
  if (!["low", "medium", "high"].includes(priority)) {
    return { ok: false, reason: "bad_priority" };
  }
  if (action === "send" && (!data.message || !String(data.message).trim())) {
    return { ok: false, reason: "empty_message" };
  }
  return {
    ok: true,
    value: {
      action,
      priority,
      message: data.message ? String(data.message).slice(0, 3400) : "",
      reason: String(data.reason || ""),
      tags: Array.isArray(data.tags) ? data.tags.map(String) : [],
    },
  };
}

function resolveApiConfig(config) {
  const base =
    config?.hermes?.api_base ||
    process.env.HERMES_API_BASE ||
    "http://127.0.0.1:8642/v1";
  const key =
    process.env.HERMES_API_SERVER_KEY ||
    process.env.API_SERVER_KEY ||
    config?.hermes?.api_key ||
    "";
  const model = config?.hermes?.model || process.env.HERMES_API_MODEL || "hermes-agent";
  return {
    base: String(base).replace(/\/$/, ""),
    key: String(key || ""),
    model: String(model || "hermes-agent"),
    timeout_ms: Number(config?.hermes?.timeout_ms || 45000),
  };
}

/**
 * Call Hermes as the real brain (OpenAI chat completions compatible).
 * Returns plain text for Zalo outbound after Policy Guard.
 */
export async function callHermesBrain({
  config,
  prompt,
  fetchImpl = globalThis.fetch,
  maxRetries = 2,
  system =
    "Bạn là Hermes Agent. Trả lời ngắn, tiếng Việt, đúng format tin điều hành. Không jargon kỹ thuật. Không bịa.",
}) {
  const api = resolveApiConfig(config);
  if (!api.key) {
    // No API key → caller uses local ops fallback.
    return { ok: false, reason: "hermes_api_key_missing" };
  }
  if (!fetchImpl) return { ok: false, reason: "no_fetch", manual_review: true };

  let lastErr = null;
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), api.timeout_ms);
    try {
      const res = await fetchImpl(`${api.base}/chat/completions`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${api.key}`,
        },
        body: JSON.stringify({
          model: api.model,
          messages: [
            { role: "system", content: system },
            { role: "user", content: String(prompt || "") },
          ],
          temperature: 0.2,
          max_tokens: 900,
        }),
        signal: ctrl.signal,
      });
      const text = await res.text();
      if (!res.ok) {
        lastErr = `http_${res.status}:${text.slice(0, 180)}`;
        await sleep(200 * attempt);
        continue;
      }
      let data;
      try {
        data = JSON.parse(text);
      } catch {
        lastErr = "malformed_json";
        await sleep(200 * attempt);
        continue;
      }
      const content = data?.choices?.[0]?.message?.content;
      if (!content || !String(content).trim()) {
        lastErr = "empty_content";
        await sleep(200 * attempt);
        continue;
      }
      return {
        ok: true,
        text: String(content).trim().slice(0, 3400),
        reason: "api_chat_completions",
        attempts: attempt,
      };
    } catch (err) {
      lastErr = String(err?.message || err);
      await sleep(200 * attempt);
    } finally {
      clearTimeout(t);
    }
  }
  return { ok: false, reason: lastErr || "retries_exhausted", manual_review: true };
}

export async function callHermes({
  config,
  payload,
  fetchImpl = globalThis.fetch,
  maxRetries = 3,
}) {
  // Prefer real Hermes brain for ops_report / destination asks.
  if (payload?.purpose === "ops_report" || payload?.purpose === "destination_ask") {
    const joined = (payload.messages || [])
      .map((m) => m.text)
      .filter(Boolean)
      .join("\n");
    const brain = await callHermesBrain({
      config,
      prompt: joined,
      fetchImpl,
      maxRetries,
    });
    if (brain.ok) {
      return {
        ok: true,
        response: {
          action: "send",
          priority: "medium",
          message: brain.text,
          reason: brain.reason,
          tags: ["brain"],
        },
        attempts: brain.attempts,
      };
    }
    // fall through to webhook/mock
  }

  const url = config.hermes?.webhook_url || process.env.HERMES_WEBHOOK_URL || "";
  if (!url) {
    return mockHermes(payload);
  }
  if (!fetchImpl) return { ok: false, reason: "no_fetch", manual_review: true };

  const headers = { "content-type": "application/json" };
  if (process.env.HERMES_WEBHOOK_TOKEN) {
    headers.authorization = `Bearer ${process.env.HERMES_WEBHOOK_TOKEN}`;
  }

  let lastErr = null;
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), config.hermes?.timeout_ms || 15000);
    try {
      const res = await fetchImpl(url, {
        method: "POST",
        headers,
        body: JSON.stringify(payload),
        signal: ctrl.signal,
      });
      const text = await res.text();
      let data;
      try {
        data = JSON.parse(text);
      } catch {
        lastErr = "malformed_json";
        await sleep(200 * attempt);
        continue;
      }
      const validated = validateHermesResponse(data);
      if (!validated.ok) {
        lastErr = validated.reason;
        await sleep(200 * attempt);
        continue;
      }
      return { ok: true, response: validated.value, attempts: attempt };
    } catch (err) {
      lastErr = String(err?.message || err);
      await sleep(200 * attempt);
    } finally {
      clearTimeout(t);
    }
  }
  return { ok: false, reason: lastErr || "retries_exhausted", manual_review: true };
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

export function mockHermes(payload) {
  const texts = (payload.messages || []).map((m) => m.text).filter(Boolean);
  if (!texts.length) {
    return {
      ok: true,
      response: {
        action: "ignore",
        priority: "low",
        message: "",
        reason: "no_messages",
        tags: [],
      },
      mock: true,
    };
  }

  if (payload.purpose === "alert") {
    const joined = texts.join(" · ").slice(0, 400);
    const high =
      /gấp|khẩn|scam|lừa|lead|chốt|book|hủy|sập|ban|phốt|khủng hoảng/i.test(joined);
    return {
      ok: true,
      response: {
        action: "send",
        priority: high ? "high" : "medium",
        message: [
          "Cảnh báo — destination đã cấu hình",
          "",
          "Trạng thái: có tín hiệu cần xem sớm.",
          `Nội dung: ${joined}`,
          "Việc tiếp theo: kiểm tra nhóm nguồn và xử lý nếu cần.",
        ].join("\n"),
        reason: "mock_alert",
        tags: high ? ["high", "mock"] : ["mock"],
      },
      mock: true,
    };
  }

  // Digest/ask without API key: local ops_report owns final text.
  return {
    ok: true,
    response: {
      action: "ignore",
      priority: "low",
      message: "",
      reason: "use_local_ops_report",
      tags: ["mock"],
    },
    mock: true,
  };
}
