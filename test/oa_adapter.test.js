import test from "node:test";
import assert from "node:assert/strict";

import {
  OaAdapter,
  OaProviderError,
  normalizeOaWebhookEvent,
} from "../src/oa_adapter.js";

function response(body, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    async json() {
      return body;
    },
    async text() {
      return JSON.stringify(body);
    },
  };
}

test("OA adapter refreshes once, caches access token, and exposes rotated refresh token", async () => {
  const calls = [];
  let now = 1_700_000_000_000;
  const adapter = new OaAdapter({
    botId: "demo-oa",
    tenantId: "demo",
    appId: "app-fixture",
    appSecret: "secret-fixture",
    refreshToken: "refresh-fixture",
    now: () => now,
    fetchImpl: async (url, options) => {
      calls.push({ url, options });
      return response({
        access_token: "access-fixture",
        refresh_token: "rotated-refresh-fixture",
        expires_in: 3600,
      });
    },
  });

  assert.equal(await adapter.getAccessToken(), "access-fixture");
  assert.equal(await adapter.getAccessToken(), "access-fixture");
  assert.equal(calls.length, 1);
  assert.equal(adapter.getRotatedRefreshToken(), "rotated-refresh-fixture");

  const params = new URLSearchParams(calls[0].options.body);
  assert.equal(calls[0].url, "https://oauth.zaloapp.com/v4/oa/access_token");
  assert.equal(calls[0].options.method, "POST");
  assert.equal(calls[0].options.headers["content-type"], "application/x-www-form-urlencoded");
  assert.equal(params.get("app_id"), "app-fixture");
  assert.equal(params.get("grant_type"), "refresh_token");
  assert.equal(params.get("refresh_token"), "refresh-fixture");
  assert.equal(params.get("secret_key"), "secret-fixture");

  // Refresh inside the safety window; no second provider call.
  now += 3_500_000;
  assert.equal(await adapter.getAccessToken(), "access-fixture");
  assert.equal(calls.length, 1);
});

test("OA adapter sends text with the cached access token and returns a receipt", async () => {
  const calls = [];
  const adapter = new OaAdapter({
    botId: "demo-oa",
    tenantId: "demo",
    appId: "app-fixture",
    appSecret: "secret-fixture",
    refreshToken: "refresh-fixture",
    fetchImpl: async (url, options) => {
      calls.push({ url, options });
      if (calls.length === 1) return response({ access_token: "access-fixture", expires_in: 3600 });
      return response({ message_id: "provider-message-fixture" });
    },
  });

  const receipt = await adapter.sendText({
    recipient_id: "user-fixture",
    text: "Xin chào từ ABS",
    correlation_id: "corr-fixture",
  });

  assert.deepEqual(receipt, {
    ok: true,
    adapter: "zalo_oa",
    bot_id: "demo-oa",
    tenant_id: "demo",
    recipient_id: "user-fixture",
    provider_message_id: "provider-message-fixture",
    correlation_id: "corr-fixture",
  });
  assert.equal(calls[1].url, "https://openapi.zalo.me/v3.0/oa/message/cs");
  assert.equal(calls[1].options.method, "POST");
  assert.equal(calls[1].options.headers.access_token, "access-fixture");
  assert.deepEqual(JSON.parse(calls[1].options.body), {
    recipient: { user_id: "user-fixture" },
    message: { text: "Xin chào từ ABS" },
  });
});

test("OA adapter rejects provider errors without leaking response secrets", async () => {
  const adapter = new OaAdapter({
    botId: "demo-oa",
    tenantId: "demo",
    appId: "app-fixture",
    appSecret: "secret-fixture",
    refreshToken: "refresh-fixture",
    fetchImpl: async () => response({ error: "invalid_token", refresh_token: "must-not-leak" }, 401),
  });

  await assert.rejects(
    adapter.getAccessToken(),
    (error) => {
      assert.ok(error instanceof OaProviderError);
      assert.equal(error.code, "token_refresh_failed");
      assert.equal(error.status, 401);
      assert.equal(JSON.stringify(error), "{}");
      assert.equal(String(error.message).includes("must-not-leak"), false);
      return true;
    },
  );
});

