import crypto from "node:crypto";

export const DEFAULT_OA_TOKEN_URL = "https://oauth.zaloapp.com/v4/oa/access_token";
export const DEFAULT_OA_MESSAGE_URL = "https://openapi.zalo.me/v3.0/oa/message/cs";
const TOKEN_SKEW_MS = 60_000;
const MAX_TEXT_LENGTH = 3_500;

function stableHash(parts) {
  return crypto
    .createHash("sha256")
    .update(parts.filter((part) => part !== undefined && part !== null).map(String).join("|"), "utf8")
    .digest("hex");
}

function asNonEmptyString(value) {
  const text = String(value ?? "").trim();
  return text || "";
}

function retryableStatus(status) {
  return status === 408 || status === 425 || status === 429 || status >= 500;
}

function safeStatus(response) {
  return Number.isFinite(Number(response?.status)) ? Number(response.status) : 0;
}

async function readJson(response) {
  try {
    return await response.json();
  } catch {
    try {
      const text = await response.text();
      return text ? JSON.parse(text) : {};
    } catch {
      return {};
    }
  }
}

export class OaProviderError extends Error {
  constructor(code, status = 0, retryable = false) {
    super(code);
    // Keep operational metadata non-enumerable so an accidental JSON response
    // cannot expose provider payloads or credentials.
    Object.defineProperties(this, {
      name: { value: "OaProviderError", enumerable: false, configurable: true },
      code: { value: code, enumerable: false },
      status: { value: status, enumerable: false },
      retryable: { value: Boolean(retryable), enumerable: false },
    });
  }
}

export class OaAdapter {
  constructor({
    botId,
    tenantId,
    appId,
    appSecret,
    refreshToken,
    tokenUrl = DEFAULT_OA_TOKEN_URL,
    messageUrl = DEFAULT_OA_MESSAGE_URL,
    fetchImpl = globalThis.fetch,
    now = () => Date.now(),
    tokenSkewMs = TOKEN_SKEW_MS,
  } = {}) {
    this.botId = asNonEmptyString(botId);
    this.tenantId = asNonEmptyString(tenantId);
    this.appId = asNonEmptyString(appId);
    this.appSecret = asNonEmptyString(appSecret);
    this.refreshToken = asNonEmptyString(refreshToken);
    this.tokenUrl = asNonEmptyString(tokenUrl) || DEFAULT_OA_TOKEN_URL;
    this.messageUrl = asNonEmptyString(messageUrl) || DEFAULT_OA_MESSAGE_URL;
    this.fetchImpl = fetchImpl;
    this.now = now;
    this.tokenSkewMs = Math.max(0, Number(tokenSkewMs) || TOKEN_SKEW_MS);
    this.cachedToken = null;
    this.rotatedRefreshToken = null;
    this.state = "disconnected";
    this.lastErrorCode = "";
  }

  endpoints() {
    return { token_url: this.tokenUrl, message_url: this.messageUrl };
  }

  status() {
    const result = {
      bot_id: this.botId,
      tenant_id: this.tenantId,
      adapter: "zalo_oa",
      state: this.state,
      ready: Boolean(this.cachedToken && this.cachedToken.expiresAt > this.now()),
    };
    if (this.lastErrorCode) result.last_error = this.lastErrorCode;
    return result;
  }

  getRotatedRefreshToken() {
    return this.rotatedRefreshToken;
  }

  _validateCredentials() {
    if (!this.botId || !this.tenantId || !this.appId || !this.appSecret || !this.refreshToken) {
      throw new OaProviderError("credential_missing", 0, false);
    }
    if (typeof this.fetchImpl !== "function") {
      throw new OaProviderError("config_invalid", 0, false);
    }
  }

  _cachedTokenIsFresh() {
    return Boolean(
      this.cachedToken &&
        Number.isFinite(this.cachedToken.expiresAt) &&
        this.cachedToken.expiresAt - this.now() > this.tokenSkewMs,
    );
  }

  async getAccessToken() {
    if (this._cachedTokenIsFresh()) return this.cachedToken.accessToken;
    this._validateCredentials();

    const form = new URLSearchParams({
      app_id: this.appId,
      grant_type: "refresh_token",
      refresh_token: this.refreshToken,
      secret_key: this.appSecret,
    });

    let response;
    try {
      response = await this.fetchImpl(this.tokenUrl, {
        method: "POST",
        headers: {
          accept: "application/json",
          "content-type": "application/x-www-form-urlencoded",
        },
        body: form.toString(),
      });
    } catch {
      this.state = "error";
      this.lastErrorCode = "token_refresh_failed";
      throw new OaProviderError("token_refresh_failed", 0, true);
    }

    const status = safeStatus(response);
    const body = await readJson(response);
    const accessToken = asNonEmptyString(body?.access_token);
    const expiresIn = Number(body?.expires_in);
    if (!response?.ok || !accessToken || !Number.isFinite(expiresIn) || expiresIn <= 0) {
      this.state = "error";
      this.lastErrorCode = "token_refresh_failed";
      throw new OaProviderError("token_refresh_failed", status, retryableStatus(status));
    }

    this.cachedToken = {
      accessToken,
      expiresAt: this.now() + expiresIn * 1_000,
    };
    const rotated = asNonEmptyString(body?.refresh_token);
    if (rotated) this.rotatedRefreshToken = rotated;
    this.state = "connected";
    this.lastErrorCode = "";
    return accessToken;
  }

