import test from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";

import {
  createOaWebhookHandler,
  verifyWebhookSignature,
} from "../src/oa_webhook.js";

function signed(body, secret) {
  return crypto.createHmac("sha256", secret).update(body).digest("hex");
}

function request({ botId = "demo-oa", body, rawBody = JSON.stringify(body), signature = "" } = {}) {
  return {
    params: { bot_id: botId },
    body,
    rawBody: Buffer.from(rawBody),
    headers: { "x-zalo-signature": signature },
  };
}

function response() {
  return {
    statusCode: 200,
    payload: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      this.payload = payload;
      return this;
    },
  };
}

const registry = {
  version: 1,
  bots: [
    {
      bot_id: "demo-oa",
      tenant_id: "demo",
      name: "Demo OA",
      adapter: "zalo_oa",
      enabled: true,
      policy: { mode: "draft_first", allow_user_ids: [] },
      credential: {
        app_id_env: "APP_ID",
        app_secret_env: "APP_SECRET",
        refresh_token_env: "REFRESH_TOKEN",
      },
    },
  ],
};

test("webhook signature accepts exact HMAC and rejects tampering", () => {
  const raw = Buffer.from('{"event_name":"user_send_text"}');
  const signature = signed(raw, "webhook-secret");
  assert.equal(verifyWebhookSignature({ rawBody: raw, signature, secret: "webhook-secret" }), true);
  assert.equal(verifyWebhookSignature({ rawBody: raw, signature: `${signature}00`, secret: "webhook-secret" }), false);
  assert.equal(verifyWebhookSignature({ rawBody: raw, signature: "", secret: "webhook-secret" }), false);
  assert.equal(verifyWebhookSignature({ rawBody: raw, signature: "", secret: "" }), true);
});

test("webhook handler rejects unknown bot and invalid signature without callback", async () => {
  let callbacks = 0;
  const handler = createOaWebhookHandler({
    registry,
    webhookSecret: "webhook-secret",
    onEvent: async () => { callbacks += 1; },
  });
  const body = { event_name: "user_send_text", message: { from_id: "u1", text: "hello" } };

  const unknownReq = request({ botId: "unknown", body, signature: signed(JSON.stringify(body), "webhook-secret") });
  const unknownRes = response();
  await handler(unknownReq, unknownRes);
  assert.equal(unknownRes.statusCode, 404);
  assert.deepEqual(unknownRes.payload, { ok: false, error: "bot_not_found" });

  const badReq = request({ body, signature: "bad" });
  const badRes = response();
  await handler(badReq, badRes);
  assert.equal(badRes.statusCode, 401);
  assert.deepEqual(badRes.payload, { ok: false, error: "webhook_signature_invalid" });
  assert.equal(callbacks, 0);
});

test("webhook handler acknowledges normalized text and invokes callback without AI/provider calls", async () => {
  const events = [];
  let providerCalls = 0;
  const handler = createOaWebhookHandler({
    registry,
    webhookSecret: "webhook-secret",
    onEvent: async (event) => { events.push(event); providerCalls += 1; },
  });
  const body = {
    event_name: "user_send_text",
    timestamp: "1700000000000",
    bot_id: "demo-oa",
    sender: { id: "user-fixture", name: "Fixture" },
    message: { message_id: "m1", text: "xin chào" },
  };
  const rawBody = JSON.stringify(body);
  const req = request({ body, rawBody, signature: signed(rawBody, "webhook-secret") });
  const res = response();
  await handler(req, res);
  await new Promise((resolve) => setImmediate(resolve));

  assert.equal(res.statusCode, 200);
  assert.equal(res.payload.ok, true);
  assert.match(res.payload.event_id, /^[a-f0-9]{64}$/);
  assert.equal(events.length, 1);
  assert.equal(events[0].bot_id, "demo-oa");
  assert.equal(events[0].tenant_id, "demo");
  assert.equal(events[0].text, "xin chào");
  assert.equal(providerCalls, 1); // callback only; handler itself never sends or calls an AI provider.
});

test("webhook handler ignores unsupported events with a safe acknowledgement", async () => {
  const events = [];
  const handler = createOaWebhookHandler({
    registry,
    webhookSecret: "",
    onEvent: async (event) => events.push(event),
  });
  const body = { event_name: "follow", sender: { id: "u1" } };
  const res = response();
  await handler(request({ body }), res);
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.payload, { ok: true, ignored: true });
  assert.equal(events.length, 0);
});

test("webhook handler refuses a disabled bot", async () => {
  const disabledRegistry = {
    ...registry,
    bots: [{ ...registry.bots[0], enabled: false }],
  };
  const handler = createOaWebhookHandler({ registry: disabledRegistry });
  const body = { event_name: "user_send_text", message: { from_id: "u1", text: "hello" } };
  const res = response();
  await handler(request({ body }), res);
  assert.equal(res.statusCode, 409);
  assert.deepEqual(res.payload, { ok: false, error: "bot_disabled" });
});

test("webhook handler bounds raw body size before parsing", async () => {
  const handler = createOaWebhookHandler({ registry, maxBodyBytes: 10 });
  const body = { event_name: "user_send_text", message: { from_id: "u1", text: "hello" } };
  const res = response();
  await handler(request({ body, rawBody: JSON.stringify(body) }), res);
  assert.equal(res.statusCode, 413);
  assert.deepEqual(res.payload, { ok: false, error: "webhook_body_too_large" });
});

void assert;
void crypto;
