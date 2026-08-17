#!/usr/bin/env node
/**
 * ABS Zalo MCP Server — Enterprise & Autonomous MCP facade over ABS Zalo Engine.
 *
 * Branding: ABS Bot (Agent Business System)
 * Capabilities:
 * - Read/Corpus & Health checks (abs_zalo_status, abs_zalo_list_groups, abs_zalo_recent_messages, etc.)
 * - Group Administration (abs_zalo_kick_member, abs_zalo_transfer_owner, abs_zalo_add_deputy, abs_zalo_remove_deputy, abs_zalo_invite_member)
 * - Group Interaction & Polls (abs_zalo_create_poll, abs_zalo_lock_poll, abs_zalo_react_message, abs_zalo_undo_message)
 * - Discovery & Info (abs_zalo_get_user_info, abs_zalo_get_group_info, abs_zalo_find_user, abs_zalo_list_friends, abs_zalo_list_all_groups)
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

const BRIDGE_URL = (process.env.ZALO_BRIDGE_URL || "http://127.0.0.1:3871").replace(/\/$/, "");
const TOKEN = process.env.DASHBOARD_TOKEN || process.env.ZALO_BRIDGE_TOKEN || "";

function log(...args) {
  console.error("[abs-zalo-mcp]", ...args);
}

async function bridge(path, { method = "GET", body = null } = {}) {
  const headers = { "content-type": "application/json" };
  if (TOKEN && TOKEN !== "change-me") headers["x-bridge-token"] = TOKEN;
  const res = await fetch(`${BRIDGE_URL}${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    data = { raw: text.slice(0, 2000) };
  }
  if (!res.ok) {
    const err = data?.error || data?.message || res.statusText;
    throw new Error(`bridge ${method} ${path} → ${res.status}: ${err}`);
  }
  return data;
}

function ok(data) {
  return {
    content: [{ type: "text", text: JSON.stringify(data, null, 2) }],
  };
}

function fail(err) {
  return {
    content: [{ type: "text", text: JSON.stringify({ error: String(err?.message || err) }, null, 2) }],
    isError: true,
  };
}

const server = new McpServer({
  name: "abs-zalo-mcp",
  version: "0.3.0",
});

// ── Read & Telemetry Tools ──

server.tool(
  "abs_zalo_status",
  "Bridge/account safety status: connected?, READ_ONLY_SOURCE, destination, corpus counts.",
  {},
  async () => {
    try {
      const [status, corpus] = await Promise.all([
        bridge("/api/status"),
        bridge("/api/corpus/summary").catch(() => null),
      ]);
      return ok({
        accounts: status.accounts,
        owner_user_id: status.owner_user_id,
        phone_label: status.phone_label,
        destination: status.destination,
        safety: status.safety,
        corpus,
      });
    } catch (e) {
      return fail(e);
    }
  },
);

server.tool(
  "abs_zalo_list_groups",
  "List known groups (source_id + name + mode). From ABS bridge catalog / discovery.",
  {
    account_id: z.string().optional().describe("Account id, default bridge default"),
  },
  async ({ account_id }) => {
    try {
      const q = account_id ? `?account_id=${encodeURIComponent(account_id)}` : "";
      const data = await bridge(`/api/sources${q}`);
      return ok({
        destination: data.destination,
        sources: (data.sources || []).map((s) => ({
          source_id: s.source_id,
          source_name: s.source_name,
          mode: s.mode,
          is_allowed: s.is_allowed,
          muted: s.muted,
        })),
      });
    } catch (e) {
      return fail(e);
    }
  },
);

server.tool(
  "abs_zalo_list_users",
  "List known user ids / display names from corpus (members + senders).",
  {
    limit: z.number().int().min(1).max(1000).optional(),
    account_id: z.string().optional(),
  },
  async ({ limit = 100, account_id }) => {
    try {
      const qs = new URLSearchParams();
      if (account_id) qs.set("account_id", account_id);
      qs.set("limit", String(limit));
      const data = await bridge(`/api/users?${qs}`);
      return ok(data);
    } catch (e) {
      return fail(e);
    }
  },
);

server.tool(
  "abs_zalo_group_members",
  "List members of a group source_id (user_id, role, display_name).",
  {
    source_id: z.string().describe("Zalo group id"),
    account_id: z.string().optional(),
    limit: z.number().int().min(1).max(2000).optional(),
  },
  async ({ source_id, account_id, limit = 500 }) => {
    try {
      const qs = new URLSearchParams();
      if (account_id) qs.set("account_id", account_id);
      qs.set("limit", String(limit));
      const data = await bridge(`/api/sources/${encodeURIComponent(source_id)}/members?${qs}`);
      return ok(data);
    } catch (e) {
      return fail(e);
    }
  },
);

server.tool(
  "abs_zalo_recent_messages",
  "Read recently captured/stored messages from the bridge corpus (daemon/listener). Prefer this over history API.",
  {
    limit: z.number().int().min(1).max(200).optional(),
    account_id: z.string().optional(),
    source_id: z.string().optional().describe("Filter by group id"),
  },
  async ({ limit = 50, account_id, source_id }) => {
    try {
      const qs = new URLSearchParams();
      if (account_id) qs.set("account_id", account_id);
      if (source_id) qs.set("source_id", source_id);
      qs.set("limit", String(limit));
      const data = await bridge(`/api/events?${qs}`);
      let events = data.events || [];
      if (source_id) events = events.filter((e) => String(e.source_id) === String(source_id));
      return ok({ count: events.length, events });
    } catch (e) {
      return fail(e);
    }
  },
);

server.tool(
  "abs_zalo_corpus_summary",
  "Corpus inventory: groups, users, member links, messages, last backfill.",
  {
    account_id: z.string().optional(),
  },
  async ({ account_id }) => {
    try {
      const q = account_id ? `?account_id=${encodeURIComponent(account_id)}` : "";
      return ok(await bridge(`/api/corpus/summary${q}`));
    } catch (e) {
      return fail(e);
    }
  },
);

server.tool(
  "abs_zalo_backfill",
  "READ_ONLY backfill: groups/users/members + best-effort old messages. Does not send messages.",
  {
    history_count: z.number().int().min(1).max(200).optional(),
    max_groups: z.number().int().min(1).max(500).optional(),
    account_id: z.string().optional(),
  },
  async ({ history_count = 50, max_groups = 200, account_id }) => {
    try {
      const data = await bridge("/api/corpus/backfill", {
        method: "POST",
        body: { history_count, max_groups, account_id },
      });
      return ok(data);
    } catch (e) {
      return fail(e);
    }
  },
);

server.tool(
  "abs_zalo_refresh_discovery",
  "Re-scan groups after connect: resolve the configured destination + account owner.",
  {
    account_id: z.string().optional(),
  },
  async ({ account_id }) => {
    try {
      return ok(
        await bridge("/api/discovery/refresh", {
          method: "POST",
          body: { account_id },
        }),
      );
    } catch (e) {
      return fail(e);
    }
  },
);

// ── Specialized Group Management Tools (ABS Exclusive) ──

server.tool(
  "abs_zalo_kick_member",
  "Remove a user/member from a group (Requires Group Admin or Owner rights).",
  {
    group_id: z.string().describe("Target Zalo group id"),
    user_id: z.string().describe("User ID to kick from group"),
    account_id: z.string().optional(),
  },
  async ({ group_id, user_id, account_id }) => {
    try {
      const data = await bridge(`/api/groups/${encodeURIComponent(group_id)}/kick`, {
        method: "POST",
        body: { user_id, account_id },
      });
      return ok(data);
    } catch (e) {
      return fail(e);
    }
  },
);

server.tool(
  "abs_zalo_transfer_owner",
  "Transfer group ownership to another member (Requires Group Owner rights).",
  {
    group_id: z.string().describe("Target Zalo group id"),
    new_owner_id: z.string().describe("User ID of the new group owner"),
    account_id: z.string().optional(),
  },
  async ({ group_id, new_owner_id, account_id }) => {
    try {
      const data = await bridge(`/api/groups/${encodeURIComponent(group_id)}/transfer-owner`, {
        method: "POST",
        body: { new_owner_id, account_id },
      });
      return ok(data);
    } catch (e) {
      return fail(e);
    }
  },
);

server.tool(
  "abs_zalo_add_deputy",
  "Promote a member to Group Deputy / Admin (Requires Group Owner rights).",
  {
    group_id: z.string().describe("Target Zalo group id"),
    user_id: z.string().describe("User ID to promote as deputy"),
    account_id: z.string().optional(),
  },
  async ({ group_id, user_id, account_id }) => {
    try {
      const data = await bridge(`/api/groups/${encodeURIComponent(group_id)}/deputies/add`, {
        method: "POST",
        body: { user_id, account_id },
      });
      return ok(data);
    } catch (e) {
      return fail(e);
    }
  },
);

server.tool(
  "abs_zalo_remove_deputy",
  "Demote a Group Deputy / Admin back to regular member (Requires Group Owner rights).",
  {
    group_id: z.string().describe("Target Zalo group id"),
    user_id: z.string().describe("User ID to demote from deputy"),
    account_id: z.string().optional(),
  },
  async ({ group_id, user_id, account_id }) => {
    try {
      const data = await bridge(`/api/groups/${encodeURIComponent(group_id)}/deputies/remove`, {
        method: "POST",
        body: { user_id, account_id },
      });
      return ok(data);
    } catch (e) {
      return fail(e);
    }
  },
);

server.tool(
  "abs_zalo_invite_member",
  "Invite / add a user into an existing group.",
  {
    group_id: z.string().describe("Target Zalo group id"),
    user_id: z.string().describe("User ID or phone number to invite"),
    account_id: z.string().optional(),
  },
  async ({ group_id, user_id, account_id }) => {
    try {
      const data = await bridge(`/api/groups/${encodeURIComponent(group_id)}/invite`, {
        method: "POST",
        body: { user_id, account_id },
      });
      return ok(data);
    } catch (e) {
      return fail(e);
    }
  },
);

// ── Group Interaction & Message Tools ──

server.tool(
  "abs_zalo_create_poll",
  "Create an interactive poll in a Zalo group.",
  {
    group_id: z.string().describe("Target Zalo group id"),
    question: z.string().describe("Poll question text"),
    options: z.array(z.string()).min(2).describe("List of choices/options"),
    expired_time: z.number().optional().describe("Expiration timestamp (ms) or 0 for none"),
    allow_multi: z.boolean().optional().describe("Allow multiple choices"),
    allow_add: z.boolean().optional().describe("Allow members to add new options"),
    is_anon: z.boolean().optional().describe("Anonymous voting"),
    hide_preview: z.boolean().optional().describe("Hide vote count preview"),
    account_id: z.string().optional(),
  },
  async ({ group_id, question, options, expired_time = 0, allow_multi = false, allow_add = false, is_anon = false, hide_preview = false, account_id }) => {
    try {
      const data = await bridge(`/api/groups/${encodeURIComponent(group_id)}/polls`, {
        method: "POST",
        body: {
          question,
          options,
          expired_time,
          allow_multi,
          allow_add,
          is_anon,
          hide_preview,
          account_id,
        },
      });
      return ok(data);
    } catch (e) {
      return fail(e);
    }
  },
);

server.tool(
  "abs_zalo_lock_poll",
  "Lock / close an active poll in a Zalo group.",
  {
    poll_id: z.string().describe("Poll ID to lock"),
    account_id: z.string().optional(),
  },
  async ({ poll_id, account_id }) => {
    try {
      const data = await bridge(`/api/polls/${encodeURIComponent(poll_id)}/lock`, {
        method: "POST",
        body: { account_id },
      });
      return ok(data);
    } catch (e) {
      return fail(e);
    }
  },
);

server.tool(
  "abs_zalo_react_message",
  "Add an emoji reaction to a Zalo message.",
  {
    icon: z.string().describe("Reaction icon (e.g. /:heart, /:like, /:haha, /:sad, /:angry)"),
    dest: z.string().describe("Destination group/user id"),
    account_id: z.string().optional(),
  },
  async ({ icon, dest, account_id }) => {
    try {
      const data = await bridge("/api/reactions", {
        method: "POST",
        body: { icon, dest, account_id },
      });
      return ok(data);
    } catch (e) {
      return fail(e);
    }
  },
);

server.tool(
  "abs_zalo_undo_message",
  "Undo / recall a sent message on Zalo.",
  {
    dest: z.string().describe("Destination / message context"),
    thread_id: z.string().describe("Thread / group ID"),
    thread_type: z.number().optional().default(1).describe("1 for group, 0 for direct"),
    account_id: z.string().optional(),
  },
  async ({ dest, thread_id, thread_type = 1, account_id }) => {
    try {
      const data = await bridge("/api/messages/undo", {
        method: "POST",
        body: { dest, thread_id, thread_type, account_id },
      });
      return ok(data);
    } catch (e) {
      return fail(e);
    }
  },
);

// ── Discovery & Profile Tools ──

server.tool(
  "abs_zalo_get_user_info",
  "Get detailed public profile information of a Zalo user by userId.",
  {
    user_id: z.string().describe("Target Zalo user ID"),
    account_id: z.string().optional(),
  },
  async ({ user_id, account_id }) => {
    try {
      const q = account_id ? `?account_id=${encodeURIComponent(account_id)}` : "";
      const data = await bridge(`/api/user-info/${encodeURIComponent(user_id)}${q}`);
      return ok(data);
    } catch (e) {
      return fail(e);
    }
  },
);

server.tool(
  "abs_zalo_get_group_info",
  "Get detailed metadata and settings of a Zalo group by groupId.",
  {
    group_id: z.string().describe("Target Zalo group ID"),
    account_id: z.string().optional(),
  },
  async ({ group_id, account_id }) => {
    try {
      const q = account_id ? `?account_id=${encodeURIComponent(account_id)}` : "";
      const data = await bridge(`/api/group-info/${encodeURIComponent(group_id)}${q}`);
      return ok(data);
    } catch (e) {
      return fail(e);
    }
  },
);

server.tool(
  "abs_zalo_find_user",
  "Find a Zalo user profile by phone number.",
  {
    phone: z.string().describe("Phone number with country code, e.g. 84901234567"),
    account_id: z.string().optional(),
  },
  async ({ phone, account_id }) => {
    try {
      const qs = new URLSearchParams({ phone });
      if (account_id) qs.set("account_id", account_id);
      const data = await bridge(`/api/find-user?${qs}`);
      return ok(data);
    } catch (e) {
      return fail(e);
    }
  },
);

server.tool(
  "abs_zalo_list_friends",
  "List all friends of the current Zalo account.",
  {
    account_id: z.string().optional(),
  },
  async ({ account_id }) => {
    try {
      const q = account_id ? `?account_id=${encodeURIComponent(account_id)}` : "";
      const data = await bridge(`/api/friends${q}`);
      return ok(data);
    } catch (e) {
      return fail(e);
    }
  },
);

server.tool(
  "abs_zalo_list_all_groups",
  "Fetch all active groups joined by the account from Zalo server.",
  {
    account_id: z.string().optional(),
  },
  async ({ account_id }) => {
    try {
      const q = account_id ? `?account_id=${encodeURIComponent(account_id)}` : "";
      const data = await bridge(`/api/groups-all${q}`);
      return ok(data);
    } catch (e) {
      return fail(e);
    }
  },
);

// Backward-compatibility aliases for older prompts
server.tool("zalo_status", "Alias for abs_zalo_status", {}, async () => bridge("/api/status").then(ok).catch(fail));
server.tool("zalo_list_groups", "Alias for abs_zalo_list_groups", { account_id: z.string().optional() }, async ({ account_id }) => bridge(`/api/sources${account_id ? `?account_id=${account_id}` : ""}`).then(ok).catch(fail));

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  log(`running · bridge=${BRIDGE_URL}`);
  try {
    const h = await bridge("/healthz");
    log("bridge health", h);
  } catch (e) {
    log("bridge not reachable yet:", String(e.message || e));
  }
}

main().catch((err) => {
  log("fatal", err);
  process.exit(1);
});