  async sendText({ recipient_id: recipientId, text, correlation_id: correlationId = "" } = {}) {
    const recipient = asNonEmptyString(recipientId);
    const message = String(text ?? "");
    if (!recipient) throw new Error("recipient_required");
    if (!message.trim()) throw new Error("text_required");
    if (message.length > MAX_TEXT_LENGTH) throw new Error("text_too_long");

    const accessToken = await this.getAccessToken();
    let response;
    try {
      response = await this.fetchImpl(this.messageUrl, {
        method: "POST",
        headers: {
          accept: "application/json",
          "content-type": "application/json",
          access_token: accessToken,
        },
        body: JSON.stringify({
          recipient: { user_id: recipient },
          message: { text: message },
        }),
      });
    } catch {
      this.state = "error";
      this.lastErrorCode = "provider_error";
      throw new OaProviderError("provider_error", 0, true);
    }

    const status = safeStatus(response);
    const body = await readJson(response);
    if (!response?.ok) {
      this.state = "error";
      this.lastErrorCode = "provider_error";
      throw new OaProviderError("provider_error", status, retryableStatus(status));
    }

    this.state = "connected";
    this.lastErrorCode = "";
    return {
      ok: true,
      adapter: "zalo_oa",
      bot_id: this.botId,
      tenant_id: this.tenantId,
      recipient_id: recipient,
      provider_message_id: asNonEmptyString(
        body?.message_id ?? body?.data?.message_id ?? body?.message?.message_id,
      ) || null,
      correlation_id: asNonEmptyString(correlationId) || null,
    };
  }
}

function parseTimestamp(value) {
  const numeric = Number(value);
  if (Number.isFinite(numeric) && numeric > 0) {
    const milliseconds = numeric < 10_000_000_000 ? numeric * 1_000 : numeric;
    return new Date(milliseconds).toISOString();
  }
  const parsed = Date.parse(String(value ?? ""));
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : new Date(0).toISOString();
}

/**
 * Normalize only text events. This function is deliberately pure: it never
 * calls an AI provider or sends a reply.
 */
export function normalizeOaWebhookEvent({ botId, tenantId, payload } = {}) {
  const configuredBotId = asNonEmptyString(botId);
  const configuredTenantId = asNonEmptyString(tenantId);
  if (!configuredBotId || !configuredTenantId || !payload || typeof payload !== "object") return null;

  const eventType = asNonEmptyString(payload.event_name ?? payload.event ?? payload.event_type);
  if (eventType !== "user_send_text") return null;

  const providerBotId = asNonEmptyString(payload.bot_id ?? payload.oa_id ?? payload.recipient?.id);
  if (providerBotId && providerBotId !== configuredBotId && payload.bot_id) return null;

  const message = payload.message && typeof payload.message === "object" ? payload.message : {};
  const sender = payload.sender && typeof payload.sender === "object" ? payload.sender : {};
  const senderId = asNonEmptyString(
    sender.id ?? sender.user_id ?? message.from_id ?? message.fromId ?? payload.from_id,
  );
  const text = String(message.text ?? message.content ?? payload.text ?? "");
  if (!senderId || !text.trim()) return null;

  const providerMessageId = asNonEmptyString(
    message.message_id ?? message.msg_id ?? payload.message_id,
  );
  const receivedAt = parseTimestamp(payload.timestamp ?? payload.time ?? message.timestamp);
  const eventId = stableHash([
    configuredBotId,
    configuredTenantId,
    eventType,
    providerMessageId,
    senderId,
    receivedAt,
    text,
  ]);

  return {
    event_id: eventId,
    bot_id: configuredBotId,
    tenant_id: configuredTenantId,
    adapter: "zalo_oa",
    event_type: eventType,
    sender_id: senderId,
    sender_name: asNonEmptyString(sender.name ?? sender.display_name ?? message.sender_name) || "",
    text,
    is_self: false,
    received_at: receivedAt,
    raw_metadata: {
      provider_message_id: providerMessageId || null,
      provider_event: eventType,
    },
  };
}
