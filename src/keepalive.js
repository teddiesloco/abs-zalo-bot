// 24/7 keepalive: auto-connect on boot, reconnect with backoff, health ticks,
// disconnect alerts to destination only. No deep-scroll. History = from attach time.

import { utcNow } from "./schema.js";

const DEFAULTS = {
  tick_ms: 20_000,
  reconnect_base_ms: 5_000,
  reconnect_max_ms: 5 * 60_000,
  stale_message_ms: 0, // 0 = do not treat quiet chat as down
  alert_cooldown_ms: 15 * 60_000,
  auto_connect: true,
};

function num(v, fallback) {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

export function loadKeepaliveOptions(env = process.env) {
  return {
    tick_ms: num(env.KEEPALIVE_TICK_MS, DEFAULTS.tick_ms),
    reconnect_base_ms: num(env.KEEPALIVE_RECONNECT_BASE_MS, DEFAULTS.reconnect_base_ms),
    reconnect_max_ms: num(env.KEEPALIVE_RECONNECT_MAX_MS, DEFAULTS.reconnect_max_ms),
    stale_message_ms: num(env.KEEPALIVE_STALE_MESSAGE_MS, DEFAULTS.stale_message_ms),
    alert_cooldown_ms: num(env.KEEPALIVE_ALERT_COOLDOWN_MS, DEFAULTS.alert_cooldown_ms),
    auto_connect: String(env.KEEPALIVE_AUTO_CONNECT ?? "true") !== "false",
  };
}

/** Pure helper — used by tests without timers. */
export function nextBackoffMs(attempt, baseMs = DEFAULTS.reconnect_base_ms, maxMs = DEFAULTS.reconnect_max_ms) {
  const a = Math.max(0, Number(attempt) || 0);
  const base = Math.max(500, Number(baseMs) || DEFAULTS.reconnect_base_ms);
  const max = Math.max(base, Number(maxMs) || DEFAULTS.reconnect_max_ms);
  const exp = Math.min(max, base * 2 ** Math.min(a, 8));
  const jitter = Math.floor(Math.random() * Math.min(1000, exp * 0.1));
  return Math.min(max, exp + jitter);
}

export function isListenerAlive(runtime) {
  if (!runtime?.api) return false;
  const listener = runtime.api.listener;
  if (!listener) return false;
  // zca-js may expose started/closed flags; treat missing flags as alive if api exists.
  if (listener.closed === true) return false;
  if (listener.started === false) return false;
  return true;
}

export function shouldReconnect({ status, hasSession, listenerAlive, paused }) {
  if (paused) return false;
  if (!hasSession) return false; // need QR — do not thrash
  if (status === "paused" || status === "need_scan") return false;
  if (status === "connected" && listenerAlive) return false;
  return true;
}

/**
 * Build short ops alert for connection issues — no tech jargon.
 */
export function buildConnectionAlert({
  kind = "disconnect",
  displayName = "Zalo",
  detail = "",
  attempt = 0,
} = {}) {
  const title =
    kind === "recovered"
      ? "Kết nối Zalo đã ổn lại — tài khoản đã cấu hình"
      : "Cảnh báo kết nối Zalo — tài khoản đã cấu hình";
  const lines = [title, ""];
  lines.push("Trạng thái:");
  if (kind === "recovered") {
    lines.push(`Tài khoản ${displayName || "Zalo"} đã kết nối lại và đang theo dõi tin mới.`);
  } else if (kind === "need_scan") {
    lines.push("Phiên đăng nhập hết hạn. Cần quét QR lại để tiếp tục theo dõi.");
  } else {
    lines.push(`Mất kết nối tạm thời${attempt > 0 ? ` (lần thử ${attempt})` : ""}. Hệ thống đang tự kết nối lại.`);
  }
  lines.push("");
  lines.push("Số liệu hiện có:");
  lines.push("Chưa có thay đổi số liệu vận hành do sự cố kết nối.");
  lines.push("");
  lines.push("Hoạt động gần đây:");
  lines.push(
    kind === "recovered"
      ? "Đã khôi phục theo dõi tin mới realtime."
      : "Tạm dừng nhận tin mới; sẽ ghi lại sau khi kết nối ổn.",
  );
  if (detail) {
    lines.push("");
    lines.push("Nhận xét:");
    lines.push(String(detail).slice(0, 180));
  }
  lines.push("");
  lines.push("Việc tiếp theo:");
  if (kind === "need_scan") {
    lines.push("1. Quét QR đăng nhập lại.");
    lines.push("2. Kiểm tra tin điều hành sau khi online.");
  } else if (kind === "recovered") {
    lines.push("1. Không cần thao tác thêm.");
    lines.push("2. Tiếp tục theo dõi tin mới realtime.");
  } else {
    lines.push("1. Chờ hệ thống tự kết nối lại.");
    lines.push("2. Nếu quá 15 phút chưa ổn, kiểm tra phiên đăng nhập.");
  }
  return lines.join("\n").slice(0, 2000);
}

export class KeepaliveSupervisor {
  constructor({
    config,
    store,
    policy,
    hub,
    accountId,
    options = {},
    now = () => Date.now(),
    setTimeoutFn = setTimeout,
    clearTimeoutFn = clearTimeout,
    setIntervalFn = setInterval,
    clearIntervalFn = clearInterval,
  }) {
    this.config = config;
    this.store = store;
    this.policy = policy;
    this.hub = hub;
    this.accountId = String(accountId || config.default_account_id);
    this.opts = { ...DEFAULTS, ...options };
    this.now = now;
    this.setTimeoutFn = setTimeoutFn;
    this.clearTimeoutFn = clearTimeoutFn;
    this.setIntervalFn = setIntervalFn;
    this.clearIntervalFn = clearIntervalFn;

    this.started = false;
    this.tickTimer = null;
    this.reconnectTimer = null;
    this.reconnectAttempt = 0;
    this.reconnectInFlight = false;
    this.lastAlertAt = 0;
    this.lastState = "init";
    this.lastError = "";
    this.startedAt = null;
  }

  start() {
    if (this.started) return this.snapshot();
    this.started = true;
    this.startedAt = new Date(this.now()).toISOString();
    this.store.setHealth(`keepalive_${this.accountId}`, {
      started: true,
      at: this.startedAt,
      opts: {
        tick_ms: this.opts.tick_ms,
        reconnect_base_ms: this.opts.reconnect_base_ms,
        reconnect_max_ms: this.opts.reconnect_max_ms,
      },
    });
    // Boot connect once.
    if (this.opts.auto_connect) {
      this.#scheduleReconnect(0, "boot");
    }
    this.tickTimer = this.setIntervalFn(() => {
      this.tick().catch((err) => {
        try {
          this.store.setHealth(`keepalive_tick_error_${this.accountId}`, String(err?.message || err));
        } catch {
          /* ignore */
        }
      });
    }, this.opts.tick_ms);
    // first tick soon
    this.setTimeoutFn(() => {
      this.tick().catch(() => {});
    }, 1500);
    return this.snapshot();
  }

  stop() {
    this.started = false;
    if (this.tickTimer) this.clearIntervalFn(this.tickTimer);
    if (this.reconnectTimer) this.clearTimeoutFn(this.reconnectTimer);
    this.tickTimer = null;
    this.reconnectTimer = null;
  }

  snapshot() {
    const runtime = this.hub.getRuntime(this.accountId);
    const st = runtime.status();
    const alive = isListenerAlive(runtime);
    return {
      started: this.started,
      account_id: this.accountId,
      status: st.status,
      listener_alive: alive,
      reconnect_attempt: this.reconnectAttempt,
      reconnect_in_flight: this.reconnectInFlight,
      last_state: this.lastState,
      last_error: this.lastError || st.last_error || "",
      last_message_at: runtime.lastMessageAt || null,
      started_at: this.startedAt,
      now: new Date(this.now()).toISOString(),
    };
  }

  async tick() {
    if (!this.started) return this.snapshot();
    const runtime = this.hub.getRuntime(this.accountId);
    const st = runtime.status();
    const hasSession = this.store.hasSession(this.accountId);
    const listenerAlive = isListenerAlive(runtime);
    const paused = this.store.isGlobalPaused() || st.status === "paused";

    this.store.setHealth(`keepalive_tick_${this.accountId}`, {
      at: utcNow(),
      status: st.status,
      listener_alive: listenerAlive,
      has_session: hasSession,
      reconnect_attempt: this.reconnectAttempt,
      last_message_at: runtime.lastMessageAt || null,
    });

    if (st.status === "connected" && listenerAlive) {
      if (this.lastState !== "healthy") {
        const prev = this.lastState;
        this.lastState = "healthy";
        this.reconnectAttempt = 0;
        this.lastError = "";
        if (prev === "reconnecting" || prev === "down") {
          await this.#maybeAlert("recovered", { displayName: st.display_name });
        }
      }
      return this.snapshot();
    }

    if (st.status === "need_scan" || !hasSession) {
      this.lastState = "need_scan";
      await this.#maybeAlert("need_scan", {
        displayName: st.display_name,
        detail: "Phiên đăng nhập chưa sẵn sàng.",
      });
      return this.snapshot();
    }

    if (shouldReconnect({ status: st.status, hasSession, listenerAlive, paused })) {
      this.lastState = "reconnecting";
      this.#scheduleReconnect(this.reconnectAttempt, st.last_error || "listener_down");
    }
    return this.snapshot();
  }

  #scheduleReconnect(attempt, reason) {
    if (this.reconnectInFlight) return;
    if (this.reconnectTimer) return;
    const delay = attempt <= 0 ? 200 : nextBackoffMs(attempt, this.opts.reconnect_base_ms, this.opts.reconnect_max_ms);
    this.reconnectTimer = this.setTimeoutFn(() => {
      this.reconnectTimer = null;
      this.#doReconnect(reason).catch(() => {});
    }, delay);
    this.store.setHealth(`keepalive_schedule_${this.accountId}`, {
      at: utcNow(),
      attempt,
      delay_ms: delay,
      reason: String(reason || "").slice(0, 200),
    });
  }

  async #doReconnect(reason) {
    if (this.reconnectInFlight || !this.started) return;
    this.reconnectInFlight = true;
    this.reconnectAttempt += 1;
    const attempt = this.reconnectAttempt;
    const runtime = this.hub.getRuntime(this.accountId);
    try {
      this.store.setAccountStatus(this.accountId, "reconnecting", {
        last_error: String(reason || "reconnect").slice(0, 300),
      });
      // Drop stale api so connect re-binds listener.
      try {
        runtime.api?.listener?.stop?.();
      } catch {
        /* ignore */
      }
      runtime.api = null;
      runtime.listenerWired = false;
      runtime._wiredListener = null;
      await runtime.connect({ forceQr: false });
      const wasDown = attempt > 1 || this.lastState === "down" || this.lastState === "reconnecting";
      this.lastState = "healthy";
      this.reconnectAttempt = 0;
      this.lastError = "";
      this.store.setHealth(`keepalive_reconnect_ok_${this.accountId}`, {
        at: utcNow(),
        attempt,
      });
      if (wasDown && attempt > 1) {
        await this.#maybeAlert("recovered", {
          displayName: runtime.status().display_name,
          attempt,
        });
      }
    } catch (err) {
      this.lastState = "down";
      this.lastError = String(err?.message || err).slice(0, 300);
      this.store.setAccountStatus(this.accountId, "disconnected", {
        last_error: this.lastError,
      });
      this.store.setHealth(`keepalive_reconnect_err_${this.accountId}`, {
        at: utcNow(),
        attempt,
        error: this.lastError,
      });
      await this.#maybeAlert("disconnect", {
        displayName: runtime.status().display_name,
        detail: this.lastError,
        attempt,
      });
      // schedule next
      this.reconnectInFlight = false;
      this.#scheduleReconnect(this.reconnectAttempt, this.lastError);
      return;
    } finally {
      this.reconnectInFlight = false;
    }
  }

  async #maybeAlert(kind, { displayName = "", detail = "", attempt = 0 } = {}) {
    const now = this.now();
    if (now - this.lastAlertAt < this.opts.alert_cooldown_ms) {
      return { sent: false, reason: "alert_cooldown" };
    }
    const text = buildConnectionAlert({ kind, displayName, detail, attempt });
    const dest = this.store.getDestination(this.accountId);
    if (!dest?.group_id) return { sent: false, reason: "no_destination" };

    const outbound = this.policy.evaluateOutbound({
      accountId: this.accountId,
      targetId: dest.group_id,
      text,
      kind: "alert",
      alertKey: `keepalive:${kind}`,
    });
    if (!outbound.allow) {
      this.store.setHealth(`keepalive_alert_blocked_${this.accountId}`, {
        at: utcNow(),
        reason: outbound.reason,
        kind,
      });
      return { sent: false, reason: outbound.reason };
    }

    try {
      const runtime = this.hub.getRuntime(this.accountId);
      if (!runtime.api?.sendMessage) {
        // Queue as health note only when offline.
        this.store.setHealth(`keepalive_alert_queued_${this.accountId}`, {
          at: utcNow(),
          kind,
          text: text.slice(0, 500),
        });
        return { sent: false, reason: "not_connected" };
      }
      await runtime.sendText(dest.group_id, text, 1);
      this.lastAlertAt = now;
      this.store.setCooldown(this.accountId, `keepalive:${kind}`);
      this.store.audit(this.accountId, "system", "keepalive_alert", `${kind}:${attempt}`);
      return { sent: true, kind };
    } catch (err) {
      this.store.setHealth(`keepalive_alert_error_${this.accountId}`, String(err?.message || err));
      return { sent: false, reason: String(err?.message || err) };
    }
  }
}
