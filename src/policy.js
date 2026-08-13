// Policy Guard — hard READ_ONLY_SOURCE for shared personal Zalo.
// Phase 1 inbound brain: destination + owner + "bot ..." prefix only.
import { SOURCE_MODES, sha256 } from "./schema.js";
import { containsSecretPattern } from "./privacy.js";
import { isBotCommand } from "./inbound_router.js";

const ROLE_ORDER = ["viewer", "operator", "admin", "owner"];

const COMMAND_MIN_ROLE = {
  status: "viewer",
  help: "viewer",
  whoami: "viewer",
  digest: "operator",
  pause: "admin",
  resume: "admin",
  set: "admin",
  allow: "admin",
  mode: "admin",
  mute: "admin",
  add: "owner",
  remove: "owner",
};

// Bot/report fingerprints — never re-ingest as asks.
const BOT_REPORT_HINT =
  /^(Tổng hợp (?:hôm nay|vận hành)\s*[—\-–]|Cảnh báo —|Zalo Intelligence Digest|Zalo Bridge digest|Phản hồi on-demand|Tóm tắt \(|DRAFT —|account=|status=|paused=|global_kill=|Trạng thái:)/i

export class PolicyGuard {
  constructor({ config, store }) {
    this.config = config;
    this.store = store;
    this.ingestPerHour = Number(config.rate_limit?.ingest_per_hour || 2000);
    this.alertCooldownMinutes = Number(config.rate_limit?.alert_cooldown_minutes || 30);
    this.destPerHour = Number(config.rate_limit?.destination_per_hour || 30);
  }

  get readOnlySource() {
    if (this.config.read_only_source === false) return false;
    return true;
  }

  roleOf(accountId, userId) {
    return this.store.roleOf(accountId, userId) || null;
  }

  requireRole(accountId, userId, minRole) {
    const role = this.roleOf(accountId, userId);
    if (!role) return false;
    return ROLE_ORDER.indexOf(role) >= ROLE_ORDER.indexOf(minRole);
  }

  getSourcePolicy(accountId, sourceId) {
    const row = this.store.getSource(accountId, sourceId);
    if (!row || !row.is_allowed || row.mode === "off") return null;
    return {
      account_id: row.account_id,
      source_id: row.source_id,
      source_type: row.source_type,
      source_name: row.source_name,
      mode: row.mode,
      muted: Boolean(row.muted),
    };
  }

  safetyFlags() {
    const dest = this.store.getDestination(this.config.default_account_id);
    return {
      READ_ONLY_SOURCE: this.readOnlySource,
      destination: dest,
      auto_reply_disabled: true,
      dm_reply_disabled: true,
      mention_reply_disabled: true,
      quote_reply_disabled: true,
      global_inbound_action_disabled: true,
      listener_only: this.config.listener_only !== false,
      outbound_disabled: this.config.listener_only !== false,
      bot_prefix_required: false,
      auto_alert: false,
      listen_all_groups: Boolean(this.config.listen_all_groups),
      listen_dms: Boolean(this.config.listen_dms),
      outbound_allowlist: dest.group_id
        ? [dest.group_id]
        : dest.group_name
          ? [`name:${dest.group_name}`]
          : [],
    };
  }

  evaluateInbound(event) {
    if (!event?.account_id || !event?.source_id) {
      return { allow: false, reason: "missing_ids", policy: null, actions: [] };
    }

    const dest = this.store.getDestination(event.account_id);
    const inDestination =
      Boolean(dest.group_id) && String(event.source_id) === String(dest.group_id);
    const text = String(event.text || "").trim();
    const isSlash = text.startsWith("/");
    const hasBotCmd = !isSlash && isBotCommand(text);

    // Never re-ingest bot/report messages (loop prevention), including destination.
    if (event.is_self) {
      if (BOT_REPORT_HINT.test(text)) {
        return { allow: false, reason: "self_bot_report", policy: null, actions: [] };
      }
      try {
        const sha = sha256(text);
        if (this.store.recentOutboundDuplicate(event.account_id, sha, 30)) {
          return { allow: false, reason: "self_outbound_echo", policy: null, actions: [] };
        }
      } catch {
        /* ignore */
      }
    }

    // Outside destination: absolute silence on self messages.
    if (event.is_self && !inDestination) {
      return { allow: false, reason: "self_echo", policy: null, actions: [] };
    }

    // DM: store optional only if explicitly enabled; never reply / never brain.
    if (event.source_type === "dm") {
      if (!this.config.listen_dms) {
        return { allow: false, reason: "dm_disabled", policy: null, actions: [] };
      }
      return {
        allow: true,
        reason: "dm_store_only",
        policy: { mode: "listen_only", muted: true },
        actions: ["store"],
      };
    }

    // Listener-only is intentionally before every command/brain route.
    // Untrusted text — including prompt-injection-looking "bot" messages and
    // mentions — can only be stored. It cannot invoke skills, MCP, a model,
    // or an outbound action.
    if (this.config.listener_only !== false) {
      return {
        allow: true,
        reason: "listener_only_store",
        policy: { mode: "listen_only", muted: true },
        actions: ["store"],
      };
    }

    // Slash commands: ONLY valid inside destination group.
    if (isSlash) {
      if (!inDestination) {
        return { allow: false, reason: "command_outside_destination", policy: null, actions: [] };
      }
      if (event.is_self || this.roleOf(event.account_id, event.sender_id)) {
        return {
          allow: true,
          reason: "destination_command",
          policy: null,
          actions: ["command"],
        };
      }
      return { allow: false, reason: "unauthorized_silent", policy: null, actions: [] };
    }

    // Destination group: Phase 1 brain path = "bot ..." prefix only.
    if (inDestination) {
      if (!hasBotCmd) {
        return {
          allow: true,
          reason: "destination_store_only",
          policy: null,
          actions: ["store"],
        };
      }
      // Auth check deferred to router for silent unauthorized.
      return {
        allow: true,
        reason: "destination_bot_cmd",
        policy: null,
        actions: ["destination_ask"],
      };
    }

    // Source groups: READ_ONLY — store only, never reply even if tagged/quoted.
    if (this.config.listen_all_groups && event.source_type === "group") {
      const ingestCount = this.store.countInboundRecent(event.account_id, 60);
      if (ingestCount >= this.ingestPerHour) {
        return { allow: false, reason: "ingest_rate", policy: null, actions: [] };
      }
      return {
        allow: true,
        reason: "read_only_source",
        policy: {
          account_id: event.account_id,
          source_id: event.source_id,
          source_type: "group",
          source_name: event.source_name || "",
          mode: "listen_only",
          muted: true,
        },
        actions: ["store"],
      };
    }

    const policy = this.getSourcePolicy(event.account_id, event.source_id);
    if (!policy) return { allow: false, reason: "not_allowlisted", policy: null, actions: [] };

    const ingestCount = this.store.countInboundRecent(event.account_id, 60);
    if (ingestCount >= this.ingestPerHour) {
      return { allow: false, reason: "ingest_rate", policy, actions: [] };
    }

    const actions = ["store"];
    if (
      !this.readOnlySource &&
      ["digest_only", "alert_only", "mention_only", "reply_enabled"].includes(policy.mode)
    ) {
      actions.push("digest_candidate");
    }
    if (!this.readOnlySource && this.config.auto_alert) {
      if (["alert_only", "mention_only", "reply_enabled"].includes(policy.mode)) {
        actions.push("alert_candidate");
      }
    }
    return { allow: true, reason: "ok_store_only", policy: { ...policy, mode: "listen_only" }, actions };
  }

  evaluateCommand({ accountId, senderId, command, sourceId = null }) {
    if (!senderId) return { allow: false, reason: "missing_sender", silent: true };
    const dest = this.store.getDestination(accountId);
    if (!dest.group_id) return { allow: false, reason: "destination_unset", silent: true };
    if (sourceId && String(sourceId) !== String(dest.group_id)) {
      return { allow: false, reason: "command_outside_destination", silent: true };
    }
    const minRole = COMMAND_MIN_ROLE[command] || "owner";
    const account = this.store.getAccount(accountId);
    const isSelfOwner =
      account?.zalo_user_id && String(account.zalo_user_id) === String(senderId);
    if (isSelfOwner) return { allow: true, reason: "self_owner", minRole };
    if (!this.requireRole(accountId, senderId, minRole)) {
      return { allow: false, reason: "unauthorized_silent", silent: true };
    }
    return { allow: true, reason: "ok", minRole };
  }

  evaluateOutbound({ accountId, targetId, text, kind = "digest", alertKey = null }) {
    // Master hard gate. Future RBAC must replace this only together with an
    // explicit owner approval, numeric-identity checks, scoped capabilities,
    // a quota budget, and its own regression suite.
    if (this.config.listener_only !== false) return { allow: false, reason: "outbound_disabled" };
    if (this.store.isGlobalPaused()) return { allow: false, reason: "bridge_paused" };

    const account = this.store.getAccount(accountId);
    if (!account) return { allow: false, reason: "unknown_account" };
    if (account.status === "paused" || account.paused) return { allow: false, reason: "account_paused" };
    if (account.status !== "connected" && process.env.POLICY_REQUIRE_CONNECTED !== "false") {
      if (process.env.NODE_ENV !== "test" && process.env.POLICY_REQUIRE_CONNECTED !== "false") {
        return { allow: false, reason: "account_not_connected" };
      }
    }

    if (!targetId) return { allow: false, reason: "missing_target" };
    if (!text || !String(text).trim()) return { allow: false, reason: "empty_text" };

    const dest = this.store.getDestination(accountId);
    if (!dest.group_id) return { allow: false, reason: "destination_unset" };

    // HARD: only the configured destination. No source replies, no DM replies.
    if (String(targetId) !== String(dest.group_id)) {
      return { allow: false, reason: "target_not_destination" };
    }
    if (String(dest.account_id) && String(dest.account_id) !== String(accountId)) {
      return { allow: false, reason: "destination_account_mismatch" };
    }

    if (this.readOnlySource && (kind === "reply" || kind === "mention" || kind === "quote")) {
      return { allow: false, reason: "read_only_source_blocks_reply" };
    }

    if (!["digest", "alert", "ask_reply", "command_reply", "report"].includes(String(kind))) {
      if (kind !== "digest") return { allow: false, reason: "kind_blocked" };
    }

    const hourCount = this.store.countOutbound(accountId, 60);
    const dayCount = this.store.countOutbound(accountId, 60 * 24);
    const destHour = this.store.countOutbound(accountId, 60, targetId);
    if (hourCount >= (this.config.rate_limit?.messages_per_hour || 20)) {
      return { allow: false, reason: "rate_hour" };
    }
    if (dayCount >= (this.config.rate_limit?.messages_per_day || 120)) {
      return { allow: false, reason: "rate_day" };
    }
    if (destHour >= this.destPerHour) return { allow: false, reason: "rate_destination_hour" };

    const body = String(text);
    if (body.length > 3500) return { allow: false, reason: "too_long" };
    if (containsSecretPattern(body)) return { allow: false, reason: "secret_leak_pattern" };

    if (kind === "alert" && alertKey) {
      const cd = this.store.getCooldown(accountId, alertKey);
      if (cd?.last_sent_at) {
        const ageMin = (Date.now() - Date.parse(cd.last_sent_at)) / 60000;
        if (ageMin < this.alertCooldownMinutes) {
          return { allow: false, reason: "alert_cooldown" };
        }
      }
    }

    const textSha = sha256(body);
    if (this.store.recentOutboundDuplicate(accountId, textSha, 120)) {
      return { allow: false, reason: "duplicate_recent" };
    }

    return { allow: true, reason: "ok", textSha };
  }
}

export function isValidMode(mode) {
  return SOURCE_MODES.includes(String(mode || ""));
}

export { COMMAND_MIN_ROLE, ROLE_ORDER, BOT_REPORT_HINT };
