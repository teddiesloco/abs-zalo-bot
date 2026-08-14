import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { createApp } from "../src/server.js";
import { loadConfig } from "../src/config.js";
import { Store } from "../src/store.js";
import { PolicyGuard } from "../src/policy.js";
import { BridgeHub } from "../src/zalo_runtime.js";
import { publicBrandMetadata } from "../src/brand.js";

function tempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "abs-zalo-brand-qr-"));
}

async function listen(app) {
  const server = await new Promise((resolve) => {
    const instance = app.listen(0, "127.0.0.1", () => resolve(instance));
  });
  const address = server.address();
  return { server, base: `http://127.0.0.1:${address.port}` };
}

function fixtureContext() {
  const dir = tempDir();
  const configPath = path.join(dir, "config.toml");
  fs.writeFileSync(configPath, 'default_account_id="default"\nretention_days=30\n');
  const config = loadConfig(configPath);
  const store = new Store(dir);
  store.seedFromConfig(config);
  const policy = new PolicyGuard({ config, store });
  const qrImage = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";
  const clientFactory = {
    async loginWithQr({ onQr }) {
      onQr({ image: qrImage, code: "qr-fixture" });
      // A real QR login remains pending until the human scans the code.
      return new Promise(() => {});
    },
  };
  const hub = new BridgeHub({ config, store, policy, clientFactory });
  return { dir, config, store, policy, hub, qrImage };
}

test("service metadata is exposed without runtime data", async () => {
  const ctx = fixtureContext();
  const previousToken = process.env.DASHBOARD_TOKEN;
  delete process.env.DASHBOARD_TOKEN;
  const app = createApp(ctx);
  const { server, base } = await listen(app);

  try {
    const expected = publicBrandMetadata();
    for (const route of ["/healthz", "/api/health", "/api/status", "/api/battle-ready", "/api/brand"]) {
      const response = await fetch(`${base}${route}`);
      const payload = await response.json();
      assert.equal(response.status, 200, route);
      assert.deepEqual(payload.brand, expected, route);
      assert.equal(Object.hasOwn(payload.brand, "name"), true, route);
      assert.equal(Object.hasOwn(payload.brand, "version"), true, route);
      assert.equal(Object.hasOwn(payload.brand, "cookie"), false, route);
      assert.equal(Object.hasOwn(payload.brand, "session"), false, route);
    }
  } finally {
    await new Promise((resolve) => server.close(resolve));
    ctx.store.close();
    if (previousToken === undefined) delete process.env.DASHBOARD_TOKEN;
    else process.env.DASHBOARD_TOKEN = previousToken;
  }
});

test("QR connect endpoint returns generated QR while human scan is pending", async () => {
  const ctx = fixtureContext();
  const previousToken = process.env.DASHBOARD_TOKEN;
  delete process.env.DASHBOARD_TOKEN;
  const app = createApp(ctx);
  const { server, base } = await listen(app);

  try {
    const connect = await fetch(`${base}/api/accounts/default/connect`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ force_qr: true }),
    });
    const connected = await connect.json();
    assert.equal(connect.status, 200);
    assert.equal(connected.ok, true);
    assert.equal(connected.connecting, true);
    assert.equal(connected.status.status, "need_scan");
    assert.equal(connected.status.qr_available, true);
    assert.equal(connected.qr.code, "qr-fixture");
    assert.equal(connected.qr.image, ctx.qrImage);
    assert.equal(Object.hasOwn(connected.qr, "file"), false);
    const qrFile = path.join(ctx.dir, "qr", "default_login_qr.png");
    assert.equal(fs.existsSync(qrFile), true);
    assert.equal(fs.statSync(qrFile).mode & 0o777, 0o600);

    const qr = await fetch(`${base}/api/accounts/default/qr`);
    const qrPayload = await qr.json();
    assert.equal(qr.status, 200);
    assert.equal(qrPayload.ok, true);
    assert.equal(qrPayload.qr.image, ctx.qrImage);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    ctx.store.close();
    if (previousToken === undefined) delete process.env.DASHBOARD_TOKEN;
    else process.env.DASHBOARD_TOKEN = previousToken;
  }
});
