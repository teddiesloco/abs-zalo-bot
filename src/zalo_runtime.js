// Zalo adapter. Live zca-js is lazy-loaded. Tests inject a fake client.
import fs from "node:fs";
import path from "node:path";
import { EventEmitter } from "node:events";
import { normalizeInboundMessage, utcNow } from "./schema.js";

export class AccountRuntime extends EventEmitter {
  constructor({ accountId, store, policy, onEvent, clientFactory = null }) {
    super();
    this.accountId = String(accountId);
    this.store = store;
    this.policy = policy;
    this.onEvent = onEvent;
    this.clientFactory = clientFactory;
    this.api = null;
    this.qr = null; // { image, code, updated_at }
    this.loginPromise = null;
    this.lastMessageAt = null;
    this.listenerWired = false;
  }

  status() {
    const row = this.store.getAccount(this.accountId) || { status: "disconnected" };
    return {
      account_id: this.accountId,
      status: row.status,
      display_name: row.display_name,
      zalo_user_id: row.zalo_user_id,
      last_error: row.last_error,
      has_session: this.store.hasSession(this.accountId),
      qr_available: Boolean(this.qr?.image),
      updated_at: row.updated_at,
    };
  }

  async connect({ forceQr = false } = {}) {
    if (forceQr) {
      try {
        this.qrAbort?.();
      } catch {
        /* ignore */
      }
      this.qrAbort = null;
      this.api = null;
      this.qr = null;
      // wait prior login attempt to settle if any
      if (this.loginPromise) {
        try {
          await Promise.race([
            this.loginPromise,
            new Promise((r) => setTimeout(r, 500)),
          ]);
        } catch {
          /* ignore */
        }
        this.loginPromise = null;
      }
    }
    if (this.loginPromise) return this.loginPromise;
    this.loginPromise = this.#connectInner({ forceQr }).finally(() => {
      this.loginPromise = null;
    });
    return this.loginPromise;
  }

  async #connectInner({ forceQr }) {
    this.store.ensureAccount(this.accountId);
    if (this.api && !forceQr) {
      return this.status();
    }

    const factory = this.clientFactory || defaultClientFactory;
    const session = forceQr ? null : this.store.loadSession(this.accountId);

    try {
      if (session) {
        this.store.setAccountStatus(this.accountId, "reconnecting");
        this.api = await factory.loginWithSession(session);
      } else {
        this.store.setAccountStatus(this.accountId, "need_scan");
        this.api = await factory.loginWithQr({
          onQr: (payload) => {
            this.qr = { ...payload, updated_at: utcNow() };
            this.#persistQrImage(payload?.image);
            this.emit("qr", this.qr);
          },
          onScanned: (info) => {
            this.store.setAccountStatus(this.accountId, "need_scan", {
              display_name: info?.display_name || "",
            });
          },
          onCredentials: (creds) => {
            this.store.saveSession(this.accountId, creds);
          },
          onAbortHandle: (abortFn) => {
            this.qrAbort = abortFn;
          },
        });
      }

      const info = await safeAccountInfo(this.api);
      this.store.setAccountStatus(this.accountId, "connected", {
        display_name: info.display_name || "",
        zalo_user_id: info.user_id || "",
        last_error: "",
      });
      this.qr = null;

      try {
        const { bootstrapAccount } = await import("./discovery.js");
        const dest = this.store.getDestination(this.accountId);
        const wantName =
          dest.group_name || process.env.DESTINATION_GROUP_NAME || "configured destination";
        await bootstrapAccount({
          api: this.api,
          store: this.store,
          accountId: this.accountId,
          destinationName: wantName,
        });
      } catch (err) {
        this.store.setHealth(
          `bootstrap_error_${this.accountId}`,
          String(err?.message || err),
        );
      }

      this.#wireListener();
      return this.status();
    } catch (err) {
      const msg = String(err?.message || err);
      this.store.setAccountStatus(this.accountId, "disconnected", { last_error: msg.slice(0, 300) });
      this.api = null;
      throw err;
    }
  }

  #wireListener() {
    if (!this.api?.listener) return;
    // Avoid double-binding handlers when reconnect reuses same listener object.
    if (this.listenerWired && this.api.listener === this._wiredListener) {
      try {
        this.api.listener.start?.({ retryOnClose: true });
      } catch {
        /* ignore */
      }
      return;
    }
    this._wiredListener = this.api.listener;
    this.listenerWired = true;

    this.api.listener.on("message", (message) => {
      this.lastMessageAt = utcNow();
      try {
        this.store.setHealth(`last_message_at_${this.accountId}`, this.lastMessageAt);
      } catch {
        /* ignore */
      }
      try {
        const event = normalizeInboundMessage({
          accountId: this.accountId,
          message,
        });
        Promise.resolve(this.onEvent?.(event, this)).catch((err) => {
          try {
            this.store.setHealth(
              `last_listener_error_${this.accountId}`,
              String(err?.message || err),
            );
          } catch {
            /* ignore */
          }
        });
      } catch (err) {
        try {
          this.store.setHealth(
            `last_listener_error_${this.accountId}`,
            String(err?.message || err),
          );
        } catch {
          /* ignore */
        }
      }
    });
    this.api.listener.on("disconnected", () => {
      try {
        this.store.setAccountStatus(this.accountId, "reconnecting", {
          last_error: "listener_disconnected",
        });
        this.store.setHealth(`listener_disconnected_${this.accountId}`, utcNow());
        this.emit("listener_down", { reason: "disconnected", at: utcNow() });
      } catch {
        /* ignore closed store */
      }
    });
    this.api.listener.on("error", (error) => {
      try {
        this.store.setAccountStatus(this.accountId, "reconnecting", {
          last_error: String(error?.message || error).slice(0, 300),
        });
        this.store.setHealth(
          `listener_error_${this.accountId}`,
          String(error?.message || error).slice(0, 300),
        );
        this.emit("listener_down", {
          reason: String(error?.message || error).slice(0, 200),
          at: utcNow(),
        });
      } catch {
        /* ignore closed store */
      }
    });
    this.api.listener.start({ retryOnClose: true });
  }

  async sendText(targetId, text, threadType = 1) {
    if (!this.api?.sendMessage) throw new Error("not_connected");
    // Final defense-in-depth gate; no caller can bypass PolicyGuard merely by
    // holding a runtime reference.
    const outbound = this.policy.evaluateOutbound({
      accountId: this.accountId,
      targetId,
      text,
      kind: "runtime_send",
    });
    if (!outbound.allow) throw new Error(outbound.reason || "outbound_disabled");
    // Final hard gate: never send outside destination when READ_ONLY_SOURCE.
    const dest = this.store.getDestination(this.accountId);
    if (!dest.group_id || String(targetId) !== String(dest.group_id)) {
      throw new Error("blocked_non_destination_send");
    }
    // Never send to source groups even if mis-called with group thread type.
    return this.api.sendMessage(String(text), String(targetId), 1);
  }

  async pause() {
    try {
      this.api?.listener?.stop?.();
    } catch {
      /* ignore */
    }
    this.api = null;
    this.listenerWired = false;
    this._wiredListener = null;
    try {
      this.store.setAccountStatus(this.accountId, "paused");
    } catch {
      /* store may be closed in short-lived scripts */
    }
    return this.status();
  }

  async disconnect({ wipeSession = false } = {}) {
    await this.pause();
    if (wipeSession) this.store.deleteSession(this.accountId);
    this.store.setAccountStatus(this.accountId, "disconnected");
    return this.status();
  }

  getQr() {
    return this.qr;
  }

  #persistQrImage(image) {
    try {
      if (!image) return;
      const raw = String(image);
      const b64 = raw.startsWith("data:") ? raw.split(",", 2)[1] : raw;
      const buf = Buffer.from(b64, "base64");
      const dir = path.join(this.store.dataDir, "qr");
      fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
      fs.chmodSync(dir, 0o700);
      const file = path.join(dir, `${this.accountId}_login_qr.png`);
      fs.writeFileSync(file, buf, { mode: 0o600 });
      fs.chmodSync(file, 0o600);
      // Keep the persisted image private and expose only the browser-safe data
      // URL/code. Never return a local filesystem path or create a shared /tmp
      // handoff artifact.
      this.qr = { ...(this.qr || {}), image, updated_at: utcNow() };
    } catch (err) {
      this.store.setHealth(`qr_persist_error_${this.accountId}`, String(err?.message || err));
    }
  }
}

