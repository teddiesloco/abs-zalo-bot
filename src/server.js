// Express dashboard + control API. Binds localhost by default.
import express from "express";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { redactSecrets } from "./schema.js";
import { sendDigest } from "./digest.js";
import { isValidMode } from "./policy.js";
import { loadBotRegistry } from "./bot_registry.js";
import { createOaWebhookHandler } from "./oa_webhook.js";
import { createOaAutoReplyWorker } from "./oa_auto_reply.js";
import { publicBrandMetadata } from "./brand.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function auth(req, res, next) {
  const expected = process.env.DASHBOARD_TOKEN || "";
  if (!expected || expected === "change-me") {
    return next();
  }
  const header = req.get("x-bridge-token") || "";
  if (header === expected) return next();
  return res.status(401).json({ error: "unauthorized" });
}

export function createApp({
  config,
  store,
  policy,
  hub,
  keepalive = null,
  oaRegistry = null,
  oaWebhookSecret = process.env.ZALO_OA_WEBHOOK_SECRET || "",
}) {
  const app = express();
  app.disable("x-powered-by");
  app.use(
    express.json({
      limit: "256kb",
      verify: (req, _res, buffer) => {
        req.rawBody = Buffer.from(buffer);
      },
    }),
  );

  // The official OA ingress is intentionally registered before dashboard auth:
  // provider webhooks authenticate with their own signature, not a dashboard
  // token. The handler only validates/normalizes/acknowledges; it never calls
  // an AI provider or sends a reply.
  const resolvedOaRegistry = oaRegistry ?? loadBotRegistry(
    process.env.BOTS_FILE || path.join(__dirname, "..", "config", "bots.json"),
  );
  // Replies can be initiated only from this signed OA webhook callback. The
  // worker remains fail-closed unless a bot explicitly opts into
  // `inbound_auto_reply` and carries the server-only bridge token.
  const oaAutoReply = createOaAutoReplyWorker({ registry: resolvedOaRegistry });
  const oaWebhook = createOaWebhookHandler({
    registry: resolvedOaRegistry,
    webhookSecret: oaWebhookSecret,
    onEvent: (event) => oaAutoReply.handle(event),
  });
  app.post("/webhooks/zalo/oa/:bot_id", oaWebhook);

  // Public, non-sensitive product metadata. Runtime/account state remains behind
  // the normal dashboard auth boundary below.
  app.get("/api/brand", (_req, res) => {
    res.json({ ok: true, brand: publicBrandMetadata() });
  });

  // The QR onboarding shell is intentionally public and contains no QR/session
  // material. The QR/status APIs below remain behind dashboard auth, so a VPS
  // operator can open this page first and enter the token in the browser.
  app.get(["/connect", "/connect/"], (_req, res) => {
    res.sendFile(path.join(__dirname, "..", "public", "connect.html"));
  });

  app.get("/healthz", (_req, res) => {
    const accountId = config.default_account_id;
    const acc = store.getAccount(accountId);
    const runtime = hub.getRuntime(accountId);
    const listener = Boolean(runtime.api?.listener);
    const connected = acc?.status === "connected" && Boolean(runtime.api);
    res.json({
      ok: true,
      brand: publicBrandMetadata(),
      service: "hermes-zalo-personal-bridge",
      status: acc?.status || "unknown",
      connected,
      listener,
      keepalive: Boolean(keepalive?.started),
      ts: new Date().toISOString(),
    });
  });

  app.get("/api/health", (_req, res) => {
    const accountId = config.default_account_id;
    const acc = store.getAccount(accountId);
    const dest = store.getDestination(accountId);
    const runtime = hub.getRuntime(accountId);
    const snap = keepalive?.snapshot?.() || null;
    const lastMsg =
      store.getHealth(`last_message_at_${accountId}`) || runtime.lastMessageAt || null;
    const lastListenerErr = store.getHealth(`last_listener_error_${accountId}`);
    const lastTick = store.getHealth(`keepalive_tick_${accountId}`);
    res.json({
      ok: true,
      brand: publicBrandMetadata(),
      account: {
        id: accountId,
        status: acc?.status,
        display_name: acc?.display_name,
        has_session: store.hasSession(accountId),
        last_error: acc?.last_error || "",
      },
      destination: dest,
      listener: Boolean(runtime.api?.listener),
      last_message_at: lastMsg,
      last_listener_error: lastListenerErr,
      keepalive: snap,
      last_tick: lastTick,
      corpus: {
        messages: store.countEvents(accountId),
        users: store.countUsers(accountId),
        sources: store.listSources(accountId).length,
      },
      safety: policy.safetyFlags(),
    });
  });

  app.use(auth);

  app.get("/api/status", (_req, res) => {
    const accountId = config.default_account_id;
    const acc = store.getAccount(accountId);
    let bootstrap = null;
    try {
      bootstrap = JSON.parse(store.getHealth(`bootstrap_${accountId}`) || "null");
    } catch {
      bootstrap = store.getHealth(`bootstrap_${accountId}`);
    }
    res.json(
      redactSecrets({
        brand: publicBrandMetadata(),
        accounts: hub.listStatus(),
        phone_label: store.getSetting("phone_label", config.phone_label || ""),
        owner_user_id: acc?.zalo_user_id || "",
        destination: store.getDestination(accountId),
        sources: store.listSources(accountId),
        source_count: store.listSources(accountId).length,
        event_count: store.countEvents(),
        global_paused: store.isGlobalPaused(),
        paused: store.isGlobalPaused(),
        safety: policy.safetyFlags(),
        listen_all_groups: Boolean(config.listen_all_groups),
        auto_alert: Boolean(config.auto_alert),
        permissions: store.listPermissions(accountId).map((p) => ({
          user_id: p.user_id,
          role: p.role,
          display_name: p.display_name,
        })),
        bootstrap,
        token_is_default: !process.env.DASHBOARD_TOKEN || process.env.DASHBOARD_TOKEN === "change-me",
        snapshot: store.snapshot(),
      }),
    );
  });

  app.get("/api/discovery", (req, res) => {
    const accountId = req.query.account_id || config.default_account_id;
    const groups = store.getSetting(`discovered_groups_${accountId}`, []) || [];
    const acc = store.getAccount(accountId);
    res.json({
      ok: true,
      account_id: accountId,
      owner_user_id: acc?.zalo_user_id || "",
      destination: store.getDestination(accountId),
      groups,
      sources: store.listSources(accountId),
    });
  });

  app.post("/api/discovery/refresh", async (req, res) => {
    try {
      const accountId = req.body?.account_id || config.default_account_id;
      const runtime = hub.getRuntime(accountId);
      if (!runtime.api) {
        return res.status(400).json({ ok: false, error: "not_connected" });
      }
      const { bootstrapAccount } = await import("./discovery.js");
      const dest = store.getDestination(accountId);
      const result = await bootstrapAccount({
        api: runtime.api,
        store,
        accountId,
        destinationName: dest.group_name || process.env.DESTINATION_GROUP_NAME || "configured destination",
      });
      res.json({ ok: true, result });
    } catch (err) {
      res.status(500).json({ ok: false, error: String(err?.message || err) });
    }
  });

  app.post("/api/corpus/backfill", async (req, res) => {
    try {
      const accountId = req.body?.account_id || config.default_account_id;
      const runtime = hub.getRuntime(accountId);
      if (!runtime.api) return res.status(400).json({ ok: false, error: "not_connected" });
      const { backfillAccountCorpus } = await import("./backfill.js");
      // respond async-ish but await for evidence in MVP (can take minutes)
      const result = await backfillAccountCorpus({
        api: runtime.api,
        store,
        accountId,
        historyCount: Number(req.body?.history_count || 50),
        maxGroups: Number(req.body?.max_groups || 200),
        delayMs: Number(req.body?.delay_ms || 250),
        groupIds: Array.isArray(req.body?.group_ids) ? req.body.group_ids : null,
      });
      res.json({
        ok: true,
        result: {
          ...result,
          errors: (result.errors || []).slice(0, 30),
        },
        corpus: {
          messages: store.countEvents(accountId),
          users: store.countUsers(accountId),
          member_links: store.countSourceMembers(accountId),
          sources: store.listSources(accountId).length,
        },
      });
    } catch (err) {
      res.status(500).json({ ok: false, error: String(err?.message || err) });
    }
  });

  app.get("/api/corpus/summary", (req, res) => {
    const accountId = req.query.account_id || config.default_account_id;
    let last = null;
    try {
      last = JSON.parse(store.getHealth(`backfill_${accountId}`) || "null");
    } catch {
      last = store.getHealth(`backfill_${accountId}`);
    }
    res.json({
      ok: true,
      account_id: accountId,
      messages: store.countEvents(accountId),
      users: store.countUsers(accountId),
      member_links: store.countSourceMembers(accountId),
      sources: store.listSources(accountId).length,
      last_backfill: last,
    });
  });

  app.get("/api/users", (req, res) => {
    const accountId = req.query.account_id || config.default_account_id;
    res.json({
      ok: true,
      users: store.listUsers(accountId, Number(req.query.limit || 200)),
    });
  });

  app.get("/api/sources/:sourceId/members", (req, res) => {
    const accountId = req.query.account_id || config.default_account_id;
    res.json({
      ok: true,
      source_id: req.params.sourceId,
      members: store.listSourceMembers(accountId, req.params.sourceId, Number(req.query.limit || 500)),
    });
  });

  app.post("/api/accounts/:accountId/connect", async (req, res) => {
    try {
      const runtime = hub.getRuntime(req.params.accountId);
      const forceQr = Boolean(req.body?.force_qr);
      const connectPromise = runtime.connect({ forceQr });
      const raced = await Promise.race([
        connectPromise.then((s) => ({ done: true, status: s })),
        new Promise((resolve) => setTimeout(() => resolve({ done: false }), 1500)),
      ]);
      res.json({
        ok: true,
        connecting: !raced.done,
        status: runtime.status(),
        qr: runtime.getQr(),
      });
    } catch (err) {
      res.status(500).json({ ok: false, error: String(err?.message || err) });
    }
  });

  app.get("/api/accounts/:accountId/qr", (req, res) => {
    const runtime = hub.getRuntime(req.params.accountId);
    const qr = runtime.getQr();
    if (!qr) return res.status(404).json({ ok: false, error: "no_qr" });
    res.json({ ok: true, qr: { code: qr.code, updated_at: qr.updated_at, image: qr.image } });
  });

  app.post("/api/accounts/:accountId/pause", async (req, res) => {
    const runtime = hub.getRuntime(req.params.accountId);
    store.setGlobalPaused(true);
    res.json({ ok: true, status: await runtime.pause(), global_paused: true });
  });

  app.post("/api/accounts/:accountId/resume", async (req, res) => {
    store.setGlobalPaused(false);
    store.setAccountStatus(req.params.accountId, "connected");
    res.json({ ok: true, global_paused: false, status: hub.getRuntime(req.params.accountId).status() });
  });

  app.post("/api/accounts/:accountId/disconnect", async (req, res) => {
    const runtime = hub.getRuntime(req.params.accountId);
    const wipe = Boolean(req.body?.wipe_session);
    res.json({ ok: true, status: await runtime.disconnect({ wipeSession: wipe }) });
  });

  app.get("/api/events", (req, res) => {
    const accountId = req.query.account_id || null;
    const sourceId = req.query.source_id || null;
    const limit = Number(req.query.limit || 50);
    const rows = store.recentEvents({ accountId, sourceId, limit });
    res.json({
      ok: true,
      events: rows.map((r) => ({
        ...r,
        text: String(r.text || "").slice(0, 500),
      })),
    });
  });

  app.get("/api/sources", (req, res) => {
    const accountId = req.query.account_id || config.default_account_id;
    res.json({
      ok: true,
      sources: store.listSources(accountId),
      destination: store.getDestination(accountId),
    });
  });

  app.post("/api/sources", (req, res) => {
    const accountId = req.body?.account_id || config.default_account_id;
    const sourceId = req.body?.source_id;
    if (!sourceId) return res.status(400).json({ ok: false, error: "source_id_required" });
    const mode = req.body?.mode || "listen_only";
    if (!isValidMode(mode)) return res.status(400).json({ ok: false, error: "bad_mode" });
    const row = store.upsertSource({
      accountId,
      sourceId,
      sourceType: req.body?.source_type || "group",
      sourceName: req.body?.source_name || "",
      mode,
      isAllowed: mode !== "off",
      muted: Boolean(req.body?.muted),
    });
    store.audit({ accountId, actorId: "dashboard", action: "upsert_source", detail: `${sourceId}:${mode}` });
    res.json({ ok: true, source: row });
  });

  app.post("/api/sources/:sourceId/mode", (req, res) => {
    const accountId = req.body?.account_id || config.default_account_id;
    const mode = req.body?.mode;
    if (!isValidMode(mode)) return res.status(400).json({ ok: false, error: "bad_mode" });
    const row = store.setSourceMode(accountId, req.params.sourceId, mode);
    res.json({ ok: true, source: row });
  });

  app.post("/api/sources/:sourceId/mute", (req, res) => {
    const accountId = req.body?.account_id || config.default_account_id;
    const muted = req.body?.muted !== false;
    const row = store.muteSource(accountId, req.params.sourceId, muted);
    res.json({ ok: true, source: row });
  });

  app.post("/api/destination", (req, res) => {
    const accountId = req.body?.account_id || config.default_account_id;
    const groupId = req.body?.group_id || "";
    const groupName = req.body?.group_name || "";
    const dest = store.setDestination(accountId, groupId, groupName);
    store.audit({ accountId, actorId: "dashboard", action: "set_destination", detail: groupId });
    res.json({ ok: true, destination: dest });
  });

  app.get("/api/permissions", (req, res) => {
    const accountId = req.query.account_id || config.default_account_id;
    res.json({ ok: true, permissions: store.listPermissions(accountId) });
  });

  app.post("/api/permissions", (req, res) => {
    const accountId = req.body?.account_id || config.default_account_id;
    const userId = req.body?.user_id;
    const role = req.body?.role;
    if (!userId || !role) return res.status(400).json({ ok: false, error: "user_id_and_role_required" });
    if (!["owner", "admin", "operator", "viewer"].includes(role)) {
      return res.status(400).json({ ok: false, error: "bad_role" });
    }
    const row = store.upsertPermission({
      accountId,
      userId,
      role,
      displayName: req.body?.display_name || "",
    });
    store.audit({ accountId, actorId: "dashboard", action: "upsert_permission", detail: `${userId}:${role}` });
    res.json({ ok: true, permission: row });
  });

  app.delete("/api/permissions/:userId", (req, res) => {
    const accountId = req.query.account_id || config.default_account_id;
    store.removePermission(accountId, req.params.userId);
    res.json({ ok: true });
  });

  app.post("/api/kill-switch", (req, res) => {
    const paused = Boolean(req.body?.paused);
    store.setGlobalPaused(paused);
    store.audit({ actorId: "dashboard", action: paused ? "kill_on" : "kill_off", detail: "" });
    res.json({ ok: true, global_paused: store.isGlobalPaused() });
  });

  app.get("/api/reports", (req, res) => {
    const accountId = req.query.account_id || null;
    res.json({ ok: true, reports: store.listReports({ accountId, limit: Number(req.query.limit || 20) }) });
  });

  app.get("/api/audit", (req, res) => {
    res.json({ ok: true, audit: store.recentAudit(Number(req.query.limit || 50)) });
  });

  app.post("/api/digest/run", async (req, res) => {
    try {
      if (config.listener_only !== false) {
        return res.status(403).json({ ok: false, reason: "outbound_disabled", skipped_before_analysis: true });
      }
      const accountId = req.body?.account_id || config.default_account_id;
      const hours = Number(req.body?.hours || 24);
      const result = await sendDigest({ config, store, policy, hub, accountId, hours, reportType: "manual" });
      res.json(result);
    } catch (err) {
      res.status(500).json({ ok: false, error: String(err?.message || err) });
    }
  });

  // Operator: send ONE preformatted manager report to configured destination only.
  // Does not rewrite text via Hermes brain (verbatim). Policy Guard still destination-only.
  app.post("/api/report/send", async (req, res) => {
    try {
      if (config.listener_only !== false) {
        return res.status(403).json({ ok: false, reason: "outbound_disabled" });
      }
      const { sha256 } = await import("./schema.js");
      const { scrubTechJargon } = await import("./ops_report.js");
      const accountId = req.body?.account_id || config.default_account_id;
      let text = scrubTechJargon(String(req.body?.text || req.body?.message || "").trim()).slice(0, 3200);
      if (!text || text.length < 20) {
        return res.status(400).json({ ok: false, error: "text_required" });
      }
      const dest = store.getDestination(accountId);
      if (!dest.group_id) {
        return res.status(400).json({ ok: false, error: "destination_unset" });
      }
      const decision = policy.evaluateOutbound({
        accountId,
        targetId: dest.group_id,
        text,
        kind: "report",
      });
      if (!decision.allow) {
        store.logOutbound({
          accountId,
          targetId: dest.group_id,
          kind: "report",
          textSha: sha256(text),
          ok: false,
          reason: decision.reason,
        });
        return res.status(403).json({ ok: false, reason: decision.reason, destination: dest });
      }
      const runtime = hub.getRuntime(accountId);
      if (!runtime?.api?.sendMessage) {
        return res.status(503).json({ ok: false, error: "not_connected", destination: dest });
      }
      await runtime.sendText(dest.group_id, text, 1);
      store.logOutbound({
        accountId,
        targetId: dest.group_id,
        kind: "report",
        textSha: decision.textSha || sha256(text),
        ok: true,
        reason: "sent",
      });
      store.audit({
        accountId,
        actorId: "api_report_send",
        action: "report_sent",
        detail: text.slice(0, 120),
      });
      res.json({ ok: true, reason: "sent", chars: text.length, destination: dest });
    } catch (err) {
      res.status(500).json({ ok: false, error: String(err?.message || err) });
    }
  });

  // On-demand ask → analyze corpus → ONE message to configured destination only.
  app.post("/api/ask", async (req, res) => {
    try {
      if (config.listener_only !== false) {
        return res.status(403).json({ ok: false, reason: "outbound_disabled", skipped_before_analysis: true });
      }
      const accountId = req.body?.account_id || config.default_account_id;
      const question = String(req.body?.question || req.body?.text || "").trim();
      const hours = Number(req.body?.hours || 24);
      if (!question) return res.status(400).json({ ok: false, error: "question_required" });

      const dest = store.getDestination(accountId);
      if (!dest.group_id) {
        return res.status(400).json({ ok: false, error: "destination_unset" });
      }

      const acc = store.getAccount(accountId);
      const senderId = String(
        req.body?.sender_id || acc?.zalo_user_id || process.env.OWNER_USER_IDS?.split(",")[0] || "owner",
      );

      const { handleDestinationAsk, isBotCommand } = await import("./ask.js");
      // API/MCP is owner-initiated; normalize to Phase-1 bot prefix.
      const cmdText = isBotCommand(question) ? question : `bot ${question}`;
      const event = {
        event_id: `api-ask-${Date.now()}`,
        account_id: accountId,
        source_type: "group",
        source_id: dest.group_id,
        source_name: dest.group_name || "configured destination",
        sender_id: senderId,
        sender_name: acc?.display_name || "owner",
        message_id: `api-ask-${Date.now()}`,
        message_type: "text",
        text: cmdText,
        is_self: Boolean(acc?.zalo_user_id && String(acc.zalo_user_id) === senderId),
        is_mention: false,
        raw_metadata: { via: "api_ask" },
        created_at: new Date().toISOString(),
      };

      const result = await handleDestinationAsk({
        event,
        store,
        policy,
        hub,
        config,
        hours,
      });
      res.json({ ok: Boolean(result?.ok), ...result, destination: dest });
    } catch (err) {
      res.status(500).json({ ok: false, error: String(err?.message || err) });
    }
  });

  // ── Group Ops & Advanced Zalo Endpoints (ABS Specialized Ops) ──

  app.post("/api/groups/:groupId/kick", async (req, res) => {
    try {
      const accountId = req.body?.account_id || config.default_account_id;
      const memberId = req.body?.user_id || req.body?.member_id;
      if (!memberId) return res.status(400).json({ ok: false, error: "user_id_required" });
      const runtime = hub.getRuntime(accountId);
      if (!runtime.api) return res.status(400).json({ ok: false, error: "not_connected" });
      const result = await runtime.removeUserFromGroup(req.params.groupId, memberId);
      res.json({ ok: true, result });
    } catch (err) {
      res.status(500).json({ ok: false, error: String(err?.message || err) });
    }
  });

  app.post("/api/groups/:groupId/transfer-owner", async (req, res) => {
    try {
      const accountId = req.body?.account_id || config.default_account_id;
      const newOwnerId = req.body?.new_owner_id || req.body?.user_id;
      if (!newOwnerId) return res.status(400).json({ ok: false, error: "new_owner_id_required" });
      const runtime = hub.getRuntime(accountId);
      if (!runtime.api) return res.status(400).json({ ok: false, error: "not_connected" });
      const result = await runtime.changeGroupOwner(req.params.groupId, newOwnerId);
      res.json({ ok: true, result });
    } catch (err) {
      res.status(500).json({ ok: false, error: String(err?.message || err) });
    }
  });

  app.post("/api/groups/:groupId/deputies/add", async (req, res) => {
    try {
      const accountId = req.body?.account_id || config.default_account_id;
      const memberId = req.body?.user_id || req.body?.member_id;
      if (!memberId) return res.status(400).json({ ok: false, error: "user_id_required" });
      const runtime = hub.getRuntime(accountId);
      if (!runtime.api) return res.status(400).json({ ok: false, error: "not_connected" });
      const result = await runtime.addGroupDeputy(req.params.groupId, memberId);
      res.json({ ok: true, result });
    } catch (err) {
      res.status(500).json({ ok: false, error: String(err?.message || err) });
    }
  });

  app.post("/api/groups/:groupId/deputies/remove", async (req, res) => {
    try {
      const accountId = req.body?.account_id || config.default_account_id;
      const memberId = req.body?.user_id || req.body?.member_id;
      if (!memberId) return res.status(400).json({ ok: false, error: "user_id_required" });
      const runtime = hub.getRuntime(accountId);
      if (!runtime.api) return res.status(400).json({ ok: false, error: "not_connected" });
      const result = await runtime.removeGroupDeputy(req.params.groupId, memberId);
      res.json({ ok: true, result });
    } catch (err) {
      res.status(500).json({ ok: false, error: String(err?.message || err) });
    }
  });

  app.post("/api/groups/:groupId/invite", async (req, res) => {
    try {
      const accountId = req.body?.account_id || config.default_account_id;
      const memberId = req.body?.user_id || req.body?.member_id;
      if (!memberId) return res.status(400).json({ ok: false, error: "user_id_required" });
      const runtime = hub.getRuntime(accountId);
      if (!runtime.api) return res.status(400).json({ ok: false, error: "not_connected" });
      const result = await runtime.addUserToGroup(req.params.groupId, memberId);
      res.json({ ok: true, result });
    } catch (err) {
      res.status(500).json({ ok: false, error: String(err?.message || err) });
    }
  });

  app.post("/api/groups/:groupId/polls", async (req, res) => {
    try {
      const accountId = req.body?.account_id || config.default_account_id;
      const { question, options, expired_time, allow_multi, allow_add, is_anon, hide_preview } = req.body || {};
      if (!question || !Array.isArray(options) || options.length < 2) {
        return res.status(400).json({ ok: false, error: "question_and_options_required" });
      }
      const runtime = hub.getRuntime(accountId);
      if (!runtime.api) return res.status(400).json({ ok: false, error: "not_connected" });
      const result = await runtime.createPoll(req.params.groupId, {
        question,
        options,
        expiredTime: expired_time,
        allowMultiChoices: allow_multi,
        allowAddNewOption: allow_add,
        isAnonymous: is_anon,
        hideVotePreview: hide_preview,
      });
      res.json({ ok: true, result });
    } catch (err) {
      res.status(500).json({ ok: false, error: String(err?.message || err) });
    }
  });

  app.post("/api/polls/:pollId/lock", async (req, res) => {
    try {
      const accountId = req.body?.account_id || config.default_account_id;
      const runtime = hub.getRuntime(accountId);
      if (!runtime.api) return res.status(400).json({ ok: false, error: "not_connected" });
      const result = await runtime.lockPoll(req.params.pollId);
      res.json({ ok: true, result });
    } catch (err) {
      res.status(500).json({ ok: false, error: String(err?.message || err) });
    }
  });

  app.post("/api/reactions", async (req, res) => {
    try {
      const accountId = req.body?.account_id || config.default_account_id;
      const { icon, dest } = req.body || {};
      if (!icon || !dest) return res.status(400).json({ ok: false, error: "icon_and_dest_required" });
      const runtime = hub.getRuntime(accountId);
      if (!runtime.api) return res.status(400).json({ ok: false, error: "not_connected" });
      const result = await runtime.addReaction(icon, dest);
      res.json({ ok: true, result });
    } catch (err) {
      res.status(500).json({ ok: false, error: String(err?.message || err) });
    }
  });

  app.post("/api/messages/undo", async (req, res) => {
    try {
      const accountId = req.body?.account_id || config.default_account_id;
      const { dest, thread_id, thread_type } = req.body || {};
      if (!dest || !thread_id) return res.status(400).json({ ok: false, error: "dest_and_thread_id_required" });
      const runtime = hub.getRuntime(accountId);
      if (!runtime.api) return res.status(400).json({ ok: false, error: "not_connected" });
      const result = await runtime.undoMessage(dest, thread_id, thread_type || 1);
      res.json({ ok: true, result });
    } catch (err) {
      res.status(500).json({ ok: false, error: String(err?.message || err) });
    }
  });

  app.get("/api/user-info/:userId", async (req, res) => {
    try {
      const accountId = req.query.account_id || config.default_account_id;
      const runtime = hub.getRuntime(accountId);
      if (!runtime.api) return res.status(400).json({ ok: false, error: "not_connected" });
      const result = await runtime.getUserInfo(req.params.userId);
      res.json({ ok: true, result });
    } catch (err) {
      res.status(500).json({ ok: false, error: String(err?.message || err) });
    }
  });

  app.get("/api/group-info/:groupId", async (req, res) => {
    try {
      const accountId = req.query.account_id || config.default_account_id;
      const runtime = hub.getRuntime(accountId);
      if (!runtime.api) return res.status(400).json({ ok: false, error: "not_connected" });
      const result = await runtime.getGroupInfo(req.params.groupId);
      res.json({ ok: true, result });
    } catch (err) {
      res.status(500).json({ ok: false, error: String(err?.message || err) });
    }
  });

  app.get("/api/find-user", async (req, res) => {
    try {
      const phone = req.query.phone;
      if (!phone) return res.status(400).json({ ok: false, error: "phone_required" });
      const accountId = req.query.account_id || config.default_account_id;
      const runtime = hub.getRuntime(accountId);
      if (!runtime.api) return res.status(400).json({ ok: false, error: "not_connected" });
      const result = await runtime.findUser(phone);
      res.json({ ok: true, result });
    } catch (err) {
      res.status(500).json({ ok: false, error: String(err?.message || err) });
    }
  });

  app.get("/api/friends", async (req, res) => {
    try {
      const accountId = req.query.account_id || config.default_account_id;
      const runtime = hub.getRuntime(accountId);
      if (!runtime.api) return res.status(400).json({ ok: false, error: "not_connected" });
      const result = await runtime.getAllFriends();
      res.json({ ok: true, result });
    } catch (err) {
      res.status(500).json({ ok: false, error: String(err?.message || err) });
    }
  });

  app.get("/api/groups-all", async (req, res) => {
    try {
      const accountId = req.query.account_id || config.default_account_id;
      const runtime = hub.getRuntime(accountId);
      if (!runtime.api) return res.status(400).json({ ok: false, error: "not_connected" });
      const result = await runtime.getAllGroups();
      res.json({ ok: true, result });
    } catch (err) {
      res.status(500).json({ ok: false, error: String(err?.message || err) });
    }
  });

  app.get("/api/battle-ready", async (_req, res) => {
    const accountId = config.default_account_id;
    const acc = store.getAccount(accountId);
    const dest = store.getDestination(accountId);
    const safety = policy.safetyFlags();
    const runtime = hub.getRuntime(accountId);
    const ka = keepalive?.snapshot?.() || null;
    res.json({
      ok: true,
      brand: publicBrandMetadata(),
      battle_ready: Boolean(
        acc?.status === "connected" &&
          dest.group_id &&
          safety.READ_ONLY_SOURCE &&
          safety.auto_reply_disabled &&
          runtime.api,
      ),
      account: {
        id: accountId,
        status: acc?.status,
        display_name: acc?.display_name,
        zalo_user_id: acc?.zalo_user_id,
        has_session: store.hasSession(accountId),
      },
      destination: dest,
      safety,
      corpus: {
        messages: store.countEvents(accountId),
        users: store.countUsers(accountId),
        member_links: store.countSourceMembers(accountId),
        sources: store.listSources(accountId).length,
      },
      listener: Boolean(runtime.api?.listener),
      keepalive: ka,
    });
  });

  app.use(express.static(path.join(__dirname, "..", "public")));

  app.use((err, _req, res, _next) => {
    if (err?.type === "entity.parse.failed") {
      return res.status(400).json({ ok: false, error: "invalid_json" });
    }
    return res.status(500).json({ ok: false, error: "internal" });
  });

  return app;
}
