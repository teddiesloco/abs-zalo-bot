// Fail-closed config loader. TOML via tiny pure parser for our flat schema.
import fs from "node:fs";
import path from "node:path";
import { normalizeMode, SOURCE_MODES } from "./schema.js";

export class ConfigError extends Error {
  constructor(message) {
    super(message);
    this.name = "ConfigError";
  }
}

function parseSimpleToml(text) {
  // Enough for our config shape. Not a general TOML engine.
  const root = {};
  let section = root;
  let arrayKey = null;
  let arrayItem = null;

  const flushArrayItem = () => {
    if (arrayKey && arrayItem) {
      if (!Array.isArray(root[arrayKey])) root[arrayKey] = [];
      root[arrayKey].push(arrayItem);
      arrayItem = null;
    }
  };

  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.replace(/#.*$/, "").trim();
    if (!line) continue;

    const tableArray = line.match(/^\[\[([a-zA-Z0-9_]+)\]\]$/);
    if (tableArray) {
      flushArrayItem();
      arrayKey = tableArray[1];
      arrayItem = {};
      section = arrayItem;
      continue;
    }

    const table = line.match(/^\[([a-zA-Z0-9_]+)\]$/);
    if (table) {
      flushArrayItem();
      arrayKey = null;
      root[table[1]] = root[table[1]] || {};
      section = root[table[1]];
      continue;
    }

    const kv = line.match(/^([a-zA-Z0-9_]+)\s*=\s*(.+)$/);
    if (!kv) continue;
    const key = kv[1];
    let value = kv[2].trim();
    if (value === "true") value = true;
    else if (value === "false") value = false;
    else if (value === "[]") value = [];
    else if (/^-?\d+$/.test(value)) value = Number(value);
    else if (value.startsWith('"') && value.endsWith('"')) value = value.slice(1, -1);
    else if (value.startsWith("[") && value.endsWith("]")) {
      const inner = value.slice(1, -1).trim();
      value = inner
        ? inner.split(",").map((s) => {
            s = s.trim();
            if (s.startsWith('"') && s.endsWith('"')) return s.slice(1, -1);
            if (/^-?\d+$/.test(s)) return Number(s);
            return s;
          })
        : [];
    }
    section[key] = value;
  }
  flushArrayItem();
  return root;
}