async function safeAccountInfo(api) {
  try {
    if (typeof api.fetchAccountInfo === "function") {
      const info = await api.fetchAccountInfo();
      const { extractAccountIdentity } = await import("./discovery.js");
      const id = extractAccountIdentity(info);
      return { display_name: id.display_name, user_id: id.user_id };
    }
  } catch {
    /* optional */
  }
  return { display_name: "", user_id: "" };
}

async function defaultClientFactory() {
  // placeholder so tests don't import zca-js accidentally via call shape
  return null;
}

defaultClientFactory.loginWithSession = async function loginWithSession(session) {
  const { Zalo } = await import("zca-js");
  const zalo = new Zalo();
  return zalo.login({
    cookie: session.cookie,
    imei: session.imei,
    userAgent: session.userAgent,
  });
};

defaultClientFactory.loginWithQr = async function loginWithQr({ onQr, onScanned, onCredentials }) {
  const { Zalo, LoginQRCallbackEventType } = await import("zca-js");
  const zalo = new Zalo();
  let savedCreds = null;

  const api = await zalo.loginQR({}, (event) => {
    switch (event.type) {
      case LoginQRCallbackEventType.QRCodeGenerated:
        onQr?.({
          image: event.data.image, // base64 or data url depending on lib
          code: event.data.code,
        });
        break;
      case LoginQRCallbackEventType.QRCodeScanned:
        onScanned?.(event.data);
        break;
      case LoginQRCallbackEventType.GotLoginInfo:
        savedCreds = {
          cookie: event.data.cookie,
          imei: event.data.imei,
          userAgent: event.data.userAgent,
        };
        onCredentials?.(savedCreds);
        break;
      default:
        break;
    }
  });

  // Some versions only expose credentials via GotLoginInfo; if missing, leave session save to caller later.
  if (savedCreds) onCredentials?.(savedCreds);
  return api;
};

