// Versioned, profile-scoped adapter contract for external Hermes platform plugins.
// It deliberately exposes no QR/session/raw provider state.
import { sha256 } from "./schema.js";
import { resolveStagedMedia } from "./hermes_media.js";
import { profileSummary, resolveAgentProfile } from "./agent_profile.js";

function decodeCursor(value) {
  if (!value) return { createdAt: "", eventId: "" };
  try {
    const parsed = JSON.parse(Buffer.from(String(value), "base64url").toString("utf8"));
    return { createdAt: String(parsed.created_at || ""), eventId: String(parsed.event_id || "") };
  } catch {
    throw new Error("invalid_cursor");
  }
}

function encodeCursor(row) {
  return Buffer.from(JSON.stringify({ created_at: row.created_at, event_id: row.event_id })).toString("base64url");
}

function allowedThreads() {
  return new Set(String(process.env.HERMES_ZALO_ALLOWED_THREADS || "").split(",").map((v) => v.trim()).filter(Boolean));
}

function allowedUsers() {
  return new Set(String(process.env.HERMES_ZALO_ALLOWED_USERS || "").split(",").map((v) => v.trim()).filter(Boolean));
}

function gatewaySettings() {
  const groupMode = String(process.env.HERMES_ZALO_GROUP_MODE || "mention").trim();
  const allowAllUsers = process.env.HERMES_ZALO_ALLOW_ALL === "true" || process.env.HERMES_ZALO_ALLOW_ALL_USERS === "true";
  const allowAllThreads = process.env.HERMES_ZALO_ALLOW_ALL === "true" || process.env.HERMES_ZALO_ALLOW_ALL_THREADS === "true";
  const threads = allowedThreads();
  const users = allowedUsers();
  return {
    enabled: process.env.HERMES_ZALO_GATEWAY_ENABLED === "true",
    autoReply: process.env.HERMES_ZALO_ALLOW_AUTOREPLY === "true",
    groupMode: ["off", "mention", "all"].includes(groupMode) ? groupMode : "mention",
    allowAllUsers,
    allowAllThreads,
    threads,
    users,
  };
}

function canDeliverInbound(row, settings) {
  if (!settings.enabled) return false;
  if (!settings.allowAllThreads && (!settings.threads.size || !settings.threads.has(String(row.source_id)))) return false;
  if (!settings.allowAllUsers && (!settings.users.size || !settings.users.has(String(row.sender_id)))) return false;
  if (row.is_self) return false;
  if (row.source_type !== "group") return true;
  if (settings.groupMode === "all") return true;
  return settings.groupMode === "mention" && Boolean(row.is_mention);
}

export function createHermesBridge({ config, store, hub }) {
  const accountId = () => String(process.env.HERMES_ZALO_ACCOUNT_ID || config.default_account_id);
  return {
    health() {
      const id = accountId();
      const account = store.getAccount(id);
      const runtime = hub.getRuntime(id);
      return {
        ok: true,
        protocol: "zalo-bridge/v1",
        connected: account?.status === "connected" && Boolean(runtime?.api),
        account_ref: `zalo:${sha256(id).slice(0, 16)}`,
        capabilities: ["text", "typing", "reply", "event-poll", "profile-route"],
        gateway: {
          enabled: gatewaySettings().enabled,
          auto_reply_enabled: gatewaySettings().autoReply,
          group_mode: gatewaySettings().groupMode,
          allowlisted_threads: gatewaySettings().threads.size,
          allowlisted_users: gatewaySettings().users.size,
        },
      };
    },
    profiles() {
      const id = accountId();
      return {
        ok: true,
        account_ref: `zalo:${sha256(id).slice(0, 16)}`,
        profiles: (config.agent_profiles || [])
          .filter((profile) => profile.account_id === id)
          .map((profile) => profileSummary(profile)),
      };
    },
    events({ cursor = "", limit = 50 } = {}) {
      const id = accountId();
      const after = decodeCursor(cursor);
      const rows = store.hermesEventsAfter({ accountId: id, ...after, limit });
      const last = rows.at(-1);
      const settings = gatewaySettings();
      return {
        ok: true,
        // Advance the cursor over filtered rows too. Without this, a disabled
        // gateway would repeatedly scan the same private event forever.
        events: rows.filter((row) => canDeliverInbound(row, settings)).map((row) => {
          const profile = resolveAgentProfile(config, { accountId: id, sourceId: row.source_id });
          return {
            id: row.event_id,
            thread: { id: row.source_id, kind: row.source_type === "group" ? "group" : "dm", name: row.source_name || "" },
            sender: { id: row.sender_id, display_name: row.sender_name || "" },
            message: { id: row.message_id || row.event_id, type: row.message_type, text: row.text || "" },
            route: { profile: profileSummary(profile) },
            attachments: (() => { try { const media = JSON.parse(row.metadata_json || "{}").hermes_media || []; return media.filter((item) => item?.id && item?.path).map(({ id, name, kind, mime, size }) => ({ id, name, kind, mime, size })); } catch { return []; } })(),
            occurred_at: row.created_at,
          };
        }),
        next_cursor: last ? encodeCursor(last) : String(cursor || ""),
      };
    },
    media({ eventId, attachmentId }) {
      const metadata = store.hermesMediaMetadata(eventId);
      if (!metadata) return null;
      return resolveStagedMedia(store.dataDir, eventId, attachmentId, { ...metadata, event_id: eventId });
    },
    async sendMessage({ threadId, text, replyTo = null, threadType = null } = {}) {
      const thread = String(threadId || "").trim();
      const body = String(text || "").trim();
      if (!thread || !body || body.length > 4000) throw new Error("invalid_message");
      const settings = gatewaySettings();
      if (!settings.enabled || !settings.autoReply) throw new Error("gateway_autoreply_disabled");
      if (!settings.allowAllThreads && !allowedThreads().has(thread)) throw new Error("thread_not_allowlisted");
      const runtime = hub.getRuntime(accountId());
      const source = store.listSources(accountId()).find((item) => String(item.source_id) === thread);
      const resolvedThreadType = Number(threadType) === 0 ? 0 : source?.source_type === "dm" ? 0 : 1;
      const result = await runtime.performPersonalAction("send_message", {
        thread_id: thread,
        thread_type: resolvedThreadType,
        text: body,
        parse_markdown: true,
        quote: replyTo ? { msgId: String(replyTo) } : undefined,
      });
      store.audit({ accountId: accountId(), actorId: "hermes-zalo-plugin", action: "hermes_bridge_send", detail: `thread=${sha256(thread).slice(0, 12)}` });
      return { ok: true, message_id: String(result?.messageId || result?.msgId || "") };
    },
    async typing({ threadId, threadType = null } = {}) {
      const thread = String(threadId || "").trim();
      const settings = gatewaySettings();
      if (!settings.enabled || !settings.autoReply) throw new Error("gateway_autoreply_disabled");
      if (!thread || (!settings.allowAllThreads && !allowedThreads().has(thread))) throw new Error("thread_not_allowlisted");
      const source = store.listSources(accountId()).find((item) => String(item.source_id) === thread);
      const resolvedThreadType = Number(threadType) === 0 ? 0 : source?.source_type === "dm" ? 0 : 1;
      await hub.getRuntime(accountId()).performPersonalAction("typing", { thread_id: thread, thread_type: resolvedThreadType });
      return { ok: true };
    },
  };
}