export function loadConfig(configPath) {
  const abs = path.resolve(configPath);
  if (!fs.existsSync(abs)) {
    throw new ConfigError(`config missing: ${abs}`);
  }
  const raw = fs.readFileSync(abs, "utf8");
  const data = parseSimpleToml(raw);

  const defaultAccountId = String(data.default_account_id || "default");
  const retentionDays = Number(data.retention_days ?? 30);
  if (!Number.isFinite(retentionDays) || retentionDays < 1 || retentionDays > 3650) {
    throw new ConfigError("retention_days must be 1..3650");
  }

  const sources = Array.isArray(data.sources) ? data.sources : [];
  const normalizedSources = sources
    .filter((s) => s && (s.source_id || s.source_id === 0))
    .map((s) => {
      const mode = normalizeMode(s.mode);
      if (!SOURCE_MODES.includes(mode)) throw new ConfigError(`invalid mode: ${s.mode}`);
      return {
        account_id: String(s.account_id || defaultAccountId),
        source_type: String(s.source_type || "group"),
        source_id: String(s.source_id),
        source_name: String(s.source_name || ""),
        mode,
      };
    });

  const destination = {
    account_id: String(data.destination?.account_id || defaultAccountId),
    group_id: String(data.destination?.group_id || ""),
    group_name: String(data.destination?.group_name || ""),
  };

  const rateLimit = {
    messages_per_hour: Number(data.rate_limit?.messages_per_hour ?? 20),
    messages_per_day: Number(data.rate_limit?.messages_per_day ?? 120),
    ingest_per_hour: Number(data.rate_limit?.ingest_per_hour ?? 2000),
    destination_per_hour: Number(data.rate_limit?.destination_per_hour ?? 30),
    alert_cooldown_minutes: Number(data.rate_limit?.alert_cooldown_minutes ?? 30),
  };

  const roles = {
    owner: Array.isArray(data.roles?.owner) ? data.roles.owner.map(String) : [],
    admin: Array.isArray(data.roles?.admin) ? data.roles.admin.map(String) : [],
    operator: Array.isArray(data.roles?.operator) ? data.roles.operator.map(String) : [],
    viewer: Array.isArray(data.roles?.viewer) ? data.roles.viewer.map(String) : [],
  };

  const hermes = {
    webhook_url: String(data.hermes?.webhook_url || process.env.HERMES_WEBHOOK_URL || ""),
    api_base: String(
      data.hermes?.api_base || process.env.HERMES_API_BASE || "http://127.0.0.1:8642/v1",
    ),
    // Prefer env — never commit API key into git config.
    api_key: String(
      process.env.HERMES_API_SERVER_KEY ||
        process.env.API_SERVER_KEY ||
        data.hermes?.api_key ||
        "",
    ),
    model: String(data.hermes?.model || process.env.HERMES_API_MODEL || "hermes-agent"),
    timeout_ms: Number(data.hermes?.timeout_ms ?? 45000),
    auto_analyze: Boolean(data.hermes?.auto_analyze ?? false),
  };

  return {
    path: abs,
    default_account_id: defaultAccountId,
    retention_days: retentionDays,
    listen_self: Boolean(data.listen_self ?? false),
    listen_all_groups: Boolean(
      data.listen_all_groups ?? process.env.LISTEN_ALL_GROUPS === "true",
    ),
    listen_dms: Boolean(data.listen_dms ?? false),
    // Hard listener-only default. Outbound is not unlocked by an inbound
    // message, mention, destination selection, or MCP request.
    listener_only: data.listener_only !== false,
    auto_alert: Boolean(data.auto_alert ?? false),
    auto_reply_default: false, // hard safety
    read_only_source: data.read_only_source === false ? false : true,
    mention_reply: false,
    quote_reply: false,
    dm_reply: false,
    phone_label: String(data.phone_label || process.env.ZALO_PHONE_LABEL || ""),
    dashboard_bind: String(data.dashboard_bind || process.env.HOST || "127.0.0.1"),
    dashboard_port: Number(process.env.PORT || data.dashboard_port || 3871),
    sources: normalizedSources,
    destination,
    rate_limit: rateLimit,
    roles,
    hermes,
  };
}

export function sourcePolicy(config, accountId, sourceId) {
  const hit = config.sources.find(
    (s) => s.account_id === String(accountId) && s.source_id === String(sourceId),
  );
  return hit || null;
}

export function canIngest(config, event) {
  if (!event?.account_id || !event?.source_id) return { ok: false, reason: "missing_ids" };
  if (event.is_self && !config.listen_self) return { ok: false, reason: "self_echo" };

  // Loop prevention: never re-ingest bot posts from destination group.
  if (
    config.destination.group_id &&
    event.source_id === config.destination.group_id &&
    event.is_self
  ) {
    return { ok: false, reason: "destination_loop" };
  }

  const policy = sourcePolicy(config, event.account_id, event.source_id);
  if (!policy) return { ok: false, reason: "not_allowlisted" };
  if (policy.mode === "off") return { ok: false, reason: "mode_off" };
  return { ok: true, policy };
}

export function canAutoReply(config, event, policy) {
  if (!policy) return false;
  if (policy.mode === "reply_enabled") return true;
  if (policy.mode === "mention_only" && event.is_mention) return true;
  return false;
}

export function shouldDigest(policy) {
  return policy && ["digest_only", "alert_only", "listen_only", "mention_only", "reply_enabled"].includes(policy.mode)
    ? policy.mode !== "listen_only" || false
    : false;
}

// digest_only/alert_only/mention_only/reply_enabled contribute to digest; listen_only stores only.
export function includeInDigest(policy) {
  if (!policy) return false;
  return ["digest_only", "alert_only", "mention_only", "reply_enabled"].includes(policy.mode);
}

export function includeInAlert(policy, priority) {
  if (!policy) return false;
  if (policy.mode === "alert_only" || policy.mode === "reply_enabled" || policy.mode === "mention_only") {
    return Number(priority || 0) >= 7;
  }
  return false;
}
