import test from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { createApp } from "../src/server.js";
import { loadConfig } from "../src/config.js";
import { Store } from "../src/store.js";
import { PolicyGuard } from "../src/policy.js";
import { BridgeHub } from "../src/zalo_runtime.js";
import { validateBotRegistry } from "../src/bot_registry.js";

function tempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "zalo-oa-route-"));
}

function registry() {
  return validateBotRegistry({
    version: 1,
    bots: [
      {
        bot_id: "demo-oa",
        tenant_id: "demo",
        name: "Demo OA",
        adapter: "zalo_oa",
        enabled: true,
        credential: {
          app_id_env: "APP_ID_FIXTURE",
          app_secret_env: "APP_SECRET_FIXTURE",
          refresh_token_env: "REFRESH_TOKEN_FIXTURE",
        },
        policy: { mode: "draft_first", allow_user_ids: [] },
      },
    ],
  });
}

function signed(body, secret) {
  return crypto.createHmac("sha256", secret).update(body).digest("hex");
}

async function listen(app) {
  const server = await new Promise((resolve) => {
    const instance = app.listen(0, "127.0.0.1", () => resolve(instance));
  });
  const address = server.address();
  return { server, base: `http://127.0.0.1:${address.port}` };
}

test("Express OA route acknowledges signed ingress before dashboard auth", async () => {
  const dir = tempDir();
  const configPath = path.join(dir, "config.toml");
  fs.writeFileSync(configPath, 'default_account_id="default"\nretention_days=30\n');
  const config = loadConfig(configPath);
  const store = new Store(dir);
  store.seedFromConfig(config);
  const policy = new PolicyGuard({ config, store });
  const hub = new BridgeHub({ config, store, policy, clientFactory: {} });
  const previousToken = process.env.DASHBOARD_TOKEN;
  process.env.DASHBOARD_TOKEN = "dashboard-fixture";
  const app = createApp({
    config,
    store,
    policy,
    hub,
    oaRegistry: registry(),
    oaWebhookSecret: "webhook-secret",
  });
  const { server, base } = await listen(app);

  try {
    const body = JSON.stringify({
      event_name: "user_send_text",
      bot_id: "demo-oa",
      sender: { id: "user-fixture" },
      message: { message_id: "message-fixture", text: "hello" },
    });
    const response = await fetch(`${base}/webhooks/zalo/oa/demo-oa`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-zalo-signature": signed(body, "webhook-secret"),
      },
      body,
    });
    const payload = await response.json();
    assert.equal(response.status, 200);
    assert.equal(payload.ok, true);
    assert.match(payload.event_id, /^[a-f0-9]{64}$/);

    const rejected = await fetch(`${base}/webhooks/zalo/oa/demo-oa`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-zalo-signature": "bad" },
      body,
    });
    assert.equal(rejected.status, 401);

    const dashboard = await fetch(`${base}/api/status`);
    assert.equal(dashboard.status, 401);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    store.close();
    if (previousToken === undefined) delete process.env.DASHBOARD_TOKEN;
    else process.env.DASHBOARD_TOKEN = previousToken;
  }
});