export class BridgeHub {
  constructor({ config, store, policy, clientFactory = null }) {
    this.config = config;
    this.store = store;
    this.policy = policy;
    this.clientFactory = clientFactory;
    this.runtimes = new Map();
  }

  getRuntime(accountId = this.config.default_account_id) {
    const id = String(accountId || this.config.default_account_id);
    if (!this.runtimes.has(id)) {
      this.store.ensureAccount(id);
      this.runtimes.set(
        id,
        new AccountRuntime({
          accountId: id,
          store: this.store,
          policy: this.policy,
          clientFactory: this.clientFactory,
          onEvent: (event, runtime) => this.handleEvent(event, runtime),
        }),
      );
    }
    return this.runtimes.get(id);
  }

  async handleEvent(event, runtime) {
    const decision = this.policy.evaluateInbound(event);
    this.store.setHealth("last_event_decision", {
      event_id: event.event_id,
      allow: decision.allow,
      reason: decision.reason,
      at: utcNow(),
    });
    if (!decision.allow) return { stored: false, decision };

    if (decision.actions.includes("command")) {
      const { handleCommand } = await import("./commands.js");
      const result = await handleCommand({
        event,
        store: this.store,
        policy: this.policy,
        hub: this,
        config: this.config,
      });
      return { stored: false, decision, command: result, runtime: runtime.accountId };
    }

    if (decision.actions.includes("destination_ask")) {
      // Phase 1 inbound router: "bot ..." → Hermes brain → outbound guard.
      this.store.putEvent({ ...event, source_name: event.source_name || "destination" });
      const { isBotCommand, handleBotBrainCommand } = await import("./inbound_router.js");
      if (!isBotCommand(event.text)) {
        return {
          stored: true,
          decision,
          ask: { ok: false, reason: "missing_bot_prefix" },
          runtime: runtime.accountId,
        };
      }
      const result = await handleBotBrainCommand({
        event,
        store: this.store,
        policy: this.policy,
        hub: this,
        config: this.config,
      });
      return { stored: true, decision, ask: result, runtime: runtime.accountId };
    }

    const stored = this.store.putEvent(event);
    // Auto-learn source names in listen-all mode (metadata only)
    if (stored && event.source_type === "group" && this.config.listen_all_groups) {
      const existing = this.store.getSource(event.account_id, event.source_id);
      if (!existing) {
        this.store.upsertSource({
          accountId: event.account_id,
          sourceId: event.source_id,
          sourceType: "group",
          sourceName: event.source_name || "",
          mode: "listen_only",
          isAllowed: true,
        });
      }
    }
    if (decision.actions.includes("alert_candidate") && stored && this.config.auto_alert) {
      const text = String(event.text || "");
      const high = /gấp|khẩn|scam|lừa|lead|chốt|book|ban|phốt/i.test(text);
      if (high) {
        this.store.putEnrichment({
          message_id: event.event_id,
          account_id: event.account_id,
          priority: "high",
          lead_flag: /lead|chốt|book/i.test(text),
          risk_flag: /scam|lừa|ban|phốt/i.test(text),
          summary: text.slice(0, 200),
        });
        const { maybeSendAlert } = await import("./digest.js");
        maybeSendAlert({
          config: this.config,
          store: this.store,
          policy: this.policy,
          hub: this,
          event,
          enrichment: {
            priority: "high",
            lead_flag: /lead|chốt|book/i.test(text),
            risk_flag: /scam|lừa|ban|phốt/i.test(text),
          },
        }).catch((err) => {
          this.store.setHealth("last_alert_error", String(err?.message || err));
        });
      }
    }
    return { stored, decision, runtime: runtime.accountId };
  }

  listStatus() {
    const ids = new Set([
      this.config.default_account_id,
      ...this.store.listAccounts().map((a) => a.account_id),
      ...this.runtimes.keys(),
    ]);
    return [...ids].map((id) => this.getRuntime(id).status());
  }
}

export function ensureDataLayout(dataDir) {
  fs.mkdirSync(dataDir, { recursive: true, mode: 0o700 });
  fs.mkdirSync(path.join(dataDir, "sessions"), { recursive: true, mode: 0o700 });
  fs.mkdirSync(path.join(dataDir, "qr"), { recursive: true, mode: 0o700 });
}
