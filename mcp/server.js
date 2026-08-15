#!/usr/bin/env node
/**
 * Zalo Personal MCP — thin MCP facade over hermes-zalo-personal-bridge.
 *
 * Design learned from minhkhoa0502/zalo-personal-mcp:
 * - Own the MCP layer (tool surface + policy)
 * - Reuse zca-js only inside the long-lived bridge/daemon
 * - History via daemon capture, not REST getGroupChatHistory (often 404)
 * - Never log to stdout (MCP stdio protocol)
 *
 * Our difference: Policy Guard + READ_ONLY_SOURCE + destination-only send.
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

const BRIDGE_URL = (process.env.ZALO_BRIDGE_URL || "http://127.0.0.1:3871").replace(/\/$/, "");
const TOKEN = process.env.DASHBOARD_TOKEN || process.env.ZALO_BRIDGE_TOKEN || "";

function log(...args) {
  console.error("[zalo-personal-mcp]", ...args);
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
  name: "zalo-personal-mcp",
  version: "0.1.0",
});

// --- read tools ---
server.tool(
  "zalo_status",
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
  "zalo_list_groups",
  "List known groups (source_id + name + mode). From bridge catalog / discovery.",
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
  "zalo_list_users",
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
  "zalo_group_members",
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
  "zalo_recent_messages",
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
      // bridge /api/events currently supports account_id+limit; filter client-side if source_id
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
  "zalo_corpus_summary",
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
  "zalo_backfill",
  "READ_ONLY backfill: groups/users/members + best-effort old messages. May take minutes. Does not send messages.",
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
  "zalo_refresh_discovery",
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

// Explicitly NOT exposing: free-form send to arbitrary threads, friend mutations, group admin.

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
