import crypto from "node:crypto";

import { getBot } from "./bot_registry.js";
import { normalizeOaWebhookEvent } from "./oa_adapter.js";

const DEFAULT_MAX_BODY_BYTES = 256 * 1024;

function bytesOf(rawBody) {
  if (rawBody == null) return 0;
  if (Buffer.isBuffer(rawBody)) return rawBody.byteLength;
  return Buffer.byteLength(String(rawBody), "utf8");
}

function rawBytes(rawBody, body) {
  if (rawBody != null) return Buffer.isBuffer(rawBody) ? rawBody : Buffer.from(String(rawBody), "utf8");
  return Buffer.from(JSON.stringify(body ?? {}), "utf8");
}

function signatureFrom(req) {
  return String(
    req?.headers?.["x-zalo-signature"] ??
      req?.headers?.["x-signature"] ??
      req?.headers?.["x-zalo-webhook-signature"] ??
      "",
  ).trim();
}

export function verifyWebhookSignature({ rawBody, signature, secret } = {}) {
  const configuredSecret = String(secret ?? "");
  if (!configuredSecret) return true;
  const provided = String(signature ?? "").trim().toLowerCase();
  if (!provided || !/^[a-f0-9]{64}$/.test(provided)) return false;
  const expected = crypto.createHmac("sha256", configuredSecret).update(rawBytes(rawBody)).digest("hex");
  const left = Buffer.from(provided, "hex");
  const right = Buffer.from(expected, "hex");
  return left.length === right.length && crypto.timingSafeEqual(left, right);
}

function reply(res, statusCode, payload) {
  if (typeof res?.status === "function" && typeof res?.json === "function") {
    return res.status(statusCode).json(payload);
  }
  if (res) {
    res.statusCode = statusCode;
    res.payload = payload;
  }
  return res;
}

/**
 * Express-compatible OA webhook handler. It performs ingress validation and
 * normalization only. The caller decides whether/how to enqueue a workflow.
 */
export function createOaWebhookHandler({
  registry,
  webhookSecret = process.env.ZALO_OA_WEBHOOK_SECRET || "",
  onEvent = async () => {},
  maxBodyBytes = DEFAULT_MAX_BODY_BYTES,
} = {}) {
  return async function oaWebhookHandler(req, res) {
    const botId = String(req?.params?.bot_id || "").trim();
    const bot = getBot(registry, botId);
    if (!bot) return reply(res, 404, { ok: false, error: "bot_not_found" });
    if (!bot.enabled) return reply(res, 409, { ok: false, error: "bot_disabled" });

    const rawBody = req?.rawBody ?? req?.bodyRaw ?? null;
    const bodySize = bytesOf(rawBody) || bytesOf(req?.body ? JSON.stringify(req.body) : "");
    if (bodySize > Math.max(1, Number(maxBodyBytes) || DEFAULT_MAX_BODY_BYTES)) {
      return reply(res, 413, { ok: false, error: "webhook_body_too_large" });
    }

    if (!verifyWebhookSignature({ rawBody: rawBody ?? JSON.stringify(req?.body ?? {}), signature: signatureFrom(req), secret: webhookSecret })) {
      return reply(res, 401, { ok: false, error: "webhook_signature_invalid" });
    }

    const event = normalizeOaWebhookEvent({
      botId: bot.bot_id,
      tenantId: bot.tenant_id,
      payload: req?.body,
    });
    if (!event) return reply(res, 200, { ok: true, ignored: true });

    // Acknowledge first. Queue/worker failures must not cause provider retries
    // to duplicate a message; errors are exposed through the caller's queue.
    const response = reply(res, 200, { ok: true, event_id: event.event_id });
    try {
      await Promise.resolve(onEvent(event));
    } catch {
      // Deliberately do not rewrite an already acknowledged provider response.
    }
    return response;
  };
}

export const OA_WEBHOOK_MAX_BODY_BYTES = DEFAULT_MAX_BODY_BYTES;
