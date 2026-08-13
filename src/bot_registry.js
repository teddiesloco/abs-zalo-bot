import fs from "node:fs";
import path from "node:path";

import { OaAdapter } from "./oa_adapter.js";

const ID_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
const ENV_RE = /^[A-Z][A-Z0-9_]{0,127}$/;
const ADAPTERS = new Set(["zalo_personal_qr", "zalo_oa"]);
// `inbound_auto_reply` may be reached only by a signed, normalized OA webhook.
// It is not accepted by the generic outbound-send policy.
const POLICY_MODES = new Set(["disabled", "draft_first", "approved_send", "inbound_auto_reply", "paused"]);

export class BotRegistryError extends Error {
  constructor(code, message = code) {
    super(message);
    Object.defineProperties(this, {
      name: { value: "BotRegistryError", enumerable: false, configurable: true },
      code: { value: code, enumerable: false },
    });
  }
}

function text(value) {
  return String(value ?? "").trim();
}

function requireId(value, code) {
  const id = text(value);
  if (!ID_RE.test(id)) throw new BotRegistryError(code, `${code}: invalid identifier`);
  return id;
}

function requireEnvRef(value) {
  const name = text(value);
  if (!ENV_RE.test(name)) throw new BotRegistryError("invalid_credential_ref", "credential must reference an env variable");
  return name;
}

function normalizePolicy(policy = {}) {
  if (!policy || typeof policy !== "object" || Array.isArray(policy)) {
    throw new BotRegistryError("invalid_policy", "policy must be an object");
  }
  const mode = text(policy.mode || "draft_first").toLowerCase();
  if (!POLICY_MODES.has(mode)) throw new BotRegistryError("invalid_policy_mode", `unsupported policy mode: ${mode}`);
  const allowUserIds = Array.isArray(policy.allow_user_ids)
    ? policy.allow_user_ids.map((id) => text(id)).filter(Boolean)
    : [];
  if (allowUserIds.some((id) => id.length > 256)) {
    throw new BotRegistryError("invalid_policy", "allow_user_ids contains an oversized id");
  }
  return {
    mode,
    allow_user_ids: [...new Set(allowUserIds)],
    max_messages_per_hour: Number.isFinite(Number(policy.max_messages_per_hour))
      ? Math.max(0, Math.floor(Number(policy.max_messages_per_hour)))
      : 20,
  };
}

function normalizeBot(bot) {
  if (!bot || typeof bot !== "object" || Array.isArray(bot)) {
    throw new BotRegistryError("invalid_bot", "each bot must be an object");
  }
  const botId = requireId(bot.bot_id, "invalid_bot_id");
  const tenantId = requireId(bot.tenant_id || "default", "invalid_tenant_id");
  const adapter = text(bot.adapter).toLowerCase();
  if (!ADAPTERS.has(adapter)) throw new BotRegistryError("invalid_adapter", `unsupported adapter: ${adapter}`);

  const normalized = {
    bot_id: botId,
    tenant_id: tenantId,
    name: text(bot.name || botId).slice(0, 120),
    adapter,
    enabled: bot.enabled !== false,
    policy: normalizePolicy(bot.policy),
  };

  if (adapter === "zalo_oa") {
    const credential = bot.credential;
    if (!credential || typeof credential !== "object" || Array.isArray(credential)) {
      throw new BotRegistryError("credential_missing", `${botId}: OA credential references are required`);
    }
    normalized.credential = {
      app_id_env: requireEnvRef(credential.app_id_env),
      app_secret_env: requireEnvRef(credential.app_secret_env),
      refresh_token_env: requireEnvRef(credential.refresh_token_env),
      token_url: text(credential.token_url || ""),
      message_url: text(credential.message_url || ""),
    };
  } else {
    const accountId = text(bot.account_id || botId);
    if (!ID_RE.test(accountId)) throw new BotRegistryError("invalid_account_id", `${botId}: invalid account_id`);
    normalized.account_id = accountId;
  }
  return normalized;
}

export function validateBotRegistry(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new BotRegistryError("config_invalid", "bot registry must be an object");
  }
  const version = Number(input.version || 1);
  if (version !== 1) throw new BotRegistryError("unsupported_registry_version", `unsupported registry version: ${version}`);
  if (!Array.isArray(input.bots)) throw new BotRegistryError("invalid_bots", "bots must be an array");
  if (input.bots.length > 1000) throw new BotRegistryError("invalid_bots", "too many bots");

  const bots = input.bots.map(normalizeBot);
  const ids = new Set();
  for (const bot of bots) {
    if (ids.has(bot.bot_id)) throw new BotRegistryError("duplicate_bot_id", `duplicate bot_id: ${bot.bot_id}`);
    ids.add(bot.bot_id);
  }
  return { version: 1, bots };
}

export function loadBotRegistry(filePath = process.env.BOTS_FILE || "./config/bots.json") {
  const abs = path.resolve(filePath);
  if (!fs.existsSync(abs)) return { version: 1, bots: [] };
  let parsed;
  try {
    parsed = JSON.parse(fs.readFileSync(abs, "utf8"));
  } catch {
    throw new BotRegistryError("config_invalid", "bot registry is not valid JSON");
  }
  return validateBotRegistry(parsed);
}

function envValue(env, key) {
  return text(env?.[key]);
}

export function createOaAdapterMap({ registry, env = process.env, fetchImpl, now } = {}) {
  const normalized = validateBotRegistry(registry || { version: 1, bots: [] });
  const adapters = new Map();
  for (const bot of normalized.bots) {
    if (!bot.enabled || bot.adapter !== "zalo_oa") continue;
    adapters.set(
      bot.bot_id,
      new OaAdapter({
        botId: bot.bot_id,
        tenantId: bot.tenant_id,
        appId: envValue(env, bot.credential.app_id_env),
        appSecret: envValue(env, bot.credential.app_secret_env),
        refreshToken: envValue(env, bot.credential.refresh_token_env),
        tokenUrl: bot.credential.token_url || undefined,
        messageUrl: bot.credential.message_url || undefined,
        fetchImpl,
        now,
      }),
    );
  }
  return adapters;
}

export function redactBotRegistry(registry) {
  const normalized = validateBotRegistry(registry || { version: 1, bots: [] });
  return {
    version: normalized.version,
    bots: normalized.bots.map((bot) => ({
      ...bot,
      credential: bot.credential
        ? {
            app_id_env: bot.credential.app_id_env,
            app_secret_env: bot.credential.app_secret_env,
            refresh_token_env: bot.credential.refresh_token_env,
            ...(bot.credential.token_url ? { token_url: bot.credential.token_url } : {}),
            ...(bot.credential.message_url ? { message_url: bot.credential.message_url } : {}),
          }
        : undefined,
    })),
  };
}

export function getBot(registry, botId) {
  const normalized = validateBotRegistry(registry || { version: 1, bots: [] });
  return normalized.bots.find((bot) => bot.bot_id === text(botId)) || null;
}

export const BOT_ADAPTERS = Object.freeze([...ADAPTERS]);
export const BOT_POLICY_MODES = Object.freeze([...POLICY_MODES]);
