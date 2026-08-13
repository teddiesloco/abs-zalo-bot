import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  BotRegistryError,
  createOaAdapterMap,
  loadBotRegistry,
  redactBotRegistry,
  validateBotRegistry,
} from "../src/bot_registry.js";

function tempJson(value) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "abs-bots-"));
  const file = path.join(dir, "bots.json");
  fs.writeFileSync(file, JSON.stringify(value));
  return file;
}

const valid = {
  version: 1,
  bots: [
    {
      bot_id: "demo-oa",
      tenant_id: "demo",
      name: "Demo OA",
      adapter: "zalo_oa",
      enabled: true,
      credential: {
        app_id_env: "ZALO_OA_APP_ID_DEMO_OA",
        app_secret_env: "ZALO_OA_APP_SECRET_DEMO_OA",
        refresh_token_env: "ZALO_OA_REFRESH_TOKEN_DEMO_OA",
      },
      policy: { mode: "draft_first", allow_user_ids: [] },
    },
  ],
};

test("bot registry validates a public-safe OA bot and normalizes defaults", () => {
  const registry = validateBotRegistry(valid);
  assert.equal(registry.version, 1);
  assert.equal(registry.bots[0].adapter, "zalo_oa");
  assert.equal(registry.bots[0].policy.mode, "draft_first");
  assert.deepEqual(registry.bots[0].policy.allow_user_ids, []);
});

test("bot registry accepts inbound auto-reply only as an explicit OA policy", () => {
  const configured = structuredClone(valid);
  configured.bots[0].policy.mode = "inbound_auto_reply";
  assert.equal(validateBotRegistry(configured).bots[0].policy.mode, "inbound_auto_reply");
});

test("bot registry rejects duplicate IDs, invalid IDs, and unknown adapters", () => {
  assert.throws(
    () => validateBotRegistry({ version: 1, bots: [{ ...valid.bots[0] }, { ...valid.bots[0] }] }),
    (error) => error instanceof BotRegistryError && error.code === "duplicate_bot_id",
  );
  assert.throws(
    () => validateBotRegistry({ version: 1, bots: [{ ...valid.bots[0], bot_id: "../local" }] }),
    (error) => error instanceof BotRegistryError && error.code === "invalid_bot_id",
  );
  assert.throws(
    () => validateBotRegistry({ version: 1, bots: [{ ...valid.bots[0], adapter: "unknown" }] }),
    (error) => error instanceof BotRegistryError && error.code === "invalid_adapter",
  );
});

test("bot registry rejects OA credential references that are not env variable names", () => {
  assert.throws(
    () => validateBotRegistry({
      version: 1,
      bots: [{
        ...valid.bots[0],
        credential: { app_id_env: "actual-secret-value", app_secret_env: "OK", refresh_token_env: "OK" },
      }],
    }),
    (error) => error instanceof BotRegistryError && error.code === "invalid_credential_ref",
  );
});

test("loadBotRegistry returns an empty fail-closed registry when file is absent", () => {
  const registry = loadBotRegistry("/tmp/abs-no-such-bots-file.json");
  assert.deepEqual(registry, { version: 1, bots: [] });
});

test("OA adapter map resolves credentials from env without putting values in status", () => {
  const adapters = createOaAdapterMap({
    registry: validateBotRegistry(valid),
    env: {
      ZALO_OA_APP_ID_DEMO_OA: "app-fixture",
      ZALO_OA_APP_SECRET_DEMO_OA: "secret-fixture",
      ZALO_OA_REFRESH_TOKEN_DEMO_OA: "refresh-fixture",
    },
    fetchImpl: async () => ({ ok: true, status: 200, async json() { return { access_token: "access", expires_in: 3600 }; } }),
  });
  assert.equal(adapters.size, 1);
  const status = adapters.get("demo-oa").status();
  assert.equal(status.bot_id, "demo-oa");
  assert.equal(JSON.stringify(status).includes("secret-fixture"), false);
});

test("redacted registry keeps env names but never resolves or prints credentials", () => {
  const registry = validateBotRegistry(valid);
  const redacted = redactBotRegistry(registry);
  assert.equal(redacted.bots[0].credential.app_id_env, "ZALO_OA_APP_ID_DEMO_OA");
  assert.equal(redacted.bots[0].credential.app_id, undefined);
  assert.equal(JSON.stringify(redacted).includes("refresh-fixture"), false);
});

test("loadBotRegistry parses a valid JSON file", () => {
  const registry = loadBotRegistry(tempJson(valid));
  assert.equal(registry.bots[0].bot_id, "demo-oa");
});

void assert;
void fs;
void os;
void path;
void tempJson;