test("OA webhook normalizes text and ignores unsupported events", () => {
  const event = normalizeOaWebhookEvent({
    botId: "demo-oa",
    tenantId: "demo",
    payload: {
      event_name: "user_send_text",
      timestamp: "1700000000000",
      sender: { id: "user-fixture" },
      recipient: { id: "oa-fixture" },
      message: { text: "xin chào" },
    },
  });

  assert.equal(event.bot_id, "demo-oa");
  assert.equal(event.tenant_id, "demo");
  assert.equal(event.adapter, "zalo_oa");
  assert.equal(event.event_type, "user_send_text");
  assert.equal(event.sender_id, "user-fixture");
  assert.equal(event.text, "xin chào");
  assert.equal(event.is_self, false);
  assert.match(event.event_id, /^[a-f0-9]{64}$/);
  assert.equal(normalizeOaWebhookEvent({ botId: "demo-oa", tenantId: "demo", payload: { event_name: "follow" } }), null);
});

test("OA webhook supports the compact from_id payload and rejects cross-tenant IDs", () => {
  const event = normalizeOaWebhookEvent({
    botId: "demo-oa",
    tenantId: "demo",
    payload: {
      event_name: "user_send_text",
      message: { from_id: "user-fixture", text: "hello" },
      bot_id: "other-bot",
    },
  });
  assert.equal(event, null);
});

// Keep the test fixture visible: a valid compact payload without a conflicting provider bot id.
test("OA webhook accepts compact from_id payload", () => {
  const event = normalizeOaWebhookEvent({
    botId: "demo-oa",
    tenantId: "demo",
    payload: {
      event_name: "user_send_text",
      message: { from_id: "user-fixture", text: "hello" },
    },
  });
  assert.equal(event.sender_id, "user-fixture");
  assert.equal(event.text, "hello");
});


test("OA adapter validates outbound input before network access", async () => {
  let calls = 0;
  const adapter = new OaAdapter({
    botId: "demo-oa",
    tenantId: "demo",
    appId: "app-fixture",
    appSecret: "secret-fixture",
    refreshToken: "refresh-fixture",
    fetchImpl: async () => {
      calls += 1;
      return response({ access_token: "access-fixture", expires_in: 3600 });
    },
  });

  await assert.rejects(adapter.sendText({ recipient_id: "", text: "hello" }), /recipient_required/);
  await assert.rejects(adapter.sendText({ recipient_id: "user-fixture", text: "" }), /text_required/);
  assert.equal(calls, 0);
});


test("OA adapter status never exposes credentials", () => {
  const adapter = new OaAdapter({
    botId: "demo-oa",
    tenantId: "demo",
    appId: "app-fixture",
    appSecret: "secret-fixture",
    refreshToken: "refresh-fixture",
  });
  const status = adapter.status();
  assert.deepEqual(status, {
    bot_id: "demo-oa",
    tenant_id: "demo",
    adapter: "zalo_oa",
    state: "disconnected",
    ready: false,
  });
  assert.equal(JSON.stringify(status).includes("fixture"), false);
});


test("OA adapter refresh rejects missing credentials before network access", async () => {
  const adapter = new OaAdapter({
    botId: "demo-oa",
    tenantId: "demo",
    appId: "",
    appSecret: "secret-fixture",
    refreshToken: "refresh-fixture",
    fetchImpl: async () => {
      throw new Error("network should not run");
    },
  });
  await assert.rejects(adapter.getAccessToken(), /credential_missing/);
});


test("OA adapter exposes explicit provider configuration without mutating env", () => {
  const adapter = new OaAdapter({
    botId: "demo-oa",
    tenantId: "demo",
    appId: "app-fixture",
    appSecret: "secret-fixture",
    refreshToken: "refresh-fixture",
    tokenUrl: "https://example.invalid/token",
    messageUrl: "https://example.invalid/message",
  });
  assert.deepEqual(adapter.endpoints(), {
    token_url: "https://example.invalid/token",
    message_url: "https://example.invalid/message",
  });
});


test("OA provider error carries stable code and retryability only", () => {
  const error = new OaProviderError("provider_error", 503, true);
  assert.equal(error.code, "provider_error");
  assert.equal(error.status, 503);
  assert.equal(error.retryable, true);
  assert.equal(error.details, undefined);
});

// A second call is intentionally not made here: webhook normalization is pure and offline.
assert.equal(typeof normalizeOaWebhookEvent, "function");

void test;
void assert;
void response;
void OaAdapter;
void OaProviderError;
